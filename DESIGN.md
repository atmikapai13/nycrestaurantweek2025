# NYC Eats design tokens

Every color and font in the app is defined once in **`src/styles/tokens.ts`**. Refer to them by name: never write a hex value or font stack in a component or stylesheet.

| Where you are | How to use a token |
|---|---|
| `.css` file | `color: var(--color-grey-dark);` / `font-family: var(--font-sans);` |
| Tailwind / shadcn class | `bg-pink-soft`, `text-grey-dark`, `border-grey-light`, `font-display`, `text-caption` |
| TypeScript (Mapbox paint, inline SVG fills) | `import { colors } from "@/styles/tokens"` → `colors.pinkLight` |

`vite.config.ts` turns `tokens.ts` into `src/styles/tokens.css`, a Tailwind v4 `@theme` block, so every token is both a Tailwind class (`bg-pink`, `text-body`) and a CSS variable (`--color-pink`). `src/index.css` imports it and points shadcn's theme variables (`--primary`, `--border`, `--muted`, …) at the palette, so shadcn components match automatically. Don't edit `tokens.css`; it's regenerated whenever `tokens.ts` changes.

**Adding or changing a color:** edit `tokens.ts` only. A new token `fooBar` becomes the class `bg-foo-bar` and the variable `var(--color-foo-bar)`.

## Colors

### Pink (brand)
| Token | CSS variable | Tailwind | Hex | Use |
|---|---|---|---|---|
| `pink` | `--color-pink` | `pink` | `#f23d97` | Remi's accent: active rims, emphasis, status glyph, card quote rule |
| `pinkLight` | `--color-pink-light` | `pink-light` | `#ff69b4` | Favorites (hearts, map dots, outlines), links |
| `pinkSoft` | `--color-pink-soft` | `pink-soft` | `#fce4f2` | Active pill fills, selected menu rows |
| `pinkSoftHover` | `--color-pink-soft-hover` | `pink-soft-hover` | `#f9d2e8` | `pinkSoft` on hover |

### Neutrals
| Token | CSS variable | Tailwind | Hex | Use |
|---|---|---|---|---|
| `ink` | `--color-ink` | `ink` | `#111111` | Primary text, dark buttons (Reset) |
| `greyDark` | `--color-grey-dark` | `grey-dark` | `#4b5563` | Secondary text: descriptions, metadata |
| `grey` | `--color-grey` | `grey` | `#888888` | Muted text, placeholders, counts, default map dots |
| `greyLight` | `--color-grey-light` | `grey-light` | `#e3e3e3` | Borders, dividers |
| `greyLightest` | `--color-grey-lightest` | `grey-lightest` | `#f4f4f4` | Hover fills, chips, page background |
| `charcoal` | `--color-charcoal` | `charcoal` | `#575e61` | Your chat messages |
| `white` | `--color-white` | `white` | `#ffffff` | Surfaces, text on dark |

### Map and accents
| Token | Hex | Use |
|---|---|---|
| `red` | `#c81224` | Map teardrops: Remi's picks and the selected restaurant |
| `tan` | `#f5dfc4` | Award chip background |
| `amber` | `#f59e0b` | Rating stars |
| `peach` / `butter` / `lavender` | `#ffe4cc` / `#fff3c4` / `#ece4ff` | Pastel badges on cards: cuisine / price / awards (no pink, it's used enough elsewhere) |
| `blue` | `#007aff` | The user's location dot |
| `green` | `#4caf50` | Success / confirmation |
| `isochrone` / `isochroneOutline` | `#b3a0f0` / `#31004a` | Travel-time area fill and outline |

Shadows still use `rgba(0, 0, 0, …)`, and pink glows use `rgba(242, 61, 151, …)` (`pink` at partial opacity).

## Typography

| Token | CSS variable | Tailwind | Stack | Use |
|---|---|---|---|---|
| `sans` | `--font-sans` | `font-sans` | Inter, system fallbacks | All UI text |
| `display` | `--font-display` | `font-display` | Bebas Neue | The NYC EATS wordmark |
| `mono` | `--font-mono` | `font-mono` | source-code-pro, Menlo, … | Code |

Type scale (`fontSizes` in `tokens.ts`, Tailwind `text-<name>`). Sizes are stored in rem; the px values below are at the default 16px root. Past 1440px wide the root font size grows (about 17px at 1920px, capped at 19px from 2560px; `index.css`), scaling all rem-based type and spacing with it, so use rem rather than px for new sizes:

| Name | Size / line-height / weight | Use |
|---|---|---|
| `heading` | 1.375rem (22px) / 1.2 / 700 | Panel titles, restaurant names on cards |
| `subheading` | 1rem (16px) / 1.3 / 600 | Section openers ("Hey, I'm Remi!") |
| `body` | 0.8125rem (13px) / 1.4 / 400 | Chat messages, card descriptions, quotes and reviews |
| `label` | 0.8125rem (13px) / 1.3 / 500 | Buttons, pills, menu items |
| `caption` | 0.6875rem (11px) / 1.4 / 400 | Tags, sources, travel times, section toggles |

Use these classes rather than `font-size` in CSS. Each one sets size, line-height and weight together; add `font-semibold` etc. to change only the weight.

## Components

- **Prefer shadcn's semantic classes** (`bg-primary`, `bg-secondary`, `bg-accent`, `border-input`, `text-muted-foreground`, `bg-foreground`) over palette classes in components. They map onto the palette: `primary` = pink, `secondary`/`accent` = pinkSoft, `border`/`input` = greyLight, `muted` = greyLightest, `muted-foreground` = greyDark, `foreground` = ink.
- **Filter bar pills** are shadcn `Button`/`Toggle` with `variant="outline"` and the added `size="pill"`. Active state: `border-primary bg-secondary` (`filterPill()` in `src/components/FilterBar/filterPill.ts`).
- **shadcn/ui** components live in `src/components/ui/` (Tailwind v4, React 19; add more with `npx shadcn@latest add <name>`, then fix the generated `import { cn } from "cn"` to `"@/lib/utils"`). Our additions: the `pill` size on Button and Toggle. Tailwind's preflight reset is off (it would restyle the rest of the app), so `src/index.css` gives shadcn components (`[data-slot]`), portaled menus and anything under `.tw-reset` the reset bits they need.
