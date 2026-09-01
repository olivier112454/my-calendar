'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { api } from '@/lib/client/api'
import { calendarPalette } from '@/config/app'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Dialog, DialogContent } from '@/components/ui/overlay'
import { ColorDot, Field } from '@/components/ui/primitives'

export function CalendarCreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [color, setColor] = React.useState<string>(calendarPalette[0].value)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the form when the dialog opens
    setName('')
    setDescription('')
    // Rotate the starting colour so a run of new calendars does not all come
    // out indigo.
    setColor(calendarPalette[Math.floor(Math.random() * calendarPalette.length)]!.value)
    setError(null)
  }, [open])

  const submit = async () => {
    if (!name.trim()) {
      setError('Give the calendar a name')
      return
    }
    setSaving(true)
    try {
      await api.post('/api/calendars', {
        name: name.trim(),
        color,
        description: description.trim() || null,
      })
      toast.success('Calendar created')
      onOpenChange(false)
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the calendar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="New calendar"
        description="A separate colour and toggle for a distinct part of your life."
        width="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={saving} onClick={submit}>
              Create calendar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name" htmlFor="calendar-name" error={error ?? undefined} required>
            <Input
              id="calendar-name"
              value={name}
              onChange={(nativeEvent) => {
                setName(nativeEvent.target.value)
                setError(null)
              }}
              onKeyDown={(nativeEvent) => {
                if (nativeEvent.key === 'Enter') {
                  nativeEvent.preventDefault()
                  void submit()
                }
              }}
              placeholder="Side project, Studies, Gym…"
              autoFocus
            />
          </Field>

          <Field label="Colour">
            <div className="flex flex-wrap gap-1.5">
              {calendarPalette.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  onClick={() => setColor(entry.value)}
                  aria-pressed={color === entry.value}
                  aria-label={entry.name}
                  title={entry.name}
                  className={cn(
                    'flex size-7 items-center justify-center rounded-full border-2 transition-transform',
                    color === entry.value
                      ? 'border-fg'
                      : 'border-transparent hover:scale-110',
                  )}
                >
                  <ColorDot color={entry.value} size={18} />
                </button>
              ))}
            </div>
          </Field>

          <Field label="Description" htmlFor="calendar-description">
            <Textarea
              id="calendar-description"
              value={description}
              onChange={(nativeEvent) => setDescription(nativeEvent.target.value)}
              placeholder="Optional"
              rows={2}
            />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  )
}
