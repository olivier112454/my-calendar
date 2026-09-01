'use client'

import type { ApiResponse } from '../api'

/**
 * Thin client for our own API.
 *
 * Two jobs beyond `fetch`: it unwraps the `{ data } | { error }` envelope so
 * callers deal in values, and it turns a failure into an `ApiClientError` that
 * already carries a message fit to show a person.
 */

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly fields?: Record<string, string[]>,
  ) {
    super(message)
    this.name = 'ApiClientError'
  }
}

async function request<T>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json, ...rest } = init ?? {}

  let response: Response
  try {
    response = await fetch(path, {
      ...rest,
      headers: {
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...rest.headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      credentials: 'same-origin',
    })
  } catch {
    // Network-level failure: offline, DNS, connection reset.
    throw new ApiClientError(
      'Could not reach the server. Check your connection and try again.',
      'network_error',
      0,
    )
  }

  if (response.status === 204) return undefined as T

  let body: ApiResponse<T>
  try {
    body = (await response.json()) as ApiResponse<T>
  } catch {
    throw new ApiClientError(
      'The server sent back something unexpected.',
      'invalid_response',
      response.status,
    )
  }

  if ('error' in body) {
    throw new ApiClientError(
      body.error.message,
      body.error.code,
      response.status,
      body.error.fields,
    )
  }
  return body.data
}

export const api = {
  get: <T>(path: string, init?: RequestInit) =>
    request<T>(path, { ...init, method: 'GET' }),
  post: <T>(path: string, json?: unknown, init?: RequestInit) =>
    request<T>(path, { ...init, method: 'POST', json }),
  patch: <T>(path: string, json?: unknown, init?: RequestInit) =>
    request<T>(path, { ...init, method: 'PATCH', json }),
  put: <T>(path: string, json?: unknown, init?: RequestInit) =>
    request<T>(path, { ...init, method: 'PUT', json }),
  delete: <T>(path: string, json?: unknown, init?: RequestInit) =>
    request<T>(path, { ...init, method: 'DELETE', json }),
}

/** Builds a query string, dropping empty values. */
export function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}
