'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useAppShell } from '@/components/layout/app-shell-context'
import { useAppearance, nextTheme } from '@/components/theme-provider'

/**
 * Global keyboard shortcuts.
 *
 * Two rules keep them from getting in the way:
 *
 *  - Single-letter shortcuts never fire while the caret is in a field or a
 *    dialog is capturing input. Typing "c" into a title must type a "c".
 *  - "g" starts a two-key sequence (g then t for Today), the convention people
 *    already know from Gmail, Linear and GitHub. The sequence times out after
 *    a second so a stray g does not swallow the next keypress.
 */

const SEQUENCE_TIMEOUT_MS = 1000

const GO_TO: Record<string, string> = {
  t: '/today',
  c: '/calendar',
  k: '/tasks',
  i: '/inbox',
  s: '/schedule',
  p: '/contacts',
  m: '/meetings',
  a: '/analytics',
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable ||
    target.getAttribute('role') === 'textbox'
  )
}

export function useGlobalShortcuts() {
  const router = useRouter()
  const {
    setCommandOpen,
    requestCreate,
    toggleSidebar,
    toggleRightPanel,
  } = useAppShell()
  const { theme, setAppearance } = useAppearance()

  const pending = React.useRef<{ key: string; at: number } | null>(null)

  React.useEffect(() => {
    const onKeyDown = (nativeEvent: KeyboardEvent) => {
      const meta = nativeEvent.metaKey || nativeEvent.ctrlKey

      // Cmd/Ctrl+K works everywhere, including inside inputs — it is how you
      // get out of wherever you are.
      if (meta && nativeEvent.key.toLowerCase() === 'k') {
        nativeEvent.preventDefault()
        setCommandOpen(true)
        return
      }

      if (meta || nativeEvent.altKey) return
      if (isTypingTarget(nativeEvent.target)) return

      const key = nativeEvent.key.toLowerCase()

      // Second key of a "g …" sequence.
      const sequence = pending.current
      if (sequence && Date.now() - sequence.at < SEQUENCE_TIMEOUT_MS) {
        pending.current = null
        const destination = GO_TO[key]
        if (destination) {
          nativeEvent.preventDefault()
          router.push(destination)
        }
        return
      }
      pending.current = null

      switch (key) {
        case 'g':
          pending.current = { key: 'g', at: Date.now() }
          break
        case 'c':
          nativeEvent.preventDefault()
          requestCreate()
          break
        case '/':
          nativeEvent.preventDefault()
          setCommandOpen(true)
          break
        case '[':
          nativeEvent.preventDefault()
          toggleSidebar()
          break
        case ']':
          nativeEvent.preventDefault()
          toggleRightPanel()
          break
        case '?':
          nativeEvent.preventDefault()
          router.push('/settings/shortcuts')
          break
        default:
          if (nativeEvent.shiftKey && key === 'd') {
            nativeEvent.preventDefault()
            setAppearance({ theme: nextTheme(theme) })
          }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    router,
    setCommandOpen,
    requestCreate,
    toggleSidebar,
    toggleRightPanel,
    theme,
    setAppearance,
  ])
}

/**
 * View shortcuts, mounted only by the calendar so D/W/M do nothing surprising
 * on a page without views.
 */
export function useCalendarShortcuts({
  setView,
  goToday,
  step,
  onDelete,
}: {
  setView: (view: string) => void
  goToday: () => void
  step: (direction: 1 | -1) => void
  onDelete?: () => void
}) {
  React.useEffect(() => {
    const onKeyDown = (nativeEvent: KeyboardEvent) => {
      if (nativeEvent.metaKey || nativeEvent.ctrlKey || nativeEvent.altKey) return
      if (isTypingTarget(nativeEvent.target)) return

      const key = nativeEvent.key.toLowerCase()
      const views: Record<string, string> = {
        d: 'day',
        w: 'week',
        m: 'month',
        y: 'year',
        a: 'agenda',
        x: 'work-week',
        '3': 'three-day',
      }

      if (key in views) {
        nativeEvent.preventDefault()
        setView(views[key]!)
      } else if (key === 't') {
        nativeEvent.preventDefault()
        goToday()
      } else if (nativeEvent.key === 'ArrowLeft' || key === 'j') {
        nativeEvent.preventDefault()
        step(-1)
      } else if (nativeEvent.key === 'ArrowRight' || key === 'l') {
        nativeEvent.preventDefault()
        step(1)
      } else if (
        (nativeEvent.key === 'Delete' || nativeEvent.key === 'Backspace') &&
        onDelete
      ) {
        nativeEvent.preventDefault()
        onDelete()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setView, goToday, step, onDelete])
}
