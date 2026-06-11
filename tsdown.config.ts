import { defineConfig } from 'tsdown'

export default defineConfig({
  copy: [{ flatten: true, from: 'src/bindings/*', to: 'dist' }],
  entry: ['./src/index.ts'],
})
