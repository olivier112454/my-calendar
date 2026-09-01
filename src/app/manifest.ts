import type { MetadataRoute } from 'next'
import { appConfig } from '@/config/app'

/**
 * PWA manifest. Generated rather than static so the product name stays in one
 * place — rename the app and the installed icon follows.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${appConfig.name} — ${appConfig.tagline}`,
    short_name: appConfig.shortName,
    description: appConfig.description,
    start_url: '/today',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#fbfbfc',
    theme_color: '#fbfbfc',
    categories: ['productivity', 'business'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      { name: 'Today', url: '/today' },
      { name: 'Calendar', url: '/calendar' },
      { name: 'Tasks', url: '/tasks' },
    ],
  }
}
