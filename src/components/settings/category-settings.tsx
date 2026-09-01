'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Plus, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/client/api'
import { calendarPalette } from '@/config/app'
import type { CategorySummary } from '@/types/domain'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ColorDot } from '@/components/ui/primitives'
import { ConfirmDialog } from '@/components/ui/overlay'
import { SettingsSection } from './settings-nav'

/**
 * Category management: rename, recolour, add, delete.
 *
 * Categories say what an event is *about*, which is a different question from
 * which calendar it sits in — so a dentist appointment and a five-a-side match
 * can share the Personal calendar and still be told apart in Analytics.
 *
 * Renaming commits on blur rather than behind a Save button: there is one field
 * and the change is trivially reversible, so a round trip through edit mode
 * would cost more than it protects.
 */
export function CategorySettings({ categories }: { categories: CategorySummary[] }) {
  const router = useRouter()
  const [pendingDelete, setPendingDelete] = React.useState<CategorySummary | null>(null)
  const [adding, setAdding] = React.useState(false)

  // Resolves false when the change was rejected, so the row can put itself back
  // rather than showing a name the server never accepted.
  const patch = async (
    categoryId: string,
    changes: { name?: string; color?: string },
  ): Promise<boolean> => {
    try {
      await api.patch(`/api/categories/${categoryId}`, changes)
      router.refresh()
      return true
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'That change was not saved.')
      return false
    }
  }

  const remove = async (category: CategorySummary) => {
    try {
      const result = await api.delete<{ eventsAffected: number }>(
        `/api/categories/${category.id}`,
      )
      toast.success(
        result.eventsAffected > 0
          ? `"${category.name}" deleted · ${result.eventsAffected} event${
              result.eventsAffected === 1 ? '' : 's'
            } kept, now without a category`
          : `"${category.name}" deleted`,
      )
      router.refresh()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not delete.')
    }
  }

  return (
    <>
      <SettingsSection
        title="Categories"
        description="What an event is about, separate from which calendar it goes in. Analytics groups your time by these."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setAdding(true)}
            disabled={adding}
            aria-label="New category"
          >
            <Plus />
            New
          </Button>
        }
      >
        <ul className="divide-y divide-border">
          {categories.map((category) => (
            <CategoryRow
              key={category.id}
              category={category}
              onRename={(name) => patch(category.id, { name })}
              onRecolour={(color) => void patch(category.id, { color })}
              onDelete={() => setPendingDelete(category)}
            />
          ))}

          {adding ? (
            <NewCategoryRow
              taken={categories.map((category) => category.name.toLowerCase())}
              onCancel={() => setAdding(false)}
              onCreated={() => {
                setAdding(false)
                router.refresh()
              }}
            />
          ) : null}
        </ul>

        {categories.length === 0 && !adding ? (
          <p className="py-3 text-[13px] text-fg-muted">
            No categories. Add one to start grouping your time.
          </p>
        ) : null}
      </SettingsSection>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={`Delete "${pendingDelete?.name ?? ''}"?`}
        description="Events keep their place in the calendar — they simply lose this label."
        onConfirm={async () => {
          const category = pendingDelete
          setPendingDelete(null)
          if (category) await remove(category)
        }}
      />
    </>
  )
}

function CategoryRow({
  category,
  onRename,
  onRecolour,
  onDelete,
}: {
  category: CategorySummary
  onRename: (name: string) => Promise<boolean>
  onRecolour: (color: string) => void
  onDelete: () => void
}) {
  const [name, setName] = React.useState(category.name)

  // The server is the source of truth: if a refresh brings a different name
  // (someone else's edit, or a rejected rename), the field follows it.
  const [lastServerName, setLastServerName] = React.useState(category.name)
  if (lastServerName !== category.name) {
    setLastServerName(category.name)
    setName(category.name)
  }

  const commit = async () => {
    const next = name.trim()
    if (!next) {
      setName(category.name)
      return
    }
    if (next === category.name) return
    const saved = await onRename(next)
    if (!saved) setName(category.name)
  }

  return (
    <li className="flex items-center gap-3 py-3">
      <ColorDot color={category.color} size={12} />

      <Input
        value={name}
        onChange={(nativeEvent) => setName(nativeEvent.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(nativeEvent) => {
          if (nativeEvent.key === 'Enter') nativeEvent.currentTarget.blur()
          if (nativeEvent.key === 'Escape') setName(category.name)
        }}
        aria-label={`Name of ${category.name}`}
        className="h-8 min-w-0 flex-1"
        maxLength={60}
      />

      <div className="flex shrink-0 items-center gap-1">
        <Swatches
          value={category.color}
          label={category.name}
          onPick={onRecolour}
        />
        <Button
          variant="dangerGhost"
          size="iconSm"
          onClick={onDelete}
          aria-label={`Delete ${category.name}`}
        >
          <Trash2 />
        </Button>
      </div>
    </li>
  )
}

function NewCategoryRow({
  taken,
  onCancel,
  onCreated,
}: {
  taken: string[]
  onCancel: () => void
  onCreated: () => void
}) {
  const [name, setName] = React.useState('')
  // Typed as string, not the palette's literal union: any hex is valid here.
  const [color, setColor] = React.useState<string>(calendarPalette[0]!.value)
  const [saving, setSaving] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const trimmed = name.trim()
  const duplicate = taken.includes(trimmed.toLowerCase())

  const save = async () => {
    if (!trimmed || duplicate || saving) return
    setSaving(true)
    try {
      await api.post('/api/categories', { name: trimmed, color })
      toast.success(`"${trimmed}" added`)
      onCreated()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not add that.')
      setSaving(false)
    }
  }

  return (
    <li className="flex items-center gap-3 py-3">
      <ColorDot color={color} size={12} />

      <div className="min-w-0 flex-1">
        <Input
          ref={inputRef}
          value={name}
          onChange={(nativeEvent) => setName(nativeEvent.target.value)}
          onKeyDown={(nativeEvent) => {
            if (nativeEvent.key === 'Enter') void save()
            if (nativeEvent.key === 'Escape') onCancel()
          }}
          placeholder="Category name"
          aria-label="New category name"
          className="h-8"
          maxLength={60}
        />
        {duplicate ? (
          <p className="mt-1 text-xs text-danger">You already have one with that name.</p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Swatches value={color} label="new category" onPick={setColor} />
        <Button
          variant="ghost"
          size="iconSm"
          onClick={() => void save()}
          disabled={!trimmed || duplicate || saving}
          aria-label="Add category"
        >
          <Check />
        </Button>
        <Button variant="ghost" size="iconSm" onClick={onCancel} aria-label="Cancel">
          <X />
        </Button>
      </div>
    </li>
  )
}

function Swatches({
  value,
  label,
  onPick,
}: {
  value: string
  label: string
  onPick: (color: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {calendarPalette.slice(0, 7).map((entry) => (
        <button
          key={entry.value}
          type="button"
          aria-label={`${label}: ${entry.name}`}
          title={entry.name}
          onClick={() => onPick(entry.value)}
          className={cn(
            'size-4 rounded-full border-2 transition-transform hover:scale-110',
            value === entry.value ? 'border-fg' : 'border-transparent',
          )}
          style={{ backgroundColor: entry.value }}
        />
      ))}
    </div>
  )
}
