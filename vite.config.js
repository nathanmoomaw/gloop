import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
  },
  build: {
    // recorder-processor.js is loaded via ctx.audioWorklet.addModule() —
    // below Vite's default 4KB inline threshold it would otherwise ship as
    // a base64 data: URI, which has had inconsistent cross-browser support
    // specifically for AudioWorklet module loading (unlike normal <script>
    // or <img> src). Force every asset to always emit as a real fetchable
    // file so that never bites us; the project has no other assets this
    // would meaningfully affect.
    assetsInlineLimit: 0,
  },
})
