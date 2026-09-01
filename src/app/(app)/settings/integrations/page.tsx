import type { Metadata } from 'next'
import { requireUserPage } from '@/lib/auth'
import { listIntegrations } from '@/server/services/settings'
import { googleConfigured } from '@/server/providers/google/oauth'
import { sampleProvidersEnabled } from '@/server/demo'
import { IntegrationsSettings } from '@/components/settings/integrations-settings'

export const metadata: Metadata = { title: 'Integrations' }

export default async function IntegrationsPage() {
  const user = await requireUserPage('/settings/integrations')
  const integrations = await listIntegrations(user.id)

  return (
    <IntegrationsSettings
      integrations={integrations}
      googleConfigured={googleConfigured()}
      usingSampleData={sampleProvidersEnabled() && integrations.length > 0}
    />
  )
}
