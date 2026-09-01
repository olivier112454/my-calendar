import { beforeAll, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'

/**
 * The security-critical primitives.
 *
 * Token encryption and hashing are the pieces where a quiet mistake has the
 * worst consequences, so their properties are pinned rather than assumed.
 */

// crypto.ts reads its key at first use; set one before importing it.
beforeAll(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64')
  process.env.AUTH_SECRET = randomBytes(32).toString('base64')
})

describe('token encryption', () => {
  it('round-trips a value', async () => {
    const { encryptSecret, decryptSecret } = await import('@/lib/crypto')
    const secret = 'ya29.a0AfH6SMB-refresh-token-example'
    expect(decryptSecret(encryptSecret(secret))).toBe(secret)
  })

  it('produces a different ciphertext every time', async () => {
    const { encryptSecret } = await import('@/lib/crypto')
    const first = encryptSecret('same input')
    const second = encryptSecret('same input')
    // A fresh IV per call: identical plaintexts must not be linkable.
    expect(first).not.toBe(second)
  })

  it('never leaks the plaintext into the ciphertext', async () => {
    const { encryptSecret } = await import('@/lib/crypto')
    const sealed = encryptSecret('super-secret-value')
    expect(sealed).not.toContain('super-secret-value')
    expect(sealed.startsWith('v1.')).toBe(true)
  })

  it('rejects a tampered ciphertext', async () => {
    const { encryptSecret, decryptSecret } = await import('@/lib/crypto')
    const sealed = encryptSecret('do not modify')
    const parts = sealed.split('.')
    const ciphertext = parts[3]!

    // Flip a character in the middle of the ciphertext. The last base64url
    // character can carry padding bits that decode to the same bytes, so
    // tampering with it is not guaranteed to change the plaintext at all.
    const middle = Math.floor(ciphertext.length / 2)
    parts[3] =
      ciphertext.slice(0, middle) +
      (ciphertext[middle] === 'A' ? 'B' : 'A') +
      ciphertext.slice(middle + 1)

    expect(() => decryptSecret(parts.join('.'))).toThrow()
  })

  it('rejects a malformed payload', async () => {
    const { decryptSecret } = await import('@/lib/crypto')
    expect(() => decryptSecret('not-a-ciphertext')).toThrow()
    expect(() => decryptSecret('v2.a.b.c')).toThrow()
  })

  it('returns null rather than throwing on the tolerant path', async () => {
    const { tryDecryptSecret } = await import('@/lib/crypto')
    expect(tryDecryptSecret(null)).toBeNull()
    expect(tryDecryptSecret('garbage')).toBeNull()
  })
})

describe('token hashing', () => {
  it('is stable and one-way', async () => {
    const { hashToken } = await import('@/lib/crypto')
    const token = 'abc123'
    expect(hashToken(token)).toBe(hashToken(token))
    expect(hashToken(token)).not.toContain(token)
    expect(hashToken(token)).toHaveLength(64)
  })

  it('separates different tokens', async () => {
    const { hashToken } = await import('@/lib/crypto')
    expect(hashToken('a')).not.toBe(hashToken('b'))
  })

  it('generates tokens with enough entropy to be unguessable', async () => {
    const { randomToken } = await import('@/lib/crypto')
    const tokens = new Set(Array.from({ length: 500 }, () => randomToken(32)))
    expect(tokens.size).toBe(500)
    // base64url of 32 bytes is 43 characters.
    expect(randomToken(32)).toHaveLength(43)
  })

  it('hashes IP addresses rather than storing them', async () => {
    const { hashIp } = await import('@/lib/crypto')
    const hashed = hashIp('192.168.1.108')
    expect(hashed).not.toContain('192.168')
    expect(hashed).toHaveLength(32)
    expect(hashIp(null)).toBeNull()
  })
})

describe('constant-time comparison', () => {
  it('matches equal strings and rejects others', async () => {
    const { safeEqual } = await import('@/lib/crypto')
    expect(safeEqual('secret', 'secret')).toBe(true)
    expect(safeEqual('secret', 'secrer')).toBe(false)
    // Different lengths must not throw.
    expect(safeEqual('secret', 'longer-secret')).toBe(false)
  })
})

describe('rate limiting', () => {
  it('allows up to the limit and refuses beyond it', async () => {
    const { check } = await import('@/lib/rate-limit')
    const key = `test-${Math.random()}`

    for (let attempt = 0; attempt < 3; attempt++) {
      expect(check(key, 3, 60_000).allowed).toBe(true)
    }
    expect(check(key, 3, 60_000).allowed).toBe(false)
  })

  it('keeps separate callers separate', async () => {
    const { check } = await import('@/lib/rate-limit')
    const suffix = Math.random()
    check(`a-${suffix}`, 1, 60_000)
    expect(check(`b-${suffix}`, 1, 60_000).allowed).toBe(true)
  })

  it('resets after the window', async () => {
    const { check } = await import('@/lib/rate-limit')
    const key = `window-${Math.random()}`
    expect(check(key, 1, 1).allowed).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(check(key, 1, 1).allowed).toBe(true)
  })
})
