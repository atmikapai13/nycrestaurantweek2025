import { useCallback, useState } from "react";
import { Check, ChevronDown, Heart, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMap } from "@/contexts/MapContext";
import { filterMenuClass, filterPill } from "./filterPill";

/**
 * ♥ pill: clicking toggles "show only favorites". When there are favorites it also opens
 * a menu with "Share with Friends", which copies a #favorites=<slugs> link.
 */
export default function FavoritesFilter({
  open,
  onOpenChange: setOpen,
}: {
  /** Controlled by the filter bar so only one menu is open at a time */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { allRestaurants, favorites, favoritesActive, setFavoritesActive } = useMap();
  const [copied, setCopied] = useState(false);
  const hasFavorites = favorites.length > 0;

  const handleShare = useCallback(async () => {
    const slugs = favorites
      .map((name) => allRestaurants.find((r) => r.name === name)?.slug)
      .filter((slug): slug is string => slug !== undefined);
    const shareUrl = `${window.location.origin}${window.location.pathname}#favorites=${slugs.join(",")}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
    }
  }, [favorites, allRestaurants]);

  return (
    <DropdownMenu open={open} onOpenChange={(next) => setOpen(next && hasFavorites)} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={filterPill(favoritesActive, "gap-1.5")}
          onClick={() => setFavoritesActive(!favoritesActive)}
          aria-label={favoritesActive ? "Hide favorites" : "Show favorites"}
        >
          {/* Same pink dot as favorites on the map */}
          <span className="inline-block size-2.5 rounded-full border border-solid border-white bg-pink-light shadow-xs" />
          <Heart className={cn("!size-3.5 text-pink-light", favoritesActive && "fill-pink-light")} strokeWidth={2} />
          {hasFavorites && (
            <ChevronDown className={cn("!size-3 transition-transform", open && "rotate-180")} aria-hidden="true" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={filterMenuClass}>
        <DropdownMenuItem
          className="cursor-pointer rounded-lg text-[13px]"
          onSelect={(e) => {
            e.preventDefault(); // stay open so "Copied!" is visible
            handleShare();
            setTimeout(() => setOpen(false), 1200);
          }}
        >
          {copied ? <Check /> : <Share2 />}
          {copied ? "URL Copied! Share away." : "Share with Friends"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
