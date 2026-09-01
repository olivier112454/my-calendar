import { addDaysToKey, todayKey, wallToUtc } from '../datetime'
import type { TaskPriority } from '@/types/domain'

/**
 * Quick-add parser for tasks.
 *
 * Deliberately smaller in scope than the event parser: a task line is short and
 * the conventions are well established, so it recognises a handful of explicit
 * tokens rather than trying to read a sentence.
 *
 *   "Send the report tomorrow p1 45m #Work"
 *   -> title "Send the report", due tomorrow, P1, 45 minutes, project Work
 */

export interface ParsedTask {
  title: string
  dueAt: string | null
  priority: TaskPriority | null
  estimatedMinutes: number | null
  projectName: string | null
  /** What was recognised, echoed back so the user can see the interpretation. */
  matched: string[]
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
}

/** Tasks default to end-of-working-day rather than midnight. */
const DEFAULT_DUE_HOUR = 17

export function parseTaskLine(input: string, timezone: string): ParsedTask {
  let rest = ` ${input.trim()} `
  const matched: string[] = []

  const consume = (pattern: RegExp, handler: (match: RegExpMatchArray) => void) => {
    const match = rest.match(pattern)
    if (!match) return false
    handler(match)
    rest = rest.replace(match[0], ' ')
    return true
  }

  /* -------------------------------------------------------------- priority */

  let priority: TaskPriority | null = null
  // `!` is not a word character, so a leading \b would never match "!2" —
  // each alternative carries its own boundary instead.
  consume(/(?:\bp([1-4])\b|!([1-4])\b)/i, (match) => {
    priority = `P${match[1] ?? match[2]}` as TaskPriority
    matched.push(priority)
  })

  /* -------------------------------------------------------------- estimate */

  let estimatedMinutes: number | null = null
  consume(/\b(\d+(?:[.,]\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?)\b/i, (match) => {
    const value = Number(match[1]!.replace(',', '.'))
    estimatedMinutes = /^h/i.test(match[2]!) ? Math.round(value * 60) : Math.round(value)
    matched.push(`${estimatedMinutes} min`)
  })

  /* --------------------------------------------------------------- project */

  let projectName: string | null = null
  consume(/\s#([A-Za-zÀ-ÿ0-9][\wÀ-ÿ-]*)/, (match) => {
    projectName = match[1]!
    matched.push(`#${projectName}`)
  })

  /* ------------------------------------------------------------------- due */

  let dueKey: string | null = null
  const today = todayKey(timezone)

  const setDue = (key: string, label: string) => {
    dueKey = key
    matched.push(label)
  }

  if (!dueKey) consume(/\btoday\b/i, () => setDue(today, 'today'))
  if (!dueKey) consume(/\btomorrow\b/i, () => setDue(addDaysToKey(today, 1), 'tomorrow'))
  if (!dueKey) {
    consume(/\bin\s+(\d{1,2})\s+days?\b/i, (match) =>
      setDue(addDaysToKey(today, Number(match[1])), `in ${match[1]} days`),
    )
  }
  if (!dueKey) {
    consume(/\bnext\s+week\b/i, () => setDue(addDaysToKey(today, 7), 'next week'))
  }
  if (!dueKey) {
    consume(
      /\b(?:(next|this)\s+)?(sunday|sun|monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat)\b/i,
      (match) => {
        const target = WEEKDAYS[match[2]!.toLowerCase()]!
        const currentDay = new Date(`${today}T12:00:00`).getDay()
        let delta = (target - currentDay + 7) % 7
        if (delta === 0) delta = 7
        if (match[1]?.toLowerCase() === 'next') delta += 7
        setDue(
          addDaysToKey(today, delta),
          `${match[1] ? `${match[1]} ` : ''}${match[2]}`,
        )
      },
    )
  }
  if (!dueKey) {
    consume(/\b(\d{4}-\d{2}-\d{2})\b/, (match) => setDue(match[1]!, match[1]!))
  }

  /* ----------------------------------------------------------------- title */

  const title =
    rest
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^(?:by|on|due)\s+/i, '')
      .replace(/[\s,;:-]+$/, '') || 'New task'

  return {
    title,
    dueAt: dueKey
      ? wallToUtc(`${dueKey}T${String(DEFAULT_DUE_HOUR).padStart(2, '0')}:00`, timezone).toISOString()
      : null,
    priority,
    estimatedMinutes,
    projectName,
    matched,
  }
}
