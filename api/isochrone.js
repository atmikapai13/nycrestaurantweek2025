import { geoapifyRequest, getNYCCenter, isWithinManhattan } from './_lib/geoapifyClient.js'
import * as turf from '@turf/turf'
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
    const redisModule = await import('./_lib/redis.js')
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
    const { coordinates, travel_time_minutes, mode, location } = req.body

    // Validation
    if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
      return res.status(400).json({ error: 'Valid coordinates [lon, lat] are required' })
    }

    if (!travel_time_minutes || typeof travel_time_minutes !== 'number') {
      return res.status(400).json({ error: 'travel_time_minutes is required and must be a number' })
    }

    if (travel_time_minutes < 5 || travel_time_minutes > 60) {
      return res.status(400).json({ error: 'travel_time_minutes must be between 5 and 60' })
    }

    // Warn if exceeding Geoapify free tier limit (15 min for transit)
    if ((mode === 'transit' || !mode) && travel_time_minutes > 15) {
      console.warn(`⚠️ Requested ${travel_time_minutes} min transit isochrone, but Geoapify free tier caps at 15 min. Result may be capped or use fallback.`)
    }

    const [lon, lat] = coordinates

    // Verify coordinates are in Manhattan
    if (!isWithinManhattan(lat, lon)) {
      return res.status(400).json({
        error: 'Location outside Manhattan',
        message: 'Our restaurant pool is limited to Manhattan borough'
      })
    }

    // Load Redis utilities
    const { cacheGet, cacheSet, createCacheKey } = await getRedisUtils()

    // Check cache (24-hour TTL for isochrones)
    const cacheKey = createCacheKey('isochrone', {
      coordinates: coordinates.map(c => c.toFixed(4)).join(','),
      minutes: travel_time_minutes,
      mode: mode || 'transit'
    })
    const cachedResult = await cacheGet(cacheKey)

    if (cachedResult) {
      console.log('📦 Returning cached isochrone result')
      return res.status(200).json(cachedResult)
    }

    // Call Geoapify Isoline API
    console.log(`Generating ${mode || 'transit'} isochrone: ${travel_time_minutes} min from [${lon}, ${lat}]`)

    const result = await geoapifyRequest('/isoline', {
      lat: lat.toString(),
      lon: lon.toString(),
      type: 'time',
      mode: mode || 'transit',
      range: (travel_time_minutes * 60).toString() // Convert to seconds
    })

    console.log('Geoapify response:', result.features ? `✅ ${result.features.length} features` : '❌ No features')

    // Handle API errors or rate limits
    if (result.fallback || result.error) {
      console.log('⚠️ Geoapify API unavailable, generating Turf.js fallback')

      const fallbackPolygon = generateFallbackIsochrone(coordinates, travel_time_minutes, mode || 'transit')

      const fallbackResponse = {
        polygon: fallbackPolygon,
        center: coordinates,
        mode: mode || 'transit',
        travel_time_minutes,
        fallback: true,
        fallback_type: 'api_unavailable',
        message: result.message || 'Using distance-based approximation'
      }

      // Cache fallback result (shorter TTL: 1 hour)
      await cacheSet(cacheKey, fallbackResponse, 3600)

      return res.status(200).json(fallbackResponse)
    }

    // Extract polygon from Geoapify response
    if (!result.features || result.features.length === 0) {
      console.log('No isochrone polygon returned, using fallback')

      const fallbackPolygon = generateFallbackIsochrone(coordinates, travel_time_minutes, mode || 'transit')

      const fallbackResponse = {
        polygon: fallbackPolygon,
        center: coordinates,
        mode: mode || 'transit',
        travel_time_minutes,
        fallback: true,
        fallback_type: 'no_results'
      }

      await cacheSet(cacheKey, fallbackResponse, 3600)
      return res.status(200).json(fallbackResponse)
    }

    // Geoapify returns GeoJSON FeatureCollection
    const polygon = result.features[0]

    const response = {
      polygon,
      center: coordinates,
      mode: mode || 'transit',
      travel_time_minutes,
      fallback: false
    }

    // Cache result (24-hour TTL)
    await cacheSet(cacheKey, response, 86400)

    console.log(`✅ Generated ${mode || 'transit'} isochrone: ${travel_time_minutes} min`)
    return res.status(200).json(response)

  } catch (error) {
    console.error('Isochrone API error:', error)

    // Try to return fallback on any error
    try {
      const { coordinates, travel_time_minutes, mode } = req.body
      if (coordinates && travel_time_minutes) {
        const fallbackPolygon = generateFallbackIsochrone(
          coordinates,
          travel_time_minutes,
          mode || 'transit'
        )

        return res.status(200).json({
          polygon: fallbackPolygon,
          center: coordinates,
          mode: mode || 'transit',
          travel_time_minutes,
          fallback: true,
          fallback_type: 'error',
          message: 'Using distance-based approximation due to API error'
        })
      }
    } catch (fallbackError) {
      console.error('Fallback also failed:', fallbackError)
    }

    return res.status(500).json({
      error: 'Failed to generate isochrone',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    })
  }
}
