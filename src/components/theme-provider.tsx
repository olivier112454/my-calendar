'use client'

import * as React from 'react'

export type ThemePreference = 'LIGHT' | 'DARK' | 'SYSTEM'

export interface AppearanceSettings {
  theme: ThemePreference
  accentColor: string
  reduceMotion: boolean
  compactMode: boolean
}

interface AppearanceContextValue extends AppearanceSettings {
  /** True when the resolved theme is dark, whatever the preference. */
  isDark: boolean
  setAppearance: (patch: Partial<AppearanceSettings>) => void
}

const AppearanceContext = React.createContext<AppearanceContextValue | null>(null)

export const STORAGE_KEY = 'dayflow.appearance'

/**
 * Script injected before first paint. It reads the persisted preference and
 * stamps the class and accent onto <html> synchronously, so a dark-mode user
 * never sees a white flash. It is intentionally tiny and dependency-free.
 */
export const themeInitScript = `
(function(){
  try {
    var raw = localStorage.getItem('${STORAGE_KEY}');
    var s = raw ? JSON.parse(raw) : {};
    var pref = s.theme || 'SYSTEM';
    var dark = pref === 'DARK' || (pref === 'SYSTEM' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
    if (s.accentColor) {
      document.documentElement.style.setProperty('--accent', s.accentColor);
    }
    if (s.reduceMotion) {
      document.documentElement.setAttribute('data-reduce-motion','true');
    }
    if (s.compactMode) {
      document.documentElement.setAttribute('data-density','compact');
    }
  } catch (e) {}
})();
`

function applyToDocument(settings: AppearanceSettings): boolean {
  const root = document.documentElement
  const dark =
    settings.theme === 'DARK' ||
    (settings.theme === 'SYSTEM' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)

  root.classList.toggle('dark', dark)
  root.style.setProperty('--accent', settings.accentColor)

  if (settings.reduceMotion) root.setAttribute('data-reduce-motion', 'true')
  else root.removeAttribute('data-reduce-motion')

  if (settings.compactMode) root.setAttribute('data-density', 'compact')
  else root.removeAttribute('data-density')

  return dark
}

/* The OS colour-scheme preference, exposed as an external store. */
function subscribeToColorScheme(onChange: () => void): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

function getColorSchemeSnapshot(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function AppearanceProvider({
  initial,
  children,
}: {
  initial: AppearanceSettings
  children: React.ReactNode
}) {
  const [settings, setSettings] = React.useState<AppearanceSettings>(initial)

  // Server settings are authoritative: they follow the user between devices,
  // whereas localStorage only exists to prevent the first-paint flash. Adopted
  // during render so a settings change applies without a second pass.
  const [syncedFrom, setSyncedFrom] = React.useState(initial)
  if (syncedFrom !== initial) {
    setSyncedFrom(initial)
    setSettings(initial)
  }

  // The OS preference is an external store, so it is read as one. That keeps
  // `isDark` derived rather than a second copy of state that has to be kept in
  // step with `settings` by hand.
  const systemPrefersDark = React.useSyncExternalStore(
    subscribeToColorScheme,
    getColorSchemeSnapshot,
    // The server cannot know; light is the safe default and the first client
    // paint corrects it before anything is visible.
    () => false,
  )

  const isDark =
    settings.theme === 'DARK' ||
    (settings.theme === 'SYSTEM' && systemPrefersDark)

  // The only job left for an effect: writing to the DOM and to storage.
  React.useEffect(() => {
    applyToDocument(settings)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      /* private mode — the flash-prevention script simply falls back to system */
    }
  }, [settings, systemPrefersDark])

  const value = React.useMemo<AppearanceContextValue>(
    () => ({
      ...settings,
      isDark,
      setAppearance: (patch) => setSettings((prev) => ({ ...prev, ...patch })),
    }),
    [settings, isDark],
  )

  return (
    <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
  )
}

export function useAppearance() {
  const ctx = React.useContext(AppearanceContext)
  if (!ctx) {
    throw new Error('useAppearance must be used inside <AppearanceProvider>')
  }
  return ctx
}

/** Cycles light -> dark -> system; used by the command palette and settings. */
export function nextTheme(current: ThemePreference): ThemePreference {
  return current === 'LIGHT' ? 'DARK' : current === 'DARK' ? 'SYSTEM' : 'LIGHT'
}
