/**
 * Type definitions for AI SDK messages and parts
 * Based on ai@6.0.26 SDK types
 */

import type {
  UIMessage,
  UIMessagePart,
  DynamicToolUIPart,
  TextUIPart as SDKTextUIPart,
} from "ai";

// Re-export core types from AI SDK
export type { UIMessage, UIMessagePart, DynamicToolUIPart };

/**
 * Text part of a UI message (redefined from SDK for compatibility)
 */
export type TextUIPart = SDKTextUIPart;

/**
 * Tool invocation part (pending execution)
 */
export interface ToolInvocationPart {
  type: "tool-invocation";
  toolName: string;
  toolCallId: string;
  input?: unknown;
  state?: "input-streaming" | "input-available";
}

/**
 * Dynamic tool part from AI SDK (for better narrowing)
 */
export type DynamicToolPart = Extract<
  UIMessagePart<any, any>,
  { type: "dynamic-tool" }
>;

/**
 * SQL query result structure
 */
export interface SqlQueryResult {
  rows: Array<{
    name?: string;
    slug?: string;
    cuisine?: string;
    neighborhood?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

/**
 * Isochrone/Isoline result structure
 */
export interface IsolineResult {
  geojson?: GeoJSON.Feature;
  geometry?: GeoJSON.Feature | GeoJSON.Geometry;
  structuredContent?: {
    geojson?: GeoJSON.Feature;
    geometry?: GeoJSON.Feature | GeoJSON.Geometry;
    results?: Array<{
      geojson?: GeoJSON.Feature;
    }>;
  };
  results?: Array<{
    geojson?: GeoJSON.Feature;
  }>;
}

/**
 * Search documents result structure
 */
export interface SearchDocumentsResult {
  chunks: Array<{
    text: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

/**
 * Type guard to check if a part is a text part
 */
export function isTextPart(
  part: UIMessagePart<any, any>
): part is TextUIPart {
  return part.type === "text";
}

/**
 * Type guard to check if a part is a dynamic tool part
 */
export function isDynamicToolPart(
  part: UIMessagePart<any, any>
): part is DynamicToolPart {
  return part.type === "dynamic-tool";
}

/**
 * Type guard to check if a part is a tool invocation part
 */
export function isToolInvocationPart(
  part: UIMessagePart<any, any>
): part is ToolInvocationPart {
  return part.type === "tool-invocation";
}

/**
 * Type guard to check if a dynamic tool part has output
 */
export function hasDynamicToolOutput(
  part: DynamicToolPart
): part is Extract<DynamicToolPart, { state: "output-available" }> {
  return (
    "state" in part && part.state === "output-available" && "output" in part
  );
}

/**
 * Extract result from a tool part (handles multiple possible structures)
 */
export function extractToolResult(
  part: Extract<DynamicToolPart, { state: "output-available" }>
): unknown {
  const output = part.output as any;
  return output?.structuredContent || output;
}

