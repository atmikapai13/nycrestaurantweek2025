import type { UIMessage } from "ai";

export type RemiStage = "Tasting" | "Geocoding" | "Mapping";

/**
 * What Remi is doing right now, so the line reads Geocoding… → Mapping… → Tasting….
 * Uses the newest tool part streamed so far; before any, the parsed intent (does the
 * search have places?); before that, `initial` (a guess from the user's message).
 */
export function remiStage(parts: UIMessage["parts"], initial: RemiStage = "Tasting"): RemiStage {
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    const toolName =
      part.type === "dynamic-tool" ? part.toolName : part.type.startsWith("tool-") ? part.type.slice(5) : null;
    if (toolName === "geocode") return "Geocoding";
    if (toolName === "get_isoline" || toolName === "get_isochrone") return "Mapping";
    if (toolName) return "Tasting";
  }
  const intent = parts.find((p) => p.type === "data-intent") as { data?: { locations?: string[] } } | undefined;
  if (intent?.data) return intent.data.locations?.length ? "Geocoding" : "Tasting";
  return initial;
}

/** Single in-place status line ("✻ Mapping…") shown while Remi works. */
export default function RemiStatus({ stage }: { stage: RemiStage }) {
  return (
    <div className="message-content remi-status" role="status" aria-live="polite">
      <span className="remi-status-glyph" aria-hidden="true">✻</span>
      <span className="remi-status-label">{stage}…</span>
    </div>
  );
}
