/**
 * First-run helper: creates .env from .env.example and fills in strong secrets.
 * Never overwrites an existing .env.
 */
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = resolve(root, '.env')
const examplePath = resolve(root, '.env.example')

if (existsSync(envPath)) {
  console.log('.env already exists — leaving it untouched.')
  process.exit(0)
}

const secret = () => randomBytes(32).toString('base64')

const contents = readFileSync(examplePath, 'utf8')
  .replace(/^AUTH_SECRET=.*$/m, `AUTH_SECRET="${secret()}"`)
  .replace(/^ENCRYPTION_KEY=.*$/m, `ENCRYPTION_KEY="${secret()}"`)

writeFileSync(envPath, contents, { mode: 0o600 })

console.log('Created .env with freshly generated AUTH_SECRET and ENCRYPTION_KEY.')
console.log('Add GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET when you want to connect Google.')
