import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./src/index.ts'],
  copy: [{ from: 'src/bindings/*', to: 'dist', flatten: true }]
})
