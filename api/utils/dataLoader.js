import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let restaurantData = null;

/**
 * Normalize string for fuzzy matching
 * - Lowercase
 * - Remove articles (the, a, an)
 * - Remove "and" (often used for "&")
 * - Remove special characters (keep alphanumeric and spaces)
 * - Collapse multiple spaces
 * - Trim whitespace
 */
function normalizeForMatching(str) {
  return str
    .toLowerCase()
    .replace(/^(the|a|an)\s+/i, '')  // Remove leading articles
    .replace(/\s+and\s+/g, ' ')      // Remove "and" between words
    .replace(/[^a-z0-9\s]/g, '')     // Remove special chars
    .replace(/\s+/g, ' ')            // Collapse multiple spaces
    .trim();
}

/**
 * Calculate Levenshtein distance between two strings
 * (simple dynamic programming implementation)
 */
function levenshteinDistance(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));

  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[len1][len2];
}

/**
 * Load restaurant data (cached in memory during function lifecycle)
 */
export function loadRestaurantData() {
  if (!restaurantData) {
    try {
      // In Vercel, read from project root
      const dataPath = path.join(process.cwd(), 'src', 'data', 'FinalData.json');
      const rawData = fs.readFileSync(dataPath, 'utf-8');
      restaurantData = JSON.parse(rawData);
      console.log(`✅ Loaded ${restaurantData.length} restaurants`);
    } catch (error) {
      console.error('❌ Error loading restaurant data:', error);
      throw error;
    }
  }
  return restaurantData;
}

/**
 * Get restaurant by name or slug with fuzzy matching
 *
 * Matching strategy (in order):
 * 1. Exact slug match
 * 2. Normalized name match
 * 3. Partial name match (substring)
 * 4. Slug similarity match
 * 5. Levenshtein distance match (typos)
 *
 * @param {string} input - User input (name or slug)
 * @returns {Object|null} - Restaurant object or null if no match
 */
export function getRestaurantByNameOrSlug(input) {
  if (!input) return null;

  const data = loadRestaurantData();
  const normalizedInput = normalizeForMatching(input);
  const inputSlug = input.toLowerCase().replace(/\s+/g, '-');

  // Tier 1: Exact slug match (fast path)
  const exactMatch = data.find(r => r.slug === inputSlug || r.slug === input);
  if (exactMatch) {
    console.log(`✅ Exact slug match: "${input}" → "${exactMatch.name}"`);
    return exactMatch;
  }

  // Tier 2: Normalized name match
  const normalizedMatch = data.find(r =>
    normalizeForMatching(r.name) === normalizedInput
  );
  if (normalizedMatch) {
    console.log(`✅ Normalized name match: "${input}" → "${normalizedMatch.name}"`);
    return normalizedMatch;
  }

  // Tier 3: Partial name match
  const partialMatch = data.find(r => {
    const normalizedName = normalizeForMatching(r.name);
    return normalizedName.includes(normalizedInput) ||
           normalizedInput.includes(normalizedName);
  });
  if (partialMatch) {
    console.log(`✅ Partial name match: "${input}" → "${partialMatch.name}"`);
    return partialMatch;
  }

  // Tier 4: Slug similarity match
  const slugMatch = data.find(r =>
    r.slug.includes(normalizedInput.replace(/\s+/g, '-'))
  );
  if (slugMatch) {
    console.log(`✅ Slug similarity match: "${input}" → "${slugMatch.name}"`);
    return slugMatch;
  }

  // Tier 5: Levenshtein distance match (typos)
  const threshold = normalizedInput.length < 8 ? 2 : 3;
  const typoMatch = data.find(r => {
    const normalizedName = normalizeForMatching(r.name);
    return levenshteinDistance(normalizedInput, normalizedName) <= threshold;
  });
  if (typoMatch) {
    console.log(`✅ Typo match (distance ≤${threshold}): "${input}" → "${typoMatch.name}"`);
    return typoMatch;
  }

  // No match found
  console.log(`❌ No match found for: "${input}"`);
  return null;
}

/**
 * Get restaurant by slug (deprecated - use getRestaurantByNameOrSlug instead)
 * @deprecated Use getRestaurantByNameOrSlug() instead
 * Kept for backward compatibility
 */
export function getRestaurantBySlug(slug) {
  return getRestaurantByNameOrSlug(slug);
}

/**
 * Filter restaurants by criteria
 */
export function filterRestaurants({
  cuisines = [],
  priceLevels = [],
  neighborhoods = [],
  minRating = 0,
  awards = []
}) {
  const allRestaurants = loadRestaurantData();
  
  let filtered = allRestaurants;
  
  if (cuisines.length > 0) {
    filtered = filtered.filter(r => 
      cuisines.some(c => 
        r.cuisine?.toLowerCase().includes(c.toLowerCase())
      )
    );
  }
  
  if (priceLevels.length > 0) {
    filtered = filtered.filter(r => priceLevels.includes(r.price));
  }
  
  if (neighborhoods.length > 0) {
    filtered = filtered.filter(r =>
      neighborhoods.some(n => 
        r.neighborhood?.toLowerCase().includes(n.toLowerCase()) ||
        r.borough?.toLowerCase().includes(n.toLowerCase())
      )
    );
  }
  
  if (minRating > 0) {
    filtered = filtered.filter(r => (r.yelp_rating || 0) >= minRating);
  }
  
  if (awards.length > 0) {
    filtered = filtered.filter(r => {
      return awards.some(award => {
        if (award === 'michelin' || award === 'michelin_star') {
          return r.michelin_award && r.michelin_award !== '';
        }
        if (award === 'nyt' || award === 'nyt_top_100') {
          return r.nyttop100_rank && r.nyttop100_rank !== '';
        }
        return false;
      });
    });
  }
  
  return filtered;
}