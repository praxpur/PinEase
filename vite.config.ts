import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  // Google Drive's virtual filesystem can miss native file change notifications.
  server: { watch: { usePolling: true, interval: 500 } },
  plugins: [
    vue(),
    tailwindcss(),
  ],
  resolve: {
    preserveSymlinks: true,
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
