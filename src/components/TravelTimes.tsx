import type { ComponentType } from "react";
import { Footprints, TramFront, type LucideProps } from "lucide-react";
import type { Restaurant } from "../types/restaurant";
import { cn } from "@/lib/utils";
import { useMap } from "../contexts/MapContext";

// Walk and transit only (bike times still reach Remi's reply for bike searches)
type Mode = "walking" | "transit";
const MODES: Array<{ mode: Mode; Icon: ComponentType<LucideProps>; label: string }> = [
  { mode: "walking", Icon: Footprints, label: "walk" },
  { mode: "transit", Icon: TramFront, label: "transit" },
];
/** The restaurant card's small section labels ("Reviews & more", "Reviews", "About") */
export const SECTION_LABEL = "text-[0.6875rem] font-semibold tracking-wide text-grey uppercase";

const LEGACY_ICONS = { walking: "🚶", cycling: "🚲", driving: "🚕", transit: "🚇" } as const;

/**
 * How far each place in the search is (Remi's picks only), one pill per place: the place's
 * character portrait (or the blue "you" dot), as tall as the pill, then the walk and
 * transit times (icon above minutes, the fastest highlighted). The place's name is its tooltip.
 * Falls back to "🚶 12 min from Union Square" lines when there are no per-mode times.
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

  // The map marker (character portrait) for a pin, matched by coordinates (~50 m)
  const markerFor = (pin?: { latitude: number; longitude: number }) =>
    pin &&
    geocodedMarkers.find(
      (m) => Math.abs(m.latitude - pin.latitude) < 0.0005 && Math.abs(m.longitude - pin.longitude) < 0.0005
    );
  const avatar = (i: number, large = false) => {
    const pin = reason?.pins?.[i];
    const marker = markerFor(pin);
    if (pin?.isUser) {
      const dot = (
        <span
          className={cn(
            "mx-0.5 shrink-0 rounded-full border-2 border-solid border-white bg-blue shadow-[0_0_0_1px_rgba(0,122,255,0.35)]",
            large ? "size-4" : "size-2.5"
          )}
          aria-hidden="true"
        />
      );
      // In the pill: centered in a white circle as tall as the pill, like a portrait
      return large ? (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background">{dot}</span>
      ) : (
        dot
      );
    }
    return marker ? (
      <img
        className={cn(
          "shrink-0 rounded-full border border-solid border-pink-light bg-white object-cover",
          large ? "size-8" : "size-4"
        )}
        src={marker.characterImage}
        alt=""
      />
    ) : null;
  };

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5 text-caption font-semibold text-muted-foreground", className)}>
      {distances.map((d, i) => {
        // "0.5 mi from AMC Empire 25" → the place's name
        const [, lead = d, place = ""] = d.match(/^(.* from )(.+)$/) ?? [];
        const times = reason?.times?.[i];
        const segments = times ? MODES.filter(({ mode }) => times[mode] != null) : [];

        if (segments.length === 0) {
          const legMode = reason?.legModes?.[i] ?? reason?.travelMode;
          return (
            <div key={d} className="flex flex-wrap items-center gap-1">
              {legMode && (
                <span className="text-[0.75rem] leading-none" aria-hidden="true">
                  {LEGACY_ICONS[legMode]}
                </span>
              )}
              <span>{lead}</span>
              {avatar(i)}
              {place && <span>{place}</span>}
            </div>
          );
        }

        // The fastest way there (transit counts as its "within N" band; ties go to the first)
        const fastest = segments.reduce((best, seg) => (times![seg.mode]! < times![best.mode]! ? seg : best)).mode;

        return (
          <div
            key={d}
            className="flex w-full items-center gap-1 rounded-full bg-muted p-0.5"
            title={`From ${place}`}
            aria-label={`Travel times from ${place}`}
          >
            {/* The place's map marker; its name only when there's no marker to show */}
            {avatar(i, true) ?? <span className="truncate px-2.5">{place}</span>}
            {segments.map(({ mode, Icon, label }) => {
              const minutes = times![mode]!;
              const text = mode === "transit" ? `≤${minutes} min` : `${minutes} min`;
              return (
                <div
                  key={mode}
                  className={cn(
                    // The times share the pill's width evenly
                    "flex min-w-11 flex-1 flex-col items-center gap-0.5 rounded-full px-2 py-1 leading-none",
                    mode === fastest && "bg-background text-foreground shadow-xs"
                  )}
                  title={`${text} by ${label}${mode === fastest ? " (fastest)" : ""}`}
                >
                  <Icon className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                  <span className="text-[0.625rem] font-semibold whitespace-nowrap">{text}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
