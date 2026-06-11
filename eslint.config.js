import { defineConfig } from '@moeru/eslint-config'

export default defineConfig(
  { react: true },
  {
    files: ['test/**/*.js'],
    rules: {
      'antfu/no-import-dist': 'off',
      'prefer-arrow/prefer-arrow-functions': 'off',
      'test/no-import-node-test': 'off',
    },
  },
)
