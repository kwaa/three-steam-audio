import { defineConfig } from 'tsdown'

export default defineConfig({
  copy: [
    { flatten: true, from: '../../LICENSE', to: '.' },
    { flatten: true, from: '../../README.md', to: '.' },
    {
      flatten: true,
      from: '../../steam-audio/core/THIRDPARTY.md',
      to: '.',
    },
    { from: 'src/bindings/*', to: 'dist/bindings' },
    { flatten: true, from: 'src/worker/audio-worklet-utils.js', to: 'dist' },
    { flatten: true, from: 'src/worker/reflection-simulator-worker.js', to: 'dist' },
    { flatten: true, from: 'src/worker/steam-audio-processor.*', to: 'dist' },
    { flatten: true, from: 'src/worker/steam-audio-ambisonic-processor.*', to: 'dist' },
  ],
  dts: { build: true },
  entry: ['./src/index.ts', './src/react/index.tsx'],
  platform: 'browser',
})
