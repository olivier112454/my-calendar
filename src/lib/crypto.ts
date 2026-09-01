import 'server-only'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

/**
 * Symmetric encryption for provider credentials at rest.
 *
 * OAuth refresh tokens are long-lived keys to a user's mailbox and calendar. A
 * database dump must not be enough to use them, so they are sealed with
 * AES-256-GCM under ENCRYPTION_KEY (which lives only in the environment).
 *
 * Format: v1.<iv-b64url>.<tag-b64url>.<ciphertext-b64url>
 * The version prefix leaves room to rotate the scheme later.
 */

const VERSION = 'v1'
const IV_BYTES = 12

let cachedKey: Buffer | null = null

function key(): Buffer {
  if (cachedKey) return cachedKey
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY is not set. Run `npm run setup` or generate one with `openssl rand -base64 32`.',
    )
  }
  // Accept base64 (32 bytes) or any passphrase, normalised through SHA-256.
  const decoded = Buffer.from(raw, 'base64')
  cachedKey = decoded.length === 32 ? decoded : createHash('sha256').update(raw).digest()
  return cachedKey
}

const b64 = (buf: Buffer) => buf.toString('base64url')
const unb64 = (str: string) => Buffer.from(str, 'base64url')

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  return [VERSION, b64(iv), b64(cipher.getAuthTag()), b64(ciphertext)].join('.')
}

export function decryptSecret(payload: string): string {
  const [version, ivPart, tagPart, dataPart] = payload.split('.')
  if (version !== VERSION || !ivPart || !tagPart || !dataPart) {
    throw new Error('Malformed ciphertext')
  }
  const decipher = createDecipheriv('aes-256-gcm', key(), unb64(ivPart))
  decipher.setAuthTag(unb64(tagPart))
  return Buffer.concat([
    decipher.update(unb64(dataPart)),
    decipher.final(),
  ]).toString('utf8')
}

/** Returns null instead of throwing — used when a token may be absent or stale. */
export function tryDecryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null
  try {
    return decryptSecret(payload)
  } catch {
    return null
  }
}

/** Opaque, URL-safe random token. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/** One-way hash for values we must look up but never need to read back. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Salted hash of an IP address. Enough to spot session anomalies and rate-limit
 * without keeping a plain record of where a user connects from.
 */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null
  const salt = process.env.AUTH_SECRET ?? ''
  return createHash('sha256').update(salt).update(ip).digest('hex').slice(0, 32)
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
