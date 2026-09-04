import 'server-only'
import { AnthropicAssistant } from './anthropic'
import type { AssistantService } from './types'

/**
 * The configured model, or null when none is.
 *
 * Null is a supported state, not a broken one: without a key the app falls back
 * to the rules engine, which is what it has always used. Nothing announces a
 * feature that cannot run.
 */

let cached: AssistantService | null | undefined

export function assistant(): AssistantService | null {
  if (cached !== undefined) return cached

  const key = process.env.ANTHROPIC_API_KEY
  cached = key ? new AnthropicAssistant(key, process.env.ASSISTANT_MODEL) : null
  return cached
}

export function assistantConfigured(): boolean {
  return assistant() !== null
}

/** Test seam; not used at runtime. */
export function __setAssistant(value: AssistantService | null | undefined): void {
  cached = value
}
