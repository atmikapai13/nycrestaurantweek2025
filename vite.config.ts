import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Self-contained subpath build: assets reference /spring2026/... and files
  // physically live under dist/spring2026/, so the app works on its own
  // .vercel.app domain and behind the router at nyceats.live/spring2026/.
  base: "/spring2026/",
  build: { outDir: "dist/spring2026" },
  server: {
    proxy: {
      // App runs under /spring2026/ in dev too, so API calls hit /spring2026/api/*.
      // Strip the subpath before forwarding to the local API server at :3000 (/api/*).
      "/spring2026/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/spring2026/, ""),
      },
      "/chat": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
