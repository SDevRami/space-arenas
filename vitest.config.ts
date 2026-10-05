import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@space-arenas/shared': fileURLToPath(new URL('./shared/src/index.ts', import.meta.url)),
    },
  },
})
