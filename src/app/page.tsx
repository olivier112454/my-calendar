import { redirect } from 'next/navigation'
import { CalendarDays, CheckCircle2, Inbox, Sparkles } from 'lucide-react'
import { appConfig } from '@/config/app'
import { getSession } from '@/lib/session'
import { googleConfigured } from '@/server/providers/google/oauth'
import { devLoginEnabled } from '@/server/demo'
import { Button } from '@/components/ui/button'
import { ErrorBanner } from '@/components/ui/states'
import { GoogleMark, Wordmark } from '@/components/brand'

const NOTICES: Record<string, { title: string; description: string }> = {
  google_not_configured: {
    title: 'Google sign-in is not set up on this server',
    description:
      'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your environment, then restart. The README walks through the Google Cloud steps.',
  },
  google_failed: {
    title: 'Google sign-in did not complete',
    description: 'Something went wrong on the way back from Google. Please try again.',
  },
  google_cancelled: {
    title: 'Sign-in cancelled',
    description: 'You can try again whenever you are ready.',
  },
}

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; next?: string }>
}) {
  const session = await getSession()
  if (session) redirect('/today')

  const params = await searchParams
  const notice = NOTICES[params.error ?? params.notice ?? '']
  const hasGoogle = googleConfigured()
  const hasDemo = devLoginEnabled()

  const next = params.next && params.next.startsWith('/') ? params.next : undefined
  const startUrl = `/api/auth/google/start${next ? `?next=${encodeURIComponent(next)}` : ''}`

  return (
    <main id="main" className="relative flex min-h-dvh flex-col">
      {/* One quiet wash of accent behind the fold. No gradients elsewhere. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[42rem] opacity-[0.055]"
        style={{
          background:
            'radial-gradient(60rem 32rem at 50% -8rem, var(--accent), transparent 70%)',
        }}
      />

      <header className="relative z-10 mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <Wordmark />
        <a
          href="https://github.com"
          className="text-xs text-fg-subtle transition-colors hover:text-fg-muted"
          rel="noreferrer"
        >
          v1.0
        </a>
      </header>

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-6 pb-24">
        <div className="w-full max-w-md text-center">
          <h1 className="text-balance text-[2.1rem] font-semibold leading-[1.15] tracking-[-0.02em] text-fg sm:text-[2.6rem]">
            {appConfig.tagline}
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-balance text-[15px] leading-relaxed text-fg-muted">
            {appConfig.description}
          </p>

          {notice ? (
            <ErrorBanner
              className="mt-6 text-left"
              title={notice.title}
              description={notice.description}
            />
          ) : null}

          <div className="mt-8 space-y-2.5">
            <form action={startUrl} method="GET">
              {next ? <input type="hidden" name="next" value={next} /> : null}
              <Button
                type="submit"
                variant="secondary"
                size="lg"
                block
                disabled={!hasGoogle}
                className="h-11 gap-2.5 text-[13px]"
              >
                <GoogleMark />
                Continue with Google
              </Button>
            </form>

            {!hasGoogle ? (
              <p className="text-xs text-fg-subtle">
                Google is not configured on this server yet.
              </p>
            ) : null}

            {hasDemo ? (
              <>
                <div className="flex items-center gap-3 py-1">
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-[11px] uppercase tracking-wide text-fg-subtle">
                    or
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
                <form action="/api/auth/dev-login" method="POST">
                  <Button
                    type="submit"
                    variant="ghost"
                    size="lg"
                    block
                    className="h-11 text-[13px]"
                  >
                    <Sparkles />
                    Explore with sample data
                  </Button>
                </form>
                <p className="text-xs text-fg-subtle">
                  Local development only. Signs you into a demo account.
                </p>
              </>
            ) : null}
          </div>
        </div>

        <ul className="mt-16 grid w-full max-w-2xl grid-cols-1 gap-x-8 gap-y-4 text-left sm:grid-cols-3">
          {[
            {
              icon: CalendarDays,
              title: 'Every calendar, one grid',
              body: 'Google today, Outlook and CalDAV next — normalised into one model.',
            },
            {
              icon: CheckCircle2,
              title: 'Tasks that get a slot',
              body: 'Drag a task onto the week and it becomes a real, linked time block.',
            },
            {
              icon: Inbox,
              title: 'Mail that knows the date',
              body: 'Reservations, flights and invites surface as drafts you confirm.',
            },
          ].map(({ icon: Icon, title, body }) => (
            <li key={title} className="space-y-1.5">
              <Icon className="size-4 text-fg-subtle" aria-hidden="true" />
              <p className="text-[13px] font-medium text-fg">{title}</p>
              <p className="text-xs leading-relaxed text-fg-muted">{body}</p>
            </li>
          ))}
        </ul>
      </div>

      <footer className="relative z-10 border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-4 text-xs text-fg-subtle">
          <span>
            {appConfig.name} · {new Date().getFullYear()}
          </span>
          <span>Your calendar data stays in your own database.</span>
        </div>
      </footer>
    </main>
  )
}
