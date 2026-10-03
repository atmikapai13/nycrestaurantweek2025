import type { Restaurant } from "../types/restaurant";

/** Same box the API uses to accept "your location" (MANHATTAN_BOUNDS in api/_lib/geo.ts). */
const MANHATTAN_BOUNDS = { minLat: 40.6829, maxLat: 40.882, minLng: -74.02, maxLng: -73.9067 };
/** The box also catches riverfront Brooklyn/Queens/NJ, so also require a listed restaurant nearby. */
const MAX_DISTANCE_TO_A_RESTAURANT_M = 600;

/** Is this point in Manhattan, as far as searches from "your location" are concerned? */
export function isInManhattan(point: { latitude: number; longitude: number }, restaurants: Restaurant[]): boolean {
  const { latitude: lat, longitude: lng } = point;
  const inBox =
    lat >= MANHATTAN_BOUNDS.minLat &&
    lat <= MANHATTAN_BOUNDS.maxLat &&
    lng >= MANHATTAN_BOUNDS.minLng &&
    lng <= MANHATTAN_BOUNDS.maxLng;
  if (!inBox) return false;
  // Equirectangular distance is plenty at city scale
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos((lat * Math.PI) / 180);
  return restaurants.some(
    (r) =>
      r.latitude != null &&
      r.longitude != null &&
      Math.hypot((r.latitude - lat) * metersPerDegLat, (r.longitude - lng) * metersPerDegLng) <=
        MAX_DISTANCE_TO_A_RESTAURANT_M
  );
}

/** Landmarks Remi always geocodes (they're in the API's known-places table, api/_lib/geo.ts). */
const FRIEND_LANDMARKS = [
  { name: "Union Square", latitude: 40.7359, longitude: -73.9911 },
  { name: "Bryant Park", latitude: 40.7536, longitude: -73.9832 },
  { name: "Washington Square Park", latitude: 40.7309, longitude: -73.9976 },
  { name: "Madison Square Park", latitude: 40.7425, longitude: -73.988 },
  { name: "Grand Central", latitude: 40.7527, longitude: -73.9772 },
  { name: "Penn Station", latitude: 40.7506, longitude: -73.9935 },
  { name: "Columbus Circle", latitude: 40.7681, longitude: -73.9819 },
  { name: "Lincoln Center", latitude: 40.7725, longitude: -73.9835 },
  { name: "Rockefeller Center", latitude: 40.7587, longitude: -73.9787 },
  { name: "Chelsea Market", latitude: 40.7424, longitude: -74.0061 },
  { name: "World Trade Center", latitude: 40.7127, longitude: -74.0134 },
  { name: "Two Bridges", latitude: 40.7108, longitude: -73.9942 },
  { name: "Columbia University", latitude: 40.8078, longitude: -73.9625 },
  { name: "East Harlem", latitude: 40.7957, longitude: -73.9425 },
];

/** A landmark for the "my friend is at…" prompt: about a kilometer from the user (0.7–1.6 km,
    nearest to 1.1 km), so two 15-minute walks overlap clearly. Null if none is in range. */
export function friendLandmarkNear(point: { latitude: number; longitude: number }): string | null {
  const metersPerDegLng = 111_320 * Math.cos((point.latitude * Math.PI) / 180);
  const withDistance = FRIEND_LANDMARKS.map((l) => ({
    name: l.name,
    meters: Math.hypot((l.latitude - point.latitude) * 111_320, (l.longitude - point.longitude) * metersPerDegLng),
  })).filter((l) => l.meters >= 700 && l.meters <= 1600);
  if (!withDistance.length) return null;
  return withDistance.sort((a, b) => Math.abs(a.meters - 1100) - Math.abs(b.meters - 1100))[0].name;
}
