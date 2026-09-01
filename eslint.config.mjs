import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescriptConfig from 'eslint-config-next/typescript'

/**
 * Flat config. `eslint-config-next` ships flat configs directly in Next 16, so
 * they are spread in as-is — running them through FlatCompat is what the older
 * setup did and it no longer works.
 */
const config = [
  ...coreWebVitals,
  ...typescriptConfig,
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      '.pgdata/**',
      'public/sw.js',
      'next-env.d.ts',
    ],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
]

export default config
