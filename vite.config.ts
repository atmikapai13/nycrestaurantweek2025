import fs from "fs";
import path from "path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { colors, cssVar, fonts, fontSizes } from "./src/styles/tokens";

// Design tokens → src/styles/tokens.css, a Tailwind v4 @theme block (bg-pink, text-body, …,
// plus --color-* / --font-* variables). tokens.ts stays the single source; Vite restarts when
// it changes (it's a config dependency), which regenerates the file.
const designTokens = (): Plugin => ({
  name: "design-tokens",
  config() {
    const lines = [
      ...Object.entries(colors).map(([name, value]) => `  ${cssVar(name)}: ${value};`),
      ...Object.entries(fonts).map(([name, value]) => `  ${cssVar(name, "font")}: ${value};`),
      ...Object.entries(fontSizes).flatMap(([name, [size, lineHeight, weight]]) => [
        `  --text-${name}: ${size};`,
        `  --text-${name}--line-height: ${lineHeight};`,
        `  --text-${name}--font-weight: ${weight};`,
      ]),
    ];
    const css = `/* Generated from src/styles/tokens.ts by vite.config.ts. Edit tokens.ts, not this file. */
@theme static {
${lines.join("\n")}
}
`;
    const file = path.resolve(__dirname, "src/styles/tokens.css");
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== css) fs.writeFileSync(file, css);
  },
});

// https://vite.dev/config/
export default defineConfig({
  plugins: [designTokens(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Self-contained subpath build: assets reference /winter2026/... and files
  // physically live under dist/winter2026/, so the app works on its own
  // .vercel.app domain and behind the router at nyceats.live/winter2026/.
  base: "/winter2026/",
  build: { outDir: "dist/winter2026" },
  server: {
    proxy: {
      // App runs under /winter2026/ in dev too, so API calls hit /winter2026/api/*.
      // Strip the subpath before forwarding to the local API server at :3000 (/api/*).
      "/winter2026/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/winter2026/, ""),
      },
      "/chat": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
