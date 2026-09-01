import 'server-only'
import { headers } from 'next/headers'
import { AppError } from './api'
import { hashIp } from './crypto'

/**
 * Fixed-window rate limiter.
 *
 * Backed by an in-process Map, which is the right trade-off for a single
 * instance and honest about its limits: behind multiple replicas each one keeps
 * its own counters. `check()` is the only entry point, so swapping in Redis
 * later touches this file alone.
 *
 * Applied to the endpoints that are cheap to call and expensive to serve:
 * public booking pages, OAuth callbacks, search, and anything that talks to a
 * third-party API on the user's behalf.
 */

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()
let lastSweep = Date.now()

function sweep(now: number) {
  if (now - lastSweep < 60_000) return
  lastSweep = now
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

export function check(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now()
  sweep(now)

  const existing = buckets.get(key)
  if (!existing || existing.resetAt <= now) {
    const bucket = { count: 1, resetAt: now + windowMs }
    buckets.set(key, bucket)
    return { allowed: true, remaining: limit - 1, resetAt: bucket.resetAt }
  }

  existing.count += 1
  return {
    allowed: existing.count <= limit,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
  }
}

/** Throws a 429 when the caller is over budget. */
export async function enforce(
  scope: string,
  { limit, windowMs }: { limit: number; windowMs: number },
  identifier?: string,
): Promise<void> {
  const id = identifier ?? (await callerFingerprint())
  const result = check(`${scope}:${id}`, limit, windowMs)
  if (!result.allowed) {
    const seconds = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))
    throw new AppError(
      `Too many requests. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`,
      'rate_limited',
      429,
    )
  }
}

/** Hashed client IP — enough to bucket by caller without storing addresses. */
export async function callerFingerprint(): Promise<string> {
  const headerList = await headers()
  const forwarded = headerList.get('x-forwarded-for')
  const ip = forwarded?.split(',')[0]?.trim() ?? headerList.get('x-real-ip') ?? 'unknown'
  return hashIp(ip) ?? 'unknown'
}

export const limits = {
  /** Public booking submissions — the only unauthenticated write in the app. */
  booking: { limit: 10, windowMs: 60 * 60 * 1000 },
  bookingAvailability: { limit: 120, windowMs: 60 * 1000 },
  /** OAuth start/callback, to blunt state-table flooding. */
  oauth: { limit: 20, windowMs: 10 * 60 * 1000 },
  /** Provider sync — each run costs third-party quota. */
  sync: { limit: 30, windowMs: 5 * 60 * 1000 },
  search: { limit: 120, windowMs: 60 * 1000 },
  write: { limit: 300, windowMs: 60 * 1000 },
} as const
