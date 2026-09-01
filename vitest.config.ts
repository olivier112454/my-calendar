import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // A fixed zone keeps date assertions honest regardless of where the suite
    // runs; anything that depends on the machine's own zone is a bug we want to
    // catch, not paper over.
    env: { TZ: 'UTC' },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` is provided by the Next.js compiler, not by a package, so
      // it needs a no-op stand-in when a server module is unit-tested directly.
      'server-only': fileURLToPath(
        new URL('./tests/stubs/server-only.ts', import.meta.url),
      ),
    },
  },
})
