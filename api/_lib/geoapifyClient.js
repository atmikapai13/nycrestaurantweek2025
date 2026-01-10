/**
 * Geoapify API Client
 * Shared HTTP client for Geoapify APIs with NYC-specific configuration
 */

// NYC bounding box for filtering results
const NYC_BBOX = {
  minLon: -74.2591,
  minLat: 40.4774,
  maxLon: -73.7004,
  maxLat: 40.9176
}

// Manhattan bounding box for API filtering (rough rectangle)
const MANHATTAN_BBOX = {
  minLon: -74.0200,
  minLat: 40.6829,
  maxLon: -73.9067,
  maxLat: 40.8820
}

// Manhattan boundary as a parallelogram/polygon (follows actual NE-SW orientation)
// Coordinates trace Manhattan's coastline clockwise from Battery Park
const MANHATTAN_POLYGON = {
  type: 'Polygon',
  coordinates: [[
    [-74.0170, 40.7033],  // Battery Park (southern tip)
    [-73.9730, 40.7100],  // Lower East Side (southeast)
    [-73.9700, 40.7500],  // East Village / Midtown East
    [-73.9300, 40.7950],  // Upper East Side (east side widest point)
    [-73.9103, 40.8758],  // Inwood (northeast tip)
    [-73.9280, 40.8785],  // Inwood (northwest tip)
    [-73.9600, 40.8150],  // Upper West Side
    [-74.0100, 40.7700],  // Midtown West / Hell's Kitchen
    [-74.0170, 40.7033]   // Back to Battery Park (close polygon)
  ]]
}

// NYC center for biasing results
const NYC_CENTER = {
  lat: 40.7831,
  lon: -73.9712
}

/**
 * Make a request to Geoapify API with error handling
 * @param {string} endpoint - API endpoint (e.g., '/geocode/search')
 * @param {Object} params - Query parameters
 * @returns {Promise<Object>} API response
 */
export async function geoapifyRequest(endpoint, params = {}) {
  const apiKey = process.env.GEOAPIFY_API_KEY

  if (!apiKey) {
    throw new Error('GEOAPIFY_API_KEY not configured')
  }

  // Add API key to params
  const queryParams = new URLSearchParams({
    ...params,
    apiKey
  })

  const url = `https://api.geoapify.com/v1${endpoint}?${queryParams.toString()}`

  try {
    const response = await fetch(url)

    // Handle rate limiting
    if (response.status === 429) {
      return {
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Geoapify API rate limit exceeded. Please try again later.',
        fallback: true
      }
    }

    // Handle quota exceeded
    if (response.status === 402) {
      return {
        error: 'QUOTA_EXCEEDED',
        message: 'Daily Geoapify quota exceeded. Using fallback approximation.',
        fallback: true
      }
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.message || `Geoapify API error: ${response.status}`)
    }

    return await response.json()
  } catch (error) {
    console.error('Geoapify API error:', error)
    throw error
  }
}

/**
 * Get NYC bounding box filter string for Geoapify
 * @returns {string} Bounding box in format "lon1,lat1,lon2,lat2"
 */
export function getNYCBoundingBox() {
  return `${NYC_BBOX.minLon},${NYC_BBOX.minLat},${NYC_BBOX.maxLon},${NYC_BBOX.maxLat}`
}

/**
 * Get NYC center coordinates for biasing results
 * @returns {Object} { lat, lon }
 */
export function getNYCCenter() {
  return NYC_CENTER
}

/**
 * Check if a coordinate is within NYC bounds
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @returns {boolean} True if within NYC bounds
 */
export function isWithinNYC(lat, lon) {
  return (
    lat >= NYC_BBOX.minLat &&
    lat <= NYC_BBOX.maxLat &&
    lon >= NYC_BBOX.minLon &&
    lon <= NYC_BBOX.maxLon
  )
}

/**
 * Check if a coordinate is within Manhattan bounds (using polygon boundary)
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @returns {boolean} True if within Manhattan bounds
 */
export function isWithinManhattan(lat, lon) {
  // Use Turf.js for point-in-polygon check (more accurate than rectangle)
  // Import dynamically to avoid circular dependencies
  try {
    // Quick rectangle check first for performance (fail fast if way outside)
    if (lat < MANHATTAN_BBOX.minLat || lat > MANHATTAN_BBOX.maxLat ||
        lon < MANHATTAN_BBOX.minLon || lon > MANHATTAN_BBOX.maxLon) {
      return false
    }

    // For edge cases, use proper polygon check
    // Note: Importing turf synchronously since this runs server-side
    const turf = require('@turf/turf')
    const point = turf.point([lon, lat])
    return turf.booleanPointInPolygon(point, MANHATTAN_POLYGON)
  } catch (error) {
    // Fallback to rectangle check if turf fails
    console.warn('Turf.js not available, using rectangle boundary check')
    return (
      lat >= MANHATTAN_BBOX.minLat &&
      lat <= MANHATTAN_BBOX.maxLat &&
      lon >= MANHATTAN_BBOX.minLon &&
      lon <= MANHATTAN_BBOX.maxLon
    )
  }
}

/**
 * Get Manhattan bounding box filter string for Geoapify
 * @returns {string} Bounding box in format "lon1,lat1,lon2,lat2"
 */
export function getManhattanBoundingBox() {
  return `${MANHATTAN_BBOX.minLon},${MANHATTAN_BBOX.minLat},${MANHATTAN_BBOX.maxLon},${MANHATTAN_BBOX.maxLat}`
}
