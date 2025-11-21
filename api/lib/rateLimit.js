import { getRedisClient } from './redis.js'

/**
 * Check if request is within rate limit
 * @param {string} identifier - User identifier (IP address, session ID, etc.)
 * @param {number} maxRequests - Maximum requests allowed in window
 * @param {number} windowSeconds - Time window in seconds
 * @returns {Promise<boolean>} - true if allowed, false if rate limited
 */
export async function checkRateLimit(identifier, maxRequests = 20, windowSeconds = 3600) {
  const client = await getRedisClient()
  if (!client) {
    // Allow request if Redis unavailable (graceful degradation)
    return true
  }

  const key = `ratelimit:${identifier}`

  try {
    const current = await client.incr(key)

    if (current === 1) {
      // First request in window - set TTL
      await client.expire(key, windowSeconds)
    }

    if (current > maxRequests) {
      console.warn(`🚫 Rate limit exceeded for ${identifier}: ${current}/${maxRequests}`)
      return false
    }

    console.log(`✅ Rate limit OK for ${identifier}: ${current}/${maxRequests}`)
    return true
  } catch (error) {
    console.error('Rate limit error:', error)
    // Allow on error (fail open)
    return true
  }
}

/**
 * Get remaining requests for identifier
 */
export async function getRateLimitInfo(identifier, maxRequests = 20) {
  const client = await getRedisClient()
  if (!client) return { remaining: maxRequests, resetIn: 0 }

  const key = `ratelimit:${identifier}`

  try {
    const current = await client.get(key)
    const ttl = await client.ttl(key)

    return {
      remaining: Math.max(0, maxRequests - (parseInt(current) || 0)),
      resetIn: ttl > 0 ? ttl : 0
    }
  } catch (error) {
    console.error('Rate limit info error:', error)
    return { remaining: maxRequests, resetIn: 0 }
  }
}
