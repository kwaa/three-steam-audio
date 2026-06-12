import { defineConfig } from '@moeru/eslint-config'

export default defineConfig(
  { react: true },
  {
    rules: {
      '@masknet/jsx-prefer-test-id': 'off',
    },
  },
  {
    files: ['**/test/**/*.ts'],
    rules: {
      '@masknet/no-top-level': 'off',
      '@masknet/prefer-timer-id': 'off',
      '@masknet/type-no-force-cast-via-top-type': 'off',
      'antfu/no-import-dist': 'off',
      'prefer-arrow/prefer-arrow-functions': 'off',
      'test/no-import-node-test': 'off',
    },
  },
)
