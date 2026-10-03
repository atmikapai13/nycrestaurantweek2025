import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

/**
 * Filter-bar pills are shadcn outline buttons at the "pill" size. Colors come from the
 * shadcn theme variables, which tailwind.config.js derives from src/styles/tokens.ts:
 * border-input = greyLight, bg-secondary = pinkSoft, border-primary = pink.
 */
export const filterPillActiveClass = "border-primary bg-secondary font-semibold hover:bg-secondary";

export function filterPill(active: boolean, className?: string) {
  return cn(
    buttonVariants({ variant: "outline", size: "pill" }),
    // No hover effect: pills only change look when a filter is applied
    "pointer-events-auto shrink-0 cursor-pointer font-sans hover:bg-background hover:text-foreground",
    active && filterPillActiveClass,
    className
  );
}

/** Popover/menu surface for filter options; above the map and chat panel. */
export const filterMenuClass = "z-[2000] min-w-[180px] max-w-[260px] rounded-2xl p-1.5 font-sans";
