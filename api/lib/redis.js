import { createClient } from 'redis'
import crypto from 'crypto'

let redisClient = null

/**
 * Get or create Redis client connection
 * Returns null if Redis is not configured (graceful degradation)
 */
export async function getRedisClient() {
  if (redisClient && redisClient.isOpen) {
    return redisClient
  }

  if (!process.env.REDIS_URL) {
    console.warn('⚠️  Redis not configured - caching disabled')
    return null
  }

  try {
    redisClient = createClient({
      url: process.env.REDIS_URL,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 3) {
            console.error('Redis connection failed after 3 retries')
            return new Error('Redis unavailable')
          }
          return Math.min(retries * 100, 3000)
        }
      }
    })

    redisClient.on('error', (err) => console.error('Redis Client Error:', err))
    redisClient.on('connect', () => console.log('✅ Redis connected'))

    await redisClient.connect()
    return redisClient
  } catch (error) {
    console.error('Failed to connect to Redis:', error)
    return null
  }
}

/**
 * Get value from cache
 * Returns null if key doesn't exist or Redis is unavailable
 */
export async function cacheGet(key) {
  const client = await getRedisClient()
  if (!client) return null

  try {
    const value = await client.get(key)
    if (value) {
      console.log(`🎯 Cache HIT: ${key}`)
      return JSON.parse(value)
    }
    console.log(`❌ Cache MISS: ${key}`)
    return null
  } catch (error) {
    console.error('Redis GET error:', error)
    return null
  }
}

/**
 * Set value in cache with TTL
 * TTL defaults to 1 hour (3600 seconds)
 */
export async function cacheSet(key, value, ttlSeconds = 3600) {
  const client = await getRedisClient()
  if (!client) return false

  try {
    await client.setEx(key, ttlSeconds, JSON.stringify(value))
    console.log(`💾 Cached: ${key} (TTL: ${ttlSeconds}s)`)
    return true
  } catch (error) {
    console.error('Redis SET error:', error)
    return false
  }
}

/**
 * Create deterministic cache key from object
 * Uses MD5 hash to keep keys short and consistent
 */
export function createCacheKey(prefix, data) {
  // Sort object keys for deterministic hashing
  const normalized = JSON.stringify(data, Object.keys(data).sort())
  const hash = crypto.createHash('md5').update(normalized).digest('hex').slice(0, 16)
  return `${prefix}:${hash}`
}

/**
 * Delete key from cache
 */
export async function cacheDelete(key) {
  const client = await getRedisClient()
  if (!client) return false

  try {
    await client.del(key)
    console.log(`🗑️  Deleted cache key: ${key}`)
    return true
  } catch (error) {
    console.error('Redis DELETE error:', error)
    return false
  }
}

/**
 * Check if key exists in cache
 */
export async function cacheExists(key) {
  const client = await getRedisClient()
  if (!client) return false

  try {
    const exists = await client.exists(key)
    return exists === 1
  } catch (error) {
    console.error('Redis EXISTS error:', error)
    return false
  }
}
