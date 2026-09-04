import 'server-only'
import type { EventDraft } from '@/types/domain'
import type { EmailCategory } from '@/server/services/email-extractor'

/**
 * The boundary between this app and a language model.
 *
 * Same shape as the other provider interfaces, and for the same reason: above
 * this line nothing knows which model is used, or that one is used at all. The
 * rules engine and the model both answer the same question and return the same
 * `ExtractionResult`, so the Inbox, the API and the composer are untouched.
 *
 * Two rules an implementation must keep, inherited from the extractor it backs:
 *
 *  - It never writes. Its output is a draft the user confirms.
 *  - It reports how sure it is, honestly. A model that is confidently wrong
 *    about a date is worse than one that says it does not know, because the
 *    first ends up in someone's calendar.
 */

export interface ReadEventInput {
  subject: string | null
  fromName: string | null
  fromEmail: string | null
  /** The body excerpt the provider gives us; never the full message. */
  snippet: string | null
  /** The user's zone, so "Thursday at two" resolves to the right instant. */
  timezone: string
  /** What the model should treat as now, in the user's zone. */
  nowIso: string
}

export interface ReadEventResult {
  category: EmailCategory
  /** Null when the message contains no appointment worth proposing. */
  draft: EventDraft | null
  confidence: number
  /** One short sentence the UI can show: why this was read as an appointment. */
  reason: string | null
}

export interface AssistantService {
  /** Identifies the backend in logs and settings, e.g. "claude-sonnet-5". */
  readonly name: string
  readEvent(input: ReadEventInput): Promise<ReadEventResult>
}

export class AssistantError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'AssistantError'
  }
}
