import tailwindcssAnimate from "tailwindcss-animate"
import plugin from "tailwindcss/plugin"
import { colors as c, cssVar, fonts, fontSizes } from "./src/styles/tokens.ts"

/** "#f23d97" → "330 87% 59%" (shadcn's variables hold bare HSL channels) */
function hslChannels(hex) {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2
  let h = 0, s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h *= 60
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}

/** Design tokens → Tailwind. Emits every token as a CSS variable on :root (--color-pink,
    --font-sans, …) plus the shadcn variables that follow the palette, and adds the palette,
    fonts and type scale to the theme (bg-pink, font-display, text-body, …).
    Kept in a plugin because `npx shadcn add` rewrites the config object below and turns
    expressions like c.pink into literal strings; it leaves `plugins` alone. */
const tokens = plugin(({ addBase }) => {
  const vars = {}
  for (const [name, value] of Object.entries(c)) vars[cssVar(name)] = value
  for (const [name, value] of Object.entries(fonts)) vars[cssVar(name, "font")] = value
  Object.assign(vars, {
    "--foreground": hslChannels(c.ink),
    "--card-foreground": hslChannels(c.ink),
    "--popover-foreground": hslChannels(c.ink),
    "--primary": hslChannels(c.pink),
    "--ring": hslChannels(c.pink),
    "--secondary": hslChannels(c.pinkSoft),
    "--secondary-foreground": hslChannels(c.ink),
    "--accent": hslChannels(c.pinkSoft),
    "--accent-foreground": hslChannels(c.ink),
    "--muted": hslChannels(c.greyLightest),
    "--muted-foreground": hslChannels(c.greyDark),
    "--border": hslChannels(c.greyLight),
    "--input": hslChannels(c.greyLight),
  })
  addBase({ ":root": vars })
}, {
  theme: {
    extend: {
      fontFamily: { sans: fonts.sans, display: fonts.display, mono: fonts.mono },
      fontSize: Object.fromEntries(
        Object.entries(fontSizes).map(([k, [size, lineHeight, fontWeight]]) => [k, [size, { lineHeight, fontWeight }]])
      ),
      colors: {
        pink: { DEFAULT: c.pink, light: c.pinkLight, soft: c.pinkSoft, "soft-hover": c.pinkSoftHover },
        grey: { DEFAULT: c.grey, dark: c.greyDark, light: c.greyLight, lightest: c.greyLightest },
        ink: c.ink,
        red: { DEFAULT: c.red },
        blue: { DEFAULT: c.blue },
        green: { DEFAULT: c.green },
        tan: c.tan,
        peach: c.peach,
        butter: c.butter,
        lavender: c.lavender,
        amber: c.amber,
        isochrone: { DEFAULT: c.isochrone, outline: c.isochroneOutline },
      },
    },
  },
})

/** @type {import('tailwindcss').Config} */
export default {
  // Preflight (Tailwind's base reset) is DISABLED so Tailwind does not reset
  // the existing app's margins/headings/buttons. The app keeps its own CSS.
  corePlugins: {
    preflight: false,
  },
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
  	extend: {
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		colors: {
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [tailwindcssAnimate, tokens],
}
