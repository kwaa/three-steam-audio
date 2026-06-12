// import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'

import { defineConfig } from 'vite'

// const packageRoot = resolve(__dirname, '../../packages/three-steam-audio')

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // alias: [
    //   { find: /^three-steam-audio\/react$/, replacement: resolve(packageRoot, 'dist/react/index.js') },
    //   { find: /^three-steam-audio$/, replacement: resolve(packageRoot, 'dist/index.js') },
    // ],
    dedupe: ['react', 'three'],
    // tsconfigPaths: true,
  },
})
