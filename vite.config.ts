import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

const telemetryFile = fileURLToPath(new URL('./logs/live-telemetry.jsonl', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  // Google Drive's virtual filesystem can miss native file change notifications.
  server: { watch: { usePolling: true, interval: 500 } },
  plugins: [
    vue(),
    tailwindcss(),
    {
      name: 'pinease-live-telemetry',
      configureServer(server) {
        mkdirSync(dirname(telemetryFile), { recursive: true })
        server.middlewares.use('/__telemetry', (req, res) => {
          if (req.method === 'DELETE') {
            writeFileSync(telemetryFile, '', 'utf8')
            res.statusCode = 204
            res.end()
            return
          }
          if (req.method !== 'POST') {
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, file: telemetryFile }))
            return
          }
          let body = ''
          req.on('data', (chunk) => {
            body += chunk
          })
          req.on('end', () => {
            try {
              const parsed = JSON.parse(body)
              const lines = Array.isArray(parsed) ? parsed : [parsed]
              for (const item of lines) {
                appendFileSync(telemetryFile, JSON.stringify(item) + '\n', 'utf8')
              }
              res.statusCode = 204
              res.end()
            } catch {
              res.statusCode = 400
              res.end()
            }
          })
        })
      },
    },
  ],
  resolve: {
    preserveSymlinks: true,
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
