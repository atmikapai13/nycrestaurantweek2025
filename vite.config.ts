import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Self-contained subpath build: assets reference /summer2025/... AND the files
  // physically live under dist/summer2025/, so the app works both on its own
  // .vercel.app domain and behind the router at nyceats.live/summer2025/.
  base: '/summer2025/',
  build: { outDir: 'dist/summer2025' }
})
