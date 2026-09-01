/**
 * Embedded PostgreSQL for local development.
 *
 * Why this exists: the app targets real PostgreSQL, but a contributor should be
 * able to clone, install and run without provisioning a database server first.
 * PGlite is PostgreSQL compiled to WASM; `pglite-socket` puts it behind the
 * PostgreSQL wire protocol, so Prisma connects to it exactly as it would to a
 * normal server — same SQL, same types, same migrations.
 *
 * `maxConnections` matters more than it looks. PGlite itself is single-threaded,
 * but the socket server can hold several client connections and queue their
 * queries onto it. With the default of one, the dev server takes the only slot
 * and every other tool — `prisma db push`, `db:seed`, `db:studio` — fails with
 * "can't reach database server", and a connection left behind by a stopped
 * process locks everyone out until the database is restarted too.
 *
 * Data lives in ./.pgdata (git-ignored). Delete that folder to reset.
 *
 * Production uses a normal PostgreSQL instance; nothing in the app imports this.
 */
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = resolve(here, '..', '.pgdata')
const port = Number(process.env.DEV_DB_PORT ?? 5432)

mkdirSync(dataDir, { recursive: true })

const db = await PGlite.create({ dataDir })

const server = new PGLiteSocketServer({
  db,
  port,
  host: '127.0.0.1',
  // Room for the dev server's pool plus a CLI command or two running alongside.
  maxConnections: 30,
  // No idleTimeout on purpose. Reaping idle sockets sounds tidy, but Prisma
  // keeps its pooled connections and is never told, so the next query after a
  // quiet spell fails with "Server has closed the connection". With 30 slots a
  // few connections left behind by a killed process cost nothing.
})

await server.start()

console.log(`\n  Embedded PostgreSQL ready on postgres://localhost:${port}`)
console.log(`  Data directory: ${dataDir}`)
console.log('  Up to 30 connections; leave this running, press Ctrl+C to stop.\n')

const shutdown = async () => {
  await server.stop()
  await db.close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
