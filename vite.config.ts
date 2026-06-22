import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Served under nyceats.live/summer2025/ via the router project's prefix-stripping rewrite.
  base: '/summer2025/'
})
