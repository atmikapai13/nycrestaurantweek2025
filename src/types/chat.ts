/**
 * Type definitions for chat messages and AI SDK tool results
 * These types match the MCP server response schemas and AI SDK message format
 */

import type { Restaurant } from './restaurant';
import type { Feature, Polygon, MultiPolygon } from 'geojson';

// =============================================================================
// MCP Tool Response Types (from marauders-query-mcp/app/agent/schema.py)
// =============================================================================

export interface SQLQueryResult {
  analysis_id: string;
  rows: Array<Record<string, unknown>>;
  row_count: number;
  format: 'dataframe';
  upload_id?: string;
}

export interface GeoJSONQueryResult {
  analysis_id: string;
  geojson: GeoJSON.FeatureCollection;
  feature_count: number;
  format: 'geojson';
  upload_id?: string;
}

export interface GeocodingResult {
  formatted_address: string;
  latitude: number;
  longitude: number;
  confidence: number;
  country?: string;
  state?: string;
  city?: string;
  street?: string;
  postcode?: string;
}

export interface GeocodeResponse {
  query: string;
  results: GeocodingResult[];
  result_count: number;
}

export interface ReverseGeocodeResult {
  formatted_address: string;
  latitude: number;
  longitude: number;
  confidence: number;
  country?: string;
  state?: string;
  city?: string;
  street?: string;
  postcode?: string;
  result_type?: string;
}

export interface ReverseGeocodeResponse {
  latitude: number;
  longitude: number;
  results: ReverseGeocodeResult[];
  result_count: number;
}

export interface DocumentChunk {
  text: string;
  score: number;
  document_name: string;
}

export interface DocumentSearchResponse {
  query: string;
  analysis_id: string;
  chunks: DocumentChunk[];
  total_chunks: number;
}

export interface IsolineResult {
  geojson: Feature<Polygon | MultiPolygon>;
  latitude: number;
  longitude: number;
  type: 'time' | 'distance';
  mode: string;
  range: number;
}

export interface IsolineResponse {
  results: IsolineResult[];
  result_count: number;
  latitude: number;
  longitude: number;
  type: 'time' | 'distance';
  mode: string;
}

// Custom tool response for displaying restaurants
export interface DisplayRestaurantsResult {
  restaurants: Restaurant[];
  count: number;
  query?: string;
  error?: string;
}

// =============================================================================
// AI SDK Message Part Types
// =============================================================================

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ToolInvocationPart {
  type: 'tool-invocation';
  toolName: string;
  toolCallId: string;
  args?: Record<string, unknown>;
}

export interface DynamicToolPart {
  type: 'dynamic-tool';
  toolName: string;
  toolCallId: string;
  result?: 
    | SQLQueryResult 
    | GeoJSONQueryResult 
    | GeocodeResponse 
    | ReverseGeocodeResponse
    | DocumentSearchResponse
    | IsolineResponse
    | DisplayRestaurantsResult;
  structuredContent?: 
    | SQLQueryResult 
    | GeoJSONQueryResult 
    | GeocodeResponse 
    | ReverseGeocodeResponse
    | DocumentSearchResponse
    | IsolineResponse
    | DisplayRestaurantsResult;
  output?: {
    structuredContent?: 
      | SQLQueryResult 
      | GeoJSONQueryResult 
      | GeocodeResponse 
      | ReverseGeocodeResponse
      | DocumentSearchResponse
      | IsolineResponse
      | DisplayRestaurantsResult;
  };
  state?: 'output-available' | 'input-available' | 'output-error';
}

export interface DisplayRestaurantsToolPart {
  type: 'tool-displayRestaurants';
  state: 'input-available' | 'output-available' | 'output-error';
  output?: DisplayRestaurantsResult;
  errorText?: string;
}

export type MessagePart = 
  | TextPart 
  | ToolInvocationPart 
  | DynamicToolPart 
  | DisplayRestaurantsToolPart;

// =============================================================================
// Message Types
// =============================================================================

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: Date;
  parts?: MessagePart[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  type?: 'text' | 'restaurant_card';
  restaurant?: Restaurant;
}

// =============================================================================
// Type Guards
// =============================================================================

export function isTextPart(part: MessagePart): part is TextPart {
  return part.type === 'text';
}

export function isToolInvocationPart(part: MessagePart): part is ToolInvocationPart {
  return part.type === 'tool-invocation';
}

export function isDynamicToolPart(part: MessagePart): part is DynamicToolPart {
  return part.type === 'dynamic-tool';
}

export function isDisplayRestaurantsToolPart(part: MessagePart): part is DisplayRestaurantsToolPart {
  return part.type === 'tool-displayRestaurants';
}

export function isSQLQueryResult(result: unknown): result is SQLQueryResult {
  return (
    typeof result === 'object' &&
    result !== null &&
    'rows' in result &&
    'format' in result &&
    (result as SQLQueryResult).format === 'dataframe'
  );
}

export function isDocumentSearchResponse(result: unknown): result is DocumentSearchResponse {
  return (
    typeof result === 'object' &&
    result !== null &&
    'chunks' in result &&
    'query' in result &&
    Array.isArray((result as DocumentSearchResponse).chunks)
  );
}

export function isIsolineResponse(result: unknown): result is IsolineResponse {
  return (
    typeof result === 'object' &&
    result !== null &&
    'results' in result &&
    Array.isArray((result as IsolineResponse).results) &&
    (result as IsolineResponse).results.length > 0 &&
    'geojson' in (result as IsolineResponse).results[0]
  );
}

