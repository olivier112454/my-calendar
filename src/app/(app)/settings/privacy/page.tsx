import type { Metadata } from 'next'
import { prisma } from '@/lib/db'
import { requireUserPage } from '@/lib/auth'
import { getSession } from '@/lib/session'
import { listSessions } from '@/server/services/settings'
import { assistant } from '@/server/providers/assistant/registry'
import { PrivacySettings } from '@/components/settings/privacy-settings'

export const metadata: Metadata = { title: 'Privacy & data' }

export default async function PrivacySettingsPage() {
  const user = await requireUserPage('/settings/privacy')
  const session = await getSession()

  const [sessions, emailCount, connectedCount] = await Promise.all([
    listSessions(user.id, session?.sessionId ?? ''),
    prisma.emailReference.count({ where: { userId: user.id } }),
    prisma.integrationAccount.count({ where: { userId: user.id } }),
  ])

  return (
    <PrivacySettings
      sessions={sessions}
      emailCount={emailCount}
      connectedCount={connectedCount}
      userEmail={user.email}
      assistantName={assistant()?.name ?? null}
    />
  )
}
