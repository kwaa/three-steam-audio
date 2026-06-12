import { defineConfig } from 'tsdown'

export default defineConfig({
  copy: [
    { from: 'src/bindings/*', to: 'dist/bindings' },
    { flatten: true, from: 'src/worker/steam-audio-processor.js', to: 'dist' },
  ],
  dts: { build: true },
  entry: ['./src/index.ts', './src/react/index.tsx'],
  platform: 'browser',
})
