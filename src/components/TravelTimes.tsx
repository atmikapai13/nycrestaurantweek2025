import type { Restaurant } from "../types/restaurant";
import { cn } from "@/lib/utils";
import { useMap } from "../contexts/MapContext";

const TRAVEL_ICONS = { walking: "🚶", cycling: "🚲", driving: "🚕", transit: "🚇" } as const;

/**
 * "🚶 12 min walk from [portrait] Union Square", one line per place in the search (Remi's
 * picks only). The place's character portrait, or the blue "you" dot, sits before its name,
 * matching its marker on the map.
 */
export default function TravelTimes({
  reason,
  className,
}: {
  reason: Restaurant["match_reason"];
  className?: string;
}) {
  const { geocodedMarkers } = useMap();
  const distances = reason?.distances ?? [];
  if (distances.length === 0) return null;

  const travelIcon = reason?.travelMode ? TRAVEL_ICONS[reason.travelMode] : null;
  // The map marker (character portrait) for a pin, matched by coordinates (~50 m)
  const markerFor = (pin?: { latitude: number; longitude: number }) =>
    pin &&
    geocodedMarkers.find(
      (m) => Math.abs(m.latitude - pin.latitude) < 0.0005 && Math.abs(m.longitude - pin.longitude) < 0.0005
    );

  return (
    <div className={cn("flex flex-col gap-1 text-caption font-semibold text-muted-foreground", className)}>
      {distances.map((d, i) => {
        const pin = reason?.pins?.[i];
        const marker = markerFor(pin);
        const legMode = reason?.legModes?.[i];
        const icon = legMode ? TRAVEL_ICONS[legMode] : travelIcon;
        // "0.5 mi from AMC Empire 25" → the pin's avatar goes right before the place name
        const [, lead = d, place = ""] = d.match(/^(.* from )(.+)$/) ?? [];
        return (
          <div key={d} className="flex flex-wrap items-center gap-1">
            {icon && (
              <span className="text-[12px] leading-none" aria-hidden="true">
                {icon}
              </span>
            )}
            <span>{lead}</span>
            {pin?.isUser ? (
              <span
                className="mx-0.5 size-2.5 shrink-0 rounded-full border-2 border-solid border-white bg-blue shadow-[0_0_0_1px_rgba(0,122,255,0.35)]"
                aria-hidden="true"
              />
            ) : marker ? (
              <img
                className="size-4 shrink-0 rounded-full border border-solid border-pink-light bg-white object-cover"
                src={marker.characterImage}
                alt=""
              />
            ) : null}
            {place && <span>{place}</span>}
          </div>
        );
      })}
    </div>
  );
}
