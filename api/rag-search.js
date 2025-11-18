import { Pinecone } from '@pinecone-database/pinecone'
import { GoogleGenerativeAI } from '@google/generative-ai'
import restaurants from '../src/data/FinalData.json' assert { type: 'json' }
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
      // Remove quotes if present
      value = value.replace(/^["']|["']$/g, '')
      process.env[key] = value
    }
  })
}

const INDEX_NAME = 'nyc-eats'

/**
 * Generate embedding for search query
 */
async function generateQueryEmbedding(query) {
  if (!process.env.GOOGLE_API_KEY) {
    throw new Error('GOOGLE_API_KEY not configured')
  }

  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY)
  const model = genAI.getGenerativeModel({ model: 'text-embedding-004' })

  const result = await model.embedContent(query)
  return result.embedding.values
}

/**
 * Query Pinecone for semantic matches
 * NOTE: We only use Pinecone for semantic similarity, not for filtering
 * Cuisine filtering happens locally because Pinecone doesn't support partial string matching
 */
async function queryPinecone(embedding, filters, topK = 50) {
  if (!process.env.PINECONE_API_KEY) {
    throw new Error('PINECONE_API_KEY not configured')
  }

  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY })
  const index = pc.index(INDEX_NAME)

  // Build Pinecone metadata filter (only for exact matches)
  const pineconeFilter = {}

  // Price and rating work with exact matching
  if (filters.price_levels && filters.price_levels.length > 0) {
    pineconeFilter.price = { $in: filters.price_levels }
  }

  if (filters.min_rating) {
    pineconeFilter.rating = { $gte: filters.min_rating }
  }

  // NOTE: We skip cuisine and neighborhood filters here because they need partial matching
  // Those will be applied locally after retrieving results

  // Query Pinecone - get more results than needed since we'll filter locally
  const queryRequest = {
    vector: embedding,
    topK: topK * 3, // Get 3x more to account for local filtering
    includeMetadata: true
  }

  // Only add filter if we have any filters
  if (Object.keys(pineconeFilter).length > 0) {
    queryRequest.filter = pineconeFilter
  }

  const results = await index.query(queryRequest)
  return results.matches || []
}

/**
 * Load full restaurant data for matched slugs and apply local filters
 */
function loadRestaurantData(pineconeMatches, filters = {}) {
  const restaurantMap = new Map(restaurants.map(r => [r.slug, r]))

  return pineconeMatches.map(match => {
    const restaurant = restaurantMap.get(match.id)
    if (!restaurant) {
      console.warn(`Restaurant not found for slug: ${match.id}`)
      return null
    }

    // Apply cuisine filter (partial matching)
    if (filters.cuisines && filters.cuisines.length > 0) {
      const matchesCuisine = filters.cuisines.some(cuisine =>
        restaurant.cuisine.toLowerCase().includes(cuisine.toLowerCase())
      )
      if (!matchesCuisine) {
        return null // Filter out this restaurant
      }
    }

    // Apply neighborhood filter (partial matching)
    if (filters.neighborhoods && filters.neighborhoods.length > 0) {
      const matchesNeighborhood = filters.neighborhoods.some(neighborhood =>
        restaurant.neighborhood.toLowerCase().includes(neighborhood.toLowerCase())
      )
      if (!matchesNeighborhood) {
        return null // Filter out this restaurant
      }
    }

    return {
      restaurant,
      score: match.score,
      metadata: match.metadata
    }
  }).filter(r => r !== null)
}

/**
 * Generate explanation for why a restaurant matched
 */
function generateExplanation(query, restaurant, score) {
  const highlights = restaurant.yelp_review_highlights || ''
  const queryLower = query.toLowerCase()

  // Extract key phrases from yelp highlights that match the query
  const sentences = highlights.split('.')
  const relevantSentences = sentences.filter(s =>
    s.toLowerCase().includes(queryLower) ||
    queryLower.split(' ').some(word => word.length > 3 && s.toLowerCase().includes(word))
  )

  if (relevantSentences.length > 0) {
    const excerpt = relevantSentences[0].trim()
    return `Matched "${query}" - ${excerpt}.`
  }

  // Fallback explanation
  const scorePercent = Math.round(score * 100)
  return `${scorePercent}% semantic match for "${query}" based on reviews and descriptions.`
}

/**
 * Generate overall explanation for why these restaurants were recommended
 */
function generateOverallExplanation(query, topResults) {
  if (topResults.length === 0) {
    return null
  }

  // Extract common themes from top results
  const cuisines = [...new Set(topResults.slice(0, 5).map(r => r.restaurant.cuisine))]
  const neighborhoods = [...new Set(topResults.slice(0, 5).map(r => r.restaurant.neighborhood))]

  // Get top 2 restaurant names to mention
  const topRestaurants = topResults.slice(0, 2).map(r => r.restaurant.name)

  // Check if query contains specific keywords
  const queryLower = query.toLowerCase()
  const isVibeQuery = /cozy|romantic|intimate|casual|upscale|trendy|lively|quiet|date|atmosphere|vibe/i.test(query)
  const isSpecificDish = /omakase|ramen|sushi|burger|pizza|pasta|steak|taco|dim sum/i.test(query)
  const isSimilarityQuery = /like|similar to|reminds|comparable/i.test(query)

  let explanation = ''

  if (isSimilarityQuery) {
    explanation = `I found restaurants with similar vibes and cuisine styles based on reviews and dining experiences. `
    if (topRestaurants.length >= 2) {
      explanation += `Check out ${topRestaurants[0]} and ${topRestaurants[1]} — `
    } else if (topRestaurants.length === 1) {
      explanation += `${topRestaurants[0]} is a great match. `
    }
    if (cuisines.length <= 2) {
      explanation += `these ${cuisines.join(' and ')} spots share similar characteristics.`
    } else {
      explanation += `the selection includes various cuisines that match the style you're looking for.`
    }
  } else if (isVibeQuery) {
    explanation = `I selected these spots based on atmosphere and dining experience mentions in reviews. `
    if (topRestaurants.length >= 2) {
      explanation += `${topRestaurants[0]} and ${topRestaurants[1]} are standout choices. `
    } else if (topRestaurants.length === 1) {
      explanation += `${topRestaurants[0]} is a perfect fit. `
    }
    if (neighborhoods.length <= 3) {
      explanation += `Found great options in ${neighborhoods.slice(0, 3).join(', ')}.`
    } else {
      explanation += `They're spread across different neighborhoods to give you options.`
    }
  } else if (isSpecificDish) {
    // Extract the dish name from query
    const dishMatch = query.match(/\b(omakase|ramen|sushi|burger|pizza|pasta|steak|taco|dim sum)\b/i)
    const dish = dishMatch ? dishMatch[1] : 'this dish'

    explanation = `These restaurants are known for their ${dish} based on detailed review analysis. `
    if (topRestaurants.length >= 2) {
      explanation += `${topRestaurants[0]} and ${topRestaurants[1]} get especially high marks. `
    } else if (topRestaurants.length === 1) {
      explanation += `${topRestaurants[0]} is highly recommended. `
    }
    const avgRating = (topResults.slice(0, 5).reduce((sum, r) => sum + r.restaurant.yelp_rating, 0) / Math.min(5, topResults.length)).toFixed(1)
    explanation += `All are highly rated (avg ${avgRating}★) with specific mentions in customer reviews.`
  } else {
    // General semantic query
    explanation = `I found these restaurants by analyzing reviews and descriptions that match your search. `
    if (topRestaurants.length >= 2) {
      explanation += `Top picks: ${topRestaurants[0]} and ${topRestaurants[1]}. `
    } else if (topRestaurants.length === 1) {
      explanation += `${topRestaurants[0]} is the top match. `
    }
    if (cuisines.length === 1) {
      explanation += `All are ${cuisines[0]} restaurants.`
    } else if (cuisines.length <= 3) {
      explanation += `Includes ${cuisines.join(', ')} options.`
    } else {
      explanation += `Diverse cuisine options that fit your criteria.`
    }
  }

  return explanation
}

/**
 * Calculate keyword boost for ranking refinement
 * Searches for query terms in restaurant fields with weighted scoring
 */
function calculateKeywordBoost(query, restaurant) {
  // Extract query terms (filter out common stop words)
  const stopWords = new Set(['the', 'a', 'an', 'with', 'for', 'in', 'at', 'to', 'and', 'or', 'but'])
  const queryTerms = query.toLowerCase()
    .split(/\s+/)
    .filter(term => term.length > 2 && !stopWords.has(term))

  if (queryTerms.length === 0) {
    return 0
  }

  let boost = 0

  // Check each field for matches
  const name = (restaurant.name || '').toLowerCase()
  const summary = (restaurant.summary || '').toLowerCase()
  const reviews = (restaurant.yelp_review_highlights || '').toLowerCase()
  const collections = (restaurant.collections || []).map(c => c.toLowerCase())

  queryTerms.forEach(term => {
    // Name matches (5x weight - highest priority)
    if (name.includes(term)) {
      boost += 5
    }

    // Summary matches (3x weight - equal to reviews)
    const summaryMatches = (summary.match(new RegExp(term, 'g')) || []).length
    boost += summaryMatches * 3

    // Review highlights matches (3x weight - equal to summary)
    const reviewMatches = (reviews.match(new RegExp(term, 'g')) || []).length
    boost += reviewMatches * 3

    // Collections match (4x weight - important for vibe queries)
    if (collections.some(c => c.includes(term))) {
      boost += 4
    }
  })

  // Normalize to 0-1 range based on query length and field weights
  // Max possible: queryTerms.length * (5 + multiple matches in summary/reviews + 4)
  // Use a reasonable upper bound for normalization
  const maxPossibleScore = queryTerms.length * 20
  return Math.min(boost / maxPossibleScore, 1)
}

/**
 * Fallback cascade when no results found
 */
async function fallbackSearch(query, filters, embedding) {
  console.log('Initiating fallback cascade...')

  // Level 1: Remove semantic query, keep all filters
  if (Object.keys(filters).length > 0) {
    console.log('Fallback Level 1: Removing semantic requirement, keeping filters')
    const results = await queryPinecone(embedding, filters, 20)
    if (results.length > 0) {
      return {
        matches: results,
        fallbackLevel: 1,
        message: `No exact matches for "${query}", showing ${filters.cuisines?.[0] || 'filtered'} restaurants`
      }
    }
  }

  // Level 2: Relax price filter
  if (filters.price_levels && filters.price_levels.includes('$')) {
    console.log('Fallback Level 2: Relaxing price filter from $ to $$')
    const relaxedFilters = {
      ...filters,
      price_levels: ['$$']
    }
    const results = await queryPinecone(embedding, relaxedFilters, 20)
    if (results.length > 0) {
      return {
        matches: results,
        fallbackLevel: 2,
        message: `No $ options found, showing $$ ${filters.cuisines?.[0] || ''} restaurants`
      }
    }
  }

  // Level 3: Just cuisine filter
  if (filters.cuisines && filters.cuisines.length > 0) {
    console.log('Fallback Level 3: Just cuisine filter')
    const results = await queryPinecone(embedding, { cuisines: filters.cuisines }, 20)
    if (results.length > 0) {
      return {
        matches: results,
        fallbackLevel: 3,
        message: `Showing top ${filters.cuisines[0]} restaurants`
      }
    }
  }

  // Level 4: Top rated restaurants overall
  console.log('Fallback Level 4: Top rated restaurants overall')
  const topRated = restaurants
    .filter(r => r.yelp_rating >= 4.0)
    .sort((a, b) => b.yelp_rating - a.yelp_rating)
    .slice(0, 10)

  return {
    matches: topRated.map((r, idx) => ({
      id: r.slug,
      score: (10 - idx) / 10, // Synthetic score
      metadata: {
        name: r.name,
        cuisine: r.cuisine,
        price: r.price,
        neighborhood: r.neighborhood,
        rating: r.yelp_rating
      }
    })),
    fallbackLevel: 4,
    message: 'Showing top-rated restaurants in NYC'
  }
}

/**
 * Main RAG search handler
 */
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
    const { query, pre_filters = {}, top_k = 20 } = req.body

    // Validation
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query is required and must be a string' })
    }

    console.log('RAG Search Request:', { query, pre_filters, top_k })

    // Step 1: Generate query embedding
    console.log('Generating query embedding...')
    const queryEmbedding = await generateQueryEmbedding(query)

    // Step 2: Query Pinecone
    console.log('Querying Pinecone...')
    let pineconeMatches = await queryPinecone(queryEmbedding, pre_filters, 50)

    let fallbackInfo = null

    // Step 3: Fallback cascade if no results
    if (pineconeMatches.length === 0) {
      console.log('No results found, initiating fallback...')
      const fallbackResult = await fallbackSearch(query, pre_filters, queryEmbedding)
      pineconeMatches = fallbackResult.matches
      fallbackInfo = {
        level: fallbackResult.fallbackLevel,
        message: fallbackResult.message
      }
    }

    // Step 4: Load full restaurant data and apply local filters (cuisine, neighborhood)
    const matchedRestaurants = loadRestaurantData(pineconeMatches, pre_filters)

    // Step 5: Apply keyword boost to refine ranking
    const boostedResults = matchedRestaurants.map(match => {
      const baseScore = match.score
      const keywordBoost = calculateKeywordBoost(query, match.restaurant)

      // Combine: 70% semantic (Pinecone) + 30% keyword boost
      const finalScore = (baseScore * 0.7) + (keywordBoost * 0.3)

      return {
        ...match,
        baseScore: baseScore,
        keywordBoost: keywordBoost,
        score: finalScore
      }
    })

    // Step 6: Re-sort by boosted scores
    boostedResults.sort((a, b) => b.score - a.score)

    // Step 7: Generate explanations
    const results = boostedResults.slice(0, top_k).map(match => ({
      ...match.restaurant,
      score: match.score,
      explanation: generateExplanation(query, match.restaurant, match.score)
    }))

    // Step 8: Generate overall explanation for the recommendations
    const overallExplanation = generateOverallExplanation(query, boostedResults.slice(0, 8))

    console.log(`Returning ${results.length} results (after local filtering + keyword boost)`)

    // Return results
    return res.status(200).json({
      query,
      total_results: results.length,
      results,
      overall_explanation: overallExplanation,
      fallback: fallbackInfo,
      filters_applied: pre_filters
    })

  } catch (error) {
    console.error('RAG Search error:', error)

    // Handle specific errors
    if (error.message?.includes('PINECONE_API_KEY')) {
      return res.status(500).json({
        error: 'Pinecone not configured',
        details: 'PINECONE_API_KEY not set in environment variables'
      })
    }

    if (error.message?.includes('GOOGLE_API_KEY')) {
      return res.status(500).json({
        error: 'Google AI not configured',
        details: 'GOOGLE_API_KEY not set in environment variables'
      })
    }

    return res.status(500).json({
      error: 'RAG search failed',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    })
  }
}
