import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: '../assets',
  resolve: {
    alias: {
      '@space-arenas/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: process.env.SA_PROXY_TARGET ?? 'http://localhost:17321',
        changeOrigin: true,
      },
      '/ws': {
        target: process.env.SA_PROXY_TARGET ?? 'ws://localhost:17321',
        ws: true,
      },
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          pixi: ['pixi.js'],
        },
      },
    },
  },
})
