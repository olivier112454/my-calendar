/**
 * Central product configuration.
 *
 * The product name lives here and nowhere else — rename the app by changing
 * NEXT_PUBLIC_APP_NAME (or this default) and every surface follows.
 */

export const appConfig = {
  name: process.env.NEXT_PUBLIC_APP_NAME || 'Dayflow',
  tagline: 'Your time, under control.',
  description:
    'Calendar, tasks and communication in one intelligent workspace.',
  /** Short form used in tight spots (mobile header, favicon text). */
  shortName: (process.env.NEXT_PUBLIC_APP_NAME || 'Dayflow').slice(0, 12),
} as const

/** Absolute base URL, safe on both server and client. */
export function appUrl(): string {
  if (typeof window !== 'undefined') return window.location.origin
  return process.env.APP_URL || 'http://localhost:3000'
}

/**
 * Accent colours offered in Settings → Appearance. Each is used as a solid
 * fill behind white text, so every value clears 4.5:1 against #fff.
 */
export const accentColors = [
  { name: 'Indigo', value: '#4f46e5' },
  { name: 'Blue', value: '#2563eb' },
  { name: 'Teal', value: '#0d7d74' },
  { name: 'Green', value: '#15803d' },
  { name: 'Amber', value: '#b45309' },
  { name: 'Orange', value: '#c2410c' },
  { name: 'Rose', value: '#be123c' },
  { name: 'Purple', value: '#7c3aed' },
  { name: 'Graphite', value: '#3f3f46' },
] as const

/**
 * Calendar / category colours. `fg` is a darkened variant used for text on the
 * pale event fill in light mode; `fgDark` does the same job in dark mode. Both
 * were picked to clear 4.5:1 against their own tinted background.
 */
export const calendarPalette = [
  { name: 'Indigo', value: '#4f46e5' },
  { name: 'Blue', value: '#2563eb' },
  { name: 'Sky', value: '#0369a1' },
  { name: 'Teal', value: '#0d7d74' },
  { name: 'Green', value: '#15803d' },
  { name: 'Lime', value: '#4d7c0f' },
  { name: 'Amber', value: '#b45309' },
  { name: 'Orange', value: '#c2410c' },
  { name: 'Red', value: '#dc2626' },
  { name: 'Rose', value: '#be123c' },
  { name: 'Pink', value: '#a21caf' },
  { name: 'Purple', value: '#7c3aed' },
  { name: 'Slate', value: '#475569' },
  { name: 'Graphite', value: '#3f3f46' },
] as const

export type CalendarColor = (typeof calendarPalette)[number]['value']

/** Default reminder offsets offered in the event composer, in minutes. */
export const reminderPresets = [
  { label: 'At time of event', minutes: 0 },
  { label: '5 minutes before', minutes: 5 },
  { label: '10 minutes before', minutes: 10 },
  { label: '15 minutes before', minutes: 15 },
  { label: '30 minutes before', minutes: 30 },
  { label: '1 hour before', minutes: 60 },
  { label: '2 hours before', minutes: 120 },
  { label: '1 day before', minutes: 1440 },
  { label: '1 week before', minutes: 10080 },
] as const

export const defaultDurations = [15, 25, 30, 45, 60, 90, 120] as const

/**
 * How far ahead the Schedule page looks, and so how much of the calendar it
 * loads. Lives here rather than beside the view because the server page reads
 * it too, and a value imported from a `'use client'` module arrives undefined
 * on the server.
 */
export const scheduleHorizons = [3, 7, 14, 30] as const
export const maxScheduleHorizonDays = 30
