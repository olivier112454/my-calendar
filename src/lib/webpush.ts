import 'server-only'
import {
  createECDH,
  createHmac,
  createSign,
  createPrivateKey,
  createCipheriv,
  randomBytes,
} from 'node:crypto'

/**
 * Web Push: VAPID signing and payload encryption.
 *
 * Written against RFC 8291 (encryption) and RFC 8292 (VAPID) rather than pulled
 * from a package, for the same reason the OAuth flow is hand-written here: it is
 * one HTTP request with a fixed, well-specified envelope, and the alternative
 * drags in a small dependency tree for it. Every constant below comes straight
 * from those documents.
 *
 * The push service routes the message but can never read it — the payload is
 * encrypted to keys only the subscribed browser holds. That is what makes it
 * acceptable to put an event title in a notification at all.
 */

export interface PushKeys {
  /** The device's P-256 public key, base64url. */
  p256dh: string
  /** The device's auth secret, base64url. */
  auth: string
}

export interface VapidKeys {
  publicKey: string
  privateKey: string
  /** Contact for the push service, as `mailto:` or a URL. */
  subject: string
}

export class PushGoneError extends Error {
  constructor(readonly status: number) {
    super(`The push subscription is no longer valid (${status}).`)
    this.name = 'PushGoneError'
  }
}

const b64url = (buf: Buffer): string => buf.toString('base64url')
const fromB64url = (value: string): Buffer => Buffer.from(value, 'base64url')

/** HKDF (RFC 5869) with SHA-256, which is all Web Push uses. */
function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  const prk = createHmac('sha256', salt).update(ikm).digest()
  const output = createHmac('sha256', prk)
    .update(Buffer.concat([info, Buffer.from([1])]))
    .digest()
  return output.subarray(0, length)
}

/**
 * Encrypts a payload for one subscription, in the `aes128gcm` content encoding.
 *
 * The result is the complete request body: a header carrying the salt, the
 * record size and the sender's ephemeral public key, followed by the ciphertext.
 */
function encrypt(payload: string, keys: PushKeys): Buffer {
  const clientPublic = fromB64url(keys.p256dh)
  const authSecret = fromB64url(keys.auth)

  // A fresh key pair per message: the shared secret must never repeat.
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  const serverPublic = ecdh.getPublicKey()
  const sharedSecret = ecdh.computeSecret(clientPublic)

  // RFC 8291 §3.3 — the info string binds the secret to both parties' keys.
  const prk = hkdf(
    authSecret,
    sharedSecret,
    Buffer.concat([
      Buffer.from('WebPush: info\0'),
      clientPublic,
      serverPublic,
    ]),
    32,
  )

  const salt = randomBytes(16)
  const key = hkdf(salt, prk, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  const nonce = hkdf(salt, prk, Buffer.from('Content-Encoding: nonce\0'), 12)

  // A single record, so the padding delimiter is 0x02 ("last record").
  const plaintext = Buffer.concat([Buffer.from(payload, 'utf8'), Buffer.from([2])])
  const cipher = createCipheriv('aes-128-gcm', key, nonce)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
    cipher.getAuthTag(),
  ])

  const recordSize = Buffer.alloc(4)
  recordSize.writeUInt32BE(4096)

  return Buffer.concat([
    salt,
    recordSize,
    Buffer.from([serverPublic.length]),
    serverPublic,
    ciphertext,
  ])
}

/**
 * The VAPID `Authorization` header: an ES256 JWT saying who is sending, scoped
 * to one push service and valid for a limited time.
 */
function vapidHeader(endpoint: string, vapid: VapidKeys): string {
  const audience = new URL(endpoint).origin
  const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const body = b64url(
    Buffer.from(
      JSON.stringify({
        aud: audience,
        // Twelve hours; the spec caps it at 24 and short-lived is cheap.
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: vapid.subject,
      }),
    ),
  )
  const signingInput = `${header}.${body}`

  // Node signs ECDSA as DER; JWS wants the raw r||s pair.
  const der = createSign('SHA256')
    .update(signingInput)
    .sign(privateKeyObject(vapid.privateKey, vapid.publicKey))
  const signature = b64url(derToJose(der))

  return `vapid t=${signingInput}.${signature}, k=${vapid.publicKey}`
}

/** Wraps a raw 32-byte P-256 scalar as a key object Node can sign with. */
function privateKeyObject(privateKey: string, publicKey: string) {
  const d = fromB64url(privateKey)
  const q = fromB64url(publicKey)
  // SEC1 EC private key, DER: version, the scalar, the named curve, the point.
  const der = Buffer.concat([
    Buffer.from([0x30, 0x77, 0x02, 0x01, 0x01, 0x04, 0x20]),
    d,
    Buffer.from([0xa0, 0x0a, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]),
    Buffer.from([0xa1, 0x44, 0x03, 0x42, 0x00]),
    q,
  ])
  return createPrivateKey({ key: der, format: 'der', type: 'sec1' })
}

/** DER-encoded ECDSA signature to the fixed-width r||s JWS wants. */
function derToJose(der: Buffer): Buffer {
  let offset = 3
  const rLength = der[offset]!
  offset += 1
  const r = der.subarray(offset, offset + rLength)
  offset += rLength + 2
  const s = der.subarray(offset)

  const out = Buffer.alloc(64)
  // Both halves are left-padded to 32 bytes; DER strips leading zeros and adds
  // one when the high bit is set, so neither can be copied verbatim.
  r.subarray(Math.max(0, r.length - 32)).copy(out, Math.max(0, 32 - r.length))
  s.subarray(Math.max(0, s.length - 32)).copy(out, 32 + Math.max(0, 32 - s.length))
  return out
}

/**
 * Delivers one notification.
 *
 * Throws `PushGoneError` when the push service says the subscription is dead —
 * the caller should delete the row rather than retry, because it will never
 * succeed again.
 */
export async function sendPush(
  endpoint: string,
  keys: PushKeys,
  payload: unknown,
  vapid: VapidKeys,
  ttlSeconds = 900,
): Promise<void> {
  const body = encrypt(JSON.stringify(payload), keys)

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: vapidHeader(endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttlSeconds),
      // Reminders are worth waking the device for; anything less is ignored by
      // some services when the phone is dozing.
      Urgency: 'high',
    },
    body: new Uint8Array(body),
  })

  if (response.status === 404 || response.status === 410) {
    throw new PushGoneError(response.status)
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Push failed (${response.status}) ${detail.slice(0, 200)}`)
  }
}

/** Generates a VAPID key pair, for `npm run setup` and the README. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  return {
    publicKey: b64url(ecdh.getPublicKey()),
    privateKey: b64url(ecdh.getPrivateKey()),
  }
}

/** Reads the configured keys, or null when push is simply not set up. */
export function vapidFromEnv(): VapidKeys | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) return null
  return {
    publicKey,
    privateKey,
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  }
}

/** Exported so the tests can verify both halves; not part of the send path. */
export const __testing = { encrypt, vapidHeader, derToJose }
