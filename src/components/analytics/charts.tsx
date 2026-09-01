'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { formatDuration } from '@/lib/datetime'

/**
 * The charts, built from plain elements.
 *
 * Hand-rolled rather than pulled from a charting library because the visual
 * rules this app follows — thin marks, rounded data-ends anchored to the
 * baseline, a 2px surface gap between stacked segments, recessive axes — are
 * exactly the things a general-purpose library fights you on. The whole set is
 * a few hundred lines and has no dependencies.
 *
 * Colour follows two rules throughout:
 *  - Two parts of one measure (booked time split into appointments and focus) are
 *    two steps of ONE hue, separated by lightness. That stays legible under any
 *    accent the user picks and under every kind of colour blindness.
 *  - Categories and calendars carry their OWN colour, because the colour is the
 *    entity's identity elsewhere in the app. Those are always accompanied by a
 *    written label, so identity is never carried by colour alone.
 */

/* ------------------------------------------------------------ stat tile */

export function StatTile({
  label,
  value,
  hint,
  trend,
}: {
  label: string
  value: string
  hint?: string
  trend?: { direction: 'up' | 'down' | 'flat'; label: string }
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
        {label}
      </p>
      <p className="mt-1 text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-fg">
        {value}
      </p>
      {hint || trend ? (
        <p className="mt-1.5 text-[11px] text-fg-muted">
          {trend ? (
            <span
              className={cn(
                'mr-1.5 font-medium',
                trend.direction === 'up' && 'text-success',
                trend.direction === 'down' && 'text-danger',
              )}
            >
              {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→'}{' '}
              {trend.label}
            </span>
          ) : null}
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------- stacked column chart */

export interface DayDatum {
  dayKey: string
  meetingMinutes: number
  focusMinutes: number
}

/**
 * Booked time per day, split into appointments and focus.
 *
 * One hue in two steps: the darker step is appointments, the lighter is focus. The
 * legend names both, and hovering a column gives the exact figures — the
 * lighter step falls below 3:1 against the surface, so it must never be the
 * only way a number is available.
 */
export function DailyLoadChart({
  data,
  height = 160,
}: {
  data: DayDatum[]
  height?: number
}) {
  const [hovered, setHovered] = React.useState<number | null>(null)

  const max = Math.max(
    60,
    ...data.map((entry) => entry.meetingMinutes + entry.focusMinutes),
  )
  const plotHeight = height - 20

  /*
   * Laid out with elements rather than SVG.
   *
   * A stretched viewBox (`preserveAspectRatio="none"`) scales the horizontal
   * axis to fit any width, which is right for the bars and disastrous for the
   * labels — the glyphs get squashed into illegible slivers. Boxes size
   * themselves and text stays text.
   */
  return (
    <figure className="relative">
      <figcaption className="sr-only">
        Booked time per day, split into appointments and focus time. Highest day:{' '}
        {formatDuration(max)}.
      </figcaption>

      <div className="relative" style={{ height: plotHeight }}>
        {/* Recessive gridlines behind the bars. */}
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          {[0.25, 0.5, 0.75, 1].map((fraction) => (
            <span
              key={fraction}
              className="absolute inset-x-0 border-t border-grid-line"
              style={{ bottom: fraction * plotHeight }}
            />
          ))}
        </div>

        <div className="flex h-full items-end gap-1">
          {data.map((entry, index) => {
            const total = entry.meetingMinutes + entry.focusMinutes
            const active = hovered === index || hovered === null
            return (
              <div
                key={entry.dayKey}
                className="flex h-full flex-1 flex-col justify-end"
                onPointerEnter={() => setHovered(index)}
                onPointerLeave={() => setHovered(null)}
              >
                {total === 0 ? (
                  <span
                    aria-hidden="true"
                    className="h-0.5 w-full rounded-full bg-grid-line-strong"
                  />
                ) : (
                  <>
                    {/* Appointments sit on top of focus time; a 2px gap of surface
                        between them keeps the boundary readable. */}
                    {entry.meetingMinutes > 0 ? (
                      <span
                        className="w-full rounded-t-[3px] transition-opacity"
                        style={{
                          height: (entry.meetingMinutes / max) * plotHeight,
                          backgroundColor: 'var(--accent)',
                          opacity: active ? 1 : 0.5,
                          marginBottom: entry.focusMinutes > 0 ? 2 : 0,
                        }}
                      />
                    ) : null}
                    {entry.focusMinutes > 0 ? (
                      <span
                        className="w-full rounded-b-[3px] transition-opacity"
                        style={{
                          height: (entry.focusMinutes / max) * plotHeight,
                          backgroundColor:
                            'color-mix(in oklab, var(--accent) 38%, var(--surface))',
                          opacity: active ? 1 : 0.5,
                          borderTopLeftRadius: entry.meetingMinutes > 0 ? 0 : 3,
                          borderTopRightRadius: entry.meetingMinutes > 0 ? 0 : 3,
                        }}
                      />
                    ) : null}
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Labels share the bars' grid, so they cannot drift out of alignment. */}
      <div className="mt-1 flex gap-1" aria-hidden="true">
        {data.map((entry, index) => (
          <span
            key={entry.dayKey}
            className="flex-1 truncate text-center text-[10px] text-fg-subtle"
          >
            {shortDay(entry.dayKey, data.length, index)}
          </span>
        ))}
      </div>

      {hovered !== null && data[hovered] ? (
        <div
          role="status"
          className="pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 rounded-md border border-border bg-surface px-2 py-1 text-[11px] shadow-md"
        >
          <span className="font-medium text-fg">
            {new Date(`${data[hovered]!.dayKey}T12:00:00`).toLocaleDateString('en-GB', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            })}
          </span>
          <span className="ml-2 text-fg-muted">
            {formatDuration(data[hovered]!.meetingMinutes)} appointments ·{' '}
            {formatDuration(data[hovered]!.focusMinutes)} focus
          </span>
        </div>
      ) : null}

      <Legend
        items={[
          { label: 'Appointments', color: 'var(--accent)' },
          {
            label: 'Focus & task blocks',
            color: 'color-mix(in oklab, var(--accent) 38%, var(--surface))',
          },
        ]}
      />
    </figure>
  )
}

function shortDay(dayKey: string, total: number, index: number): string {
  const date = new Date(`${dayKey}T12:00:00`)
  if (total <= 7) return date.toLocaleDateString('en-GB', { weekday: 'short' })
  if (total <= 14) return date.toLocaleDateString('en-GB', { weekday: 'narrow' })
  // Over a long range only the Mondays and the first of the month are labelled;
  // seven columns of text in the space of one is not a label.
  const milestone = date.getDay() === 1 || date.getDate() === 1
  return milestone || index === 0 ? String(date.getDate()) : ''
}

/* --------------------------------------------------- horizontal bar list */

export interface BarDatum {
  name: string
  color: string
  minutes: number
}

/**
 * Time by category or calendar.
 *
 * A ranked bar list rather than a pie: comparing lengths against a shared
 * baseline is something people can actually do, and comparing angles is not.
 * Every row carries its name and its value in text.
 */
export function TimeByBars({
  data,
  emptyLabel,
  max = 6,
}: {
  data: BarDatum[]
  emptyLabel: string
  max?: number
}) {
  if (data.length === 0) {
    return <p className="py-6 text-center text-[13px] text-fg-muted">{emptyLabel}</p>
  }

  const shown = data.slice(0, max)
  const rest = data.slice(max)
  const restMinutes = rest.reduce((total, entry) => total + entry.minutes, 0)
  const rows = restMinutes > 0
    ? [...shown, { name: 'Everything else', color: '#94a3b8', minutes: restMinutes }]
    : shown

  const largest = Math.max(...rows.map((entry) => entry.minutes), 1)
  const total = data.reduce((sum, entry) => sum + entry.minutes, 0)

  return (
    <ul className="space-y-2">
      {rows.map((entry) => (
        <li key={entry.name}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="truncate text-[13px] text-fg">{entry.name}</span>
            </span>
            <span className="shrink-0 text-[12px] tabular-nums text-fg-muted">
              {formatDuration(entry.minutes)}
              <span className="ml-1.5 text-fg-subtle">
                {Math.round((entry.minutes / total) * 100)}%
              </span>
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(2, (entry.minutes / largest) * 100)}%`,
                backgroundColor: entry.color,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------- weekday */

/**
 * Average load per weekday. A single measure across seven fixed buckets, so one
 * hue at varying lightness carries magnitude — no categorical colour needed.
 */
export function WeekdayHeat({
  data,
  weekStartsOn,
}: {
  data: { weekday: number; meetingMinutes: number }[]
  weekStartsOn: number
}) {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const ordered = Array.from({ length: 7 }, (_, index) => {
    const weekday = (index + weekStartsOn) % 7
    return data.find((entry) => entry.weekday === weekday) ?? { weekday, meetingMinutes: 0 }
  })
  const max = Math.max(...ordered.map((entry) => entry.meetingMinutes), 1)

  return (
    <ul className="grid grid-cols-7 gap-1.5">
      {ordered.map((entry) => {
        const intensity = entry.meetingMinutes / max
        return (
          <li key={entry.weekday} className="text-center">
            <div
              className="flex h-12 items-end justify-center rounded-md border border-border"
              style={{
                backgroundColor:
                  intensity === 0
                    ? 'var(--surface-2)'
                    : `color-mix(in oklab, var(--accent) ${Math.round(
                        18 + intensity * 62,
                      )}%, var(--surface))`,
              }}
              title={`${names[entry.weekday]}: ${formatDuration(entry.meetingMinutes)}`}
            >
              <span className="pb-1 text-[10px] font-medium tabular-nums text-fg">
                {entry.meetingMinutes > 0 ? formatDuration(entry.meetingMinutes) : ''}
              </span>
            </div>
            <span className="mt-1 block text-[10px] text-fg-subtle">
              {names[entry.weekday]}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/* -------------------------------------------------------------- legend */

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          <span className="text-[11px] text-fg-muted">{item.label}</span>
        </li>
      ))}
    </ul>
  )
}
