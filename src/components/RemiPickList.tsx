import type { Restaurant } from "../types/restaurant";
import { cn } from "@/lib/utils";
import { useMap } from "@/contexts/MapContext";
import { Button } from "@/components/ui/button";
import { displayName } from "./RestaurantCard";

/**
 * Desktop: Remi's picks as a numbered list of names in his message. Clicking one makes this
 * answer's picks the current red pins (if it's an older answer) and opens that card on the map.
 */
export default function RemiPickList({ picks }: { picks: Restaurant[] }) {
  const { allRestaurants, selectedRestaurant, setSelectedRestaurant, recommendedSlugs, setRecommendedPicks } = useMap();
  const isCurrentAnswer = picks.every((p, i) => recommendedSlugs[i] === p.slug) && picks.length === recommendedSlugs.length;

  const open = (pick: Restaurant) => {
    if (!isCurrentAnswer) setRecommendedPicks(picks);
    setSelectedRestaurant(allRestaurants.find((r) => r.slug === pick.slug) ?? pick);
  };

  return (
    <div className="tw-reset mt-2 flex flex-wrap gap-1.5 font-sans">
      {picks.map((pick, i) => {
        const active = isCurrentAnswer && selectedRestaurant?.slug === pick.slug;
        return (
          <Button
            key={pick.slug}
            variant="outline"
            size="sm"
            onClick={() => open(pick)}
            className={cn(
              "h-8 gap-1.5 rounded-md border-border px-2.5 text-label",
              active && "border-primary bg-secondary hover:bg-secondary"
            )}
            title={pick.name}
          >
            <span className="flex size-4 items-center justify-center rounded-full bg-red text-[10px] font-bold text-white">
              {i + 1}
            </span>
            {displayName(pick.name)}
          </Button>
        );
      })}
    </div>
  );
}
