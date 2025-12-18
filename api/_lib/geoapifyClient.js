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
