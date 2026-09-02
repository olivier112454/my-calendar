/**
 * Words the natural-language parsers know, and the readings that depend on them.
 *
 * Both parsers are deliberately plain and deterministic — no model, no network,
 * no cost — so the only thing between them and a second language is vocabulary.
 * Keeping it here rather than inlined in each regex means a language is taught
 * once and both parsers gain it.
 *
 * Dutch sits alongside English rather than behind a setting. The interface is
 * English but the people typing into it are not, and a half-understood sentence
 * is worse than an unrecognised one: "Lunch met Mark morgen om 13:00" used to
 * become an event titled "Lunch met Mark morgen om", on the wrong day, with no
 * guest — three silent errors from one line.
 */

/** Sunday-based, matching `Date#getDay` and `weekdayOf`. */
export const WEEKDAYS: Record<string, number> = {
  // English
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
  // Dutch. Full names only: the standard abbreviations are two letters, and
  // "do" (Thursday) and "zo" (Sunday) are ordinary words in English and Dutch
  // respectively. Reading "Do the dishes" as Thursday would move an event to a
  // day the user never named, which is a worse failure than not reading it.
  zondag: 0,
  maandag: 1,
  dinsdag: 2,
  woensdag: 3,
  donderdag: 4,
  vrijdag: 5,
  zaterdag: 6,
}

export const MONTHS: Record<string, number> = {
  // English
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
  // Dutch. Only the forms that differ from English need adding; the rest of the
  // abbreviations are shared. None of these collide with a common word.
  januari: 0,
  februari: 1,
  mrt: 2, maart: 2,
  mei: 4,
  juni: 5,
  juli: 6,
  augustus: 7,
  okt: 9, oktober: 9,
}

/**
 * Number words one to twelve, used by the Dutch clock phrases where a digit is
 * the exception rather than the rule — "half vier" is far more common written
 * out than as "half 4".
 */
const DUTCH_NUMBERS: Record<string, number> = {
  een: 1, één: 1, twee: 2, drie: 3, vier: 4, vijf: 5, zes: 6,
  zeven: 7, acht: 8, negen: 9, tien: 10, elf: 11, twaalf: 12,
  // Minutes past or to the hour are almost always one of these.
  kwart: 15, vijftien: 15, twintig: 20, vijfentwintig: 25,
}

/**
 * Alternation source with the longest words first, so "september" is not
 * matched as "sep" and "maandag" not as "maa".
 */
export function alternation(words: Iterable<string>): string {
  return [...words].sort((a, b) => b.length - a.length).join('|')
}

export const WEEKDAY_PATTERN = alternation(Object.keys(WEEKDAYS))
export const MONTH_PATTERN = alternation(Object.keys(MONTHS))

/** Qualifiers that push a weekday into the following week. */
const NEXT_WORDS = new Set(['next', 'volgende', 'aanstaande'])
/** Qualifiers that mean the coming one, which is what a bare weekday already means. */
const THIS_WORDS = new Set(['this', 'coming', 'deze', 'komende', 'aankomende'])

export const QUALIFIER_PATTERN = alternation([...NEXT_WORDS, ...THIS_WORDS])

export function isNextQualifier(word: string | undefined): boolean {
  return word !== undefined && NEXT_WORDS.has(word.toLowerCase())
}

export function isKnownQualifier(word: string | undefined): boolean {
  if (word === undefined) return false
  const lower = word.toLowerCase()
  return NEXT_WORDS.has(lower) || THIS_WORDS.has(lower)
}

/* ------------------------------------------------------------------ durations */

/**
 * Duration units in both languages. Minutes first so "min" wins over "m", and
 * "uur" over the bare "u" of "1u30".
 */
export const DURATION_UNIT_PATTERN =
  'minuten|minutes|minuut|minute|mins|min|uren|hours|hour|uur|hrs|hr|h|m|u'

export function durationUnitToMinutes(value: number, unit: string): number {
  const isHours = /^(?:u|uur|uren|h|hr|hrs|hour|hours)$/i.test(unit)
  return Math.round(isHours ? value * 60 : value)
}

/**
 * Durations Dutch states as a phrase rather than a number: "anderhalf uur",
 * "een half uur", "drie kwartier". A quarter of an hour is a unit of its own in
 * Dutch and has no natural English equivalent, so it has to be spelled out.
 */
export const NAMED_DURATION_PATTERN =
  "anderhalf\\s+uur|een\\s+half\\s+uur|half\\s+uur|drie\\s+kwartier|een\\s+kwartier|kwartier"

export function namedDurationToMinutes(phrase: string): number | null {
  const normalised = phrase.toLowerCase().replace(/\s+/g, ' ').trim()
  if (normalised === 'anderhalf uur') return 90
  if (normalised === 'een half uur' || normalised === 'half uur') return 30
  if (normalised === 'drie kwartier') return 45
  if (normalised === 'een kwartier' || normalised === 'kwartier') return 15
  return null
}

/* ---------------------------------------------------------------------- time */

/**
 * The part of the day a 12-hour reading belongs to. Dutch marks this with a
 * phrase rather than am/pm, and the marker can sit anywhere in the sentence.
 */
export const DAYPART_PATTERN =
  "'s\\s*ochtends|'s\\s*morgens|'s\\s*middags|'s\\s*avonds|'s\\s*nachts|" +
  'vanochtend|vanmorgen|vanmiddag|vanavond|vannacht|' +
  'morgenochtend|morgenmiddag|morgenavond'

export type Daypart = 'am' | 'pm'

export function daypartOf(phrase: string): Daypart {
  const normalised = phrase.toLowerCase().replace(/\s+/g, '')
  if (/middag|avond/.test(normalised)) return 'pm'
  // Morning and night both read as the small hours or the early ones.
  return 'am'
}

/**
 * Resolve an hour written on a 12-hour clock.
 *
 * With an explicit part of the day the answer is stated. Without one, a bare
 * Dutch clock phrase in a calendar means the working half of the day: "half 4"
 * is 15:30, not 03:30, and "half 7" is 18:30 rather than a dawn appointment.
 * Seven is the pivot, which leaves "half 8" at 07:30 where a standup belongs.
 */
export function resolveTwelveHour(hour: number, daypart: Daypart | null): number {
  const base = hour % 12
  if (daypart === 'pm') return base + 12
  if (daypart === 'am') return base
  return base < 7 ? base + 12 : base
}

function dutchNumber(token: string): number | null {
  const trimmed = token.trim().toLowerCase()
  if (/^\d{1,2}$/.test(trimmed)) return Number(trimmed)
  return DUTCH_NUMBERS[trimmed] ?? null
}

/** An hour on a dial: one to twelve, and never a stray "00" out of "10:00". */
function dialHour(token: string): number | null {
  const value = dutchNumber(token)
  return value !== null && value >= 1 && value <= 12 ? value : null
}

/** Minutes either side of an hour or a half hour; past thirty it is nonsense. */
function dialOffset(token: string): number | null {
  const value = dutchNumber(token)
  return value !== null && value >= 1 && value <= 30 ? value : null
}

const NUMBER_TOKEN = `\\d{1,2}|${alternation(Object.keys(DUTCH_NUMBERS))}`

/**
 * Dutch clock phrases, which name the hour they are heading towards rather than
 * the one just passed: "half vier" is half an hour before four, so 3:30. Every
 * form below is built on that, which is why they all resolve against `hour - 1`
 * apart from the plain "over" case.
 *
 * Ordered longest-construction-first, so "tien over half vier" is not read as
 * "tien over half".
 *
 * The surrounding guards keep the pattern from starting or ending inside a
 * digital time: without them "om 10:00 voor 30 minuten" offers up "00 voor 30",
 * which reads as a valid phrase and silently moves the event to 18:00.
 */
export const DUTCH_CLOCK_PATTERN =
  `(?<![\\w:.])(?:(${NUMBER_TOKEN})\\s+(over|voor)\\s+half\\s+(${NUMBER_TOKEN})` +
  `|half\\s+(${NUMBER_TOKEN})` +
  `|(${NUMBER_TOKEN})\\s+(over|voor)\\s+(${NUMBER_TOKEN}))(?![\\w:.])`

/**
 * Minutes into a 12-hour dial for a Dutch clock phrase, or null when the words
 * do not resolve to a real time. The caller applies the part of the day.
 */
export function dutchClockToMinutes(match: RegExpMatchArray): number | null {
  const [, offsetToHalf, halfDirection, halfHour, plainHalf, offset, direction, hour] =
    match

  // "tien over half vier" / "vijf voor half acht"
  if (offsetToHalf !== undefined && halfHour !== undefined) {
    const minutes = dialOffset(offsetToHalf)
    const target = dialHour(halfHour)
    if (minutes === null || target === null) return null
    const half = (target - 1) * 60 + 30
    return halfDirection?.toLowerCase() === 'voor' ? half - minutes : half + minutes
  }

  // "half vier"
  if (plainHalf !== undefined) {
    const target = dialHour(plainHalf)
    if (target === null) return null
    return (target - 1) * 60 + 30
  }

  // "kwart over negen" / "tien voor zes"
  if (offset !== undefined && hour !== undefined) {
    const minutes = dialOffset(offset)
    const target = dialHour(hour)
    if (minutes === null || target === null) return null
    return direction?.toLowerCase() === 'voor'
      ? (target - 1) * 60 + (60 - minutes)
      : target * 60 + minutes
  }

  return null
}
