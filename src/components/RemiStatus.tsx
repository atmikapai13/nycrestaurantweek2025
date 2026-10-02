import type { UIMessage } from "ai";

export type RemiStage = "Tasting" | "Geocoding" | "Mapping";

/** What Remi is doing right now, from the newest tool part streamed so far. */
export function remiStage(parts: UIMessage["parts"]): RemiStage {
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    const toolName =
      part.type === "dynamic-tool" ? part.toolName : part.type.startsWith("tool-") ? part.type.slice(5) : null;
    if (toolName === "geocode") return "Geocoding";
    if (toolName === "get_isoline" || toolName === "get_isochrone") return "Mapping";
    if (toolName) return "Tasting";
  }
  return "Tasting";
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
