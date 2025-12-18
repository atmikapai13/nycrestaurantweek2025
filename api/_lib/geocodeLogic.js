import { geoapifyRequest, getNYCBoundingBox, getNYCCenter, isWithinNYC } from './geoapifyClient.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// NYC slang expansion
const NYC_SLANG_MAP = {
  'lic': 'Long Island City',
  'fidi': 'Lower Manhattan',
  'financial district': 'Lower Manhattan',
  'ev': 'East Village',
  'wv': 'West Village',
  'les': 'Lower East Side',
  'uws': 'Upper West Side',
  'ues': 'Upper East Side',
  'hk': "Hell's Kitchen",
  'hells kitchen': "Hell's Kitchen",
  'times sq': 'Times Square',
  'grand central': 'Grand Central Terminal',
  'penn station': 'Pennsylvania Station',
  'the vessel': 'Hudson Yards',
  'soho': 'SoHo',
  'noho': 'NoHo',
  'nolita': 'NoLita',
  'tribeca': 'TriBeCa',
  'dumbo': 'DUMBO',
  'wburg': 'Williamsburg',
  'bk': 'Brooklyn'
}

/**
 * Expand NYC slang to formal names
 */
export function expandNYCSlang(query) {
  if (!query || typeof query !== 'string') return query

  let expanded = query.toLowerCase().trim()

  // Try exact match first
  if (NYC_SLANG_MAP[expanded]) {
    return NYC_SLANG_MAP[expanded]
  }

  // Try partial replacement
  for (const [slang, formal] of Object.entries(NYC_SLANG_MAP)) {
    const regex = new RegExp(`\\b${slang}\\b`, 'gi')
    expanded = expanded.replace(regex, formal)
  }

  return expanded
}

/**
 * Fallback: Use neighborhood centers from restaurant data
 */
async function fallbackNeighborhoodGeocode(address) {
  try {
    // Load restaurant data
    const restaurantsPath = path.join(__dirname, '../../src/data/FinalData.json')
    const restaurantsData = JSON.parse(fs.readFileSync(restaurantsPath, 'utf8'))

    const lowerAddress = address.toLowerCase()

    // Find restaurants in matching neighborhood
    const matchingRestaurants = restaurantsData.filter(r =>
      r.neighborhood && r.neighborhood.toLowerCase().includes(lowerAddress)
    )

    if (matchingRestaurants.length > 0) {
      // Calculate average coordinates (centroid)
      const avgLon = matchingRestaurants.reduce((sum, r) => sum + r.longitude, 0) / matchingRestaurants.length
      const avgLat = matchingRestaurants.reduce((sum, r) => sum + r.latitude, 0) / matchingRestaurants.length

      return {
        coordinates: [avgLon, avgLat],
        formatted_address: matchingRestaurants[0].neighborhood + ', New York, NY',
        confidence: 'approximate',
        fallback: true,
        fallback_type: 'neighborhood_centroid'
      }
    }

    return null
  } catch (error) {
    console.error('Fallback geocoding error:', error)
    return null
  }
}

/**
 * Geocode NYC address to coordinates
 * @param {string} address - NYC address, neighborhood, or landmark
 * @returns {Promise<{coordinates: number[], formatted_address: string, neighborhood?: string, borough?: string, confidence: string, fallback: boolean}>}
 * @throws {Error} if geocoding fails completely
 */
export async function geocodeAddress(address) {
  if (!address || typeof address !== 'string') {
    throw new Error('Address is required and must be a string')
  }

  // Expand NYC slang
  const expandedAddress = expandNYCSlang(address)
  console.log(`Geocoding: "${address}" → "${expandedAddress}"`)

  try {
    // Call Geoapify Geocoding API
    const nycCenter = getNYCCenter()
    const result = await geoapifyRequest('/geocode/search', {
      text: expandedAddress,
      filter: `rect:${getNYCBoundingBox()}`,
      bias: `proximity:${nycCenter.lon},${nycCenter.lat}`,
      limit: 5
    })

    // Handle API errors or rate limits
    if (result.fallback || result.error) {
      console.log('⚠️ Geoapify API unavailable, using fallback')
      const fallbackResult = await fallbackNeighborhoodGeocode(expandedAddress)

      if (fallbackResult) {
        return fallbackResult
      }

      throw new Error(result.message || 'Geocoding service temporarily unavailable')
    }

    // Extract first result from GeoJSON FeatureCollection
    if (!result.features || result.features.length === 0) {
      console.log('No results found, trying fallback')
      const fallbackResult = await fallbackNeighborhoodGeocode(expandedAddress)

      if (fallbackResult) {
        return fallbackResult
      }

      throw new Error(`Could not find location: ${address}`)
    }

    const topFeature = result.features[0]
    const properties = topFeature.properties
    const coordinates = topFeature.geometry.coordinates // GeoJSON format: [lon, lat]
    const [lon, lat] = coordinates

    // Verify result is within NYC bounds
    if (!isWithinNYC(lat, lon)) {
      console.log('Result outside NYC bounds, trying fallback')
      const fallbackResult = await fallbackNeighborhoodGeocode(expandedAddress)

      if (fallbackResult) {
        return fallbackResult
      }

      throw new Error(`The address "${address}" is outside New York City`)
    }

    // Build response
    return {
      coordinates,
      formatted_address: properties.formatted || properties.address_line1,
      neighborhood: properties.neighborhood || properties.suburb,
      borough: properties.county || properties.city,
      confidence: 'high',
      fallback: false
    }
  } catch (error) {
    // Try fallback on any error
    const fallbackResult = await fallbackNeighborhoodGeocode(address)
    if (fallbackResult) {
      return fallbackResult
    }

    throw error
  }
}
