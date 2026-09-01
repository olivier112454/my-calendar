import { describe, expect, it } from 'vitest'
import {
  createDecipheriv,
  createECDH,
  createHmac,
  createPublicKey,
  createVerify,
  randomBytes,
} from 'node:crypto'

/**
 * Web Push encryption and VAPID signing.
 *
 * This code talks to Apple's and Google's push services, where a mistake shows
 * up as "notifications silently never arrive" rather than as an error. So both
 * halves are checked the only way that proves anything: the payload is decrypted
 * back the way a browser would, and the VAPID token is verified against its own
 * public key.
 */

const hkdf = (salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer => {
  const prk = createHmac('sha256', salt).update(ikm).digest()
  return createHmac('sha256', prk)
    .update(Buffer.concat([info, Buffer.from([1])]))
    .digest()
    .subarray(0, length)
}

/** Stands in for the browser: makes a subscription's key material. */
function fakeSubscription() {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  return {
    ecdh,
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  }
}

/** The receiving half of RFC 8291, written independently of the sender. */
function decrypt(body: Buffer, sub: ReturnType<typeof fakeSubscription>): string {
  const salt = body.subarray(0, 16)
  const keyLength = body[20]!
  const senderPublic = body.subarray(21, 21 + keyLength)
  const ciphertext = body.subarray(21 + keyLength)

  const shared = sub.ecdh.computeSecret(senderPublic)
  const prk = hkdf(
    Buffer.from(sub.auth, 'base64url'),
    shared,
    Buffer.concat([
      Buffer.from('WebPush: info\0'),
      sub.ecdh.getPublicKey(),
      senderPublic,
    ]),
    32,
  )
  const key = hkdf(salt, prk, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  const nonce = hkdf(salt, prk, Buffer.from('Content-Encoding: nonce\0'), 12)

  const tag = ciphertext.subarray(ciphertext.length - 16)
  const decipher = createDecipheriv('aes-128-gcm', key, nonce)
  decipher.setAuthTag(tag)
  const plain = Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ])
  // Strip the padding delimiter the sender appended.
  return plain.subarray(0, plain.length - 1).toString('utf8')
}

describe('web push encryption', () => {
  it('round-trips a payload the way a browser would read it', async () => {
    const { __testing } = await import('@/lib/webpush')
    const sub = fakeSubscription()
    const payload = JSON.stringify({ title: 'Dentist', body: 'in 30 minutes' })

    const body = __testing.encrypt(payload, { p256dh: sub.p256dh, auth: sub.auth })

    expect(decrypt(body, sub)).toBe(payload)
  })

  it('uses a fresh key and salt for every message', async () => {
    const { __testing } = await import('@/lib/webpush')
    const sub = fakeSubscription()
    const keys = { p256dh: sub.p256dh, auth: sub.auth }

    const first = __testing.encrypt('same text', keys)
    const second = __testing.encrypt('same text', keys)

    // Identical input, different bytes — otherwise the shared secret repeats.
    expect(first.equals(second)).toBe(false)
    expect(decrypt(first, sub)).toBe('same text')
    expect(decrypt(second, sub)).toBe('same text')
  })

  it('survives a payload that is not plain ASCII', async () => {
    const { __testing } = await import('@/lib/webpush')
    const sub = fakeSubscription()
    const payload = '{"title":"Café — 14:00 ☕"}'

    const body = __testing.encrypt(payload, { p256dh: sub.p256dh, auth: sub.auth })

    expect(decrypt(body, sub)).toBe(payload)
  })
})

describe('VAPID', () => {
  /** JWS carries r||s; Node's verifier wants DER. This is derToJose reversed. */
  function joseToDer(sig: Buffer): Buffer {
    const trim = (half: Buffer): Buffer => {
      let i = 0
      while (i < half.length - 1 && half[i] === 0) i += 1
      const rest = half.subarray(i)
      // A leading high bit would read as negative, so DER prefixes a zero.
      return rest[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), rest]) : rest
    }
    const r = trim(sig.subarray(0, 32))
    const s = trim(sig.subarray(32))
    const body = Buffer.concat([
      Buffer.from([0x02, r.length]),
      r,
      Buffer.from([0x02, s.length]),
      s,
    ])
    return Buffer.concat([Buffer.from([0x30, body.length]), body])
  }

  it('signs a token that verifies against its own public key', async () => {
    const { generateVapidKeys, __testing } = await import('@/lib/webpush')
    const keys = generateVapidKeys()
    const endpoint = 'https://fcm.googleapis.com/fcm/send/abc123'

    const header = __testing.vapidHeader(endpoint, {
      ...keys,
      subject: 'mailto:olivier@example.com',
    })

    const token = header.match(/vapid t=([^,]+), k=(.+)$/)
    expect(token).not.toBeNull()
    const [, jwt, sentPublicKey] = token!
    expect(sentPublicKey).toBe(keys.publicKey)

    const [head, body, signature] = jwt!.split('.')
    const claims = JSON.parse(Buffer.from(body!, 'base64url').toString())
    // The audience must be the push service's origin, not the full endpoint —
    // getting this wrong is rejected with a 401 that says nothing useful.
    expect(claims.aud).toBe('https://fcm.googleapis.com')
    expect(claims.sub).toBe('mailto:olivier@example.com')
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
    expect(JSON.parse(Buffer.from(head!, 'base64url').toString()).alg).toBe('ES256')

    const publicKey = createPublicKey({
      key: Buffer.concat([
        Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex'),
        Buffer.from(keys.publicKey, 'base64url'),
      ]),
      format: 'der',
      type: 'spki',
    })
    const verifier = createVerify('SHA256')
    verifier.update(`${head}.${body}`)

    expect(
      verifier.verify(publicKey, joseToDer(Buffer.from(signature!, 'base64url'))),
    ).toBe(true)
  })

  it('rejects a token signed with the wrong key', async () => {
    const { generateVapidKeys, __testing } = await import('@/lib/webpush')
    const signing = generateVapidKeys()
    const other = generateVapidKeys()

    const header = __testing.vapidHeader('https://updates.push.services.mozilla.com/x', {
      ...signing,
      subject: 'mailto:a@b.c',
    })
    const [, jwt] = header.match(/vapid t=([^,]+),/)!
    const [head, body, signature] = jwt!.split('.')

    const wrongKey = createPublicKey({
      key: Buffer.concat([
        Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex'),
        Buffer.from(other.publicKey, 'base64url'),
      ]),
      format: 'der',
      type: 'spki',
    })
    const verifier = createVerify('SHA256')
    verifier.update(`${head}.${body}`)

    expect(
      verifier.verify(wrongKey, joseToDer(Buffer.from(signature!, 'base64url'))),
    ).toBe(false)
  })
})
