import { Hono } from "hono";
import { cors } from "hono/cors";
import { handle } from "hono/vercel";
import {
  streamText,
  stepCountIs,
  convertToModelMessages,
  tool as createTool,
  type ToolSet,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { experimental_createMCPClient as createMCPClient } from "@ai-sdk/mcp";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Restaurant } from "../src/types/restaurant.js";
import { GeometryCache } from "./utils/geometryOptimizer.js";
import { point, booleanPointInPolygon } from "@turf/turf";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import { wrapToolsWithGeometryOptimization } from "./utils/toolWrapper.js";
import { env, getGoogleApiKey } from "./env.js";
import { safeParseChatRequest } from "./schemas/chat.js";
import { performRagSearch } from "./lib/ragSearchLogic.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load restaurant data for local search
const restaurantsPath = path.join(__dirname, "../src/data/FinalData.json");
let allRestaurants: Restaurant[] = [];
try {
  const restaurantsData = fs.readFileSync(restaurantsPath, "utf8");
  allRestaurants = JSON.parse(restaurantsData);
  console.log(
    `📍 Loaded ${allRestaurants.length} restaurants from FinalData.json`
  );
} catch (error) {
  console.error("❌ Failed to load restaurant data:", error);
}

// ============ FUZZY MATCHING HELPERS ============

/**
 * Normalize string for fuzzy matching
 */
function normalizeForMatching(str: string): string {
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
 */
function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix: number[][] = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));

  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[len1][len2];
}

/**
 * Fuzzy match a restaurant by name or slug
 * Returns the best match from the search pool
 */
function fuzzyMatchRestaurant(input: string, searchPool: Restaurant[]): Restaurant | null {
  if (!input) return null;

  const normalizedInput = normalizeForMatching(input);
  const inputSlug = input.toLowerCase().replace(/\s+/g, '-');

  // Tier 1: Exact slug match
  const exactMatch = searchPool.find(r => r.slug === inputSlug || r.slug === input.toLowerCase());
  if (exactMatch) {
    console.log(`✅ Exact slug match: "${input}" → "${exactMatch.name}"`);
    return exactMatch;
  }

  // Tier 2: Normalized name match
  const normalizedMatch = searchPool.find(r =>
    normalizeForMatching(r.name) === normalizedInput
  );
  if (normalizedMatch) {
    console.log(`✅ Normalized name match: "${input}" → "${normalizedMatch.name}"`);
    return normalizedMatch;
  }

  // Tier 3: Partial name match
  const partialMatch = searchPool.find(r => {
    const normalizedName = normalizeForMatching(r.name);
    return normalizedName.includes(normalizedInput) ||
           normalizedInput.includes(normalizedName);
  });
  if (partialMatch) {
    console.log(`✅ Partial name match: "${input}" → "${partialMatch.name}"`);
    return partialMatch;
  }

  // Tier 4: Slug similarity match
  const slugMatch = searchPool.find(r =>
    r.slug.includes(normalizedInput.replace(/\s+/g, '-'))
  );
  if (slugMatch) {
    console.log(`✅ Slug similarity match: "${input}" → "${slugMatch.name}"`);
    return slugMatch;
  }

  // Tier 5: Levenshtein distance match (typos)
  const threshold = normalizedInput.length < 8 ? 2 : 3;
  const typoMatch = searchPool.find(r => {
    const normalizedName = normalizeForMatching(r.name);
    return levenshteinDistance(normalizedInput, normalizedName) <= threshold;
  });
  if (typoMatch) {
    console.log(`✅ Typo match (distance ≤${threshold}): "${input}" → "${typoMatch.name}"`);
    return typoMatch;
  }

  console.log(`❌ No fuzzy match found for: "${input}"`);
  return null;
}

/**
 * Detect if query mentions Restaurant Week keywords
 * Used to auto-filter to RW participants even if filter bar isn't active
 */
function detectRestaurantWeekIntent(query: string): boolean {
  const lowerQuery = query.toLowerCase();
  const keywords = [
    "restaurant week",
    "restaurantweek",
    "prix fixe",
    "prixfixe",
    "price fix",
    "$30 lunch",
    "$45 dinner",
    "$60 dinner",
    "rw 2026",
    "rw2026",
  ];
  return keywords.some(kw => lowerQuery.includes(kw));
}

const app = new Hono();

// Enable CORS
app.use("/*", cors());

// Initialize Google Gemini with validated API key
const google = createGoogleGenerativeAI({
  apiKey: getGoogleApiKey(),
});

/**
 * POST /chat
 *
 * Streaming chat endpoint using AI SDK + Google Gemini + MCP
 * Returns AI SDK stream format compatible with useChat hook
 */
// Handler for chat endpoint
const chatHandler = async (c: any) => {
  // Log the incoming path for debugging
  console.log("📥 Request path:", c.req.path);
  console.log("📥 Request URL:", c.req.url);
  // Validate request body with Zod
  const body = await c.req.json();
  const parseResult = safeParseChatRequest(body);

  if (!parseResult.success) {
    const errors = parseResult.error.format();
    console.error("❌ Invalid chat request:", JSON.stringify(errors, null, 2));

    // Log the actual messages being sent for debugging
    if (body.messages) {
      console.error(
        "📨 Received messages:",
        JSON.stringify(body.messages, null, 2)
      );
    }

    return c.json(
      {
        error: "Invalid request body",
        details: errors,
        message: "Please check that messages array is properly formatted",
      },
      400
    );
  }

  const { messages: rawMessages, context } = parseResult.data;
  console.log(`📨 Received ${rawMessages.length} messages from client`);

  // ============ PRE-PROCESS: Direct Restaurant Name Lookup ============
  // Check if the user is asking for a specific restaurant by name
  // This bypasses Gemini entirely for deterministic, reliable lookups
  const lastUserMessage = rawMessages.filter(m => m.role === "user").pop();
  const userQuery = lastUserMessage?.content?.toString().trim() || "";

  // Pattern: "show me X", "find me X", "where is X", etc., or just "X" (single word/phrase)
  const restaurantNamePatterns = [
    /^(?:show\s*(?:me)?|find\s*(?:me)?|where\s*(?:is|can\s+i\s+find)?|tell\s+me\s+about|what\s+(?:is|about)|info\s+(?:on|about)|details\s+(?:on|for|about)|look\s*(?:up)?|search\s*(?:for)?|get\s*(?:me)?)\s+(.+?)[\?\.]?$/i,
    /^(.+?)[\?\.]?$/i, // Fallback: entire query as potential name (for short queries like "hangawi")
  ];

  let extractedName: string | null = null;
  for (const pattern of restaurantNamePatterns) {
    const match = userQuery.match(pattern);
    if (match && match[1]) {
      extractedName = match[1].trim();
      break;
    }
  }

  // Try to fuzzy match the extracted name against our restaurant data
  if (extractedName && extractedName.length >= 3) {
    const matchedRestaurant = fuzzyMatchRestaurant(extractedName, allRestaurants);

    // Only short-circuit if we have a confident match (not a cuisine type or generic term)
    const genericTerms = new Set([
      "italian", "japanese", "chinese", "korean", "mexican", "french", "indian", "thai",
      "mediterranean", "american", "asian", "european", "latin", "spanish", "greek",
      "vegetarian", "vegan", "seafood", "steakhouse", "pizza", "sushi", "ramen", "tacos",
      "restaurants", "spots", "places", "food", "deals", "award", "michelin", "stars",
      "cheap", "expensive", "fancy", "casual", "romantic", "cozy", "trendy", "best",
      "near", "around", "close", "walking", "transit", "between", "midtown", "downtown",
      "uptown", "village", "soho", "tribeca", "chelsea", "harlem", "uws", "ues", "les",
    ]);

    const isGenericTerm = genericTerms.has(extractedName.toLowerCase()) ||
                          extractedName.split(/\s+/).some(word => genericTerms.has(word.toLowerCase()));

    if (matchedRestaurant && !isGenericTerm) {
      console.log(`🎯 PRE-PROCESS: Direct restaurant match! "${extractedName}" → "${matchedRestaurant.name}"`);

      // Build restaurant card data
      const restaurant: Restaurant = {
        name: matchedRestaurant.name,
        slug: matchedRestaurant.slug,
        cuisine: matchedRestaurant.cuisine || "Unknown",
        price: matchedRestaurant.price || "$$",
        neighborhood: matchedRestaurant.neighborhood || "",
        borough: matchedRestaurant.borough || "",
        latitude: matchedRestaurant.latitude,
        longitude: matchedRestaurant.longitude,
        yelp_rating: matchedRestaurant.yelp_rating || 0,
        yelp_review_count: matchedRestaurant.yelp_review_count || 0,
        michelin_award: matchedRestaurant.michelin_award || "",
        nyttop100_rank: matchedRestaurant.nyttop100_rank || "",
        summary: matchedRestaurant.summary || "",
        summary2: matchedRestaurant.summary2 || "",
        yelp_review_highlights: matchedRestaurant.yelp_review_highlights || "",
        opentable_id: matchedRestaurant.opentable_id || "",
        telephone: matchedRestaurant.telephone || "",
        address: matchedRestaurant.address || "",
        collections: matchedRestaurant.collections || [],
        meal_types: matchedRestaurant.meal_types || [],
        participation_weeks: matchedRestaurant.participation_weeks || [],
        participation_weeks2: matchedRestaurant.participation_weeks2 || "",
        website: matchedRestaurant.website || "",
        facebook_url: matchedRestaurant.facebook_url || "",
        instagram_url: matchedRestaurant.instagram_url || "",
        yelp_url: matchedRestaurant.yelp_url || "",
        menu_url: matchedRestaurant.menu_url || "",
      };

      // Generate a charming response
      const charmingIntros = [
        `Ah, ${matchedRestaurant.name}! Excellent choice.`,
        `${matchedRestaurant.name} - a fine establishment!`,
        `You've got great taste! Here's ${matchedRestaurant.name}.`,
        `${matchedRestaurant.name}, coming right up!`,
      ];
      const intro = charmingIntros[Math.floor(Math.random() * charmingIntros.length)];

      // Return a streaming response that mimics AI SDK format
      // This includes both the text response and tool result
      const responseData = {
        restaurants: [restaurant],
        count: 1,
        query: extractedName,
      };

      // Create AI SDK compatible streaming response
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          // Text part
          controller.enqueue(encoder.encode(`0:${JSON.stringify(intro)}\n`));
          // Tool call part (displayRestaurants)
          const toolCallId = `call_${Date.now()}`;
          controller.enqueue(encoder.encode(`9:${JSON.stringify({
            toolCallId,
            toolName: "displayRestaurants",
            args: { restaurant_names: [matchedRestaurant.slug] },
          })}\n`));
          // Tool result part
          controller.enqueue(encoder.encode(`a:${JSON.stringify({
            toolCallId,
            result: responseData,
          })}\n`));
          // Finish
          controller.enqueue(encoder.encode(`d:${JSON.stringify({ finishReason: "stop", usage: { promptTokens: 0, completionTokens: 0 } })}\n`));
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Vercel-AI-Data-Stream": "v1",
        },
      });
    }
  }
  // ============ END PRE-PROCESS ============

  // Extract filterPool from context (restaurants matching current filter bar selections)
  const filterPool: string[] = (context as any)?.filterPool || [];
  const hasFilterPool = filterPool.length > 0 && filterPool.length < allRestaurants.length;
  if (hasFilterPool) {
    console.log(`🎯 Filter pool active: ${filterPool.length} restaurants (of ${allRestaurants.length} total)`);
  } else {
    console.log(`🎯 No filter pool - searching all ${allRestaurants.length} restaurants`);
  }

  // Normalize messages: ensure parts is always an array (AI SDK requirement)
  // Type assertion is safe here because we've validated the structure with Zod
  const messages = rawMessages.map((msg) => ({
    ...msg,
    parts: msg.parts ?? [], // Convert undefined to empty array
  })) as UIMessage[];

  const analysisId = env.MCP_ANALYSIS_ID;
  let mcpTools: ToolSet = {};
  let datasetContext = "";
  let sqlTables = "";
  let docCollections = "";
  let spatialReference = "";

  // Initialize geometry cache for this request
  const geometryCache = new GeometryCache();

  // 1. Connect and Fetch Tools/Resources with error handling
  let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | null = null;
  let optimizedTools: ToolSet = {};

  // Validate MCP config before attempting connection
  if (!env.MCP_SERVER_URL || !env.MCP_API_KEY) {
    console.warn("⚠️ MCP not configured (missing MCP_SERVER_URL or MCP_API_KEY), continuing with local tools only");
  } else {
    try {
      // Create abort controller for MCP connection timeout
      const mcpController = new AbortController();
      const mcpTimeoutId = setTimeout(() => mcpController.abort(), 10000); // 10s timeout

      const transport = new StreamableHTTPClientTransport(
        new URL(env.MCP_SERVER_URL),
        {
          requestInit: {
            headers: { Authorization: `Bearer ${env.MCP_API_KEY}` },
            signal: mcpController.signal,
          },
        }
      );

      mcpClient = await createMCPClient({ transport });
      clearTimeout(mcpTimeoutId);
      console.log("✅ Connected to MCP");

      // Fetch Spatial Reference and Examples
      try {
        console.log("📂 Fetching spatial reference and examples...");
        const [spatialFuncs, spatialExamples] = await Promise.all([
          mcpClient.readResource({ uri: "spatial-functions://reference" }),
          mcpClient.readResource({ uri: "spatial-query-examples://duckdb" }),
        ]);

        if (spatialFuncs?.contents?.[0]?.text) {
          spatialReference += `\n### DUCKDB SPATIAL FUNCTIONS REFERENCE:\n${spatialFuncs.contents[0].text}\n`;
        }
        if (spatialExamples?.contents?.[0]?.text) {
          spatialReference += `\n### SPATIAL QUERY EXAMPLES:\n${spatialExamples.contents[0].text}\n`;
        }
      } catch (err) {
        console.error("⚠️ Failed to fetch spatial resources:", err);
      }

      mcpTools = await mcpClient.tools();
      console.log("📦 MCP Tools:", Object.keys(mcpTools).join(", "));

      // Wrap MCP tools with geometry optimization
      optimizedTools = wrapToolsWithGeometryOptimization(
        mcpTools,
        geometryCache
      );
    } catch (mcpError) {
      console.warn("⚠️ MCP connection failed, continuing with local tools only:", mcpError);
      mcpClient = null;
      mcpTools = {};
      optimizedTools = {};
    }
  }

  // Create a custom tool for displaying restaurant cards
  const displayRestaurantsTool = createTool({
    description:
      "Display restaurant cards. REQUIRED: You MUST pass restaurant_names array. Example: displayRestaurants({ restaurant_names: ['Hangawi'] }) or displayRestaurants({ restaurant_names: ['carbone', 'lilia', 'don-angie'] })",
    parameters: z.object({
      restaurant_names: z
        .array(z.string())
        .optional()
        .default([])
        .describe("REQUIRED array of restaurant names or slugs. Example: ['Hangawi', 'Carbone'] or ['hangawi', 'carbone']"),
      query: z
        .string()
        .optional()
        .describe("Optional: The original search query"),
    }),
    execute: async (params: { restaurant_names?: string[]; query?: string }) => {
      const { restaurant_names = [], query } = params || {};
      try {
        if (!restaurant_names || !Array.isArray(restaurant_names) || restaurant_names.length === 0) {
          console.log(`⚠️ displayRestaurants: No restaurant_names provided - returning clarification request`);
          // Return a "success" with a message for the model to relay to user
          // This prevents the model from looping and calling the tool again
          return {
            restaurants: [],
            count: 0,
            query: query || "",
            needsClarification: true,
            message: "I'd love to help! Could you tell me what kind of restaurant you're looking for? For example: a specific restaurant name (like 'Carbone'), a cuisine type (like 'Italian'), or a vibe (like 'cozy date spot')?"
          };
        }

        console.log(
          `🍽️ displayRestaurants resolving cards for: ${JSON.stringify(
            restaurant_names
          )}`
        );

        // Start with filterPool-restricted set if active, otherwise all restaurants
        const searchPool = hasFilterPool
          ? allRestaurants.filter((r) => filterPool.includes(r.slug))
          : allRestaurants;

        // Match by slug, exact name, OR fuzzy match - PRESERVE input order (important for semantic search ranking)
        const foundRestaurants: Restaurant[] = [];
        for (const name of restaurant_names) {
          // First try exact match (slug or name)
          let match = searchPool.find(
            (r) => r.slug === name || r.name.toLowerCase() === name.toLowerCase()
          );
          // If no exact match, try fuzzy matching (handles typos, partial names)
          if (!match) {
            match = fuzzyMatchRestaurant(name, searchPool);
          }
          if (match && !foundRestaurants.some(r => r.slug === match!.slug)) {
            foundRestaurants.push(match);
          }
        }

        console.log(`✅ Resolved ${foundRestaurants.length} restaurant cards (preserving input order)`);

        // Return results with clean data structure (all fields needed for RestaurantCard)
        // Limit to 5 cards - order preserved from input (semantic relevance)
        const restaurants: Restaurant[] = foundRestaurants
          .slice(0, 5)
          .map((r) => ({
            name: r.name,
            slug: r.slug,
            cuisine: r.cuisine || "Unknown",
            price: r.price || "$$",
            neighborhood: r.neighborhood || "",
            borough: r.borough || "",
            latitude: r.latitude,
            longitude: r.longitude,
            yelp_rating: r.yelp_rating || 0,
            yelp_review_count: r.yelp_review_count || 0,
            michelin_award: r.michelin_award || "",
            nyttop100_rank: r.nyttop100_rank || "",
            summary: r.summary || "",
            summary2: r.summary2 || "", // For "About" accordion
            yelp_review_highlights: r.yelp_review_highlights || "",
            opentable_id: r.opentable_id || "",
            telephone: r.telephone || "",
            address: r.address || "",
            collections: r.collections || [],
            // Restaurant Week accordion fields
            meal_types: r.meal_types || [],
            participation_weeks: r.participation_weeks || [],
            participation_weeks2: r.participation_weeks2 || "",
            // Socials accordion fields
            website: r.website || "",
            facebook_url: r.facebook_url || "",
            instagram_url: r.instagram_url || "",
            yelp_url: r.yelp_url || "",
            menu_url: r.menu_url || "",
          }));

        return {
          restaurants,
          count: restaurants.length,
          query: query || "",
          error: undefined as string | undefined,
        };
      } catch (error) {
        console.error("❌ Error in displayRestaurantsTool:", error);
        return {
          restaurants: [] as Restaurant[],
          count: 0,
          query: query || "",
          error: String(error) as string | undefined,
        };
      }
    },
  });

  // Create a dedicated tool for looking up a specific restaurant by name
  // Structure matches displayRestaurants for consistent frontend rendering
  const lookupRestaurantTool = createTool({
    description:
      "REQUIRED: Use this tool when user mentions ANY specific restaurant name. Trigger phrases: 'show me [name]', 'where is [name]', 'find [name]', 'tell me about [name]'. Examples: 'show me Hangawi' -> use this tool with restaurant_name='Hangawi'. 'where is Carbone?' -> use this tool with restaurant_name='Carbone'. Supports fuzzy matching for typos.",
    parameters: z.object({
      restaurant_name: z
        .string()
        .describe("The restaurant name extracted from the user's query. Examples: 'Hangawi', 'Carbone', 'Le Bernardin', 'Gramercy Tavern'"),
    }),
    execute: async (params: { restaurant_name?: string } | undefined) => {
      const { restaurant_name = "" } = params || {};
      try {
        if (!restaurant_name || typeof restaurant_name !== "string" || restaurant_name.trim() === "") {
          console.log(`⚠️ lookup_restaurant: No restaurant_name provided`);
          return {
            restaurants: [] as Restaurant[],
            count: 0,
            restaurant_name: restaurant_name || "",
            error: "Missing restaurant_name"
          };
        }

        console.log(`🔍 lookup_restaurant: Looking up "${restaurant_name}"`);
        const match = fuzzyMatchRestaurant(restaurant_name, allRestaurants);

        if (!match) {
          console.log(`❌ No match found for "${restaurant_name}"`);
          return {
            restaurants: [] as Restaurant[],
            count: 0,
            restaurant_name,
            error: `No restaurant found matching "${restaurant_name}"`,
          };
        }

        console.log(`✅ Found restaurant: ${match.name}`);

        // Return the restaurant with all fields needed for RestaurantCard
        const restaurant: Restaurant = {
          name: match.name,
          slug: match.slug,
          cuisine: match.cuisine || "Unknown",
          price: match.price || "$$",
          neighborhood: match.neighborhood || "",
          borough: match.borough || "",
          latitude: match.latitude,
          longitude: match.longitude,
          yelp_rating: match.yelp_rating || 0,
          yelp_review_count: match.yelp_review_count || 0,
          michelin_award: match.michelin_award || "",
          nyttop100_rank: match.nyttop100_rank || "",
          summary: match.summary || "",
          summary2: match.summary2 || "",
          yelp_review_highlights: match.yelp_review_highlights || "",
          opentable_id: match.opentable_id || "",
          telephone: match.telephone || "",
          address: match.address || "",
          collections: match.collections || [],
          meal_types: match.meal_types || [],
          participation_weeks: match.participation_weeks || [],
          participation_weeks2: match.participation_weeks2 || "",
          website: match.website || "",
          facebook_url: match.facebook_url || "",
          instagram_url: match.instagram_url || "",
          yelp_url: match.yelp_url || "",
          menu_url: match.menu_url || "",
        };

        return {
          restaurants: [restaurant],
          count: 1,
          restaurant_name,
          error: undefined as string | undefined,
        };
      } catch (error) {
        console.error("❌ Error in lookupRestaurantTool:", error);
        return {
          restaurants: [] as Restaurant[],
          count: 0,
          restaurant_name: restaurant_name || "",
          error: String(error),
        };
      }
    },
  });

  // Create semantic search tool using local RAG (replaces MCP's search_documents)
  // Returns data in same format as get_isoline for consistent multi-tool orchestration
  const semanticSearchRestaurantsTool = createTool({
    description: `Search restaurants by vibe, ambiance, dietary preferences, or descriptive queries using semantic similarity.
Use for: "cozy date spot", "best omakase", "vegetarian friendly", "vegan options", "gluten-free", "outdoor seating", "trendy rooftop".
Returns restaurantSlugs array - IMMEDIATELY call displayRestaurants({ restaurant_names: restaurantSlugs }) after this.
Automatically respects active filter bar selections.
IMPORTANT: If user mentions "restaurant week", "prix fixe", or "$30/$45/$60 deals", set restaurantWeekIntent=true.
IMPORTANT: If you just called get_isoline, pass its restaurantSlugs to scopeToSlugs to search ONLY within the isochrone area!`,
    parameters: z.object({
      query: z
        .string()
        .describe("Natural language search query (e.g., 'vegetarian friendly', 'vegan options', 'cozy romantic spot')"),
      topK: z
        .number()
        .min(1)
        .max(20)
        .optional()
        .default(10)
        .describe("Number of results to return (default: 10, max: 20)"),
      restaurantWeekIntent: z
        .boolean()
        .optional()
        .default(false)
        .describe("Set to true if user mentions 'restaurant week', 'prix fixe', '$30 lunch', '$45 dinner', or '$60 dinner'. Auto-filters to RW 2026 participants."),
      scopeToSlugs: z
        .array(z.string())
        .optional()
        .describe("IMPORTANT: If you called get_isoline before this, pass its restaurantSlugs here to scope semantic search to the isochrone area. Example: After get_isoline returns { restaurantSlugs: ['a', 'b', 'c'] }, call semantic_search_restaurants({ query: '...', scopeToSlugs: ['a', 'b', 'c'] })"),
    }),
    execute: async (params: { query: string; topK?: number; restaurantWeekIntent?: boolean; scopeToSlugs?: string[] }) => {
      const { query, topK = 10, restaurantWeekIntent = false, scopeToSlugs } = params || {};
      try {
        if (!query || typeof query !== "string" || query.trim() === "") {
          console.log(`⚠️ semantic_search_restaurants: No query provided`);
          return { restaurantSlugs: [], restaurants: [], count: 0, query: "", error: "Missing query" };
        }

        console.log(`🔍 semantic_search_restaurants: "${query}" (topK: ${topK}, restaurantWeekIntent: ${restaurantWeekIntent}, scopeToSlugs: ${scopeToSlugs?.length ?? 'none'})`);

        // Detect Restaurant Week intent from query keywords OR explicit parameter
        const hasRWIntent = restaurantWeekIntent || detectRestaurantWeekIntent(query);

        // Build restaurantIds with priority: scopeToSlugs > filterPool > all
        // scopeToSlugs takes highest priority (from isochrone results within same request)
        let restaurantIds: string[] | null = null;

        if (scopeToSlugs && scopeToSlugs.length > 0) {
          // Highest priority: use slugs passed from get_isoline (same request)
          restaurantIds = [...scopeToSlugs];
          console.log(`🗺️ Scoping semantic search to ${scopeToSlugs.length} restaurants from isochrone`);
        } else if (hasFilterPool) {
          // Second priority: use filterPool from frontend context
          restaurantIds = [...filterPool];
          console.log(`🎯 Scoping semantic search to filterPool of ${filterPool.length} restaurants`);
        }

        // If RW intent detected, narrow to only RW participants
        if (hasRWIntent) {
          const rwSlugs = allRestaurants
            .filter(r => r.meal_types && Array.isArray(r.meal_types) && r.meal_types.length > 0)
            .map(r => r.slug);

          if (restaurantIds) {
            // Intersect with existing scope (isochrone or filterPool)
            restaurantIds = restaurantIds.filter(slug => rwSlugs.includes(slug));
          } else {
            // Use RW participants as the filter
            restaurantIds = rwSlugs;
          }
          console.log(`🎄 Auto-detected Restaurant Week intent, filtering to ${restaurantIds.length} RW participants`);
        }

        // Perform RAG search with 70% semantic + 30% keyword hybrid scoring
        const result = await performRagSearch(query, topK, restaurantIds);

        // Extract slugs for displayRestaurants (same pattern as get_isoline)
        const restaurantSlugs = result.results.map((r) => r.slug);

        // Map results to summary objects (not full objects - keeps response small)
        const restaurants = result.results.map((r) => ({
          name: r.name,
          slug: r.slug,
          cuisine: r.cuisine || "Unknown",
          price: r.price || "$$",
          neighborhood: r.neighborhood || "",
          yelp_rating: r.yelp_rating || 0,
          michelin_award: r.michelin_award || "",
          nyttop100_rank: r.nyttop100_rank || "",
        }));

        console.log(`✅ semantic_search_restaurants: Found ${restaurants.length} matches, slugs: [${restaurantSlugs.slice(0, 3).join(", ")}${restaurantSlugs.length > 3 ? "..." : ""}]`);

        return {
          // restaurantSlugs: Pass this array to displayRestaurants({ restaurant_names: restaurantSlugs })
          restaurantSlugs,
          // restaurants: Summary info for context (cuisine mix, ratings, awards)
          restaurants,
          count: restaurants.length,
          query,
          filterPoolApplied: result.filterPoolApplied,
          // Indicates if we scoped to isochrone via scopeToSlugs parameter
          scopedToIsochrone: scopeToSlugs && scopeToSlugs.length > 0,
          // Tell frontend to activate Restaurant Week filter if we detected it
          restaurantWeekDetected: hasRWIntent,
        };
      } catch (error) {
        console.error("❌ Error in semanticSearchRestaurantsTool:", error);
        return {
          restaurantSlugs: [] as string[],
          restaurants: [] as { name: string; slug: string; cuisine: string; price: string; neighborhood: string; yelp_rating: number; michelin_award: string; nyttop100_rank: string }[],
          count: 0,
          query: query || "",
          filterPoolApplied: false,
          scopedToIsochrone: false,
          restaurantWeekDetected: false,
          error: String(error),
        };
      }
    },
  });

  // 2. Fetch Dataset Schemas (Let it fail/throw)
  if (analysisId) {
    console.log(`📂 Fetching datasets for analysis: ${analysisId}`);
    const datasetsRes = await mcpClient.readResource({
      uri: `analysis://${analysisId}/datasets`,
    });
    const firstContent = datasetsRes?.contents?.[0];
    if (
      firstContent &&
      "text" in firstContent &&
      typeof firstContent.text === "string"
    ) {
      const data = JSON.parse(firstContent.text);
      if (data.datasets?.length > 0) {
        for (const ds of data.datasets) {
          const vId = ds.versionId || ds.version_id;
          const tName = ds.tableName || ds.table_name;
          const kind = typeof ds.kind === "string" ? ds.kind.toLowerCase() : "";

          const schemaRes = await mcpClient.readResource({
            uri: `analysis://${analysisId}/dataset/${vId}/schema`,
          });
          const schemaContent = schemaRes?.contents?.[0];
          const schemaText =
            schemaContent &&
            "text" in schemaContent &&
            typeof schemaContent.text === "string"
              ? schemaContent.text
              : "No schema available";

          if (kind === "unstructured") {
            // Clean up schema text to avoid calling it a table
            const cleanedSchema = schemaText
              .replace(/\*\*Table:.*?\*\*/gi, "")
              .replace(/"table_name":/gi, '"collection_id":');
            docCollections += `\n### DOCUMENT COLLECTION: "${ds.name}"\nID: ${vId}\n${cleanedSchema}\n`;
          } else {
            sqlTables += `\n### SQL TABLE: "${tName}"\nName: ${ds.name}\n${schemaText}\n`;
          }
        }

        if (sqlTables) {
          datasetContext += `\nDATASETS AVAILABLE FOR SQL QUERIES:\n${sqlTables}`;
        }
        if (docCollections) {
          datasetContext += `\nDATASETS AVAILABLE FOR DOCUMENT SEARCH:\n${docCollections}`;
        }
        console.log(`✅ Schemas loaded for ${data.datasets.length} datasets`);
      }
    }
  }

  // Build the tool instructions based on available dataset types
  let toolInstructions = `
- semantic_search_restaurants: **USE THIS for dietary preferences and vibes** - NOT execute_sql!
  **MUST use for**: vegetarian, vegan, gluten-free, kosher, halal, pescatarian, dairy-free, nut-free, AND any vibe/ambiance queries.
  Examples: "vegetarian friendly", "vegan options", "cozy date spot", "trendy rooftop", "quiet romantic".
  **WHY**: Dietary info is in reviews/descriptions, NOT structured database fields. SQL CANNOT find vegetarian restaurants!
  **CRITICAL**: If user mentions "restaurant week", "prix fixe", or "$30/$45/$60 deals", set restaurantWeekIntent=true.
  **CRITICAL FOR ISOCHRONE+VIBE QUERIES**: If you called get_isoline first, you MUST pass its restaurantSlugs to scopeToSlugs!
    Example: get_isoline returns { restaurantSlugs: ["a", "b", "c"] }
    → semantic_search_restaurants({ query: "cozy", scopeToSlugs: ["a", "b", "c"] })
    This ensures semantic search only looks at restaurants INSIDE the isochrone!
  Returns restaurantSlugs array. **IMMEDIATELY call displayRestaurants({ restaurant_names: restaurantSlugs }) after!**
- displayRestaurants: **THE MAIN TOOL FOR SHOWING RESTAURANTS.** Use for:
  1. Specific restaurant by name: displayRestaurants({ restaurant_names: ["Hangawi"] }) - supports fuzzy matching!
  2. After semantic_search_restaurants: displayRestaurants({ restaurant_names: restaurantSlugs })
  3. After execute_sql/get_isoline: displayRestaurants({ restaurant_names: [...] })
  **ALWAYS call this to show restaurant cards!**`;

  if (sqlTables) {
    toolInstructions += `
- execute_sql: Use ONLY for structured fields: neighborhood, price ($/$$/$$$/$$$$), cuisine TYPE (Italian, Japanese, etc.), awards.
  **DO NOT use for**: vegetarian, vegan, dietary preferences, vibes, ambiance - these are NOT in the database schema!`;
  }
  if (docCollections) {
    toolInstructions += `
- search_documents: Use ONLY for Document Collections (for information gathering, NOT restaurant search).`;
  }

  // Build filter pool context for system prompt
  const filterPoolContext = hasFilterPool
    ? `
### 🎯 ACTIVE USER FILTERS
The user has applied filters in the app. Your recommendations MUST only include restaurants from the filtered set of ${filterPool.length} restaurants.
- The displayRestaurants tool will automatically respect these filters
- Do NOT recommend restaurants outside this filtered set
- If asked "show me all restaurants" or similar, show restaurants from the filtered set only
`
    : "";

  const systemPrompt = `You are Remi, based on Remy from Ratatouille - a rat with an extraordinary sense of taste who became a professional chef. You're a self-aware intellectual with cultivated epicurean tastes, channeling some of Anthony Bourdain's honest palate and sharp wit. Your mission: help foodie users find the right restaurant based on their preferences, inspired by Chef Gusteau's motto "Anyone can cook!"

You are a restaurant concierge sommelier helping users discover restaurants and the best deals during NYC Restaurant Week.

### ⚠️ CRITICAL RULES - NEVER VIOLATE THESE!
1. **ALWAYS CALL TOOLS** - You MUST call tools to find restaurants! Never just respond with text.
2. **ALWAYS extract information from the user's message** before calling tools.
   - "show me hangawi" → Extract "hangawi" → displayRestaurants({ restaurant_names: ["hangawi"] })
   - "show me italian" → Extract "italian" → execute_sql with cuisine filter
3. **If you don't understand**, ask the user a clarifying question in your text response.
4. **NEVER call displayRestaurants with empty arguments** - always pass restaurant_names!

### 📝 TEXT OUTPUT RULES (these apply to your TEXT responses, NOT tool calling!)
5. **BE TERSE** - Max 2 sentences of text. No apologies. No repetition. Let cards speak.

**PATTERN MATCHING FOR SHORT QUERIES:**
1. **CUISINE TYPE** ("show me italian", "mediterranean spots", "japanese restaurants"):
   → execute_sql with cuisine filter, then displayRestaurants
   Example: "show me italian" → execute_sql({ sql: "SELECT name FROM ... WHERE LOWER(cuisine) LIKE '%italian%'" })

2. **SPECIFIC RESTAURANT NAME** ("show me hangawi", "where is carbone", "gramercy tavern"):
   → displayRestaurants({ restaurant_names: ["hangawi"] }) directly

3. **AWARD WINNERS** ("show me award-winners", "michelin restaurants", "top 100", "bib gourmand"):
   → execute_sql with award filter: WHERE michelin_award != '' OR nyttop100_rank != ''
   Example: "michelin stars" → execute_sql({ sql: "SELECT name FROM ... WHERE michelin_award != ''" })

4. **VIBES/DIETARY** ("vegetarian", "cozy spot", "romantic", "vegan"):
   → semantic_search_restaurants({ query: "vegetarian friendly" }), then displayRestaurants

5. **LOCATION** ("near times square", "walking distance from chelsea"):
   → geocode, then get_isoline, then displayRestaurants

### 🍽️ NYC RESTAURANT WEEK CONTEXT
NYC Restaurant Week is a biannual event run by NYC Tourism + Conventions, Inc. The Spring 2026 edition runs from January 20 to February 12, 2026. Participating restaurants offer prix fixe lunch and/or dinner menus at special prices ($30, $45, or $60). This is a great opportunity for diners to explore award-winning restaurants at accessible price points.

**Pro tip to share occasionally:** When users are browsing Restaurant Week options, you can mention: "Some restaurants share their prix fixe menus beforehand. If you'd like to see only those, click on 'Has Prix Fixe Menu' in the filter bar after selecting '2026 Restaurant Week'."

### 🗽 COVERAGE & LIMITATIONS
NYC Eats currently covers **Manhattan only**. If users ask about restaurants in other boroughs (Brooklyn, Queens, Bronx, Staten Island), adding restaurants, or unsupported features, respond warmly: "Alas, NYC Eats is limited to Manhattan for now. If you're interested in helping expand coverage, leave my creator a note and perhaps a coffee [here](https://buymeacoffee.com/atmikapai). Cheers!"

${filterPoolContext}
${datasetContext}
${spatialReference}

Available Tools for analysis "${analysisId}":${toolInstructions}

### 🍴 HOW TO DISTINGUISH RESTAURANT NAMES vs CUISINE TYPES
**Restaurant names** are proper nouns (specific establishments): Hangawi, Carbone, Le Bernardin, Gramercy Tavern, Lilia, Don Angie
**Cuisine types** are categories: Italian, Japanese, Mediterranean, Mexican, French, Korean, Indian

**If unsure**, ask yourself: "Is this a specific place I could make a reservation at, or a type of food?"
- "Hangawi" = specific Korean restaurant → displayRestaurants({ restaurant_names: ["Hangawi"] })
- "Korean" = cuisine type → execute_sql with cuisine filter

**Examples:**
- "show me Hangawi" → displayRestaurants({ restaurant_names: ["Hangawi"] })
- "show me korean" → execute_sql({ sql: "SELECT name FROM ... WHERE LOWER(cuisine) LIKE '%korean%'" })
- "where is Carbone?" → displayRestaurants({ restaurant_names: ["Carbone"] })
- "italian spots" → execute_sql({ sql: "SELECT name FROM ... WHERE LOWER(cuisine) LIKE '%italian%'" })

**WARNING**: Do NOT geocode restaurant names - they are restaurants, not locations!

- geocode: Convert street addresses and neighborhoods to coordinates. Always append ", New York City".
  * When users mention neighborhoods (e.g., "Greenwich Village", "Chelsea", "Williamsburg"), geocode the neighborhood name directly without asking for clarification. Use your best judgment for the neighborhood center.
  * Example: User says "show me restaurants near Greenwich Village" → geocode("Greenwich Village, New York City") - NO follow-up questions needed!
- get_isoline: Calculate reachable areas (isochrones).

### 🗺️ ISOCHRONE CREATION RULES
**Mode + Time specified** (e.g., "15 min walk from Chelsea") → Execute immediately, no questions.

**Mode only, no time** (e.g., "walking from Times Square") → Default to 15 minutes silently, mention in response: "I'll use a 15-minute walk..."

**Time only, no mode** (e.g., "restaurants within 20 min of Grand Central") → Ask for mode only: "Walking, subway, cycling, or driving for those 20 minutes?"

**Neither mode nor time** (e.g., "restaurants in SoHo") → Ask for both conversationally: "How would you like to get around - walking, subway, cycling, or driving? And how far are you willing to travel?"

**Travel modes:** walking/walk/on foot → "walking" | subway/transit/train/MTA → "transit" | cycling/bike → "cycling" | driving/car/Uber/taxi → "driving"

### 🚀 IMPORTANT: HIGH-PERFORMANCE SPATIAL QUERIES
Geometries (polygons) are large and tricky. I have simplified them for you:
1. When you call get_isoline, the result contains a tiny placeholder ID like "GEO_REF_ABC12".
2. **DUCKDB REQUIREMENT**: The spatial engine ONLY accepts the geometry object (the coordinates), not the full Feature. I have automatically extracted the geometry for you and stored it in the ID.
3. **THE SQL RECIPE**: To use an isochrone in SQL, always use \`ST_GeomFromGeoJSON(ID)\`.
   - ✅ Correct: \`ST_GeomFromGeoJSON(GEO_REF_ABC12)\`
   - ✅ Correct: \`ST_GeomFromGeoJSON('GEO_REF_ABC12')\`
   - ✅ Correct: \`ST_GeomFromGeoJSON(LAST_GEO)\`
4. **DO NOT** attempt to manually escape, quote, or format the IDs beyond what is shown above. The backend handles all the "kitchen prep" (injection and escaping) for you.

### ⚠️ CRITICAL: GEO_REF IDs ARE TEMPORARY AND REQUEST-SCOPED
**GEO_REF IDs ONLY exist during the CURRENT message/request**. They are CLEARED after each response!

✅ CORRECT Example (all in ONE message):
User: "Find Korean restaurants between Chelsea and East Village"
1. geocode("Chelsea, New York City") → lat/lng
2. get_isoline(lat, lng, ...) → returns GEO_REF_A1B2C
3. geocode("East Village, New York City") → lat/lng
4. get_isoline(lat, lng, ...) → returns GEO_REF_D3E4F
5. execute_sql("SELECT name FROM table WHERE ST_Intersects(geometry, ST_Intersection(ST_GeomFromGeoJSON(GEO_REF_A1B2C), ST_GeomFromGeoJSON(GEO_REF_D3E4F)))")
6. displayRestaurants([names])
→ SUCCESS! All GEO_REF IDs were created and used in the SAME request.

❌ WRONG Example (across multiple messages):
User: "Find area between Chelsea and East Village"
Assistant: [creates GEO_REF_A1B2C and GEO_REF_D3E4F, shows map]
User: "Now find Korean restaurants in that area"
Assistant tries: execute_sql("...ST_GeomFromGeoJSON(GEO_REF_A1B2C)...")
→ FAILS! GEO_REF_A1B2C no longer exists. It was cleared after the previous response.

✅ CORRECT Fix (start fresh):
User: "Now find Korean restaurants in that area"
1. geocode("Chelsea, New York City") → lat/lng
2. get_isoline(lat, lng, ...) → returns NEW_GEO_REF_X
3. geocode("East Village, New York City") → lat/lng
4. get_isoline(lat, lng, ...) → returns NEW_GEO_REF_Y
5. execute_sql("SELECT name FROM table WHERE cuisine='Korean' AND ST_Intersects(geometry, ST_Intersection(ST_GeomFromGeoJSON(NEW_GEO_REF_X), ST_GeomFromGeoJSON(NEW_GEO_REF_Y)))")
6. displayRestaurants([names])
→ SUCCESS! Created fresh GEO_REF IDs for this request.

**IF THE USER ASKS FOR REFINEMENT**: You MUST re-call get_isoline to get NEW IDs. Never assume old IDs still work!

Example Query:
\`SELECT name FROM "4d73f3d7-85df-49bd-99cb-0da1f4034825" WHERE ST_Intersects(geometry, ST_GeomFromGeoJSON(LAST_GEO))\`

Important Instructions for "Between Us" Queries:
When a user asks to find restaurants "between" two locations:
1. Call geocode for BOTH locations.
2. Call get_isoline TWICE.
3. Use the two IDs (e.g., GEO_REF_1 and GEO_REF_2) in a single spatial SQL query.
   - Example: \`SELECT name FROM "table" WHERE ST_Intersects(geometry, ST_Intersection(ST_GeomFromGeoJSON(GEO_REF_1), ST_GeomFromGeoJSON(GEO_REF_2)))\`
4. FINALLY call displayRestaurants with the names you found.

Rules:
1. ONLY use tools listed as available above.
2. **TOOL SELECTION** (CRITICAL):
   - semantic_search_restaurants: vegetarian, vegan, dietary, vibes, ambiance, "cozy", "romantic", "trendy"
   - execute_sql: neighborhood, price level, cuisine TYPE, awards, spatial queries
   - **NEVER use execute_sql for dietary preferences** - the database has no vegetarian/vegan columns!
3. **SHOWING RESTAURANT CARDS** (CRITICAL - USERS SEE NOTHING WITHOUT THIS!):
   - semantic_search_restaurants → Returns restaurantSlugs. **Your VERY NEXT tool call MUST be displayRestaurants({ restaurant_names: restaurantSlugs }). DO NOT call execute_sql or any other tool first!**
   - get_isoline → Returns restaurantSlugs. **Your VERY NEXT tool call MUST be displayRestaurants({ restaurant_names: restaurantSlugs }).**
   - execute_sql → Returns names. **Your VERY NEXT tool call MUST be displayRestaurants with the names.**
   - Specific restaurant name → displayRestaurants({ restaurant_names: ["name"] }) directly!
   - **WARNING**: If you call semantic_search_restaurants but don't call displayRestaurants immediately after, THE USER WILL SEE NO RESTAURANT CARDS!

### 🚨 RESULT VALIDATION - TRUST YOUR TOOL RESULTS!
**When semantic_search_restaurants returns results, those ARE your final results. Do NOT second-guess them with execute_sql!**

semantic_search_restaurants searches review text, descriptions, and vibes - things SQL cannot query. If it returns 5 restaurants for "hole in the wall", those 5 restaurants ARE the answer.

❌ WRONG (ignores successful semantic search):
User: "hole in the wall spots within 15 min walk"
1. get_isoline → 10 restaurants in area ✓
2. semantic_search_restaurants("hole in the wall") → 5 matches ✓
3. execute_sql(...WHERE "hole in the wall"...) → 0 results (SQL can't search vibes!)
4. "Sorry, no results" ← WRONG! You had 5 results from step 2!

✅ CORRECT (trust semantic search results):
User: "hole in the wall spots within 15 min walk"
1. get_isoline → 10 restaurants in area ✓
2. semantic_search_restaurants("hole in the wall") → 5 matches ✓
3. displayRestaurants({ restaurant_names: [the 5 slugs] }) ← USE THE RESULTS!
4. "Found 5 cozy spots!" ← CORRECT!

**KEY RULE**: If semantic_search_restaurants returns results (count > 0), IMMEDIATELY call displayRestaurants with those results. NEVER call execute_sql afterward for the same query - it will fail and you'll lose the good results!
4. **GEO_REF IDs expire after each response**. Never reference IDs from previous messages. Always call get_isoline fresh when needed.
5. **NEVER** type out actual coordinates.
6. **When users mention neighborhoods, geocode them directly**. Don't ask clarifying questions about specific addresses within the neighborhood. Trust your judgment!
7. **NEVER mention technical details like GEO_REF IDs, table UUIDs, or internal tool mechanics to the user**. Keep your responses natural and conversational - the user doesn't need to know about the backend magic!
8. Be concise, charming, and follow the recipe!
9. **RESTAURANT NAME QUERIES**: When users ask about a specific restaurant by name, use displayRestaurants({ restaurant_names: ["name"] }). Do NOT try to geocode restaurant names - they are restaurants, not locations!

### 📝 RESPONSE FORMAT RULES - BE TERSE!
**CRITICAL: Keep text SHORT. No fluff.**

1. **Brief intro before tools** (1 sentence max, or none at all).
2. **NEVER list restaurant names** in text - cards show them.
3. **NEVER repeat yourself** - if you said it once, don't say it again.
4. **NEVER apologize** - no "My apologies", "I'm sorry", "it seems I was too subtle".
5. **NEVER write multiple paragraphs**.

**AFTER displayRestaurants returns**: Look at the results (michelin_award, nyttop100_rank, summary fields) and make ONE astute observation about something interesting - an award, a famous chef, a unique vibe, or why a spot stands out. Do NOT just list restaurant names. Then STOP.

✅ GOOD observations:
- "Found 12 spots. Buddakan's dramatic communal dining room is worth it alone."
- "8 matches - three have Michelin stars, and Carbone's spicy rigatoni is legendary."
- "15 options here. La Sirene brings legit Brittany-style French to Hudson Street."

❌ BAD (just listing names): "Here are a few of them, including Felice on Hudson, La Sirene, and Buddakan."
❌ BAD (flowery): "Ah, a true aficionado! Let me find you some delightful spots where the good times roll..."

**If search returns same results**: Just say "These are the best matches." Don't apologize.

**MULTI-TOOL QUERIES** (geocode → isoline → search):
- Call all tools SILENTLY - no text between tool calls!
- Only speak ONCE at the very end with results.
❌ BAD: "First I'll geocode... [tool] Excellent, found it at 40.7... Now let me map... [tool] Great, mapped! Now searching..."
✅ GOOD: [tools run silently] "Found 8 spots within 15 min walk for both of you:"

### 🗺️ ISOCHRONE + SEMANTIC SEARCH COMBO (CRITICAL!)
When user asks for both location AND vibe (e.g., "hole in the wall spots within 20 min walk of Chrysler Building"):

✅ CORRECT FLOW:
1. geocode("Chrysler Building, New York City") → { lat, lng }
2. get_isoline({ lat, lng, minutes: 20, mode: "walking" }) → { restaurantSlugs: ["slug-a", "slug-b", ...] }
3. semantic_search_restaurants({ query: "hole in the wall", scopeToSlugs: ["slug-a", "slug-b", ...] }) → results ONLY from isochrone!
4. displayRestaurants({ restaurant_names: [results] })

❌ WRONG (forgets to pass scopeToSlugs):
1. geocode → ✓
2. get_isoline → { restaurantSlugs: [...] } ✓
3. semantic_search_restaurants({ query: "hole in the wall" }) → searches ALL restaurants, ignores isochrone!
4. Results are from across Manhattan, not the isochrone area!

**KEY**: The scopeToSlugs parameter is what connects get_isoline to semantic_search_restaurants. Without it, semantic search doesn't know about the isochrone!`;


  // Wrap search_documents to filter results by filterPool
  const wrappedSearchDocuments = optimizedTools.search_documents
    ? {
        ...optimizedTools.search_documents,
        execute: async (args: Record<string, unknown>) => {
          // Call the original search_documents tool
          const result = await (optimizedTools.search_documents as any).execute(args);

          // If no filterPool or result has error, return as-is
          if (!hasFilterPool || !result || (result as any).isError) {
            return result;
          }

          // Get restaurant names in filterPool for matching
          const filterPoolNames = new Set(
            allRestaurants
              .filter((r) => filterPool.includes(r.slug))
              .map((r) => r.name.toLowerCase())
          );

          // Filter chunks to only include those mentioning restaurants in filterPool
          const chunks = (result as any).chunks || [];
          const filteredChunks = chunks.filter((chunk: any) => {
            const text = (chunk.text || "").toLowerCase();
            // Check if chunk mentions any restaurant in filterPool
            return Array.from(filterPoolNames).some(
              (name) => name.length > 3 && text.includes(name)
            );
          });

          console.log(
            `🔍 search_documents: Filtered ${chunks.length} chunks → ${filteredChunks.length} (filterPool: ${filterPool.length} restaurants)`
          );

          return {
            ...result,
            chunks: filteredChunks,
          };
        },
      }
    : undefined;

  // Wrap execute_sql to inject filterPool constraint into WHERE clause
  const wrappedExecuteSql = optimizedTools.execute_sql
    ? {
        ...optimizedTools.execute_sql,
        execute: async (args: Record<string, unknown>) => {
          let sql = args.sql as string;

          // Inject filterPool constraint if active
          if (hasFilterPool && sql) {
            // Build the slug list for SQL IN clause
            const slugList = filterPool.map((s) => `'${s}'`).join(",");
            const filterClause = `slug IN (${slugList})`;

            // Check if SQL already has a WHERE clause
            const whereMatch = sql.match(/\bWHERE\b/i);
            if (whereMatch) {
              // Insert filter after WHERE
              sql = sql.replace(
                /\bWHERE\b/i,
                `WHERE ${filterClause} AND`
              );
            } else {
              // Find the end of FROM clause and add WHERE
              // Match: FROM "table-uuid" or FROM table_name
              const fromMatch = sql.match(/\bFROM\s+["']?[\w-]+["']?/i);
              if (fromMatch) {
                const insertPos = (fromMatch.index || 0) + fromMatch[0].length;
                sql =
                  sql.slice(0, insertPos) +
                  ` WHERE ${filterClause}` +
                  sql.slice(insertPos);
              }
            }

            console.log(
              `🔒 execute_sql: Injected filterPool constraint (${filterPool.length} slugs)`
            );
          }

          // Call the original execute_sql with modified SQL
          return (optimizedTools.execute_sql as any).execute({
            ...args,
            sql,
          });
        },
      }
    : undefined;

  // Manhattan bounding box (simple rectangle check)
  const MANHATTAN_BOUNDS = {
    minLat: 40.6829,
    maxLat: 40.8820,
    minLng: -74.0200,
    maxLng: -73.9067,
  };

  // Wrap get_isoline to compute filterPool restaurants inside the polygon
  // This ensures the model gets accurate restaurant counts at isochrone creation time
  const wrappedGetIsoline = optimizedTools.get_isoline
    ? {
        ...optimizedTools.get_isoline,
        execute: async (args: Record<string, unknown>) => {
          // Quick Manhattan boundary check before API call
          // Check multiple possible parameter names
          console.log("🗺️ get_isoline args:", JSON.stringify(args, null, 2));

          const lat = Number(args.lat ?? args.latitude ?? args.origin_lat);
          const lng = Number(args.lng ?? args.lon ?? args.longitude ?? args.origin_lng);

          if (!isNaN(lat) && !isNaN(lng)) {
            const outsideManhattan =
              lat < MANHATTAN_BOUNDS.minLat ||
              lat > MANHATTAN_BOUNDS.maxLat ||
              lng < MANHATTAN_BOUNDS.minLng ||
              lng > MANHATTAN_BOUNDS.maxLng;

            if (outsideManhattan) {
              console.log(`⚠️ get_isoline: Coordinates (${lat}, ${lng}) outside Manhattan bounds`);
              return {
                isError: true,
                error: "Location is outside Manhattan. NYC Eats currently covers Manhattan only.",
                outsideManhattan: true,
              };
            }
          } else {
            console.log(`⚠️ get_isoline: Could not extract lat/lng from args`);
          }

          // 1. Call original get_isoline for polygon
          const result = await (optimizedTools.get_isoline as any).execute(args);

          if (!result || (result as any).isError) {
            return result;
          }

          // 2. Extract polygon geometry from result
          // The geometry could be in different places depending on MCP response format
          const geojson = (result as any).geojson || (result as any).geometry || (result as any).results?.[0]?.geojson;

          if (!geojson) {
            console.log("⚠️ get_isoline: No geometry found in result, returning as-is");
            return result;
          }

          // 3. Extract the actual polygon coordinates for point-in-polygon check
          let polygonGeometry: Polygon | MultiPolygon | null = null;

          if (geojson.type === "Feature") {
            polygonGeometry = (geojson as Feature<Polygon | MultiPolygon>).geometry;
          } else if (geojson.type === "Polygon" || geojson.type === "MultiPolygon") {
            polygonGeometry = geojson as Polygon | MultiPolygon;
          }

          if (!polygonGeometry) {
            console.log("⚠️ get_isoline: Could not extract polygon geometry, returning as-is");
            return result;
          }

          // 4. Determine search pool: filterPool if active, otherwise all restaurants
          const searchPool = hasFilterPool
            ? allRestaurants.filter((r) => filterPool.includes(r.slug))
            : allRestaurants;

          // 5. Compute which restaurants from the search pool are inside the polygon
          const restaurantsInPolygon = searchPool.filter((r) => {
            const lng = Number(r.longitude);
            const lat = Number(r.latitude);
            if (isNaN(lng) || isNaN(lat)) return false;

            try {
              const pt = point([lng, lat]);
              return booleanPointInPolygon(pt, polygonGeometry!);
            } catch (e) {
              console.warn(`⚠️ Point-in-polygon check failed for ${r.slug}:`, e);
              return false;
            }
          });

          const restaurantSlugs = restaurantsInPolygon.map((r) => r.slug);

          console.log(
            `🗺️ get_isoline: Found ${restaurantsInPolygon.length} restaurants in polygon` +
            (hasFilterPool ? ` (from filterPool of ${filterPool.length})` : ` (from all ${allRestaurants.length})`)
          );

          // 6. Return enhanced result with restaurant data
          return {
            ...result,
            // Restaurant data for the model to use
            restaurants: restaurantsInPolygon.map((r) => ({
              name: r.name,
              slug: r.slug,
              cuisine: r.cuisine,
              price: r.price,
              neighborhood: r.neighborhood,
              yelp_rating: r.yelp_rating,
              michelin_award: r.michelin_award,
              nyttop100_rank: r.nyttop100_rank,
            })),
            restaurantSlugs,
            count: restaurantsInPolygon.length,
            // Metadata about filtering
            filterPoolActive: hasFilterPool,
            filterPoolSize: hasFilterPool ? filterPool.length : allRestaurants.length,
            searchedPool: searchPool.length,
          };
        },
      }
    : undefined;

  // Combine MCP tools with our custom tools
  // Note: We explicitly exclude search_documents from MCP and use our local semantic search instead
  const allTools = {
    // Selectively include MCP tools (exclude search_documents)
    ...(optimizedTools.geocode ? { geocode: optimizedTools.geocode } : {}),
    // Override with filtered/wrapped versions
    ...(wrappedExecuteSql ? { execute_sql: wrappedExecuteSql } : {}),
    ...(wrappedGetIsoline ? { get_isoline: wrappedGetIsoline } : {}),
    // Local tools
    displayRestaurants: displayRestaurantsTool,
    semantic_search_restaurants: semanticSearchRestaurantsTool,
    // DO NOT include search_documents - replaced by semantic_search_restaurants
  };
  console.log("🛠️ All tools available:", Object.keys(allTools).join(", "));

  try {
    const result = streamText({
      model: google("gemini-2.5-flash"),
      temperature: 0, // Deterministic responses
      messages: await convertToModelMessages(messages),
      tools: allTools,
      toolChoice: "auto", //auto //required
      system: systemPrompt,
      stopWhen: stepCountIs(10),
      abortSignal: AbortSignal.timeout(55_000), // Under Vercel's 60s limit
      onStepFinish: (step) => {
        console.log(
          `🎯 Step: ${step.finishReason}${
            Array.isArray(step.toolCalls) && step.toolCalls.length
              ? ` | Tools: ${step.toolCalls.filter(Boolean).map((t) => t?.toolName ?? "unknown").join(", ")}`
              : ""
          }`
        );
        (Array.isArray(step.toolCalls) ? step.toolCalls : []).forEach((tc) => {
          if (!tc) return;
          // Log tool arguments
          const args = "args" in tc ? tc.args : undefined;
          console.log(`   🛠️  ${tc.toolName}(${JSON.stringify(args)})`);
        });
        (step.toolResults ?? []).forEach((tr) => {
          if (!tr) return;
          const res =
            "result" in tr
              ? tr.result
              : "output" in tr && tr.output
              ? tr.output
              : undefined;
          const isError = "isError" in tr && tr.isError;
          const color = isError ? "❌" : "✅";
          console.log(
            `   ${color} ${tr.toolName}: ${isError ? "Error" : "Success"} (${
              JSON.stringify(res).length
            } chars)`
          );
          if (isError) console.error("      Detail:", res);
        });
      },
      onFinish: async () => {
        // Close MCP client only when stream fully completes
        // NOTE: Do NOT use finally block - it runs immediately after return,
        // not after the stream completes, which would close MCP prematurely
        if (mcpClient) {
          try {
            await mcpClient.close();
            console.log("✅ MCP client closed");
          } catch (closeError) {
            console.warn("⚠️ Error closing MCP client:", closeError);
          }
        }
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error("❌ Fatal error in stream:", error);
    // Close MCP client on error (before streaming started)
    if (mcpClient) {
      try {
        await mcpClient.close();
        console.log("✅ MCP client closed (on error)");
      } catch (closeError) {
        console.warn("⚠️ Error closing MCP client:", closeError);
      }
    }
    return c.json(
      { error: error instanceof Error ? error.message : String(error) },
      500
    );
  }
};

// Mount on "/chat" for local development (api/server.ts)
app.post("/chat", chatHandler);
// Catch-all for Vercel (file-based routing passes "/" or full path)
app.post("/", chatHandler);
app.post("/*", chatHandler);

// Vercel configuration - use Node.js runtime for fs/path APIs
export const config = {
  runtime: "nodejs",
};

// Default export for local development (api/server.ts uses this)
export default app;

// Named exports for Vercel serverless functions
export const GET = handle(app);
export const POST = handle(app);
