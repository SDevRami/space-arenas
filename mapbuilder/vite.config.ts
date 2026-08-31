import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: {
      '@space-arenas/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5174,
    host: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
})
