/**
 * Hybrid Isochrone Service
 * Routes between Mapbox (free, walking/cycling) and Geoapify (paid, transit)
 * with Turf.js fallback for when quotas are exceeded
 */

import * as turf from '@turf/turf'
import { API_CONFIG } from '../config/features'

export type TransportMode = 'walking' | 'cycling' | 'transit' | 'driving'

export interface IsochroneRequest {
  location: string // Address or neighborhood
  coordinates?: [number, number] // Optional: pre-geocoded coordinates [lon, lat]
  travel_time_minutes: number // 5, 10, 15, 20, 30
  mode: TransportMode
}

export interface IsochroneResponse {
  polygon: GeoJSON.Feature<GeoJSON.Polygon>
  center: [number, number] // [lon, lat]
  mode: TransportMode
  travel_time_minutes: number
  fallback: boolean
  fallback_type?: 'turf_approximation' | 'api_unavailable'
}

// Track Mapbox usage (100K/month free tier)
let mapboxRequestsThisMonth = 0
const MAPBOX_MONTHLY_LIMIT = 95000 // Safety margin

// Get Mapbox token from environment
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

// Debug: Check if token is loaded
if (!MAPBOX_TOKEN || MAPBOX_TOKEN === 'undefined') {
  console.error('⚠️ VITE_MAPBOX_TOKEN is not defined! Isochrones will use fallback approximation.')
  console.log('Make sure .env.local has VITE_MAPBOX_TOKEN set and restart the dev server.')
}

/**
 * Main isochrone function - routes to appropriate service
 */
export async function getIsochrone(request: IsochroneRequest): Promise<IsochroneResponse> {
  const { mode, coordinates, location, travel_time_minutes } = request

  // If no coordinates provided, geocode first
  let coords = coordinates
  if (!coords) {
    coords = await geocodeLocation(location)
  }

  // Route based on mode
  if (mode === 'walking' || mode === 'cycling' || mode === 'driving') {
    return fetchMapboxIsochrone(coords, travel_time_minutes, mode)
  } else if (mode === 'transit') {
    return fetchGeoapifyIsochrone(coords, travel_time_minutes, location)
  }

  throw new Error(`Invalid transport mode: ${mode}`)
}

/**
 * Geocode location to coordinates
 */
async function geocodeLocation(location: string): Promise<[number, number]> {
  try {
    const response = await fetch(`${API_CONFIG.API_URL}/geocode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: location })
    })

    if (!response.ok) {
      throw new Error('Geocoding failed')
    }

    const data = await response.json()
    return data.coordinates as [number, number]
  } catch (error) {
    console.error('Geocoding error in isochrone service:', error)
    throw new Error(`Could not geocode location: ${location}`)
  }
}

/**
 * Fetch isochrone from Mapbox (walking, cycling, driving)
 * Free tier: 100,000 requests/month
 */
async function fetchMapboxIsochrone(
  coordinates: [number, number],
  minutes: number,
  mode: TransportMode
): Promise<IsochroneResponse> {
  const [lon, lat] = coordinates

  // Check if we've exceeded monthly limit
  if (mapboxRequestsThisMonth >= MAPBOX_MONTHLY_LIMIT) {
    console.warn('⚠️ Mapbox monthly limit reached, using Turf.js fallback')
    return generateTurfApproximation(coordinates, minutes, mode)
  }

  try {
    // Map our mode to Mapbox profile
    const profile = mode === 'walking' ? 'walking' : mode === 'cycling' ? 'cycling' : 'driving'

    console.log(`🗺️ Calling Mapbox Isochrone API: ${profile}, ${minutes} min from [${lon}, ${lat}]`)

    const url = `https://api.mapbox.com/isochrone/v1/mapbox/${profile}/${lon},${lat}`
    const params = new URLSearchParams({
      contours_minutes: minutes.toString(),
      polygons: 'true',
      denoise: '0.5',      // Reduced from 1 to keep more detail
      generalize: '10',    // Reduced from 500 to 50 meters for smoother shape
      access_token: MAPBOX_TOKEN
    })

    const response = await fetch(`${url}?${params.toString()}`)

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Mapbox API error (${response.status}):`, errorText)

      if (response.status === 429) {
        console.warn('⚠️ Mapbox rate limit hit, using Turf.js fallback')
        return generateTurfApproximation(coordinates, minutes, mode)
      }

      console.warn(`⚠️ Mapbox API failed (${response.status}), using Turf.js fallback`)
      return generateTurfApproximation(coordinates, minutes, mode)
    }

    const data = await response.json()

    console.log('✅ Mapbox API success! Response:', data)
    console.log('📍 Full geometry:', JSON.stringify(data.features[0].geometry, null, 2))

    // Increment usage counter
    mapboxRequestsThisMonth++

    // Extract polygon from GeoJSON FeatureCollection
    if (!data.features || data.features.length === 0) {
      console.error('❌ Mapbox returned empty features array')
      throw new Error('No isochrone polygon returned')
    }

    const polygon = data.features[0]
    const coords = polygon.geometry.coordinates

    // Check polygon structure - should be Polygon with coordinates[0] being outer ring
    if (polygon.geometry.type === 'Polygon' && coords[0]) {
      console.log('✅ Returning Mapbox isochrone polygon with', coords[0].length, 'coordinates in outer ring')
    } else {
      console.log('⚠️ Unexpected polygon structure:', polygon.geometry.type, 'coords length:', coords.length)
    }

    return {
      polygon: data.features[0],
      center: coordinates,
      mode,
      travel_time_minutes: minutes,
      fallback: false
    }
  } catch (error) {
    console.error('Mapbox isochrone error:', error)
    return generateTurfApproximation(coordinates, minutes, mode)
  }
}

/**
 * Fetch isochrone from Geoapify (transit only)
 * Free tier: 3,000 credits/day (1 credit per 5 minutes)
 */
async function fetchGeoapifyIsochrone(
  coordinates: [number, number],
  minutes: number,
  location: string
): Promise<IsochroneResponse> {
  try {
    const response = await fetch(`${API_CONFIG.API_URL}/isochrone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coordinates,
        travel_time_minutes: minutes,
        mode: 'transit',
        location // Pass original location for better error messages
      })
    })

    if (!response.ok) {
      throw new Error(`Geoapify isochrone API error: ${response.status}`)
    }

    const data = await response.json()

    if (data.fallback) {
      console.warn('⚠️ Geoapify quota exceeded, using Turf.js fallback')
      return generateTurfApproximation(coordinates, minutes, 'transit')
    }

    return {
      polygon: data.polygon,
      center: coordinates,
      mode: 'transit',
      travel_time_minutes: minutes,
      fallback: false
    }
  } catch (error) {
    console.error('Geoapify isochrone error:', error)
    return generateTurfApproximation(coordinates, minutes, 'transit')
  }
}

/**
 * Generate approximate isochrone using Turf.js buffer
 * Fallback when APIs are unavailable
 */
function generateTurfApproximation(
  coordinates: [number, number],
  minutes: number,
  mode: TransportMode
): IsochroneResponse {
  // Approximate speeds in meters/minute
  const speeds: Record<TransportMode, number> = {
    walking: 83,      // 5 km/h
    cycling: 250,     // 15 km/h
    driving: 667,     // 40 km/h
    transit: 333      // 20 km/h average (subway)
  }

  const speedMetersPerMin = speeds[mode]
  const radiusMeters = minutes * speedMetersPerMin

  const center = turf.point(coordinates)
  const buffered = turf.buffer(center, radiusMeters / 1000, { units: 'kilometers', steps: 64 })

  if (!buffered) {
    throw new Error('Failed to generate approximate isochrone')
  }

  return {
    polygon: buffered,
    center: coordinates,
    mode,
    travel_time_minutes: minutes,
    fallback: true,
    fallback_type: 'turf_approximation'
  }
}

/**
 * Reset Mapbox monthly counter (call this on the 1st of each month)
 */
export function resetMapboxCounter() {
  mapboxRequestsThisMonth = 0
  console.log('🔄 Mapbox usage counter reset')
}

/**
 * Get current Mapbox usage
 */
export function getMapboxUsage() {
  return {
    requests: mapboxRequestsThisMonth,
    limit: MAPBOX_MONTHLY_LIMIT,
    remaining: MAPBOX_MONTHLY_LIMIT - mapboxRequestsThisMonth,
    percentage: Math.round((mapboxRequestsThisMonth / MAPBOX_MONTHLY_LIMIT) * 100)
  }
}
