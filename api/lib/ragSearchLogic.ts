/**
 * RAG Search Logic for Semantic Restaurant Search
 * Ported from DEPRECATED_LANGRAPH (api)/_lib/ragSearchLogic.js
 *
 * Uses 70% semantic (Pinecone) + 30% keyword hybrid scoring
 * Supports filterPool pre-filtering via restaurantIds parameter
 */

import { Pinecone } from "@pinecone-database/pinecone";
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Restaurant } from "../../src/types/restaurant";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constants
const INDEX_NAME = "nyc-eats";
const EMBEDDING_MODEL = "text-embedding-004";
const MIN_SIMILARITY_THRESHOLD = 0.2;
const HIGH_QUALITY_THRESHOLD = 0.30; // If 5th result is above this, return 10 results; otherwise 5
const STOP_WORDS = new Set([
  "the", "a", "an", "with", "for", "in", "at", "to", "and", "or", "but",
]);

// Types
interface PineconeMatch {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

interface MatchedRestaurant {
  restaurant: Restaurant;
  score: number;
  baseScore: number;
  keywordBoost: number;
}

export interface RagSearchResult {
  query: string;
  total_results: number;
  results: Array<Restaurant & { score: number; baseScore: number; keywordBoost: number }>;
  filterPoolApplied: boolean;
}

// Restaurant data cache
let restaurantsCache: Restaurant[] | null = null;

function loadRestaurants(): Restaurant[] {
  if (!restaurantsCache) {
    const restaurantsPath = path.join(__dirname, "../../src/data/FinalData.json");
    restaurantsCache = JSON.parse(fs.readFileSync(restaurantsPath, "utf8"));
    console.log(`📍 RAG: Loaded ${restaurantsCache!.length} restaurants`);
  }
  return restaurantsCache!;
}

/**
 * Generate embedding for search query using Google's text-embedding-004
 */
async function generateQueryEmbedding(query: string): Promise<number[]> {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY not configured");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });

  const result = await model.embedContent(query);
  return result.embedding.values;
}

/**
 * Query Pinecone for semantic matches
 */
async function queryPinecone(
  embedding: number[],
  topK: number = 50
): Promise<PineconeMatch[]> {
  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) {
    throw new Error("PINECONE_API_KEY not configured");
  }

  const pc = new Pinecone({ apiKey });
  const index = pc.index(INDEX_NAME);

  // Query Pinecone - get 3x more results to account for filtering
  const queryRequest = {
    vector: embedding,
    topK: topK * 3,
    includeMetadata: true,
  };

  const results = await index.query(queryRequest);
  const matches = results.matches || [];

  // Filter out weak semantic matches
  const filteredMatches = matches.filter(
    (match) => (match.score ?? 0) >= MIN_SIMILARITY_THRESHOLD
  );

  console.log(
    `🎯 Pinecone: ${matches.length} raw results → ${filteredMatches.length} after threshold (≥${MIN_SIMILARITY_THRESHOLD})`
  );

  return filteredMatches.map((m) => ({
    id: m.id,
    score: m.score ?? 0,
    metadata: m.metadata,
  }));
}

/**
 * Load full restaurant data for matched slugs
 */
function loadRestaurantData(pineconeMatches: PineconeMatch[]): MatchedRestaurant[] {
  const restaurants = loadRestaurants();
  const restaurantMap = new Map(restaurants.map((r) => [r.slug, r]));

  return pineconeMatches
    .map((match) => {
      const restaurant = restaurantMap.get(match.id);
      if (!restaurant) {
        // Skip restaurants not in current dataset
        return null;
      }

      return {
        restaurant,
        score: match.score,
        baseScore: match.score,
        keywordBoost: 0,
      };
    })
    .filter((r): r is MatchedRestaurant => r !== null);
}

/**
 * Calculate keyword boost for ranking refinement
 * Returns a score 0-1 based on keyword matches in restaurant fields
 */
function calculateKeywordBoost(query: string, restaurant: Restaurant): number {
  // Extract query terms (filter out stop words)
  const queryTerms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 2 && !STOP_WORDS.has(term));

  if (queryTerms.length === 0) {
    return 0;
  }

  let boost = 0;

  // Prepare fields for matching
  const name = (restaurant.name || "").toLowerCase();
  const summary = (restaurant.summary || "").toLowerCase();
  const reviews = (restaurant.yelp_review_highlights || "").toLowerCase();
  const collections = (restaurant.collections || [])
    .filter((c) => c)
    .map((c) => c.toLowerCase());

  // Exact phrase matching bonus
  const queryLower = query.toLowerCase();
  const EXACT_PHRASE_BONUS = 10;

  // Exact phrase in name (highest priority - 20 points)
  if (name.includes(queryLower)) {
    boost += EXACT_PHRASE_BONUS * 2;
  }

  // Exact phrase in summary (10 points)
  if (summary.includes(queryLower)) {
    boost += EXACT_PHRASE_BONUS;
  }

  // Exact phrase in reviews (10 points)
  if (reviews.includes(queryLower)) {
    boost += EXACT_PHRASE_BONUS;
  }

  // Exact phrase in collections (10 points)
  if (collections.some((c) => c.includes(queryLower))) {
    boost += EXACT_PHRASE_BONUS;
  }

  // Term-by-term keyword matching
  queryTerms.forEach((term) => {
    // Name matches (5x weight)
    if (name.includes(term)) {
      boost += 5;
    }

    // Summary matches (3x weight per occurrence)
    const summaryMatches = (summary.match(new RegExp(term, "g")) || []).length;
    boost += summaryMatches * 3;

    // Review highlights matches (3x weight per occurrence)
    const reviewMatches = (reviews.match(new RegExp(term, "g")) || []).length;
    boost += reviewMatches * 3;

    // Collections match (4x weight)
    if (collections.some((c) => c.includes(term))) {
      boost += 4;
    }
  });

  // Normalize to 0-1 range
  const maxPossibleScore = queryTerms.length * 20;
  return Math.min(boost / maxPossibleScore, 1);
}

/**
 * Perform RAG search using Pinecone vector embeddings
 *
 * @param query - Natural language search query
 * @param topK - Number of results to return (default: 10)
 * @param restaurantIds - Optional array of restaurant slugs to scope search (filterPool)
 * @returns Search results with restaurants ranked by 70% semantic + 30% keyword
 */
export async function performRagSearch(
  query: string,
  topK: number = 10,
  restaurantIds: string[] | null = null
): Promise<RagSearchResult> {
  if (!query || typeof query !== "string") {
    throw new Error("Query is required and must be a string");
  }

  console.log(
    `🔍 RAG Search: "${query}" (topK: ${topK}, filterPool: ${
      restaurantIds?.length || "all"
    })`
  );

  // Step 1: Generate query embedding
  const queryEmbedding = await generateQueryEmbedding(query);

  // Step 2: Query Pinecone (get more results to account for filtering)
  const pineconeMatches = await queryPinecone(queryEmbedding, Math.max(topK, 50));

  // Step 3: Load full restaurant data
  let matchedRestaurants = loadRestaurantData(pineconeMatches);

  // Step 4: Filter by restaurantIds (filterPool) if provided
  const filterPoolApplied = restaurantIds !== null && restaurantIds.length > 0;
  if (filterPoolApplied) {
    const idSet = new Set(restaurantIds);
    const beforeCount = matchedRestaurants.length;
    matchedRestaurants = matchedRestaurants.filter((match) =>
      idSet.has(match.restaurant.slug)
    );
    console.log(
      `🎯 Filtered to ${matchedRestaurants.length} restaurants from filterPool of ${restaurantIds!.length} (before: ${beforeCount})`
    );
  }

  // Step 5: Apply keyword boost and compute final scores
  const boostedResults = matchedRestaurants.map((match) => {
    const baseScore = match.score;
    const keywordBoost = calculateKeywordBoost(query, match.restaurant);

    // Hybrid scoring: 70% semantic + 30% keyword
    const finalScore = baseScore * 0.7 + keywordBoost * 0.3;

    return {
      ...match,
      baseScore,
      keywordBoost,
      score: finalScore,
    };
  });

  // Step 6: Sort by final score (descending)
  boostedResults.sort((a, b) => b.score - a.score);

  // Step 7: Adaptive result count based on quality
  // If 5th result is above HIGH_QUALITY_THRESHOLD, return up to 10; otherwise return 5
  const fifthResultScore = boostedResults[4]?.score ?? 0;
  const hasHighQualityResults = fifthResultScore >= HIGH_QUALITY_THRESHOLD;
  const adaptiveTopK = hasHighQualityResults ? Math.min(topK, 10) : Math.min(topK, 5);

  // Log top results for debugging
  console.log(`\n🎯 Top ${Math.min(10, boostedResults.length)} Semantic Search Results:`);
  boostedResults.slice(0, 10).forEach((match, i) => {
    const semanticPct = (match.baseScore * 100).toFixed(0);
    const keywordPct = (match.keywordBoost * 100).toFixed(0);
    const finalPct = (match.score * 100).toFixed(0);
    const marker = i < adaptiveTopK ? "→" : " ";
    console.log(
      `  ${marker} ${i + 1}. ${match.restaurant.name.padEnd(30)} | Final: ${finalPct}% (sem: ${semanticPct}% + kw: ${keywordPct}%)`
    );
  });
  console.log(`  📊 5th result score: ${(fifthResultScore * 100).toFixed(0)}% | Threshold: ${(HIGH_QUALITY_THRESHOLD * 100).toFixed(0)}% | Returning: ${adaptiveTopK} results`);
  console.log("");

  // Step 8: Return top results with restaurant data + scores
  const results = boostedResults.slice(0, adaptiveTopK).map((match) => ({
    ...match.restaurant,
    score: match.score,
    baseScore: match.baseScore,
    keywordBoost: match.keywordBoost,
  }));

  console.log(
    `✅ Returning ${results.length} results (filterPool: ${filterPoolApplied})`
  );

  return {
    query,
    total_results: results.length,
    results,
    filterPoolApplied,
  };
}
