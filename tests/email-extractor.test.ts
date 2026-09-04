import { describe, expect, it } from 'vitest'
import { RuleBasedExtractor, SUGGESTION_THRESHOLD } from '@/server/services/email-extractor'
import type { RemoteMessage } from '@/server/providers/types'
import { AMS } from './helpers'

/**
 * The email-to-event extractor.
 *
 * Two failure modes matter, and they are not symmetrical. Missing a booking
 * confirmation costs the user a manual entry. Proposing an event from a
 * shipping notification costs their trust in every future suggestion — so the
 * "must not fire" cases below are the more important half of this file.
 */

function message(overrides: Partial<RemoteMessage> = {}): RemoteMessage {
  return {
    externalId: 'msg-1',
    threadId: 'thread-1',
    subject: null,
    fromName: null,
    fromEmail: 'someone@example.com',
    toEmails: ['me@example.com'],
    snippet: null,
    receivedAt: new Date('2026-08-31T09:00:00Z'),
    isUnread: false,
    isImportant: false,
    labels: ['INBOX'],
    hasCalendarAttachment: false,
    ...overrides,
  }
}

/**
 * The rules engine on its own, not the exported extractor.
 *
 * What is being pinned here is which patterns fire and which must not — a
 * question about the patterns, not about whether a model was reachable. Testing
 * the composed extractor would make these depend on a network call and drop the
 * synchronous reads below.
 */
const rules = new RuleBasedExtractor()
const extract = (input: Partial<RemoteMessage>) => rules.extract(message(input), AMS)

describe('recognising appointments', () => {
  it('reads a meeting proposal', () => {
    const result = extract({
      subject: 'Meeting next Tuesday?',
      fromName: 'John Smith',
      snippet: 'Could we meet next Tuesday at 14:00 to go through the results?',
    })
    expect(result.category).toBe('MEETING')
    expect(result.confidence).toBeGreaterThanOrEqual(SUGGESTION_THRESHOLD)
    expect(result.draft).not.toBeNull()
  })

  it('reads a restaurant reservation', () => {
    const result = extract({
      subject: 'Reservation confirmed — Fratelli',
      snippet: 'Table for 4 on Friday at 19:30, Korenmarkt 12, Arnhem.',
    })
    expect(result.category).toBe('RESERVATION')
    expect(result.confidence).toBeGreaterThanOrEqual(SUGGESTION_THRESHOLD)
  })

  it('reads a flight confirmation', () => {
    const result = extract({
      subject: 'Your flight Amsterdam → Rome',
      fromEmail: 'noreply@klm.example',
      snippet: 'KL1601 departs Amsterdam Schiphol on 14 October at 09:25.',
    })
    expect(result.category).toBe('TRAVEL')
    // An automated sender is a penalty, not a veto — this is still a real event.
    expect(result.confidence).toBeGreaterThanOrEqual(SUGGESTION_THRESHOLD)
  })

  it('reads a deadline', () => {
    const result = extract({
      subject: 'Tender deadline: 12 September',
      snippet: 'Submissions close on 12 September at 17:00.',
    })
    expect(result.category).toBe('DEADLINE')
  })

  it('treats a calendar attachment as near-proof of an invitation', () => {
    const result = extract({
      subject: 'Design review',
      snippet: 'Thursday 4 September, 14:00 – 15:30',
      hasCalendarAttachment: true,
    })
    expect(result.category).toBe('INVITATION')
    expect(result.confidence).toBeGreaterThanOrEqual(SUGGESTION_THRESHOLD)
  })

  it('uses the subject as the title, cleaned of reply prefixes', () => {
    const result = extract({
      subject: 'Re: Meeting next Tuesday',
      snippet: 'Could we meet next Tuesday at 14:00?',
    })
    expect((result.draft as { title: string }).title).toBe('Meeting next Tuesday')
  })

  it('puts the sender in the guest list', () => {
    const result = extract({
      subject: 'Coffee?',
      fromName: 'Emma de Vries',
      fromEmail: 'emma@example.com',
      snippet: 'Could we meet tomorrow at 10:00?',
    })
    const participants = (result.draft as { participants: { email?: string }[] })
      .participants
    expect(participants.some((entry) => entry.email === 'emma@example.com')).toBe(true)
  })
})

describe('refusing to guess', () => {
  it('ignores a shipping notification', () => {
    const result = extract({
      subject: 'Your order has shipped',
      fromEmail: 'noreply@shop.example',
      snippet: 'Your order is on its way and should arrive within two days.',
    })
    expect(result.draft).toBeNull()
    expect(result.confidence).toBeLessThan(SUGGESTION_THRESHOLD)
  })

  it('ignores an invoice', () => {
    const result = extract({
      subject: 'Invoice 2026-0142',
      snippet: 'Payment is due on 30 September.',
    })
    expect(result.draft).toBeNull()
  })

  it('ignores conversational mail with no date in it', () => {
    const result = extract({
      subject: 'Re: Terminal visit',
      snippet: 'Thanks for the notes. I will look through them this week.',
    })
    expect(result.draft).toBeNull()
    expect(result.confidence).toBeLessThan(SUGGESTION_THRESHOLD)
  })

  it('ignores a newsletter even when it mentions dates', () => {
    const result = extract({
      subject: 'Our September newsletter',
      snippet: 'This month: what happened on 3 September and what comes next.',
    })
    expect(result.draft).toBeNull()
  })

  it('produces nothing from an empty message', () => {
    const result = extract({})
    expect(result.category).toBe('OTHER')
    expect(result.draft).toBeNull()
    expect(result.confidence).toBe(0)
  })
})
