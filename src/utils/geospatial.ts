/**
 * Geospatial utility functions using Turf.js
 * Provides free, client-side geographic calculations for restaurant recommendations
 */

import * as turf from '@turf/turf'
import type { Restaurant } from '../types/restaurant'
import type { Feature, Polygon, MultiPolygon, Geometry } from 'geojson'

/**
 * Type representing a GeoJSON polygon (Feature or direct geometry)
 */
type GeoJSONPolygon = Feature<Polygon | MultiPolygon> | Polygon | MultiPolygon | Feature<Geometry>

/**
 * Calculate the true geographic midpoint between two locations
 * and find restaurants within a radius of that midpoint
 */
export function calculateTrueMidpoint(
  location1: [number, number], // [longitude, latitude]
  location2: [number, number],
  restaurants: Restaurant[],
  radiusMiles: number = 1.0
) {
  const point1 = turf.point(location1)
  const point2 = turf.point(location2)

  // Calculate true midpoint
  const midpoint = turf.midpoint(point1, point2)
  const midpointCoords = midpoint.geometry.coordinates as [number, number]

  // Find restaurants within radius, calculate distances and balance
  const results = restaurants
    .map(r => {
      const rPoint = turf.point([r.longitude, r.latitude])
      const midpointDistance = turf.distance(midpoint, rPoint, { units: 'miles' })
      const distanceFrom1 = turf.distance(point1, rPoint, { units: 'miles' })
      const distanceFrom2 = turf.distance(point2, rPoint, { units: 'miles' })

      return {
        ...r,
        midpointDistance: parseFloat(midpointDistance.toFixed(2)),
        distanceFrom1: parseFloat(distanceFrom1.toFixed(2)),
        distanceFrom2: parseFloat(distanceFrom2.toFixed(2)),
        balanceScore: parseFloat(Math.abs(distanceFrom1 - distanceFrom2).toFixed(2))
      }
    })
    .filter(r => r.midpointDistance <= radiusMiles)
    .sort((a, b) => a.balanceScore - b.balanceScore) // Most balanced first

  return {
    midpoint: midpointCoords,
    restaurants: results
  }
}

/**
 * Find restaurants within a radius of a center point
 */
export function findRestaurantsWithinRadius(
  centerCoords: [number, number],
  restaurants: Restaurant[],
  radiusMiles: number
) {
  const center = turf.point(centerCoords)

  return restaurants
    .map(r => {
      const point = turf.point([r.longitude, r.latitude])
      const distance = turf.distance(center, point, { units: 'miles' })
      return { ...r, distance: parseFloat(distance.toFixed(2)) }
    })
    .filter(r => r.distance <= radiusMiles)
    .sort((a, b) => a.distance - b.distance)
}

/**
 * Order restaurants as a greedy nearest-neighbor walk starting from an anchor
 * point: each next stop is the closest not-yet-visited restaurant to the
 * *previous* stop (not back to the anchor), so the path moves outward in a
 * continuous line instead of the zigzag you get sorting everything by
 * straight-line distance from a single fixed center. Visited slugs are
 * removed from the remaining pool each step so the walk can never double
 * back and re-pick a restaurant it already placed.
 */
export function findRestaurantsByGreedyWalk(
  anchor: Restaurant,
  restaurants: Restaurant[]
): Restaurant[] {
  const remaining = new Map(restaurants.map(r => [r.slug, r]))
  remaining.delete(anchor.slug)

  const ordered: Restaurant[] = [anchor]
  let current = anchor

  while (remaining.size > 0) {
    if (current.longitude == null || current.latitude == null) break
    const currentPoint = turf.point([current.longitude, current.latitude])

    let nearestSlug: string | null = null
    let nearestDistance = Infinity
    for (const [slug, r] of remaining) {
      if (r.longitude == null || r.latitude == null) continue
      const distance = turf.distance(currentPoint, turf.point([r.longitude, r.latitude]))
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestSlug = slug
      }
    }

    if (nearestSlug == null) break // no remaining restaurants have valid coordinates
    const next = remaining.get(nearestSlug)!
    ordered.push(next)
    remaining.delete(nearestSlug)
    current = next
  }

  return ordered
}

/**
 * Find restaurants along a route (within a corridor buffer)
 */
export function findRestaurantsAlongRoute(
  location1: [number, number],
  location2: [number, number],
  restaurants: Restaurant[],
  bufferMiles: number = 0.3
) {
  // Create a line between the two points
  const line = turf.lineString([location1, location2])

  // Create a buffer (corridor) around the line
  const buffered = turf.buffer(line, bufferMiles, { units: 'miles' })

  if (!buffered) return []

  // Find restaurants within the corridor
  const results = restaurants
    .filter(r => {
      const restaurantPoint = turf.point([r.longitude, r.latitude])
      return turf.booleanPointInPolygon(restaurantPoint, buffered)
    })
    .map(r => {
      // Calculate distance from the line (how far "off route")
      const point = turf.point([r.longitude, r.latitude])
      const distanceFromLine = turf.pointToLineDistance(point, line, { units: 'miles' })
      return { ...r, routeOffset: parseFloat(distanceFromLine.toFixed(2)) }
    })
    .sort((a, b) => a.routeOffset - b.routeOffset) // Closest to route first

  return results
}

/**
 * Get the geographic center (centroid) of a neighborhood
 * Based on averaging all restaurant coordinates in that neighborhood
 */
export function getNeighborhoodCenter(
  neighborhood: string,
  restaurants: Restaurant[]
): [number, number] | null {
  const restaurantsInArea = restaurants.filter(r =>
    r.neighborhood && r.neighborhood.toLowerCase().includes(neighborhood.toLowerCase())
  )

  if (restaurantsInArea.length === 0) return null

  const avgLon = restaurantsInArea.reduce((sum, r) => sum + r.longitude, 0) / restaurantsInArea.length
  const avgLat = restaurantsInArea.reduce((sum, r) => sum + r.latitude, 0) / restaurantsInArea.length

  return [avgLon, avgLat]
}

/**
 * Expand a neighborhood search to include adjacent areas
 */
export function expandNeighborhoodSearch(neighborhood: string): string[] {
  const NEIGHBORS: Record<string, string[]> = {
    // Manhattan
    "Kips Bay": ["Gramercy", "Murray Hill", "Midtown East", "Stuyvesant Town"],
    "Gramercy": ["Kips Bay", "Union Square", "Flatiron District", "East Village"],
    "East Village": ["Lower East Side", "Greenwich Village", "NoHo", "Alphabet City", "Gramercy"],
    "West Village": ["Greenwich Village", "Chelsea", "Meatpacking District", "SoHo"],
    "Greenwich Village": ["West Village", "East Village", "SoHo", "NoHo"],
    "Chelsea": ["West Village", "Hell's Kitchen", "Flatiron District", "Midtown West"],
    "Hell's Kitchen": ["Midtown West", "Chelsea", "Times Square", "Clinton"],
    "Midtown East": ["Kips Bay", "Murray Hill", "Turtle Bay", "Midtown"],
    "Midtown West": ["Hell's Kitchen", "Times Square", "Garment District"],
    "Upper West Side": ["Lincoln Square", "Manhattan Valley", "Morningside Heights"],
    "Upper East Side": ["Yorkville", "Carnegie Hill", "Lenox Hill"],
    "Harlem": ["Morningside Heights", "East Harlem", "Central Harlem"],
    "Financial District": ["Battery Park City", "Tribeca", "Seaport"],
    "Tribeca": ["Financial District", "SoHo", "Chinatown"],
    "SoHo": ["Tribeca", "NoLita", "Greenwich Village", "Little Italy"],
    "NoLita": ["SoHo", "Little Italy", "Lower East Side"],
    "Lower East Side": ["East Village", "Chinatown", "Two Bridges"],

    // Brooklyn
    "Williamsburg": ["Greenpoint", "East Williamsburg", "Bushwick"],
    "Greenpoint": ["Williamsburg", "Long Island City"],
    "Bushwick": ["Williamsburg", "East Williamsburg", "Bed-Stuy"],
    "Park Slope": ["Gowanus", "Prospect Heights", "South Slope"],
    "DUMBO": ["Brooklyn Heights", "Vinegar Hill", "Downtown Brooklyn"],
    "Brooklyn Heights": ["DUMBO", "Cobble Hill", "Downtown Brooklyn"],
    "Fort Greene": ["Clinton Hill", "Downtown Brooklyn", "Prospect Heights"],
    "Carroll Gardens": ["Cobble Hill", "Gowanus", "Red Hook"],

    // Queens
    "Long Island City": ["Astoria", "Sunnyside", "Greenpoint"],
    "Astoria": ["Long Island City", "Sunnyside", "Woodside"],
    "Forest Hills": ["Rego Park", "Kew Gardens"],
    "Flushing": ["Murray Hill", "Auburndale", "Whitestone"],

    // Default: no expansion
  }

  const normalizedNeighborhood = neighborhood.trim()
  const neighbors = NEIGHBORS[normalizedNeighborhood] || []

  return [normalizedNeighborhood, ...neighbors]
}

/**
 * Calculate walking time estimate based on distance
 * Average walking speed: 3 mph = 20 minutes per mile
 */
export function estimateWalkingTime(distanceMiles: number): number {
  const minutesPerMile = 20
  return Math.round(distanceMiles * minutesPerMile)
}

/**
 * Format distance for display
 */
export function formatDistance(miles: number): string {
  if (miles < 0.1) {
    const feet = Math.round(miles * 5280)
    return `${feet} ft`
  }
  return `${miles.toFixed(1)} mi`
}

/**
 * Check if a point is within walking distance
 * Default: 1 mile (20 minute walk)
 */
export function isWalkingDistance(distanceMiles: number, maxMiles: number = 1.0): boolean {
  return distanceMiles <= maxMiles
}

/**
 * Filter restaurants by polygon (isochrone)
 * Returns restaurants that fall within the given GeoJSON polygon
 */
export function filterRestaurantsByPolygon(
  restaurants: Restaurant[],
  polygon: GeoJSONPolygon
): Restaurant[] {
  // Handle both Feature and direct Polygon geometry
  const polygonGeometry = polygon.type === 'Feature' ? polygon : turf.feature(polygon as Polygon | MultiPolygon)

  return restaurants.filter(r => {
    if (!r.latitude || !r.longitude) return false

    const point = turf.point([r.longitude, r.latitude])
    return turf.booleanPointInPolygon(point, polygonGeometry)
  })
}

/**
 * Intersect two or more polygons to find overlap area
 * Used for "restaurants between us" queries with dual isochrones
 */
export function intersectPolygons(
  ...polygons: GeoJSONPolygon[]
): Feature<Geometry> | null {
  try {
    if (polygons.length === 0) return null
    if (polygons.length === 1) return polygons[0] as Feature<Geometry>

    // Convert all to features
    const features = polygons.map(p =>
      p.type === 'Feature' ? p : turf.feature(p as Polygon | MultiPolygon)
    )

    // Reduce all polygons into a single intersection
    // turf.intersect takes a FeatureCollection, not individual features
    return features.reduce((acc, feature) => {
      if (!acc) return feature
      const featureCollection = turf.featureCollection([acc, feature])
      const result = turf.intersect(featureCollection)
      return result
    }) as Feature<Geometry> | null
  } catch (error) {
    console.error('Error intersecting polygons:', error)
    return null
  }
}

/**
 * Union two or more polygons to find combined area
 * Used for "restaurants near either of us" queries
 */
export function unionPolygons(
  ...polygons: GeoJSONPolygon[]
): Feature<Geometry> | null {
  try {
    if (polygons.length === 0) return null
    if (polygons.length === 1) return polygons[0] as Feature<Geometry>

    // Convert all to features
    const features = polygons.map(p =>
      p.type === 'Feature' ? p : turf.feature(p as Polygon | MultiPolygon)
    )

    // Reduce all polygons into a single union
    // turf.union takes a FeatureCollection
    return features.reduce((acc, feature) => {
      if (!acc) return feature
      const featureCollection = turf.featureCollection([acc, feature])
      return turf.union(featureCollection)
    }) as Feature<Geometry> | null
  } catch (error) {
    console.error('Error unioning polygons:', error)
    return null
  }
}

/**
 * Exclude one polygon from another (difference)
 * Used for "show places near X but not in Y" queries
 */
export function excludePolygon(
  basePolygon: GeoJSONPolygon,
  excludePolygon: GeoJSONPolygon
): Feature<Geometry> | null {
  try {
    const baseFeature = basePolygon.type === 'Feature' ? basePolygon : turf.feature(basePolygon as Polygon | MultiPolygon)
    const excludeFeature = excludePolygon.type === 'Feature' ? excludePolygon : turf.feature(excludePolygon as Polygon | MultiPolygon)

    const featureCollection = turf.featureCollection([baseFeature, excludeFeature])
    const difference = turf.difference(featureCollection)
    return difference as Feature<Geometry> | null
  } catch (error) {
    console.error('Error excluding polygon:', error)
    return null
  }
}
