/**
 * Design tokens: the single source for every color and font in the app. See DESIGN.md.
 *
 * Use them by name, never by hex:
 *   CSS       var(--color-pink), var(--font-sans)   (generated into tokens.css, a Tailwind @theme)
 *   Tailwind  bg-pink, text-grey-dark, border-grey-light, font-sans
 *   TS / Map  import { colors } from "@/styles/tokens"  (Mapbox paint can't read CSS variables)
 *
 * Plain-object module (no React/DOM imports) so vite.config.ts can import it to write tokens.css.
 */

export const colors = {
  /** Remi pink: links, accents, active rims, emphasis */
  pink: "#f23d97",
  /** Lighter pink: favorites (hearts, map dots, outlines), hover fills */
  pinkLight: "#ff69b4",
  /** Pale pink: active-pill fills, selected menu rows */
  pinkSoft: "#fce4f2",
  /** pinkSoft on hover */
  pinkSoftHover: "#f9d2e8",

  /** Primary text, dark buttons */
  ink: "#111111",
  /** Secondary text: descriptions, metadata */
  greyDark: "#4b5563",
  /** Muted text and placeholders; default map dots */
  grey: "#888888",
  /** Borders and dividers */
  greyLight: "#e3e3e3",
  /** Subtle surfaces: hover fills, chips, page background */
  greyLightest: "#f4f4f4",
  /** Your chat messages and the quick-prompt bubbles */
  charcoal: "#575e61",
  white: "#ffffff",

  /** Remi's picks on the map */
  red: "#c81224",
  /** Award chip background */
  tan: "#f5dfc4",
  /** Pastel tag fills on restaurant cards: cuisine, price, awards */
  peach: "#ffe4cc",
  butter: "#fff3c4",
  lavender: "#ece4ff",
  /** Rating stars */
  amber: "#f59e0b",
  /** The user's location dot */
  blue: "#007aff",
  /** Success / confirmation */
  green: "#4caf50",
  /** Travel-time (isochrone) area fill and outline */
  isochrone: "#b3a0f0",
  isochroneOutline: "#31004a",
} as const;

export type ColorToken = keyof typeof colors;

export const fonts = {
  /** Everything in the UI */
  sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  /** The NYC EATS wordmark */
  display: "'Bebas Neue', sans-serif",
  mono: "source-code-pro, Menlo, Monaco, Consolas, 'Courier New', monospace",
} as const;

/** Type scale: [font-size, line-height, weight]. Tailwind: text-heading, text-subheading, … */
export const fontSizes = {
  /** Panel and card titles */
  heading: ["22px", "1.2", "700"],
  /** Section openers, e.g. "Hey, I'm Remi!" */
  subheading: ["16px", "1.3", "600"],
  /** Chat messages and other running text */
  body: ["13px", "1.4", "400"],
  /** Buttons, pills, menu items */
  label: ["13px", "1.3", "500"],
  /** Metadata, hints, small buttons */
  caption: ["11px", "1.4", "400"],
} as const;

/** camelCase token name → CSS custom property, e.g. pinkSoft → --color-pink-soft */
export const cssVar = (name: string, prefix = "color") =>
  `--${prefix}-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
