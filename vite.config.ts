import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Self-contained subpath build: assets reference /summer2026/... and files
  // physically live under dist/summer2026/, so the app works on its own
  // .vercel.app domain and behind the router at nyceats.live/summer2026/.
  base: "/summer2026/",
  build: { outDir: "dist/summer2026" },
  server: {
    proxy: {
      // App runs under /summer2026/ in dev too, so API calls hit /summer2026/api/*.
      // Strip the subpath before forwarding to the local API server at :3000 (/api/*).
      "/summer2026/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/summer2026/, ""),
      },
      "/chat": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
