/**
 * Geocoding + isochrones via Geoapify (the provider the MCP server wrapped),
 * called directly to skip the MCP hop. Known Manhattan places resolve from a
 * local table; everything else is cached per warm instance so repeat queries
 * are instant and return identical coordinates/polygons.
 */
import { booleanPointInPolygon, point } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { Restaurant } from "../../src/types/restaurant.js";
import { expandNYCSlang } from "../../src/utils/nycSlang.js";

export type TravelMode = "walking" | "cycling" | "driving" | "transit";

export interface GeocodeResult {
  query: string;
  latitude: number;
  longitude: number;
  formattedAddress: string;
}

export class OutsideManhattanError extends Error {}
export class GeocodeNotFoundError extends Error {}

const GEOAPIFY_MODE: Record<TravelMode, string> = {
  walking: "walk",
  cycling: "bicycle",
  driving: "drive",
  transit: "transit",
};

export const MANHATTAN_BOUNDS = { minLat: 40.6829, maxLat: 40.882, minLng: -74.02, maxLng: -73.9067 };
// Search all five boroughs, then reject non-Manhattan hits by county. Restricting the
// search to Manhattan's box instead would turn "Williamsburg" into some Manhattan match.
const NYC_RECT = "rect:-74.26,40.49,-73.70,40.92";

// Neighborhoods and landmarks resolved locally: the geocoder tends to return
// Manhattan's centroid for neighborhood-level queries, and this skips a 2–5s call.
const KNOWN_PLACES: Record<string, { lat: number; lng: number; name: string }> = {
  "east village": { lat: 40.7265, lng: -73.9815, name: "East Village" },
  "west village": { lat: 40.7336, lng: -73.9999, name: "West Village" },
  "greenwich village": { lat: 40.7336, lng: -73.9975, name: "Greenwich Village" },
  "lower east side": { lat: 40.715, lng: -73.9843, name: "Lower East Side" },
  "upper west side": { lat: 40.787, lng: -73.9754, name: "Upper West Side" },
  "upper east side": { lat: 40.7736, lng: -73.9566, name: "Upper East Side" },
  chelsea: { lat: 40.7465, lng: -74.0014, name: "Chelsea" },
  soho: { lat: 40.7233, lng: -73.9985, name: "SoHo" },
  noho: { lat: 40.7258, lng: -73.9927, name: "NoHo" },
  nolita: { lat: 40.723, lng: -73.995, name: "NoLita" },
  tribeca: { lat: 40.7163, lng: -74.0086, name: "TriBeCa" },
  chinatown: { lat: 40.7158, lng: -73.997, name: "Chinatown" },
  "little italy": { lat: 40.7191, lng: -73.9973, name: "Little Italy" },
  "financial district": { lat: 40.7075, lng: -74.0089, name: "Financial District" },
  fidi: { lat: 40.7075, lng: -74.0089, name: "Financial District" },
  midtown: { lat: 40.7549, lng: -73.984, name: "Midtown Manhattan" },
  "midtown east": { lat: 40.7549, lng: -73.9712, name: "Midtown East" },
  "midtown west": { lat: 40.759, lng: -73.9937, name: "Midtown West" },
  "hell's kitchen": { lat: 40.7638, lng: -73.9918, name: "Hell's Kitchen" },
  "hells kitchen": { lat: 40.7638, lng: -73.9918, name: "Hell's Kitchen" },
  "murray hill": { lat: 40.7479, lng: -73.9757, name: "Murray Hill" },
  gramercy: { lat: 40.7382, lng: -73.986, name: "Gramercy" },
  "gramercy park": { lat: 40.7382, lng: -73.986, name: "Gramercy Park" },
  flatiron: { lat: 40.7411, lng: -73.9897, name: "Flatiron District" },
  "flatiron district": { lat: 40.7411, lng: -73.9897, name: "Flatiron District" },
  "union square": { lat: 40.7359, lng: -73.9911, name: "Union Square" },
  "times square": { lat: 40.758, lng: -73.9855, name: "Times Square" },
  harlem: { lat: 40.8116, lng: -73.9465, name: "Harlem" },
  "east harlem": { lat: 40.7957, lng: -73.9425, name: "East Harlem" },
  "washington heights": { lat: 40.8417, lng: -73.9394, name: "Washington Heights" },
  inwood: { lat: 40.8677, lng: -73.9212, name: "Inwood" },
  "morningside heights": { lat: 40.81, lng: -73.9626, name: "Morningside Heights" },
  "hudson yards": { lat: 40.7542, lng: -74.0023, name: "Hudson Yards" },
  "battery park city": { lat: 40.7115, lng: -74.0154, name: "Battery Park City" },
  "battery park": { lat: 40.7033, lng: -74.017, name: "Battery Park" },
  "stuyvesant town": { lat: 40.7318, lng: -73.9779, name: "Stuyvesant Town" },
  "kip's bay": { lat: 40.7425, lng: -73.9801, name: "Kip's Bay" },
  "kips bay": { lat: 40.7425, lng: -73.9801, name: "Kip's Bay" },
  koreatown: { lat: 40.7479, lng: -73.987, name: "Koreatown" },
  ktown: { lat: 40.7479, lng: -73.987, name: "Koreatown" },
  "two bridges": { lat: 40.7108, lng: -73.9942, name: "Two Bridges" },
  meatpacking: { lat: 40.7408, lng: -74.0078, name: "Meatpacking District" },
  "meatpacking district": { lat: 40.7408, lng: -74.0078, name: "Meatpacking District" },
  nyu: { lat: 40.7295, lng: -73.9965, name: "NYU" },
  columbia: { lat: 40.8075, lng: -73.9626, name: "Columbia University" },
  "columbia university": { lat: 40.8078, lng: -73.9625, name: "Columbia University" },
  downtown: { lat: 40.7128, lng: -74.006, name: "Downtown Manhattan" },
  uptown: { lat: 40.81, lng: -73.9553, name: "Uptown Manhattan" },
  "columbus circle": { lat: 40.7681, lng: -73.9819, name: "Columbus Circle" },
  "lincoln center": { lat: 40.7725, lng: -73.9835, name: "Lincoln Center" },
  "world trade center": { lat: 40.7127, lng: -74.0134, name: "World Trade Center" },
  wtc: { lat: 40.7127, lng: -74.0134, name: "World Trade Center" },
  "penn station": { lat: 40.7506, lng: -73.9935, name: "Penn Station" },
  "grand central": { lat: 40.7527, lng: -73.9772, name: "Grand Central Terminal" },
  "washington square park": { lat: 40.7309, lng: -73.9976, name: "Washington Square Park" },
  moma: { lat: 40.7616, lng: -73.9775, name: "MoMA" },
  "the high line": { lat: 40.7477, lng: -74.0049, name: "The High Line" },
  "high line": { lat: 40.7477, lng: -74.0049, name: "The High Line" },
  "rockefeller center": { lat: 40.7587, lng: -73.9787, name: "Rockefeller Center" },
  "empire state building": { lat: 40.7484, lng: -73.9857, name: "Empire State Building" },
  "bryant park": { lat: 40.7536, lng: -73.9832, name: "Bryant Park" },
  "madison square park": { lat: 40.7425, lng: -73.988, name: "Madison Square Park" },
  "madison square garden": { lat: 40.7505, lng: -73.9934, name: "Madison Square Garden" },
  "central park": { lat: 40.7812, lng: -73.9665, name: "Central Park" },
  "chelsea market": { lat: 40.7424, lng: -74.0061, name: "Chelsea Market" },
};

const BOROUGH_NAMES = /\b(brooklyn|queens|bronx|staten\s*island)\b/i;
// Brooklyn 112xx, Queens 113xx–119xx, Bronx 104xx, Staten Island 103xx
const NON_MANHATTAN_POSTCODE = /^(112\d{2}|11[3-9]\d{2}|104\d{2}|103\d{2})$/;

// Geoapify transit isochrones occasionally take 20s+; give up and let the caller fall back.
const REQUEST_TIMEOUT_MS = 8000;

const geocodeCache = new Map<string, GeocodeResult>();
const isolineCache = new Map<string, Feature<Polygon | MultiPolygon>>();

function apiKey(): string {
  const key = process.env.GEOAPIFY_API_KEY;
  if (!key) throw new Error("GEOAPIFY_API_KEY is not set");
  return key;
}

function normalizePlace(query: string): string {
  return expandNYCSlang(query)
    .replace(/,?\s*(manhattan|new york city|new york|nyc|ny|united states|usa|us)\b/gi, "")
    .replace(/[.,]+$/, "")
    .trim()
    .toLowerCase();
}

export function isInsideManhattanBounds(lat: number, lng: number): boolean {
  return (
    lat >= MANHATTAN_BOUNDS.minLat &&
    lat <= MANHATTAN_BOUNDS.maxLat &&
    lng >= MANHATTAN_BOUNDS.minLng &&
    lng <= MANHATTAN_BOUNDS.maxLng
  );
}

/** Resolve a place name to coordinates, Manhattan only. Throws OutsideManhattanError / GeocodeNotFoundError. */
export async function geocode(query: string, useCache = true): Promise<GeocodeResult> {
  const key = normalizePlace(query);
  if (BOROUGH_NAMES.test(key)) throw new OutsideManhattanError(query);

  const known = KNOWN_PLACES[key];
  if (known) {
    return { query, latitude: known.lat, longitude: known.lng, formattedAddress: `${known.name}, Manhattan, New York, NY` };
  }
  if (useCache && geocodeCache.has(key)) return { ...geocodeCache.get(key)!, query };

  const url =
    `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(`${key}, New York, NY`)}` +
    `&filter=${NYC_RECT}&bias=proximity:-73.98,40.75&limit=1&format=json&apiKey=${apiKey()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Geoapify geocode failed: HTTP ${res.status}`);
  const top = (await res.json()).results?.[0];
  if (!top) throw new GeocodeNotFoundError(query);

  const outside =
    (top.county && top.county !== "New York County") ||
    !isInsideManhattanBounds(top.lat, top.lon) ||
    NON_MANHATTAN_POSTCODE.test(top.postcode ?? "") ||
    BOROUGH_NAMES.test(top.formatted ?? "");
  if (outside) throw new OutsideManhattanError(query);

  const result = { query, latitude: top.lat, longitude: top.lon, formattedAddress: top.formatted };
  geocodeCache.set(key, result);
  return result;
}

/** Travel-time polygon around a point. */
export async function isochrone(
  latitude: number,
  longitude: number,
  mode: TravelMode,
  minutes: number,
  useCache = true
): Promise<Feature<Polygon | MultiPolygon>> {
  const cacheKey = `${latitude.toFixed(5)},${longitude.toFixed(5)},${mode},${minutes}`;
  if (useCache && isolineCache.has(cacheKey)) return isolineCache.get(cacheKey)!;

  const url =
    `https://api.geoapify.com/v1/isoline?lat=${latitude}&lon=${longitude}&type=time` +
    `&mode=${GEOAPIFY_MODE[mode]}&range=${Math.round(minutes * 60)}&apiKey=${apiKey()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Geoapify isoline failed: HTTP ${res.status}`);
  const feature = (await res.json()).features?.[0];
  if (!feature?.geometry) throw new Error("Geoapify isoline returned no geometry");

  isolineCache.set(cacheKey, feature);
  return feature;
}

export function restaurantsInPolygon(
  restaurants: Restaurant[],
  polygon: Feature<Polygon | MultiPolygon>
): Restaurant[] {
  return restaurants.filter((r) => {
    const lat = Number(r.latitude);
    const lng = Number(r.longitude);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return false;
    return booleanPointInPolygon(point([lng, lat]), polygon);
  });
}
