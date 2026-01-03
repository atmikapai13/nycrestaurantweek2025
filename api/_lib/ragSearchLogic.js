import { Pinecone } from '@pinecone-database/pinecone'
import { GoogleGenerativeAI } from '@google/generative-ai'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const INDEX_NAME = 'nyc-eats'

// Load restaurants data
let restaurantsCache = null
function loadRestaurants() {
  if (!restaurantsCache) {
    const restaurantsPath = path.join(__dirname, '../../src/data/FinalData.json')
    restaurantsCache = JSON.parse(fs.readFileSync(restaurantsPath, 'utf8'))
  }
  return restaurantsCache
}

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
  if (filters.priceLevels && filters.priceLevels.length > 0) {
    pineconeFilter.price = { $in: filters.priceLevels }
  }

  if (filters.min_rating) {
    pineconeFilter.rating = { $gte: filters.min_rating }
  }

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
  const matches = results.matches || []

  // Filter out weak semantic matches (< 0.2 similarity) to avoid bad recommendations
  const MIN_SIMILARITY_THRESHOLD = 0.2
  const filteredMatches = matches.filter(match => match.score >= MIN_SIMILARITY_THRESHOLD)

  console.log(`🎯 Pinecone: ${matches.length} raw results → ${filteredMatches.length} after threshold (≥${MIN_SIMILARITY_THRESHOLD})`)

  return filteredMatches
}

/**
 * Load full restaurant data for matched slugs and apply local filters
 */
function loadRestaurantData(pineconeMatches, filters = {}) {
  const restaurants = loadRestaurants()
  const restaurantMap = new Map(restaurants.map(r => [r.slug, r]))

  return pineconeMatches.map(match => {
    const restaurant = restaurantMap.get(match.id)
    if (!restaurant) {
      // Silently skip restaurants not in current dataset (e.g., other boroughs)
      return null
    }

    // Apply price filter (exact matching) - STRICT filtering for user expectations
    if (filters.priceLevels && filters.priceLevels.length > 0) {
      if (!restaurant.price) {
        return null // Skip restaurants without price data - don't show if user filtered by price
      }
      const matchesPrice = filters.priceLevels.includes(restaurant.price)
      if (!matchesPrice) {
        return null // Filter out this restaurant - price doesn't match exactly
      }
    }

    // Apply cuisine filter (partial matching)
    if (filters.cuisines && filters.cuisines.length > 0) {
      if (!restaurant.cuisine) {
        return null // Skip restaurants without cuisine data
      }
      const matchesCuisine = filters.cuisines.some(cuisine =>
        restaurant.cuisine.toLowerCase().includes(cuisine.toLowerCase())
      )
      if (!matchesCuisine) {
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
    explanation = `I found restaurants with similar vibes and cuisine styles based on Yelp and Reddit dining experiences. `
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
    explanation = `I selected these spots based on atmosphere and dining experience mentionned in Yelp and Reddit reviews. `
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
    const dishMatch = query.match(/\b(omakase|ramen|sushi|burger|pizza|pasta|steak|taco|dim sum|butter chicken)\b/i)
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
  const collections = (restaurant.collections || []).filter(c => c).map(c => c.toLowerCase())

  // Exact phrase matching bonus (boost for full query match, not just individual terms)
  const queryLower = query.toLowerCase()
  const EXACT_PHRASE_BONUS = 10

  // Exact phrase in name (highest priority)
  if (name.includes(queryLower)) {
    boost += EXACT_PHRASE_BONUS * 2 // 20 points for name match
  }

  // Exact phrase in summary
  if (summary.includes(queryLower)) {
    boost += EXACT_PHRASE_BONUS // 10 points
  }

  // Exact phrase in reviews/highlights
  if (reviews.includes(queryLower)) {
    boost += EXACT_PHRASE_BONUS // 10 points
  }

  // Exact phrase in collections
  if (collections.some(c => c.includes(queryLower))) {
    boost += EXACT_PHRASE_BONUS // 10 points
  }

  // Term-by-term keyword matching (existing logic)
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
  const maxPossibleScore = queryTerms.length * 20
  return Math.min(boost / maxPossibleScore, 1)
}

/**
 * Honest fallback - only used when no filters specified
 * If user specified explicit filters (price, cuisine, etc.), return empty rather than dishonest results
 */
async function fallbackSearch(query, filters, embedding) {
  const restaurants = loadRestaurants()

  console.log('No results found for query')

  // If user specified ANY explicit filter, respect it - return empty instead of lying
  if (filters.priceLevels || filters.cuisines || filters.minRating) {
    console.log('❌ User has explicit filters - returning empty (honest design)')
    return {
      matches: [],
      fallbackLevel: null,
      message: `No restaurants found matching "${query}" with your filters. Try adjusting your criteria.`
    }
  }

  // Only fallback if user had NO filters - show top-rated as suggestions
  console.log('Fallback: Showing top-rated suggestions (no filters specified)')
  const topRated = restaurants
    .filter(r => r.yelp_rating >= 4.0)
    .sort((a, b) => b.yelp_rating - a.yelp_rating)
    .slice(0, 10)

  return {
    matches: topRated.map((r, idx) => ({
      id: r.slug,
      score: (10 - idx) / 10,
      metadata: {
        name: r.name,
        cuisine: r.cuisine,
        price: r.price,
        neighborhood: r.neighborhood,
        rating: r.yelp_rating
      }
    })),
    fallbackLevel: 1,
    message: `No matches for "${query}" - here are some top-rated options to explore`
  }
}

/**
 * Perform RAG search using Pinecone vector embeddings
 * @param {string} query - Natural language query
 * @param {object} preFilters - Pre-filters to apply: { cuisines, priceLevels, minRating }
 * @param {number} topK - Number of results to return (default: 10)
 * @param {string[]|null} restaurantIds - Optional array of restaurant slugs to scope search
 * @returns {Promise<{query: string, total_results: number, results: object[], overall_explanation: string, fallback: object|null, filters_applied: object}>}
 * @throws {Error} if Pinecone or Google AI API is not configured
 */
export async function performRagSearch(query, preFilters = {}, topK = 10, restaurantIds = null) {
  if (!query || typeof query !== 'string') {
    throw new Error('Query is required and must be a string')
  }

  console.log('RAG Search Request:', { query, preFilters, topK, restaurant_ids_count: restaurantIds?.length || 'all' })

  // Step 1: Generate query embedding
  const queryEmbedding = await generateQueryEmbedding(query)

  // Step 2: Query Pinecone
  let pineconeMatches = await queryPinecone(queryEmbedding, preFilters, 50)

  let fallbackInfo = null

  // Step 3: Fallback cascade if no results
  if (pineconeMatches.length === 0) {
    console.log('No results found, initiating fallback...')
    const fallbackResult = await fallbackSearch(query, preFilters, queryEmbedding)
    pineconeMatches = fallbackResult.matches
    fallbackInfo = {
      level: fallbackResult.fallbackLevel,
      message: fallbackResult.message
    }
  }

  // Step 4: Load full restaurant data and apply local filters (cuisine, neighborhood)
  let matchedRestaurants = loadRestaurantData(pineconeMatches, preFilters)

  // Step 4.5: Filter by restaurant_ids if provided (contextual search)
  if (restaurantIds && restaurantIds.length > 0) {
    const idSet = new Set(restaurantIds)
    const beforeCount = matchedRestaurants.length
    matchedRestaurants = matchedRestaurants.filter(match =>
      idSet.has(match.restaurant.slug)
    )
    console.log(`🎯 Filtered to ${matchedRestaurants.length} restaurants from provided ${restaurantIds.length} IDs (before: ${beforeCount})`)
  }

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

  // Log top results with score breakdown for debugging
  console.log(`\n🎯 Top 10 Semantic Search Results:`)
  boostedResults.slice(0, 10).forEach((match, i) => {
    const semanticPct = (match.baseScore * 100).toFixed(0)
    const keywordPct = (match.keywordBoost * 100).toFixed(0)
    const finalPct = (match.score * 100).toFixed(0)
    console.log(`  ${i+1}. ${match.restaurant.name.padEnd(30)} | Final: ${finalPct}% (sem: ${semanticPct}% + kw: ${keywordPct}%)`)
  })
  console.log('')

  // Dynamic result count based on top score confidence
  let dynamicTopK = topK
  if (boostedResults.length > 0) {
    const topScore = boostedResults[0].score

    if (topScore < 0.4) {
      // Low confidence - return fewer results (7 max to avoid decision fatigue)
      dynamicTopK = Math.min(7, topK)
      console.log(`⚠️ Low confidence query (top score: ${topScore.toFixed(3)}) - reducing results to ${dynamicTopK}`)
    } else {
      // High confidence - return more results (12)
      dynamicTopK = 12
      console.log(`✅ High confidence query (top score: ${topScore.toFixed(3)}) - returning ${dynamicTopK} results`)
    }
  }

  // Step 7: Generate explanations
  const results = boostedResults.slice(0, dynamicTopK).map(match => ({
    ...match.restaurant,
    score: match.score,
    explanation: generateExplanation(query, match.restaurant, match.score)
  }))

  // Step 8: Generate overall explanation for the recommendations
  const overallExplanation = generateOverallExplanation(query, boostedResults.slice(0, 8))

  console.log(`Returning ${results.length} results (after local filtering + keyword boost)`)

  return {
    query,
    total_results: results.length,
    results,
    overall_explanation: overallExplanation,
    fallback: fallbackInfo,
    filters_applied: preFilters
  }
}
