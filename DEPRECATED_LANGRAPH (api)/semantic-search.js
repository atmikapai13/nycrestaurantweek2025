import restaurants from '../src/data/FinalData.json' assert { type: 'json' }

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
    const { query, keywords, pre_filters, restaurant_ids = null } = req.body

    // Validation
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query is required and must be a string' })
    }

    // Keywords are now optional - log warning if missing/empty
    const hasKeywords = keywords && Array.isArray(keywords) && keywords.length > 0
    if (!hasKeywords) {
      console.warn('⚠️  No keywords provided by Gemini - falling back to exact query match')
    }

    console.log('Semantic search for:', query)
    console.log('Keywords:', keywords || 'none (using fallback)')
    console.log('Pre-filters:', pre_filters)
    console.log('Restaurant IDs filter:', restaurant_ids?.length || 'all')

    // Step 1: Pre-filter using traditional filters
    let candidates = restaurants
    if (pre_filters) {
      candidates = applyPreFilters(candidates, pre_filters)
      console.log(`Pre-filtered to ${candidates.length} restaurants`)
    }

    // Step 1.5: Filter by restaurant_ids if provided (contextual search)
    if (restaurant_ids && restaurant_ids.length > 0) {
      const idSet = new Set(restaurant_ids)
      const beforeCount = candidates.length
      candidates = candidates.filter(r => idSet.has(r.slug))
      console.log(`🎯 Filtered to ${candidates.length} restaurants from provided ${restaurant_ids.length} IDs (before: ${beforeCount})`)
    }

    // Step 2: Score by keyword matches with field weighting OR fallback to exact phrase match
    const scored = candidates.map(r => {
      let score = 0

      if (hasKeywords) {
        // Normal keyword-based search with field weighting
        keywords.forEach(keyword => {
          const kw = keyword.toLowerCase()
          const escapedKeyword = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const regex = new RegExp(escapedKeyword, 'gi')

          // Weight matches by field importance
          const nameMatches = ((r.name || '').match(regex) || []).length
          const summaryMatches = ((r.summary || '').match(regex) || []).length
          const reviewMatches = ((r.yelp_review_highlights || '').match(regex) || []).length
          const redditMatches = ((r.reddit || '').match(regex) || []).length
          const descriptionMatches = ((r.description || '').match(regex) || []).length

          score += nameMatches * 5         // Name matches are most important
          score += summaryMatches * 3      // Summary is important
          score += reviewMatches * 2       // Review highlights are important
          score += descriptionMatches * 2  // Description is important
          score += redditMatches * 1       // Reddit is least important
        })
      } else {
        // Fallback: exact phrase match with equal weighting
        const queryLower = query.toLowerCase()
        const escapedQuery = queryLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const regex = new RegExp(escapedQuery, 'gi')

        // Search in specific fields with equal weighting
        const reviewMatches = ((r.yelp_review_highlights || '').match(regex) || []).length
        const redditMatches = ((r.reddit || '').match(regex) || []).length
        const summaryMatches = ((r.summary || '').match(regex) || []).length

        // Handle collections array (join to string first)
        const collectionsText = Array.isArray(r.collections) ? r.collections.join(' ') : (r.collections || '')
        const collectionsMatches = (collectionsText.match(regex) || []).length

        // Equal weighting for all fields in fallback mode
        score += reviewMatches * 1
        score += redditMatches * 1
        score += summaryMatches * 1
        score += collectionsMatches * 1
      }

      // Bonus for exact query match anywhere (applies to both modes)
      const allText = [
        r.name || '',
        r.summary || '',
        r.yelp_review_highlights || '',
        r.description || '',
        r.reddit || ''
      ].join(' ').toLowerCase()

      if (allText.includes(query.toLowerCase())) {
        score += 15 // Significant bonus for exact phrase match
      }

      return {
        slug: r.slug,
        name: r.name,
        cuisine: r.cuisine,
        price: r.price || r.price_range,
        neighborhood: r.neighborhood,
        rating: r.yelp_rating,
        score
      }
    })

    // Step 3: Return ranked results (only those with matches)
    const results = scored
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)

    console.log(`Returning ${results.length} results (top score: ${results[0]?.score || 0})`)

    return res.status(200).json({ results })

  } catch (error) {
    console.error('Semantic search error:', error)

    return res.status(500).json({
      error: 'Failed to process semantic search',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    })
  }
}

function applyPreFilters(restaurantList, filters) {
  return restaurantList.filter(r => {
    // Cuisine filter
    if (filters.cuisines?.length) {
      const matchesCuisine = filters.cuisines.some(c =>
        r.cuisine && r.cuisine.toLowerCase().includes(c.toLowerCase())
      )
      if (!matchesCuisine) return false
    }

    // Price filter
    if (filters.price_levels?.length) {
      const restaurantPrice = r.price || r.price_range
      if (!filters.price_levels.includes(restaurantPrice)) {
        return false
      }
    }

    // Neighborhood filter
    if (filters.neighborhoods?.length) {
      const matchesNeighborhood = filters.neighborhoods.some(n =>
        r.neighborhood && r.neighborhood.toLowerCase().includes(n.toLowerCase())
      )
      if (!matchesNeighborhood) return false
    }

    // Rating filter
    if (filters.min_rating && r.yelp_rating < filters.min_rating) {
      return false
    }

    return true
  })
}