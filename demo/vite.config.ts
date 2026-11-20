import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// Visor de prueba: usa el código fuente del paquete, no `dist`.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: { alias: { acd: fileURLToPath(new URL('../src/index.ts', import.meta.url)) } },
  server: { port: 5181 },
})
