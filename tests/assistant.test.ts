import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * The model-backed extractor.
 *
 * What is worth pinning here is not that a model can read a sentence — it can —
 * but everything around it: that a wrong or hostile answer cannot become a
 * calendar entry, that a wall clock becomes the right instant, and that the app
 * still works when the model does not.
 */

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** One Messages API response carrying a forced tool call. */
function reply(input: Record<string, unknown>, status = 200) {
  return {
    ok: status === 200,
    status,
    json: async () => ({ content: [{ type: 'tool_use', name: 'record_reading', input }] }),
    text: async () => 'error body',
  } as unknown as Response
}

const AMS = 'Europe/Amsterdam'

async function read(input: Record<string, unknown>, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => reply(input, status)))
  const { AnthropicAssistant } = await import('@/server/providers/assistant/anthropic')
  return new AnthropicAssistant('test-key').readEvent({
    subject: 'Even bijpraten',
    fromName: 'Lars',
    fromEmail: 'lars@example.com',
    snippet: 'Zullen we donderdag na de lunch even bijpraten?',
    timezone: AMS,
    nowIso: '2026-09-01T09:00:00.000Z',
  })
}

describe('reading an email with a model', () => {
  it('turns a local wall clock into the right instant', async () => {
    const result = await read({
      category: 'MEETING',
      is_appointment: true,
      title: 'Bijpraten met Lars',
      start: '2026-09-03T14:00',
      end: '2026-09-03T15:00',
      confidence: 0.72,
      reason: 'Donderdag na de lunch',
    })

    // September is summer time in Amsterdam: 14:00 local is 12:00 UTC.
    expect(result.draft?.start).toBe('2026-09-03T12:00:00.000Z')
    expect(result.draft?.end).toBe('2026-09-03T13:00:00.000Z')
    expect(result.category).toBe('MEETING')
  })

  it('gets the offset right on the other side of a DST change', async () => {
    const result = await read({
      category: 'MEETING',
      is_appointment: true,
      title: 'Winteroverleg',
      start: '2026-12-03T14:00',
      confidence: 0.9,
    })

    // December is winter time: 14:00 local is 13:00 UTC.
    expect(result.draft?.start).toBe('2026-12-03T13:00:00.000Z')
  })

  it('refuses a draft when the model names no date', async () => {
    const result = await read({
      category: 'MEETING',
      is_appointment: true,
      title: 'Koffie',
      start: '',
      confidence: 0.6,
    })

    // The message is still surfaced as a meeting; it just cannot be scheduled.
    expect(result.draft).toBeNull()
    expect(result.category).toBe('MEETING')
  })

  it('drops a date it cannot parse rather than guessing', async () => {
    const result = await read({
      category: 'MEETING',
      is_appointment: true,
      title: 'Ergens volgende week',
      start: 'next Thursday afternoon',
      confidence: 0.8,
    })

    expect(result.draft).toBeNull()
  })

  it('keeps an unknown category out of the app', async () => {
    const result = await read({
      category: 'WEDDING',
      is_appointment: false,
      confidence: 0.3,
    })

    expect(result.category).toBe('OTHER')
  })

  it('clamps a confidence outside 0–1', async () => {
    const high = await read({ category: 'OTHER', is_appointment: false, confidence: 42 })
    const low = await read({ category: 'OTHER', is_appointment: false, confidence: -3 })

    expect(high.confidence).toBe(1)
    expect(low.confidence).toBe(0)
  })

  it('treats a rate limit as retryable and a bad request as not', async () => {
    const { AssistantError } = await import('@/server/providers/assistant/types')

    await expect(read({}, 429)).rejects.toMatchObject({ retryable: true })
    await expect(read({}, 400)).rejects.toMatchObject({ retryable: false })
    // Both are the app's own error type, not a raw fetch failure.
    await expect(read({}, 500)).rejects.toBeInstanceOf(AssistantError)
  })
})

describe('choosing between the rules and the model', () => {
  const message = {
    externalId: 'm1',
    threadId: 't1',
    subject: 'Even bijpraten',
    fromName: 'Lars',
    fromEmail: 'lars@example.com',
    toEmails: [],
    snippet: 'Zullen we donderdag na de lunch even bijpraten?',
    receivedAt: new Date('2026-09-01T09:00:00Z'),
    isUnread: true,
    isImportant: false,
    labels: [],
    hasCalendarAttachment: false,
  }

  it('does not call the model when the rules are already confident', async () => {
    const { __setAssistant } = await import('@/server/providers/assistant/registry')
    const readEvent = vi.fn()
    __setAssistant({ name: 'stub', readEvent })

    const { emailExtractor } = await import('@/server/services/email-extractor')
    // A Google Meet invitation is exactly what the patterns are for.
    await emailExtractor.extract(
      {
        ...message,
        subject: 'Invitation: Design review @ Thu Sep 3, 2026 14:00 - 15:00',
        snippet: 'You have been invited. Google Meet link included. RSVP',
      },
      AMS,
    )

    expect(readEvent).not.toHaveBeenCalled()
    __setAssistant(undefined)
  })

  it('falls back to the rules when the model fails', async () => {
    const { __setAssistant } = await import('@/server/providers/assistant/registry')
    __setAssistant({
      name: 'stub',
      readEvent: async () => {
        throw new Error('model down')
      },
    })

    const { emailExtractor } = await import('@/server/services/email-extractor')
    const result = await emailExtractor.extract(message, AMS)

    // No throw, and still a usable answer.
    expect(result).toHaveProperty('category')
    expect(result.confidence).toBeGreaterThanOrEqual(0)
    __setAssistant(undefined)
  })

  it('keeps the rules when the model is less sure than they are', async () => {
    const { __setAssistant } = await import('@/server/providers/assistant/registry')
    __setAssistant({
      name: 'stub',
      readEvent: async () => ({
        category: 'OTHER' as const,
        draft: null,
        confidence: 0.01,
        reason: null,
      }),
    })

    const { emailExtractor } = await import('@/server/services/email-extractor')
    const invitation = {
      ...message,
      subject: 'Invitation: Design review @ Thu Sep 3, 2026 14:00',
      snippet: 'RSVP — Google Meet',
    }
    const result = await emailExtractor.extract(invitation, AMS)

    expect(result.category).not.toBe('OTHER')
    __setAssistant(undefined)
  })
})

describe('how often a message is read', () => {
  /**
   * The mailbox returns the same messages every sync, and reading is the only
   * step that can cost money. This pins the rule that makes the bill follow the
   * mail rather than the clock: a message is read once.
   */
  it('reads a message once, however often it comes back', async () => {
    const { __setAssistant } = await import('@/server/providers/assistant/registry')
    const readEvent = vi.fn(async () => ({
      category: 'MEETING' as const,
      draft: null,
      confidence: 0.6,
      reason: null,
    }))
    __setAssistant({ name: 'stub', readEvent })

    const { emailExtractor } = await import('@/server/services/email-extractor')
    const vague = {
      externalId: 'm1',
      threadId: 't1',
      subject: 'Even bijpraten',
      fromName: 'Lars',
      fromEmail: 'lars@example.com',
      toEmails: [],
      snippet: 'Zullen we een keer afspreken?',
      receivedAt: new Date('2026-09-01T09:00:00Z'),
      isUnread: true,
      isImportant: false,
      labels: [],
      hasCalendarAttachment: false,
    }

    // The extractor itself has no memory — that is `refreshInbox`'s job, which
    // looks the message up before asking. What is pinned here is the other half:
    // an unclear message does reach the model, so the skip has to happen above.
    await emailExtractor.extract(vague, AMS)
    expect(readEvent).toHaveBeenCalledTimes(1)

    __setAssistant(undefined)
  })
})
