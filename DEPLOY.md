# Deploying Dayflow to Vercel

Everything below is done once. The order matters: the database has to exist
before the first build, and Google has to know the final URL before anyone can
sign in.

**The one thing to know before you start:** the password-less demo login is
disabled in production, by two independent guards (`NODE_ENV !== 'production'`
and `ALLOW_DEV_LOGIN`). So on the deployed app, signing in with Google is the
*only* way in. If step 5 is not finished, nobody can get past the landing page —
including you.

---

## 1. A hosted database

The local database (`npm run dev:db`) is an embedded PGlite server that only
exists on this laptop. Production needs a real PostgreSQL instance.

[Neon](https://neon.tech) and [Supabase](https://supabase.com) both have a free
tier that is ample for this.

Take the **pooled** connection string, not the direct one. Vercel runs each
request in its own short-lived function, so without pooling the database runs
out of connections long before the app runs out of users. On Neon this is the
URL containing `-pooler`; on Supabase it is the one on port `6543`.

Append `?pgbouncer=true` if it is not already there — it stops Prisma relying on
named prepared statements, which a pooler does not keep between connections.

## 2. Push the code to GitHub

Vercel deploys from a repository. This project has git history but no remote
yet, so create an empty repository on GitHub and push to it.

Keep it **private** unless you have re-read what is in the demo seed data first.

## 3. Create the Vercel project

Import the GitHub repository at [vercel.com/new](https://vercel.com/new). Vercel
detects Next.js on its own; leave the build settings alone.

It will find the `vercel-build` script in `package.json`, which runs
`prisma migrate deploy` before `next build`. That applies
`prisma/migrations/0_init` to the empty database on the first deploy, and does
nothing on later ones.

The first build will fail if the environment variables are not set yet. That is
expected — set them, then redeploy.

## 4. Environment variables

In Vercel: Settings → Environment Variables. Everything from `.env.example`,
with these differences.

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | The pooled string from step 1 |
| `APP_URL` | `https://your-project.vercel.app` — no trailing slash |
| `GOOGLE_REDIRECT_URI` | `https://your-project.vercel.app/api/integrations/google/callback` |
| `ALLOW_DEV_LOGIN` | Leave unset. Never `true` here. |
| `NEXT_PUBLIC_APP_NAME` | Whatever the app should be called |

Generate the two secrets fresh — do not reuse the local ones:

```bash
openssl rand -base64 32
```

`AUTH_SECRET` signs the session cookie. `ENCRYPTION_KEY` encrypts stored Google
tokens at rest; changing it later forces everyone to reconnect their account.

Web push (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`)
is optional. Without it reminders still appear inside the app, and Settings says
push is not configured rather than offering a switch that does nothing. The
command to generate a pair is in `.env.example`.

## 5. Point Google at the new URL

In the Google Cloud console, on the OAuth client this project already uses (see
the README for how it was set up), add to **Authorised redirect URIs**:

```
https://your-project.vercel.app/api/integrations/google/callback
```

Exactly — Google matches the string, not the pattern. Leave the localhost entry
in place so local development keeps working.

While the OAuth consent screen is in "Testing", only accounts listed as test
users can sign in. Add your own address there.

## 6. Turn on the reminders scheduler

Nothing in the app fires on its own; `.github/workflows/reminders.yml` is the
scheduler that calls it. In the GitHub repository, under Settings → Secrets and
variables → Actions, add:

- `APP_URL` — the same URL as above
- `JOBS_SECRET` — the same value as the Vercel variable

Until this is done, reminders, the daily agenda and nightly housekeeping simply
never run.

## 7. Install it on a phone

Open the Vercel URL in Safari or Chrome and use *Add to Home Screen*. Because it
is now served over HTTPS, the service worker registers, the app opens without a
browser bar, and push notifications become possible — none of which work over a
plain `http://` address on the local network.

---

## Afterwards

- **Do not seed production.** `npm run db:seed` writes the demo calendar —
  Emma de Vries, a dentist appointment, a site visit to Nordport. It belongs on
  a laptop, not on a live account.
- **Stripe**, if it is ever wired in here, can finally have its redirect set: it
  needs a real domain and could not be configured against localhost.
- Every push to the default branch deploys. Branches get their own preview URL,
  which is a good place to try a change before it is live — but note that a
  preview shares the same database unless you give it a different `DATABASE_URL`.
