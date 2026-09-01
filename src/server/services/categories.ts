import 'server-only'
import { prisma } from '@/lib/db'
import { AppError, NotFoundError } from '@/lib/api'
import { recordAudit } from '@/server/audit'
import type { CategorySummary } from '@/types/domain'

/** Enough for any real taxonomy; past this a list stops being a list. */
const MAX_CATEGORIES = 50

/**
 * Rejects a name already in use before anything is written.
 *
 * `@@unique([userId, name])` is the real guarantee, but leaning on the
 * constraint error is not an option here: the embedded PGlite dev server closes
 * the connection on *any* failed query, so a duplicate name would take the
 * whole pool down with it. Checking first also lets the match be
 * case-insensitive, which the index is not — "work" and "Work" as two separate
 * categories helps nobody.
 */
async function assertNameFree(
  userId: string,
  name: string,
  exceptId?: string,
): Promise<void> {
  const clash = await prisma.category.findFirst({
    where: {
      userId,
      name: { equals: name, mode: 'insensitive' },
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    select: { id: true },
  })
  if (clash) {
    throw new AppError(`You already have a category called "${name}".`, 'duplicate', 409)
  }
}

/**
 * Categories — what an event is about, as opposed to which calendar it is in.
 *
 * Every account starts with a set of them (see `bootstrap.ts`); this is the read
 * side those pickers and the Analytics breakdown share. Like every service here
 * it takes a `userId` and scopes to it, so one account can never see another's.
 */

export async function listCategories(userId: string): Promise<CategorySummary[]> {
  const rows = await prisma.category.findMany({
    where: { userId },
    orderBy: [{ name: 'asc' }],
  })

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    icon: row.icon,
    isSystem: row.isSystem,
  }))
}

export async function createCategory(
  userId: string,
  input: { name: string; color: string },
): Promise<CategorySummary> {
  const count = await prisma.category.count({ where: { userId } })
  if (count >= MAX_CATEGORIES) {
    throw new AppError('You have reached the maximum number of categories.', 'limit', 400)
  }

  await assertNameFree(userId, input.name)

  const created = await prisma.category.create({
    data: { userId, name: input.name, color: input.color },
  })

  await recordAudit({
    userId,
    action: 'category.created',
    entityType: 'Category',
    entityId: created.id,
    metadata: { name: created.name },
  })

  return {
    id: created.id,
    name: created.name,
    color: created.color,
    icon: created.icon,
    isSystem: created.isSystem,
  }
}

export async function updateCategory(
  userId: string,
  categoryId: string,
  patch: { name?: string; color?: string },
): Promise<void> {
  // Scoped by userId, so another account's id simply does not exist here.
  const existing = await prisma.category.findFirst({
    where: { id: categoryId, userId },
    select: { id: true },
  })
  if (!existing) throw new NotFoundError('That category')

  if (patch.name) await assertNameFree(userId, patch.name, existing.id)

  await prisma.category.update({
    where: { id: existing.id },
    data: { name: patch.name, color: patch.color },
  })

  await recordAudit({
    userId,
    action: 'category.updated',
    entityType: 'Category',
    entityId: existing.id,
    metadata: patch,
  })
}

/**
 * Deleting a category never deletes events: the relation is `SetNull`, so the
 * events survive and simply become uncategorised. The count is returned so the
 * UI can say how many were affected instead of leaving it a surprise.
 */
export async function deleteCategory(
  userId: string,
  categoryId: string,
): Promise<{ eventsAffected: number }> {
  const existing = await prisma.category.findFirst({
    where: { id: categoryId, userId },
    select: { id: true, name: true, _count: { select: { events: true } } },
  })
  if (!existing) throw new NotFoundError('That category')

  await prisma.category.delete({ where: { id: existing.id } })

  await recordAudit({
    userId,
    action: 'category.deleted',
    entityType: 'Category',
    entityId: existing.id,
    metadata: { name: existing.name, eventsAffected: existing._count.events },
  })

  return { eventsAffected: existing._count.events }
}
