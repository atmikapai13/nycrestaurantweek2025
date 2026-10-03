import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"
import { fontSizes } from "@/styles/tokens"

// Teach tailwind-merge our type scale (text-heading, text-body, …) so it replaces shadcn's
// text-sm / text-xs instead of keeping both and letting CSS order decide.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: Object.keys(fontSizes) }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
