import { geoapifyRequest, isWithinNYC } from './geoapifyClient.js'
import { geocodeAddress } from './geocodeLogic.js'
import * as turf from '@turf/turf'

/**
 * Normalize polygon geometry to always be Polygon (not MultiPolygon)
 * Converts MultiPolygon to Polygon by dissolving/merging all parts
 */
function normalizePolygonGeometry(feature) {
  const geometry = feature.geometry || feature

  // If already a Polygon, return as-is
  if (geometry.type === 'Polygon') {
    return feature
  }

  // If MultiPolygon, dissolve into single Polygon
  if (geometry.type === 'MultiPolygon') {
    try {
      // Use turf.dissolve to merge all polygons into one
      // For a single feature, this effectively converts MultiPolygon → Polygon
      const dissolved = turf.dissolve(turf.featureCollection([feature]))

      if (dissolved.features && dissolved.features.length > 0) {
        console.log('✅ Normalized MultiPolygon → Polygon')
        return dissolved.features[0]
      }
    } catch (error) {
      console.warn('⚠️ Failed to normalize MultiPolygon, returning original:', error.message)
    }
  }

  // Return original if normalization not needed/failed
  return feature
}

/**
 * Generate Turf.js fallback isochrone (circular approximation)
 */
function generateFallbackIsochrone(coordinates, minutes, mode) {
  // Approximate speeds in meters/minute
  const speeds = {
    walking: 83,      // 5 km/h
    cycling: 250,     // 15 km/h
    driving: 667,     // 40 km/h
    transit: 333      // 20 km/h average
  }

  const speedMetersPerMin = speeds[mode] || 333
  const radiusMeters = minutes * speedMetersPerMin

  const center = turf.point(coordinates)
  const buffered = turf.buffer(center, radiusMeters / 1000, { units: 'kilometers' })

  return buffered
}

/**
 * Generate isochrone (travel-time polygon) from coordinates
 * @param {number[]} coordinates - [lon, lat]
 * @param {number} travelTimeMinutes - Travel time in minutes (5-60)
 * @param {string} mode - Travel mode: "walking", "cycling", "transit", "driving"
 * @returns {Promise<{polygon: object, center: number[], mode: string, travel_time_minutes: number, fallback: boolean, fallback_type?: string}>}
 * @throws {Error} if coordinates are invalid or outside NYC
 */
export async function generateIsochrone(coordinates, travelTimeMinutes, mode = 'walking') {
  // Validation
  if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
    throw new Error('Valid coordinates [lon, lat] are required')
  }

  if (!travelTimeMinutes || typeof travelTimeMinutes !== 'number') {
    throw new Error('travelTimeMinutes is required and must be a number')
  }

  if (travelTimeMinutes < 5 || travelTimeMinutes > 60) {
    throw new Error('travelTimeMinutes must be between 5 and 60')
  }

  // Warn if exceeding Geoapify free tier limit (15 min for transit)
  if ((mode === 'transit' || !mode) && travelTimeMinutes > 15) {
    console.warn(`⚠️ Requested ${travelTimeMinutes} min transit isochrone, but Geoapify free tier caps at 15 min. Result may be capped or use fallback.`)
  }

  const [lon, lat] = coordinates

  // Verify coordinates are in NYC
  if (!isWithinNYC(lat, lon)) {
    throw new Error('Location outside NYC - isochrone calculations are only supported for NYC locations')
  }

  try {
    // Map mode names to Geoapify API values
    const modeMap = {
      'walking': 'walk',
      'cycling': 'bicycle',
      'transit': 'transit',
      'driving': 'drive'
    };
    const geoapifyMode = modeMap[mode] || mode || 'transit';

    // Call Geoapify Isoline API
    console.log(`Generating ${mode || 'transit'} isochrone: ${travelTimeMinutes} min from [${lon}, ${lat}]`)

    const result = await geoapifyRequest('/isoline', {
      lat: lat.toString(),
      lon: lon.toString(),
      type: 'time',
      mode: geoapifyMode,
      range: (travelTimeMinutes * 60).toString() // Convert to seconds
    })

    console.log('Geoapify response:', result.features ? `✅ ${result.features.length} features` : '❌ No features')

    // Handle API errors or rate limits
    if (result.fallback || result.error) {
      console.log('⚠️ Geoapify API unavailable, generating Turf.js fallback')

      const fallbackPolygon = generateFallbackIsochrone(coordinates, travelTimeMinutes, mode || 'transit')

      return {
        polygon: fallbackPolygon,
        center: coordinates,
        mode: mode || 'transit',
        travel_time_minutes: travelTimeMinutes,
        fallback: true,
        fallback_type: 'api_unavailable',
        message: result.message || 'Using distance-based approximation'
      }
    }

    // Extract polygon from Geoapify response
    if (!result.features || result.features.length === 0) {
      console.log('No isochrone polygon returned, using fallback')

      const fallbackPolygon = generateFallbackIsochrone(coordinates, travelTimeMinutes, mode || 'transit')

      return {
        polygon: fallbackPolygon,
        center: coordinates,
        mode: mode || 'transit',
        travel_time_minutes: travelTimeMinutes,
        fallback: true,
        fallback_type: 'no_results'
      }
    }

    // Geoapify returns GeoJSON FeatureCollection
    const rawPolygon = result.features[0]

    // Normalize geometry to ensure it's always Polygon (not MultiPolygon)
    const polygon = normalizePolygonGeometry(rawPolygon)

    return {
      polygon,
      center: coordinates,
      mode: mode || 'transit',
      travel_time_minutes: travelTimeMinutes,
      fallback: false
    }
  } catch (error) {
    // Try to return fallback on any error
    console.error('Isochrone generation error:', error)

    const fallbackPolygon = generateFallbackIsochrone(
      coordinates,
      travelTimeMinutes,
      mode || 'transit'
    )

    return {
      polygon: fallbackPolygon,
      center: coordinates,
      mode: mode || 'transit',
      travel_time_minutes: travelTimeMinutes,
      fallback: true,
      fallback_type: 'error',
      message: 'Using distance-based approximation due to error'
    }
  }
}

/**
 * Generate isochrones for multiple parties and combine with spatial operation
 * @param {Array<{address: string, travelTimeMinutes: number, mode?: string}>} locations - Array of locations
 * @param {string} operation - "intersection", "union", or "exclusion"
 * @returns {Promise<{combinedPolygon: object|null, individualPolygons: object[], operation: string, locations: object[]}>}
 * @throws {Error} if geocoding or isochrone generation fails
 */
export async function generateMultiPartyIsochrone(locations, operation = 'intersection') {
  if (!locations || !Array.isArray(locations) || locations.length < 2) {
    throw new Error('At least 2 locations are required')
  }

  const validOperations = ['intersection', 'union', 'exclusion']
  if (!validOperations.includes(operation)) {
    throw new Error(`Invalid operation: ${operation}. Must be one of: ${validOperations.join(', ')}`)
  }

  console.log(`🎯 Multi-party isochrone: ${locations.length} locations, operation: ${operation}`)

  // Step 1: Geocode all locations in parallel
  const geocodedLocations = await Promise.all(
    locations.map(async (loc) => {
      const geocoded = await geocodeAddress(loc.address)
      return {
        ...loc,
        geocoded
      }
    })
  )

  // Step 2: Generate isochrones for each location in parallel
  const isochroneResults = await Promise.all(
    geocodedLocations.map(async (loc) => {
      const isochrone = await generateIsochrone(
        loc.geocoded.coordinates,
        loc.travelTimeMinutes,
        loc.mode || 'walking'
      )
      return {
        ...loc,
        isochrone
      }
    })
  )

  // Extract polygons
  const polygons = isochroneResults.map(result => result.isochrone.polygon)

  // Step 3: Perform spatial operation
  let combinedPolygon = null

  try {
    if (operation === 'intersection') {
      // Find overlap between all polygons (Turf v7+ uses array syntax)
      if (polygons.length === 2) {
        combinedPolygon = turf.intersect(turf.featureCollection(polygons))
      } else {
        // For 3+ polygons, do pairwise intersection
        combinedPolygon = polygons[0]
        for (let i = 1; i < polygons.length; i++) {
          combinedPolygon = turf.intersect(turf.featureCollection([combinedPolygon, polygons[i]]))
          if (!combinedPolygon) {
            console.log('No overlap found during intersection')
            break // No overlap
          }
        }
      }
    } else if (operation === 'union') {
      // Combine all polygons (Turf v7+ uses array syntax)
      if (polygons.length === 2) {
        combinedPolygon = turf.union(turf.featureCollection(polygons))
      } else {
        combinedPolygon = polygons[0]
        for (let i = 1; i < polygons.length; i++) {
          combinedPolygon = turf.union(turf.featureCollection([combinedPolygon, polygons[i]]))
        }
      }
    } else if (operation === 'exclusion') {
      // First polygon MINUS all others (Turf v7+ uses array syntax)
      combinedPolygon = polygons[0]
      for (let i = 1; i < polygons.length; i++) {
        combinedPolygon = turf.difference(turf.featureCollection([combinedPolygon, polygons[i]]))
        if (!combinedPolygon) {
          console.log('Complete exclusion - no area remaining')
          break // Completely excluded
        }
      }
    }
  } catch (error) {
    console.error(`Spatial operation ${operation} failed:`, error)
    throw new Error(`Failed to perform ${operation} operation: ${error.message}`)
  }

  return {
    combinedPolygon,
    individualPolygons: polygons,
    operation,
    locations: geocodedLocations.map(loc => ({
      address: loc.address,
      formatted_address: loc.geocoded.formatted_address,
      coordinates: loc.geocoded.coordinates,
      mode: loc.mode || 'walking',
      travelTimeMinutes: loc.travelTimeMinutes
    }))
  }
}
