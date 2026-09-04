import 'server-only'
import { wallToUtc } from '@/lib/datetime'
import type { EventDraft } from '@/types/domain'
import type { EmailCategory } from '@/server/services/email-extractor'
import {
  AssistantError,
  type AssistantService,
  type ReadEventInput,
  type ReadEventResult,
} from './types'

/**
 * Reads an email with Claude.
 *
 * Plain `fetch` against the Messages API rather than the SDK, for the same
 * reason the OAuth and Web Push code is hand-written here: this is one request
 * with a fixed shape, and the alternative is a dependency tree for it.
 *
 * The answer comes back through a forced tool call rather than as prose. That
 * is not decoration — it means the model has to fill in a typed structure, so
 * "sometime next week" cannot arrive as a sentence where a date is expected,
 * and a malformed answer fails loudly instead of parsing into a wrong date.
 */

const API = 'https://api.anthropic.com/v1/messages'
const VERSION = '2023-06-01'
const DEFAULT_MODEL = 'claude-sonnet-5'

const CATEGORIES: EmailCategory[] = [
  'OTHER',
  'MEETING',
  'RESERVATION',
  'TRAVEL',
  'DEADLINE',
  'INVITATION',
  'TICKET',
]

/**
 * The structure the model must fill in.
 *
 * Every date is a local wall clock without a zone: the model reasons about
 * "Thursday at two", and this app owns the conversion to an instant. Handing
 * the model that job as well would put timezone maths in the one place it
 * cannot be tested.
 */
const TOOL = {
  name: 'record_reading',
  description: 'Record what this message says about an appointment.',
  input_schema: {
    type: 'object' as const,
    properties: {
      category: { type: 'string', enum: CATEGORIES },
      is_appointment: {
        type: 'boolean',
        description:
          'True only when the message concerns a specific occasion at a specific time. A newsletter, a receipt or a security alert is not one.',
      },
      title: {
        type: 'string',
        description:
          'Short, as the user would write it themselves: "Dentist", "Lunch with Mark". Never the email subject verbatim if that reads like marketing.',
      },
      start: {
        type: 'string',
        description:
          'Local start as YYYY-MM-DDTHH:mm, or YYYY-MM-DD when all-day. Empty when the message gives no concrete date.',
      },
      end: { type: 'string', description: 'Same format as start. Empty if unknown.' },
      all_day: { type: 'boolean' },
      location: { type: 'string' },
      participants: {
        type: 'array',
        items: { type: 'string' },
        description: 'Names or addresses of other people involved.',
      },
      confidence: {
        type: 'number',
        description:
          '0 to 1. Above 0.8 only when the date and time are stated outright. Guessing costs the user a wrong entry in their calendar, so under-report rather than over-report.',
      },
      reason: {
        type: 'string',
        description: 'One short sentence, in the language of the message, saying what was read.',
      },
    },
    required: ['category', 'is_appointment', 'confidence'],
  },
}

function systemPrompt(input: ReadEventInput): string {
  return [
    'You read one email and decide whether it describes an appointment worth putting in a calendar.',
    '',
    `Today is ${input.nowIso} in the timezone ${input.timezone}. Resolve relative dates against that:`,
    '"tomorrow", "donderdag", "next week", "over twee weken".',
    '',
    'Both Dutch and English appear, often mixed and informal. "Zullen we donderdag na de lunch',
    'even bijpraten?" is an appointment; guess a sensible time from the daypart and lower your',
    'confidence accordingly.',
    '',
    'Say it is not an appointment when there is no specific occasion: newsletters, receipts,',
    'password resets, security alerts, marketing, delivery notices without a slot.',
    '',
    'Never invent a date. If a message proposes a meeting but names no day, record it as an',
    'appointment with an empty start and low confidence — the user is shown the message either',
    'way, and a made-up date is worse than none.',
  ].join('\n')
}

function userPrompt(input: ReadEventInput): string {
  return [
    `From: ${input.fromName ?? 'unknown'} <${input.fromEmail ?? 'unknown'}>`,
    `Subject: ${input.subject ?? '(none)'}`,
    '',
    input.snippet ?? '(no preview available)',
  ].join('\n')
}

interface ToolUse {
  type: string
  name?: string
  input?: Record<string, unknown>
}

export class AnthropicAssistant implements AssistantService {
  readonly name: string

  constructor(
    private readonly apiKey: string,
    model?: string,
  ) {
    this.name = model || DEFAULT_MODEL
  }

  async readEvent(input: ReadEventInput): Promise<ReadEventResult> {
    let response: Response
    try {
      response = await fetch(API, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': VERSION,
        },
        body: JSON.stringify({
          model: this.name,
          max_tokens: 512,
          system: systemPrompt(input),
          messages: [{ role: 'user', content: userPrompt(input) }],
          tools: [TOOL],
          // Forced: the model must answer through the structure, not around it.
          tool_choice: { type: 'tool', name: TOOL.name },
        }),
        // A slow model must not hold up a whole mailbox sync.
        signal: AbortSignal.timeout(20_000),
      })
    } catch (cause) {
      throw new AssistantError(`Could not reach the model: ${String(cause)}`, true)
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      // 429 and 5xx are worth another go later; 400 and 401 never are.
      const retryable = response.status === 429 || response.status >= 500
      throw new AssistantError(
        `Model returned ${response.status}: ${detail.slice(0, 200)}`,
        retryable,
      )
    }

    const payload = (await response.json()) as { content?: ToolUse[] }
    const call = payload.content?.find(
      (block) => block.type === 'tool_use' && block.name === TOOL.name,
    )
    if (!call?.input) {
      throw new AssistantError('Model answered without using the tool.', true)
    }

    return toResult(call.input, input)
  }
}

const str = (value: unknown): string | null => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length > 0 ? text : null
}

/** Turns the model's answer into the app's own shape, distrusting every field. */
function toResult(raw: Record<string, unknown>, input: ReadEventInput): ReadEventResult {
  const category = (CATEGORIES as string[]).includes(String(raw.category))
    ? (raw.category as EmailCategory)
    : 'OTHER'

  const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0))
  const reason = str(raw.reason)

  const start = str(raw.start)
  // A draft without a start is not something the calendar can offer, whatever
  // the model thought of it.
  if (!raw.is_appointment || !start) {
    return { category, draft: null, confidence, reason }
  }

  const allDay = raw.all_day === true
  const draft: EventDraft = {
    title: str(raw.title) ?? str(input.subject) ?? 'Appointment',
    start: toInstant(start, allDay, input.timezone),
    end: toInstant(str(raw.end), allDay, input.timezone),
    allDay,
    location: str(raw.location),
    participants: Array.isArray(raw.participants)
      ? raw.participants
          .map((entry) => str(entry))
          .filter((entry): entry is string => entry !== null)
          .slice(0, 10)
          .map((entry) => (entry.includes('@') ? { email: entry } : { name: entry }))
      : undefined,
    confidence,
    matched: reason ? [reason] : [],
  }

  if (!draft.start) return { category, draft: null, confidence, reason }
  return { category, draft, confidence, reason }
}

/**
 * The model answers in the user's wall clock; a draft carries an instant.
 *
 * The conversion happens here rather than in the prompt because it is the one
 * step that must be right every time, including across a DST change — and a
 * model cannot be unit-tested. Anything not in the two accepted shapes is
 * dropped rather than coerced: a half-understood date is the failure that
 * reaches the calendar looking correct.
 */
function toInstant(
  value: string | null,
  allDay: boolean,
  timezone: string,
): string | null {
  if (!value) return null
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const wallClock = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
  if (!dateOnly && !wallClock) return null

  // An all-day event, or a date with no time, starts at local midnight.
  const wall = wallClock && !allDay ? value : `${value.slice(0, 10)}T00:00`
  const instant = wallToUtc(wall, timezone)
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString()
}
