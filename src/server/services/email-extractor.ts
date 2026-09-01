import 'server-only'
import { parseEventText } from '@/lib/nlp/parse-event'
import type { EventDraft } from '@/types/domain'
import type { RemoteMessage } from '../providers/types'

/**
 * Turns a message into a proposed event.
 *
 * The contract is deliberately narrow — message in, `ExtractionResult` out — so
 * the implementation can be replaced without touching the Inbox page, the API,
 * or the composer. Today it is a rules engine over the subject and snippet;
 * `AssistantService` can later route low-confidence messages to a model and
 * return the same shape.
 *
 * Two rules the implementation must keep:
 *
 *  - It never writes. Its output is a draft the user confirms.
 *  - It says how sure it is. Below the confidence floor the UI shows the mail
 *    as ordinary mail rather than as a suggestion, because a wrong suggestion
 *    costs more attention than a missing one.
 */

export type EmailCategory =
  | 'OTHER'
  | 'MEETING'
  | 'RESERVATION'
  | 'TRAVEL'
  | 'DEADLINE'
  | 'INVITATION'
  | 'TICKET'

export interface ExtractionResult {
  category: EmailCategory
  /** Null when nothing date-like was found. */
  draft: EventDraft | null
  confidence: number
}

export interface EmailEventExtractor {
  extract(message: RemoteMessage, timezone: string): ExtractionResult | Promise<ExtractionResult>
}

/** Below this the Inbox does not offer "Add to calendar". */
export const SUGGESTION_THRESHOLD = 0.45

const CATEGORY_SIGNALS: { category: EmailCategory; patterns: RegExp[]; weight: number }[] = [
  {
    category: 'INVITATION',
    patterns: [
      /\binvit(?:ation|ed|es)\b/i,
      /\bhas invited you\b/i,
      /\brsvp\b/i,
      /\bgoogle meet\b|\bmicrosoft teams\b|\bzoom meeting\b/i,
    ],
    weight: 0.45,
  },
  {
    category: 'TRAVEL',
    patterns: [
      /\bflight\b|\bboarding\b|\bdeparts?\b|\bdeparture\b/i,
      /\btrain\b.*\bticket\b|\bplatform\b/i,
      /\bcheck[- ]in\b/i,
      /\b[A-Z]{2}\d{2,4}\b/, // flight numbers such as KL1601
    ],
    weight: 0.4,
  },
  {
    category: 'RESERVATION',
    patterns: [
      /\breservation\b|\breserved\b|\bbooking confirmed\b/i,
      /\btable for \d+\b/i,
      /\bappointment\b/i,
    ],
    weight: 0.4,
  },
  {
    category: 'MEETING',
    patterns: [
      /\bmeet(?:ing)?\b/i,
      /\bcall\b/i,
      /\bcatch up\b/i,
      /\bare you (?:free|available)\b/i,
      /\bcould we\b/i,
    ],
    weight: 0.3,
  },
  {
    category: 'DEADLINE',
    patterns: [
      /\bdeadline\b/i,
      /\bdue (?:on|by)\b/i,
      /\bsubmissions? clos/i,
      /\blast day\b/i,
      /\bexpires? on\b/i,
    ],
    weight: 0.35,
  },
  {
    category: 'TICKET',
    patterns: [/\bticket\b/i, /\byour (?:pass|entry)\b/i, /\bdoors open\b/i],
    weight: 0.3,
  },
]

/** Senders that are never worth proposing an appointment from. */
const NOISE_SENDERS = [
  /\bnoreply@/i,
  /\bno-reply@/i,
  /\bnotifications?@/i,
  /\bnewsletter@/i,
]

/** Subjects that look date-ish but are not appointments. */
const NOISE_SUBJECTS = [
  /\border has shipped\b/i,
  /\bdelivery\b/i,
  /\breceipt\b/i,
  /\binvoice\b/i,
  /\bpassword\b/i,
  /\bunsubscribe\b/i,
  /\bnewsletter\b/i,
]

export class RuleBasedExtractor implements EmailEventExtractor {
  extract(message: RemoteMessage, timezone: string): ExtractionResult {
    const subject = message.subject ?? ''
    const snippet = message.snippet ?? ''
    const text = `${subject}. ${snippet}`

    if (NOISE_SUBJECTS.some((pattern) => pattern.test(subject))) {
      return { category: 'OTHER', draft: null, confidence: 0 }
    }

    /* ------------------------------------------------------- category */

    let category: EmailCategory = 'OTHER'
    let categoryScore = 0

    for (const signal of CATEGORY_SIGNALS) {
      const hits = signal.patterns.filter((pattern) => pattern.test(text)).length
      if (hits === 0) continue
      // More matching signals from one category is stronger evidence, but with
      // diminishing returns so a keyword-stuffed mail cannot dominate.
      const score = signal.weight * (1 + Math.min(hits - 1, 2) * 0.25)
      if (score > categoryScore) {
        categoryScore = score
        category = signal.category
      }
    }

    // A .ics attachment is near-proof, whatever the wording.
    if (message.hasCalendarAttachment) {
      category = 'INVITATION'
      categoryScore = Math.max(categoryScore, 0.6)
    }

    /* ----------------------------------------------------------- when */

    const parsed = parseEventText(text, { timezone, defaultDurationMinutes: 60 })
    const matched = parsed.matched ?? []
    const hasWhen = matched.some((entry) =>
      /\d|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i.test(
        entry,
      ),
    )

    let confidence = categoryScore
    if (hasWhen) confidence += 0.3
    if (matched.some((entry) => /^\d{2}:\d{2}/.test(entry))) confidence += 0.15
    if (NOISE_SENDERS.some((pattern) => pattern.test(message.fromEmail ?? ''))) {
      // Automated senders do send real confirmations, so this is a penalty
      // rather than a veto.
      confidence -= 0.15
    }
    if (message.isImportant) confidence += 0.05

    confidence = Math.max(0, Math.min(1, confidence))

    if (category === 'OTHER' || !hasWhen) {
      return { category, draft: null, confidence: Math.min(confidence, 0.3) }
    }

    /* ---------------------------------------------------------- draft */

    const draft: EventDraft = {
      // The subject is a better title than a sentence pulled from the body.
      title: cleanSubject(subject) || parsed.title,
      start: parsed.start,
      end: parsed.end,
      allDay: parsed.allDay,
      location: parsed.location ?? null,
      description: buildDescription(message),
      participants: participantsFrom(message, parsed.participants ?? []),
      recurrenceRule: parsed.recurrenceRule ?? null,
      meetingUrl: null,
      confidence,
      matched,
    }

    return { category, draft, confidence }
  }
}

/** Strips the reply and invitation noise a subject collects. */
function cleanSubject(subject: string): string {
  return subject
    .replace(/^(re|fwd?|fw)\s*:\s*/i, '')
    .replace(/^invitation:\s*/i, '')
    // Google puts the whole time range in the subject of an invite.
    .replace(/\s*@\s*\w{3},?\s+\d{1,2}\s+\w{3,}.*$/i, '')
    .trim()
}

function buildDescription(message: RemoteMessage): string {
  const parts = [
    message.fromName || message.fromEmail
      ? `From: ${message.fromName ?? ''} ${message.fromEmail ? `<${message.fromEmail}>` : ''}`.trim()
      : null,
    message.snippet,
  ].filter(Boolean)
  return parts.join('\n\n')
}

function participantsFrom(
  message: RemoteMessage,
  parsed: { name?: string; email?: string }[],
): { name?: string; email?: string }[] {
  const out = [...parsed]
  if (message.fromEmail && !out.some((entry) => entry.email === message.fromEmail)) {
    out.unshift({ name: message.fromName ?? undefined, email: message.fromEmail })
  }
  return out.slice(0, 25)
}

/** The extractor the app uses. One place to swap in a different strategy. */
export const emailExtractor: EmailEventExtractor = new RuleBasedExtractor()
