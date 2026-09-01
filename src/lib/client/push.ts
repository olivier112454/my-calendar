'use client'

import { api } from './api'

/**
 * Subscribing this device to push notifications.
 *
 * The browser mints the subscription; the server only ever stores what it hands
 * back. Everything here is defensive, because the support matrix is genuinely
 * uneven — most of the code is about telling the user *why* it will not work
 * rather than failing quietly.
 */

export type PushSupport =
  | { kind: 'ready' }
  /** iOS grants notification permission only to home-screen installs. */
  | { kind: 'needs-install' }
  | { kind: 'unsupported' }
  /** The keys are not configured on the server. */
  | { kind: 'not-configured' }

const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''

function isIos(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS reports as a Mac; a touch-capable "Mac" is an iPad.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Safari's own flag, which predates the standard media query.
    (window.navigator as { standalone?: boolean }).standalone === true
  )
}

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return { kind: 'unsupported' }
  if (!vapidPublicKey) return { kind: 'not-configured' }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    // On iPhone this is what a Safari tab reports; installing fixes it.
    return isIos() && !isStandalone() ? { kind: 'needs-install' } : { kind: 'unsupported' }
  }
  if (typeof Notification === 'undefined') return { kind: 'unsupported' }
  if (isIos() && !isStandalone()) return { kind: 'needs-install' }
  return { kind: 'ready' }
}

/** base64url to the byte array `PushManager` insists on. */
function toApplicationServerKey(base64url: string): ArrayBuffer {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

/** A label the user can recognise in a device list. */
export function describeDevice(): string {
  const ua = navigator.userAgent
  const browser = /Firefox/.test(ua)
    ? 'Firefox'
    : /Edg\//.test(ua)
      ? 'Edge'
      : /Chrome/.test(ua)
        ? 'Chrome'
        : /Safari/.test(ua)
          ? 'Safari'
          : 'Browser'
  const platform = isIos()
    ? 'iPhone'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac/.test(ua)
        ? 'Mac'
        : /Windows/.test(ua)
          ? 'Windows'
          : 'this device'
  return `${browser} on ${platform}`
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  // `ready` waits for an active worker, which subscribing requires.
  return navigator.serviceWorker.ready
}

export async function isSubscribed(): Promise<boolean> {
  const reg = await registration()
  if (!reg) return false
  return (await reg.pushManager.getSubscription()) !== null
}

/**
 * Asks permission, subscribes, and registers the device with the server.
 *
 * Returns the permission outcome so the caller can explain a refusal; a browser
 * only ever asks once, so a denial has to be handled rather than retried.
 */
export async function enablePush(): Promise<'granted' | 'denied' | 'failed'> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'

  const reg = await registration()
  if (!reg) return 'failed'

  try {
    const existing = await reg.pushManager.getSubscription()
    const subscription =
      existing ??
      (await reg.pushManager.subscribe({
        // Required by Chrome: every push must result in something visible.
        userVisibleOnly: true,
        applicationServerKey: toApplicationServerKey(vapidPublicKey),
      }))

    const raw = subscription.toJSON() as {
      endpoint?: string
      keys?: { p256dh?: string; auth?: string }
    }
    if (!raw.endpoint || !raw.keys?.p256dh || !raw.keys.auth) return 'failed'

    await api.post('/api/push/subscribe', {
      endpoint: raw.endpoint,
      keys: { p256dh: raw.keys.p256dh, auth: raw.keys.auth },
      label: describeDevice(),
    })
    return 'granted'
  } catch {
    return 'failed'
  }
}

/** Removes this device, on the server first so a failure leaves it working. */
export async function disablePush(): Promise<void> {
  const reg = await registration()
  const subscription = await reg?.pushManager.getSubscription()
  if (!subscription) return

  await api.delete('/api/push/subscribe', { endpoint: subscription.endpoint })
  await subscription.unsubscribe()
}
