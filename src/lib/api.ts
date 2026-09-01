import 'server-only'
import { NextResponse } from 'next/server'
import { ZodError, type ZodType } from 'zod'
import { ForbiddenError, UnauthorizedError } from './auth'

/**
 * One response shape for every API route:
 *
 *   success -> { data: ... }
 *   failure -> { error: { code, message, fields? } }
 *
 * `message` is always something a person can act on. Stack traces and database
 * errors are logged server-side and replaced with a generic message, because
 * leaking internals is both a poor experience and an information disclosure.
 */

export type ApiError = {
  code: string
  message: string
  fields?: Record<string, string[]>
}

export type ApiResponse<T> = { data: T } | { error: ApiError }

export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string = 'bad_request',
    readonly status: number = 400,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class NotFoundError extends AppError {
  constructor(what = 'That item') {
    super(`${what} could not be found`, 'not_found', 404)
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 'conflict', 409)
  }
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json<ApiResponse<T>>({ data }, { status: 200, ...init })
}

export function created<T>(data: T) {
  return NextResponse.json<ApiResponse<T>>({ data }, { status: 201 })
}

export function noContent() {
  return new NextResponse(null, { status: 204 })
}

export function fail(
  message: string,
  code = 'bad_request',
  status = 400,
  fields?: Record<string, string[]>,
) {
  return NextResponse.json<ApiResponse<never>>(
    { error: { code, message, ...(fields ? { fields } : {}) } },
    { status },
  )
}

/**
 * Wraps a route handler so every thrown error becomes a well-formed response.
 * Handlers can therefore `throw new NotFoundError()` instead of threading
 * response objects through their control flow.
 */
export function route<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args)
    } catch (error) {
      return toErrorResponse(error)
    }
  }
}

export function toErrorResponse(error: unknown): Response {
  if (error instanceof UnauthorizedError) {
    return fail(error.message, 'unauthorized', 401)
  }
  if (error instanceof ForbiddenError) {
    return fail(error.message, 'forbidden', 403)
  }
  if (error instanceof AppError) {
    return fail(error.message, error.code, error.status)
  }
  if (error instanceof ZodError) {
    return fail('Some fields need attention', 'validation_error', 422, fieldErrors(error))
  }
  console.error('[api] unhandled error', error)
  return fail(
    'Something went wrong on our side. Please try again.',
    'internal_error',
    500,
  )
}

function fieldErrors(error: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    ;(out[key] ??= []).push(issue.message)
  }
  return out
}

/**
 * Parses and validates a JSON body. Never trust the client: every route that
 * accepts input runs it through a Zod schema before it reaches a service.
 */
export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    throw new AppError('Expected a JSON body', 'invalid_json', 400)
  }
  return schema.parse(payload)
}

/** Same, for query strings. */
export function parseQuery<T>(request: Request, schema: ZodType<T>): T {
  const url = new URL(request.url)
  const raw: Record<string, string | string[]> = {}
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key)
    raw[key] = values.length > 1 ? values : values[0]!
  }
  return schema.parse(raw)
}

/** Extracts `{ data }` from a fetch to our own API, throwing on `{ error }`. */
export async function unwrap<T>(response: Response): Promise<T> {
  const body = (await response.json()) as ApiResponse<T>
  if ('error' in body) {
    throw new AppError(body.error.message, body.error.code, response.status)
  }
  return body.data
}
