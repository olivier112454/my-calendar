'use client'

import * as React from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import type { UserSettings } from '@prisma/client'
import { cn } from '@/lib/utils'
import { accentColors } from '@/config/app'
import { useAppearance, type ThemePreference } from '@/components/theme-provider'
import { Switch } from '@/components/ui/controls'
import { SettingsRow, SettingsSection } from './settings-nav'
import { useSettingsSave } from './use-settings-save'

/**
 * Appearance.
 *
 * Every control here applies to the live interface as you change it — the
 * preview is the app itself, which is more informative than any swatch.
 */
export function AppearanceSettings({ settings }: { settings: UserSettings }) {
  const { save } = useSettingsSave()
  const { setAppearance } = useAppearance()
  const [local, setLocal] = React.useState(settings)

  const patch = (changes: Partial<UserSettings>) => {
    const previous = local
    setLocal({ ...local, ...changes })

    // Apply to the running UI first so the change is instant, then persist.
    setAppearance({
      ...(changes.theme ? { theme: changes.theme as ThemePreference } : {}),
      ...(changes.accentColor ? { accentColor: changes.accentColor } : {}),
      ...(changes.reduceMotion !== undefined
        ? { reduceMotion: changes.reduceMotion }
        : {}),
      ...(changes.compactMode !== undefined
        ? { compactMode: changes.compactMode }
        : {}),
    })

    void save({ settings: changes as Record<string, unknown> }, {
      revert: () => {
        setLocal(previous)
        setAppearance({
          theme: previous.theme,
          accentColor: previous.accentColor,
          reduceMotion: previous.reduceMotion,
          compactMode: previous.compactMode,
        })
      },
    })
  }

  const themes: { value: ThemePreference; label: string; icon: React.ElementType }[] = [
    { value: 'LIGHT', label: 'Light', icon: Sun },
    { value: 'DARK', label: 'Dark', icon: Moon },
    { value: 'SYSTEM', label: 'System', icon: Monitor },
  ]

  return (
    <>
      <SettingsSection
        title="Appearance"
        description="Changes apply straight away."
      >
        <SettingsRow label="Theme" stacked>
          <div
            role="radiogroup"
            aria-label="Theme"
            className="grid grid-cols-3 gap-2"
          >
            {themes.map((theme) => {
              const Icon = theme.icon
              const active = local.theme === theme.value
              return (
                <button
                  key={theme.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => patch({ theme: theme.value })}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-lg border px-3 py-3 transition-colors',
                    active
                      ? 'border-accent bg-accent-soft text-fg'
                      : 'border-border text-fg-muted hover:bg-surface-2',
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  <span className="text-[13px] font-medium">{theme.label}</span>
                </button>
              )
            })}
          </div>
        </SettingsRow>

        <SettingsRow
          label="Accent colour"
          description="Used for today, selection and primary buttons."
          stacked
        >
          <div className="flex flex-wrap gap-2">
            {accentColors.map((accent) => {
              const active = local.accentColor === accent.value
              return (
                <button
                  key={accent.value}
                  type="button"
                  aria-pressed={active}
                  aria-label={accent.name}
                  title={accent.name}
                  onClick={() => patch({ accentColor: accent.value })}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-full border-2 transition-transform',
                    active ? 'border-fg' : 'border-transparent hover:scale-110',
                  )}
                >
                  <span
                    className="size-5 rounded-full"
                    style={{ backgroundColor: accent.value }}
                  />
                </button>
              )
            })}
          </div>
        </SettingsRow>

        <SettingsRow
          label="Compact calendar"
          description="Shorter hour rows, so more of the day fits on screen."
          htmlFor="density"
        >
          <Switch
            id="density"
            checked={local.eventDensity === 'COMPACT'}
            onCheckedChange={(compact) =>
              patch({
                eventDensity: compact ? 'COMPACT' : 'COMFORTABLE',
                compactMode: compact,
              })
            }
          />
        </SettingsRow>

        <SettingsRow
          label="Reduce motion"
          description="Turns off panel and menu animations. Your system setting is respected regardless."
          htmlFor="reduce-motion"
        >
          <Switch
            id="reduce-motion"
            checked={local.reduceMotion}
            onCheckedChange={(reduceMotion) => patch({ reduceMotion })}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="Calendar display"
        description="What the grid shows."
      >
        <SettingsRow label="Show weekends" htmlFor="weekends">
          <Switch
            id="weekends"
            checked={local.showWeekends}
            onCheckedChange={(showWeekends) => patch({ showWeekends })}
          />
        </SettingsRow>
        <SettingsRow label="Show week numbers" htmlFor="week-numbers">
          <Switch
            id="week-numbers"
            checked={local.showWeekNumbers}
            onCheckedChange={(showWeekNumbers) => patch({ showWeekNumbers })}
          />
        </SettingsRow>
        <SettingsRow
          label="Show declined events"
          description="Keep events you have declined visible on the calendar."
          htmlFor="declined"
        >
          <Switch
            id="declined"
            checked={local.showDeclinedEvents}
            onCheckedChange={(showDeclinedEvents) => patch({ showDeclinedEvents })}
          />
        </SettingsRow>
        <SettingsRow label="Show birthdays" htmlFor="birthdays">
          <Switch
            id="birthdays"
            checked={local.showBirthdays}
            onCheckedChange={(showBirthdays) => patch({ showBirthdays })}
          />
        </SettingsRow>
        <SettingsRow label="Show holidays" htmlFor="holidays">
          <Switch
            id="holidays"
            checked={local.showHolidays}
            onCheckedChange={(showHolidays) => patch({ showHolidays })}
          />
        </SettingsRow>
      </SettingsSection>
    </>
  )
}
