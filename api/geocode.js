import { geoapifyRequest, getNYCBoundingBox, getNYCCenter, isWithinNYC } from './lib/geoapifyClient.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load environment variables from .env.local
const envPath = path.join(__dirname, '../.env.local')
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8')
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/)
    if (match) {
      const key = match[1].trim()
      let value = match[2].trim()
      value = value.replace(/^["']|["']$/g, '')
      process.env[key] = value
    }
  })
}

// Redis utilities - will be loaded lazily
let redisUtils = null
async function getRedisUtils() {
  if (redisUtils) return redisUtils

  try {
    const redisModule = await import('./lib/redis.js')
    redisUtils = {
      cacheGet: redisModule.cacheGet,
      cacheSet: redisModule.cacheSet,
      createCacheKey: redisModule.createCacheKey
    }
  } catch (error) {
    console.log('Redis not available - caching disabled')
    redisUtils = {
      cacheGet: async () => null,
      cacheSet: async () => false,
      createCacheKey: () => ''
    }
  }
  return redisUtils
}

// NYC slang expansion (server-side duplicate of client-side utility)
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

function expandNYCSlang(query) {
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

// Fallback: Use neighborhood centers from restaurant data
async function fallbackNeighborhoodGeocode(address) {
  try {
    // Load restaurant data
    const restaurantsPath = path.join(__dirname, '../src/data/FinalData.json')
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

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { address } = req.body

    if (!address || typeof address !== 'string') {
      return res.status(400).json({ error: 'Address is required and must be a string' })
    }

    // Expand NYC slang
    const expandedAddress = expandNYCSlang(address)
    console.log(`Geocoding: "${address}" → "${expandedAddress}"`)

    // Load Redis utilities
    const { cacheGet, cacheSet, createCacheKey } = await getRedisUtils()

    // Check cache (7-day TTL for geocoding)
    const cacheKey = createCacheKey('geocode', { address: expandedAddress.toLowerCase() })
    const cachedResult = await cacheGet(cacheKey)

    if (cachedResult) {
      console.log('📦 Returning cached geocoding result')
      return res.status(200).json(cachedResult)
    }

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
        await cacheSet(cacheKey, fallbackResult, 86400) // 1-day TTL for fallback
        return res.status(200).json(fallbackResult)
      }

      return res.status(503).json({
        error: 'Geocoding service temporarily unavailable',
        message: result.message || 'Could not geocode address'
      })
    }

    // Extract first result from GeoJSON FeatureCollection
    if (!result.features || result.features.length === 0) {
      console.log('No results found, trying fallback')
      const fallbackResult = await fallbackNeighborhoodGeocode(expandedAddress)

      if (fallbackResult) {
        await cacheSet(cacheKey, fallbackResult, 86400)
        return res.status(200).json(fallbackResult)
      }

      return res.status(404).json({
        error: 'Location not found',
        message: `Could not find location: ${address}`
      })
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
        await cacheSet(cacheKey, fallbackResult, 86400)
        return res.status(200).json(fallbackResult)
      }

      return res.status(400).json({
        error: 'Location outside NYC',
        message: `The address "${address}" is outside New York City`
      })
    }

    // Build response
    const response = {
      coordinates,
      formatted_address: properties.formatted || properties.address_line1,
      neighborhood: properties.neighborhood || properties.suburb,
      borough: properties.county || properties.city,
      confidence: 'high',
      fallback: false
    }

    // Cache result (7-day TTL)
    await cacheSet(cacheKey, response, 604800)

    console.log(`✅ Geocoded: ${response.formatted_address} → [${coordinates}]`)
    return res.status(200).json(response)

  } catch (error) {
    console.error('Geocoding API error:', error)

    // Try fallback on any error
    try {
      const fallbackResult = await fallbackNeighborhoodGeocode(req.body.address)
      if (fallbackResult) {
        return res.status(200).json(fallbackResult)
      }
    } catch (fallbackError) {
      console.error('Fallback also failed:', fallbackError)
    }

    return res.status(500).json({
      error: 'Failed to geocode address',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    })
  }
}
