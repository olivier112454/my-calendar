import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Stable initials for avatars, e.g. "Olivier Pinkster" -> "OP". */
export function initials(name: string | null | undefined, fallback = '?') {
  if (!name) return fallback
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return fallback
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Deterministic colour pick from the palette, used for contacts without one. */
export function colorFromString(input: string, palette: readonly string[]) {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i)
    hash |= 0
  }
  return palette[Math.abs(hash) % palette.length]
}

export function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export function truncate(input: string, max: number) {
  return input.length <= max ? input : input.slice(0, max - 1).trimEnd() + '…'
}

/** Groups a list by a derived key, preserving insertion order. */
export function groupBy<T, K extends string>(
  items: readonly T[],
  key: (item: T) => K,
): Map<K, T[]> {
  const out = new Map<K, T[]>()
  for (const item of items) {
    const k = key(item)
    const bucket = out.get(k)
    if (bucket) bucket.push(item)
    else out.set(k, [item])
  }
  return out
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function unique<T>(items: readonly T[]): T[] {
  return Array.from(new Set(items))
}

/** Fires `fn` at most once per `wait` ms, on the trailing edge. */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  wait: number,
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const wrapped = (...args: A) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
  wrapped.cancel = () => timer && clearTimeout(timer)
  return wrapped
}
