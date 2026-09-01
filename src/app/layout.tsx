import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { Toaster } from 'sonner'
import { TooltipProvider } from '@/components/ui/controls'
import { themeInitScript } from '@/components/theme-provider'
import { ServiceWorkerRegistrar } from '@/components/layout/service-worker'
import { appConfig } from '@/config/app'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: `${appConfig.name} — ${appConfig.tagline}`,
    template: `%s · ${appConfig.name}`,
  },
  description: appConfig.description,
  applicationName: appConfig.name,
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: appConfig.shortName,
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
  formatDetection: { telephone: false },
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Zoom is never disabled — pinch-to-zoom is an accessibility feature, not a
  // layout inconvenience.
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfbfc' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0b0e' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Runs before first paint so the theme never flashes. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-dvh bg-bg text-fg antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-100 focus:rounded-md focus:border focus:border-border focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:shadow-lg"
        >
          Skip to content
        </a>
        <TooltipProvider delayDuration={400} skipDelayDuration={300}>
          {children}
        </TooltipProvider>
        <ServiceWorkerRegistrar />
        <Toaster
          position="bottom-right"
          gap={8}
          offset={16}
          toastOptions={{
            classNames: {
              toast:
                'group !bg-surface !border !border-border !text-fg !shadow-lg !rounded-lg !text-[13px]',
              description: '!text-fg-muted !text-xs',
              actionButton:
                '!bg-accent !text-accent-fg !text-xs !h-7 !px-2.5 !rounded-md !font-medium',
              cancelButton:
                '!bg-surface-2 !text-fg-muted !text-xs !h-7 !px-2.5 !rounded-md',
              error: '![--normal-text:var(--danger)]',
            },
          }}
        />
      </body>
    </html>
  )
}
