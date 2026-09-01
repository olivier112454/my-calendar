# Dayflow

A calendar, task and communication workspace: one grid for every calendar you
use, tasks that get a real slot in the week, and the appointments hiding in your
mail surfaced as drafts you confirm.

Built as a single Next.js application over PostgreSQL. Everything below runs
locally with two commands and no external accounts; Google is optional and can
be added later without touching any code.

---

## Contents

1. [Quick start](#quick-start)
2. [Stack](#stack)
3. [Architecture](#architecture)
4. [Database](#database)
5. [Environment variables](#environment-variables)
6. [Google Cloud setup](#google-cloud-setup)
7. [Scheduled jobs](#scheduled-jobs)
8. [Development](#development)
9. [Testing](#testing)
10. [Production](#production)
11. [Security](#security)
12. [What is not built yet](#what-is-not-built-yet)

---

## Quick start

```bash
npm install
npm run setup          # writes .env with freshly generated secrets
npm run dev:db         # embedded PostgreSQL on :5432 — leave this running
npm run db:push        # create the schema
npm run db:seed        # a realistic week of sample data
npm run dev            # http://localhost:3000
```

Open <http://localhost:3000> and choose **Explore with sample data**. That signs
you into a demo account with calendars, events, tasks, contacts and a sample
mailbox, so every screen has something real in it.

There is no PostgreSQL to install: `npm run dev:db` starts
[PGlite](https://pglite.dev) behind the PostgreSQL wire protocol, so Prisma
connects to it exactly as it would to a normal server — same SQL, same types,
same migrations. Data lives in `.pgdata/`; delete that folder to start over.

> The `connection_limit=5&pgbouncer=true` parameters in the default
> `DATABASE_URL` are for the embedded server only. `pgbouncer=true` stops Prisma
> relying on named prepared statements, which PGlite does not keep between
> connections; the connection limit leaves room for a CLI command to run
> alongside `npm run dev`. Against a real PostgreSQL instance you can drop both.
>
> The embedded server accepts up to 30 connections, so `db:push`, `db:seed` and
> `db:studio` all work while the dev server is running. If a query ever reports
> that it cannot reach the database, `npm run dev:db` has stopped — restart it
> rather than lowering the connection limit.
>
> One PGlite behaviour to design around: a *failed* query closes that
> connection, and Prisma keeps the dead one in its pool, so the next request
> fails with "Server has closed the connection". Never let an expected outcome
> arrive as a database error — check for a duplicate before inserting rather
> than catching the unique-constraint violation (see
> `assertNameFree` in `src/server/services/categories.ts`).

---

## Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router, React 19) | Server components keep data access on the server; one deployable unit |
| Language | TypeScript, strict | |
| Styling | Tailwind CSS 4 | CSS-first tokens; the accent colour is a runtime variable, not a rebuild |
| Database | PostgreSQL via Prisma 6 | Real relational constraints, and the app owns its data |
| Validation | Zod 4 | The same schema validates the form and the request body |
| Dates | date-fns + date-fns-tz | Zone-aware conversion; no hand-rolled offset maths |
| Recurrence | rrule | RFC 5545, rather than a home-made repeat engine |
| Auth | Hand-written OAuth 2.0 + PKCE, DB-backed sessions | See [Security](#security) |
| Icons | Lucide, exclusively | One icon language; never emoji |
| Tests | Vitest | |

Deliberately **not** used: a charting library (the four charts are 300 lines of
SVG and follow the app's own mark rules), `googleapis` (tens of megabytes of
generated code for a dozen endpoints), and any drag-and-drop library (the
calendar's pointer handling has requirements no generic library meets).

---

## Architecture

```
src/
  app/                     routes — thin; they resolve data and render
    (app)/                 the signed-in shell: today, calendar, tasks, …
    book/                  public booking pages (no shell, no session)
    api/                   route handlers
  components/
    ui/                    primitives: button, input, overlay, menu, controls
    layout/                shell, sidebar, mobile nav, context panel
    calendar/ events/ tasks/ inbox/ contacts/ meetings/ analytics/ settings/
  server/
    services/              all business logic; every function takes a userId
    providers/             the external-world boundary (see below)
    jobs/                  background work, driven by an endpoint
  lib/                     pure, testable: datetime, recurrence, layout, ics, nlp
  types/                   the shapes the UI works with
```

### Three rules the codebase depends on

**1. The provider boundary.** Google is reached only through
`CalendarProvider`, `MailProvider` and `ContactsProvider`
(`src/server/providers/types.ts`). Those interfaces return the app's own
normalized types, so nothing above the provider layer knows Google exists.
Adding Outlook means writing three classes and extending two switches in
`registry.ts` — no service, page or component changes.

```
Google Calendar  ─┐
Microsoft (later) ─┼─▶ CalendarProvider ─▶ normalized Event ─▶ services ─▶ UI
CalDAV (later)   ─┘
```

**2. Authorisation is explicit.** Every service function takes a `userId` and
scopes its queries by it. There is no ambient "current user" a query can forget,
and no code path that loads a record by id alone. That is what keeps one account
out of another's data, and it is enforced in the services rather than repeated in
each route.

**3. Time is stored as an instant plus intent.** Events keep a UTC timestamp and
the IANA zone they were authored in; all-day events additionally keep plain
`YYYY-MM-DD` dates so they cannot drift across zones. Recurrence is generated on
the wall clock and converted back, so a weekly 09:00 meeting stays at 09:00 after
the clocks change. `src/lib/datetime.ts` is the only bridge between the two.

### Recurrence

Series follow RFC 5545: the master row carries `recurrenceRule` and
`recurrenceExDates`, and a modified occurrence is a separate row pointing at the
master through `recurringEventId` + `originalStartAt`. Occurrences are expanded
at read time, never materialised. Editing offers the three scopes every calendar
has to — this event, this and following, all events — and each maps onto that
model directly.

---

## Database

24 models, UUID keys, `createdAt`/`updatedAt` throughout, indexed on the columns
the calendar actually queries (`userId + startAt`, `calendarId + startAt`,
`recurringEventId`). The schema is documented inline:
[`prisma/schema.prisma`](prisma/schema.prisma).

```bash
npm run db:push       # sync the schema (development)
npm run db:migrate    # create a migration (needs a real PostgreSQL: PGlite
                      # cannot create the shadow database Prisma wants)
npm run db:seed       # sample data — safe to re-run
npm run db:studio     # browse the data
```

---

## Environment variables

Copy `.env.example` to `.env`, or run `npm run setup` to generate one with
secrets already filled in.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `AUTH_SECRET` | yes | Signs session material. `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | yes | AES-256-GCM key for provider tokens at rest. Changing it invalidates stored tokens, and users reconnect |
| `APP_URL` | yes | Public origin; used for OAuth redirects and booking links |
| `NEXT_PUBLIC_APP_NAME` | no | Product name. Defaults to Dayflow, and appears nowhere else in code — but the logo artwork has the name drawn into it, so a rename means redrawing it too (see [Brand assets](#brand-assets)) |
| `GOOGLE_CLIENT_ID` | no | Enables Google sign-in and integrations |
| `GOOGLE_CLIENT_SECRET` | no | |
| `GOOGLE_REDIRECT_URI` | no | Must match the Google console exactly |
| `JOBS_SECRET` | no | Bearer token for `/api/jobs/run`. Without it, jobs refuse to run |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | no | Enables push notifications. See [Notifications](#notifications) |
| `VAPID_PRIVATE_KEY` | no | The other half of the pair. Changing it makes every device re-subscribe |
| `VAPID_SUBJECT` | no | Contact address push services can reach, as `mailto:` |
| `ALLOW_DEV_LOGIN` | no | `"true"` enables the demo login and sample mail. Never in production |

Never commit `.env`.

---

## Google Cloud setup

The app works fully without this. Follow it when you want real calendars and
mail.

**1. Create a project**
<https://console.cloud.google.com/projectcreate> — any name.

**2. Configure the OAuth consent screen**
*APIs & Services → OAuth consent screen*
- User type **External** (or Internal on Workspace).
- App name, support email, developer email.
- Add yourself under **Test users** while the app is unverified. Without this
  Google refuses the sign-in.

**3. Create an OAuth client**
*APIs & Services → Credentials → Create credentials → OAuth client ID*
- Application type **Web application**.
- **Authorised redirect URI** — exactly, including the scheme and no trailing
  slash:
  ```
  http://localhost:3000/api/integrations/google/callback
  ```
  Add your production URL here too when you deploy.
- Copy the client ID and secret.

**4. Enable the APIs** — *APIs & Services → Library*
- **Google Calendar API** — required for calendars and events.
- **Gmail API** — only if you want the Inbox features.
- **People API** — only if you want contact import.

Each is optional and requested separately; connecting Google for the calendar
does not ask for your mailbox.

**5. Add the variables**

```bash
GOOGLE_CLIENT_ID="…apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="…"
GOOGLE_REDIRECT_URI="http://localhost:3000/api/integrations/google/callback"
```

**6. Restart and connect**
`npm run dev`, then **Continue with Google**, or *Settings → Integrations →
Add account* to connect an additional account. You may connect several Google
accounts — a personal and a work one — and each calendar shows which account it
came from.

**Scopes requested**

| Feature | Scope |
|---|---|
| Sign-in | `openid`, `email`, `profile` |
| Calendar | `.../auth/calendar` |
| Gmail | `.../auth/gmail.readonly` |
| Contacts | `.../auth/contacts.readonly` |

Gmail is read-only and only ever fetched with `format=metadata` and an explicit
header allow-list, so message bodies are never transferred or stored.

---

## Scheduled jobs

Reminders, sync, the daily agenda and housekeeping run from
`POST /api/jobs/run`, authenticated with `JOBS_SECRET`. They are plain functions
with no scheduler of their own, so any host works.

```bash
curl -X POST -H "Authorization: Bearer $JOBS_SECRET" \
  "https://your-app.example/api/jobs/run?job=reminders"
```

| `job` | What it does | Suggested cadence |
|---|---|---|
| `reminders` | Fires event reminders that have come due | every 5 minutes |
| `tasks` | Notifies about tasks due today | hourly |
| `agenda` | Sends the morning summary at each user's chosen hour | hourly |
| `sync` | Pulls connected calendars and mailboxes | every 15 minutes |
| `maintenance` | Expired sessions, stale OAuth state, old notifications | daily |
| `all` | Everything except `sync` | — |

Without `JOBS_SECRET` set the endpoint returns 503 rather than defaulting to
open.

### Notifications

A reminder becomes three things: a row in the app's own notification list, and —
when the user has switched a device on — a push notification that arrives with
the app closed.

Push needs a VAPID key pair, which is what identifies this server to Apple's and
Google's push services:

```bash
node -e "const{createECDH}=require('node:crypto');const e=createECDH('prime256v1');e.generateKeys();console.log(e.getPublicKey().toString('base64url'));console.log(e.getPrivateKey().toString('base64url'))"
```

Put the first line in `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, the second in
`VAPID_PRIVATE_KEY`, and a contact address in `VAPID_SUBJECT`. Without them the
settings page says push is not configured instead of offering a switch that
cannot work.

Encryption and signing are in `src/lib/webpush.ts`, written against RFC 8291 and
RFC 8292 rather than pulled from a package — it is one HTTP request with a fixed
envelope, and `tests/webpush.test.ts` decrypts its own output and verifies its
own signatures.

Two things decide whether a notification actually arrives:

- **A scheduler must call `job=reminders`.** Nothing fires on its own. On Vercel
  that is a cron entry; anywhere else, a cron job with `curl`.
- **iPhone and iPad only allow it for an installed app.** Safari grants
  notification permission to a Home Screen install, never to a normal tab. The
  settings page detects this and says so rather than offering a dead button.

---

## Development

```bash
npm run dev          # Next.js with Turbopack
npm run dev:db       # embedded PostgreSQL — a second terminal
npm run typecheck
npm run lint
npm run test
npm run build
```

### Brand assets

The logo is supplied artwork, not drawn SVG, so it keeps its own colours
whatever accent is set in Settings. `brand/logo-source.png` is the original;
`scripts/build-logo.py` turns it into everything the app serves:

```bash
python3 scripts/build-logo.py    # needs Pillow and numpy
```

It keys the white background out — flood-filling the icon from its corners, so
the white face inside survives — and writes the wide lockup, the icon on its
own, a lightened lockup for the dark theme, and the favicon and PWA icons.
Change the source and re-run it; nothing else needs touching.

### Conventions

- Business logic lives in `src/server/services`, never in a component or route.
- Route handlers validate with Zod, then call one service function.
- Anything time-related goes through `src/lib/datetime.ts`. `toISOString()` on a
  local wall clock silently shifts the day, so it is never used for that.
- Every icon comes from Lucide. Emoji are never used as icons.
- Every interactive control has an accessible name; tooltips are hints, never
  the only label.
- Mutations are optimistic with a rollback and a toast. Deletes offer undo
  rather than a confirmation dialog, except where the action is genuinely
  unrecoverable.

### A note on `react-hooks/set-state-in-effect`

A handful of effects carry a targeted `eslint-disable` with a reason. They are
all the sanctioned case — synchronising with an external system: an in-flight
network request, a `localStorage` read that cannot run during SSR, or the
browser's notification permission. Prop-to-state synchronisation was rewritten
to compare during render instead, and anything reading the clock during render
now goes through `useNow()`.

---

## Testing

```bash
npm run test          # 114 tests
npm run test:watch
```

The suite covers the logic that fails quietly rather than loudly:

| File | What it pins down |
|---|---|
| `datetime.test.ts` | Zone conversion, DST in both directions, day keys, week grids |
| `recurrence.test.ts` | Expansion, EXDATE, UNTIL/COUNT, and a weekly series holding 09:00 across a clock change |
| `calendar-layout.test.ts` | Overlap packing, back-to-back events staying full width, multi-day clamping, all-day lanes |
| `scheduling.test.ts` | Free/busy from working hours, merged and overlapping meetings, nothing proposed in the past |
| `parsers.test.ts` | Natural-language event and task parsing, including what must *not* be recognised |
| `ics.test.ts` | Import/export round-trip, folding, escaping, `TZID`, `DURATION` |
| `email-extractor.test.ts` | Appointments recognised — and shipping notices, invoices and newsletters refused |
| `security.test.ts` | Token encryption, tamper rejection, hashing, rate limiting |

---

## Production

```bash
npm run build
npm run start
```

Requirements:

- A real PostgreSQL instance; run `prisma migrate deploy` against it.
- `ALLOW_DEV_LOGIN` unset or `"false"`.
- `APP_URL` set to the public origin, and that origin registered as a Google
  redirect URI.
- A scheduler calling `/api/jobs/run`.
- HTTPS. Session cookies are marked `Secure` in production and will not be set
  over plain HTTP.

---

## Security

| Area | Approach |
|---|---|
| Sessions | Opaque random token in an `HttpOnly`, `SameSite=Lax`, `Secure` cookie. Only its SHA-256 is stored, so a database leak yields no usable sessions, and any session can be revoked |
| OAuth | Authorisation-code flow with PKCE (S256) and a single-use server-side `state`. A replayed callback finds nothing to redeem |
| Tokens at rest | Refresh and access tokens are sealed with AES-256-GCM under `ENCRYPTION_KEY` before they touch the database, and never serialised to the client |
| CSRF | `SameSite=Lax` plus an `Origin` check on every state-changing request |
| Authorisation | Every service call is scoped by `userId`; ids arriving from the client are re-checked against ownership before use (IDOR) |
| Injection | Prisma parameterises every query. No string-built SQL anywhere |
| XSS | React escapes by default; the one `dangerouslySetInnerHTML` is a constant theme script with no interpolation |
| Rate limiting | Applied to public booking, OAuth, sync, search, imports and writes |
| Errors | Users see a sentence they can act on; stack traces and provider payloads are logged server-side only |
| Privacy | Message bodies are never fetched or stored — only ids, the metadata a list row needs, and the extraction result. Disconnecting an account revokes the token and cascades everything it brought in |
| Data rights | Full JSON export and complete account deletion, both self-service |

---

## What is not built yet

Stated plainly, because a feature list that quietly includes intentions is worse
than a short one.

- **Outlook, Apple and CalDAV.** The provider interfaces and the normalized
  models are in place and the Integrations page lists them; the implementations
  are not written.
- **Outbound email.** Invitations, the daily agenda and email reminders are
  composed and recorded, but no transport is wired up. `runDailyAgenda` in
  `src/server/jobs/index.ts` is where a provider slots in. Push notifications do
  work — see [Notifications](#notifications).
- **Calendar sharing.** The `CalendarShare` model and roles exist; there is no
  UI, and the Share menu item is disabled rather than pretending.
- **Address autocomplete and real travel time.** `locationData` carries
  coordinates and the estimator is isolated in
  `src/server/services/conflicts.ts`; today it is straight-line distance times a
  detour factor, clearly labelled as approximate.
- **AI features.** The extractor and the natural-language parser sit behind
  interfaces (`EmailEventExtractor`, `parseEventText`) that a model can be put
  behind without changing a caller. The calendar works entirely without them.
- **Offline editing.** The service worker caches the shell; mutations still need
  a connection.
