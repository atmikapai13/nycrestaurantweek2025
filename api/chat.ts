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
import { expandNYCSlang } from "../src/utils/nycSlang.js";
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
    "deals",
    "restaurant week offerings",
    "restaurant week spots",
    "res week"
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

// Warm-up: GET request to /api/chat warms the serverless function
app.get("/", (c) => c.text("ok"));
app.get("/*", (c) => c.text("ok"));

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

  // Extract user's current location from context (from browser geolocation)
  const userLocation: { latitude: number; longitude: number } | null = (context as any)?.userLocation || null;
  if (userLocation) {
    console.log(`📍 User location available: ${userLocation.latitude}, ${userLocation.longitude}`);
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

  // Request-scoped isochrone slugs (set by get_isoline, used by execute_sql/semantic_search)
  // Stores arrays from each isochrone call - intersection is computed for multi-party scenarios
  const allIsochroneSlugs: string[][] = [];

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

**AFTER get_isoline**: You MUST pass get_isoline's restaurantSlugs as the scopeToSlugs parameter!
Example: If get_isoline returned { restaurantSlugs: ["slug-a","slug-b","slug-c"] }, you MUST call:
  semantic_search_restaurants({ query: "cozy", scopeToSlugs: ["slug-a","slug-b","slug-c"] })
Failure to pass scopeToSlugs after get_isoline will search ALL 637 restaurants instead of just those in the isochrone!

**"SHOW ME MORE" REQUESTS**: Pass only the slugs that were DISPLAYED via displayRestaurants (not the full search results).
Example: displayRestaurants showed 5 restaurants → excludeSlugs should have those 5 slugs only.

Returns restaurantSlugs array - IMMEDIATELY call displayRestaurants({ restaurant_names: restaurantSlugs }) after this.
IMPORTANT: If user mentions "restaurant week", "prix fixe", or "$30/$45/$60 deals", set restaurantWeekIntent=true.`,
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
        .describe("**REQUIRED after get_isoline!** Pass the exact restaurantSlugs array from get_isoline's response. Without this, search covers ALL restaurants, ignoring the isochrone boundary. Example: get_isoline returned { restaurantSlugs: ['resto-a', 'resto-b'] } → pass scopeToSlugs: ['resto-a', 'resto-b']"),
      excludeSlugs: z
        .array(z.string())
        .optional()
        .describe("For 'show me more' requests: pass ONLY the slugs from the previous displayRestaurants call (the ones user actually saw), NOT the full search results."),
    }),
    execute: async (params: { query: string; topK?: number; restaurantWeekIntent?: boolean; scopeToSlugs?: string[]; excludeSlugs?: string[] }) => {
      const { query, topK = 10, restaurantWeekIntent = false, scopeToSlugs, excludeSlugs } = params || {};
      try {
        if (!query || typeof query !== "string" || query.trim() === "") {
          console.log(`⚠️ semantic_search_restaurants: No query provided`);
          return { restaurantSlugs: [], restaurants: [], count: 0, query: "", error: "Missing query" };
        }

        console.log(`🔍 semantic_search_restaurants: "${query}" (topK: ${topK}, restaurantWeekIntent: ${restaurantWeekIntent}, scopeToSlugs: ${scopeToSlugs?.length ?? 'none'})`);

        // Detect Restaurant Week intent from query keywords OR explicit parameter
        const hasRWIntent = restaurantWeekIntent || detectRestaurantWeekIntent(query);

        // Build restaurantIds with priority: scopeToSlugs > isochroneSlugs > filterPool > all
        // scopeToSlugs takes highest priority (explicitly passed from get_isoline by model)
        // isochroneSlugs is auto-injected fallback (from get_isoline in same request)
        let restaurantIds: string[] | null = null;

        if (scopeToSlugs && scopeToSlugs.length > 0) {
          // Highest priority: use slugs explicitly passed by model
          restaurantIds = [...scopeToSlugs];
          console.log(`🗺️ Scoping semantic search to ${scopeToSlugs.length} restaurants from scopeToSlugs`);
        } else if (allIsochroneSlugs.length > 0) {
          // Auto-inject: compute intersection of all isochrones (for multi-party scenarios)
          if (allIsochroneSlugs.length === 1) {
            restaurantIds = [...allIsochroneSlugs[0]];
          } else {
            // Intersection: restaurants reachable from ALL locations
            restaurantIds = allIsochroneSlugs.reduce((acc, slugs) =>
              acc.filter(slug => slugs.includes(slug))
            );
          }
          console.log(`🗺️ Auto-injecting ${restaurantIds.length} isochrone slugs into semantic search (from ${allIsochroneSlugs.length} isochrone(s))`);
        } else if (hasFilterPool) {
          // Third priority: use filterPool from frontend context
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
        // Request extra results if we need to exclude some
        const extraForExclusion = excludeSlugs?.length || 0;
        const result = await performRagSearch(query, topK + extraForExclusion, restaurantIds);

        // Filter out excluded slugs (for "show me more" requests)
        let filteredResults = result.results;
        if (excludeSlugs && excludeSlugs.length > 0) {
          filteredResults = result.results.filter(r => !excludeSlugs.includes(r.slug));
          console.log(`🚫 Excluded ${excludeSlugs.length} previously shown slugs, ${filteredResults.length} remaining`);
        }

        // Limit to topK after exclusion
        filteredResults = filteredResults.slice(0, topK);

        // Extract slugs for displayRestaurants (same pattern as get_isoline)
        const restaurantSlugs = filteredResults.map((r) => r.slug);

        // Map results to summary objects (not full objects - keeps response small)
        const restaurants = filteredResults.map((r) => ({
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

  **⚠️ MANDATORY TOOL CHAINING RULE**: After calling get_isoline, you MUST pass its restaurantSlugs to scopeToSlugs!
    CORRECT: get_isoline returns { restaurantSlugs: ["a", "b", "c"] }
             → semantic_search_restaurants({ query: "cozy", scopeToSlugs: ["a", "b", "c"] })
    WRONG:   → semantic_search_restaurants({ query: "cozy" })  ← Missing scopeToSlugs!
    If you omit scopeToSlugs, you will search ALL 637 restaurants and IGNORE the isochrone boundary!

  Returns restaurantSlugs array. **IMMEDIATELY call displayRestaurants({ restaurant_names: restaurantSlugs }) after!**
- displayRestaurants: **THE MAIN TOOL FOR SHOWING RESTAURANTS.** Use for:
  1. Specific restaurant by name: displayRestaurants({ restaurant_names: ["Hangawi"] }) - supports fuzzy matching!
  2. After semantic_search_restaurants: displayRestaurants({ restaurant_names: restaurantSlugs })
  3. After execute_sql/get_isoline: displayRestaurants({ restaurant_names: [...] })
  **ALWAYS call this to show restaurant cards!**`;

  if (sqlTables) {
    toolInstructions += `
- execute_sql: Use ONLY for structured fields: price ($/$$/$$$/$$$$), cuisine TYPE (Italian, Japanese, etc.), awards.
  **DO NOT use for**: vegetarian, vegan, dietary preferences, vibes, ambiance, or neighborhood/location queries - ALWAYS geocode for locations!`;
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

  // Build user location context for system prompt
  const userLocationContext = userLocation
    ? `
### 📍 USER'S CURRENT LOCATION
The user's device location is available: latitude ${userLocation.latitude}, longitude ${userLocation.longitude}
- When the user says "my location", "where I am", "near me", or similar, use these coordinates directly with get_isoline
- Do NOT call geocode for "my location" - use the coordinates above directly
- Example: get_isoline({ latitude: ${userLocation.latitude}, longitude: ${userLocation.longitude}, mode: "transit", range: 900 })
`
    : "";

  const systemPrompt = `You are Remi, a witty restaurant concierge inspired by Ratatouille's Remy. You have Anthony Bourdain's honesty, wit, and authenticity when it comes to food. Goal: help users find restaurants and the best deals during NYC Restaurant Week. A biannual program run by NYC Tourism & Convention Inc., Restaurant Week features over 600 participating restaurants offering prix-fixe lunch, brunch, dinner menus. The Winter 2026 edition runs from January 20 to February 12, 2026. It's an affordable way to experience the city's dining scene!

### CRITICAL RULES
1. **ALWAYS call tools** - never respond with text only. Extract info from user message before calling tools.
2. **displayRestaurants is REQUIRED** - users see nothing without it! Always call it after any search/filter tool.
3. **BE TERSE** - Max 2-3 sentences. No apologies. Highlight 1-2 restaurants with meaningful insight (award, famous dish or chef, unique vibe).
4. **Never call displayRestaurants with empty arguments** - always pass restaurant_names!

### TOOL SELECTION
- **semantic_search_restaurants**: vibes, dietary, ambiance ("cozy", "romantic", "vegan") - SQL cannot search these!
- **execute_sql**: cuisine, price, awards, yelp rating, restaurant week prix fix dinner types (NEVER use neighborhood - always geocode for location queries)
- **Trust semantic search results** - if it returns matches, use them! Don't second-guess with execute_sql.

### QUERY PATTERNS WITH TOOL SELECTION
| Query Type | Action |
|------------|--------|
| Restaurant name ("Carbone", "Hangawi") | displayRestaurants({ restaurant_names: ["name"] }) directly |
| Cuisine ("italian", "korean") | execute_sql with cuisine filter → displayRestaurants |
| Awards ("michelin", "top 100") | execute_sql with award filter → displayRestaurants |
| Price ("cheap", "affordable" → $, $$; "splurge", "fancy" → $$$, $$$$) | execute_sql with price filter → displayRestaurants |
| Vibes/dietary ("cozy", "vegan") | semantic_search_restaurants → displayRestaurants |
| Location ("near Times Square") | geocode → get_isoline → displayRestaurants |
| "my location" / "near me" | get_isoline with user's coordinates (from context) → displayRestaurants |

**Restaurant names are proper nouns (Hangawi, Carbone). Cuisine types are categories (Italian, Korean). Never geocode restaurant names!**

### COVERAGE
Manhattan only. For other boroughs: "Alas, NYC Eats is limited to Manhattan (for now). If you'd like to add more restaurants, nudge me with a coffee [here](https://buymeacoffee.com/atmikapai)."

### FILTER DEFINITIONS
- **Published Prix Fixe Menu**: Restaurants that have published their prix fixe menus on the official Restaurant Week website.
- **Meal Types**: Meals (lunch/dinner/brunch) and prices ($30/$45/$60) the restaurant offers during Restaurant Week.

${filterPoolContext}
${userLocationContext}
${datasetContext}
${spatialReference}

Available Tools for analysis "${analysisId}":${toolInstructions}

### GEOCODING
Append ", Manhattan, New York" to all geocode queries for accuracy.

### ISOCHRONE
Default 15min if time not given; ask user for mode of transit always if not specified.
Modes: walk→"walking" | subway/transit/bus →"transit" | bike→"cycling" | car/uber→"driving"

### GEO_REF SPATIAL QUERIES
get_isoline returns a GEO_REF ID (e.g., "GEO_REF_ABC12"). Use in SQL: \`ST_GeomFromGeoJSON(GEO_REF_ABC12)\`

**GEO_REF IDs are REQUEST-SCOPED** - they expire after each response! For follow-up queries, re-call get_isoline to get fresh IDs.

"Between" queries: geocode both locations → get_isoline twice → \`ST_Intersection(ST_GeomFromGeoJSON(ID1), ST_GeomFromGeoJSON(ID2))\` → displayRestaurants

### ISOCHRONE + SEMANTIC SEARCH (CRITICAL TOOL CHAINING)
For location + vibe queries ("cozy spots near Times Square", "date night Japanese within 20 min of my place"):
1. geocode("Times Square") → { latitude, longitude }
2. get_isoline({ lat, lng, mode, range }) → { restaurantSlugs: ["slug1", "slug2", ...] }
3. **CRITICAL**: semantic_search_restaurants({ query: "cozy", scopeToSlugs: ["slug1", "slug2", ...] })
   ↑ You MUST copy the exact restaurantSlugs array from step 2 into scopeToSlugs!
4. displayRestaurants({ restaurant_names: results })

**DO NOT** call semantic_search_restaurants without scopeToSlugs after get_isoline - this ignores the isochrone!

### RESPONSE RULES
- Brief intro (1 sentence max) or none
- Never list restaurant names in text - cards show them
- Never repeat yourself
- After displayRestaurants: ONE astute observation, then STOP
- Multi-tool queries: call tools silently, speak once at end

### AREA SUMMARY QUERIES (Exception to "be terse")
For "describe this area", "what's in this isochrone", or "what kind of restaurants" queries, give a RICH overview:
- Cuisine breakdown (top 3-5 cuisines with counts), **Award highlights**: "X Michelin-starred spots, Y Bib Gourmands", Price range mix (budget-friendly $, mid-range $$, splurge $$$+)
- Notable standouts worth mentioning by name
Users asking about an area want details - this is the ONE exception to brevity!

Never mention GEO_REF IDs, table UUIDs, or internal mechanics to users.`;


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

          console.log(`📝 execute_sql ORIGINAL: ${sql}`);

          // Auto-transform cuisine exact matches to ILIKE partial matches
          // This handles cases like cuisine = 'Japanese' matching 'Japanese / Sushi'
          if (sql) {
            // Handle: cuisine = 'Japanese' → cuisine ILIKE '%Japanese%'
            sql = sql.replace(
              /cuisine\s*=\s*'([^']+)'/gi,
              (match, cuisineValue) => {
                console.log(`🍽️ Transforming cuisine = '${cuisineValue}' to ILIKE '%${cuisineValue}%'`);
                return `cuisine ILIKE '%${cuisineValue}%'`;
              }
            );

            // Handle: cuisine IN ('Japanese', 'Italian') → (cuisine ILIKE '%Japanese%' OR cuisine ILIKE '%Italian%')
            sql = sql.replace(
              /cuisine\s+IN\s*\(([^)]+)\)/gi,
              (match, valuesStr) => {
                // Extract quoted values from the IN clause
                const values = valuesStr.match(/'([^']+)'/g);
                if (!values || values.length === 0) return match;

                const ilikeConditions = values.map((v: string) => {
                  const cuisineValue = v.replace(/'/g, '');
                  return `cuisine ILIKE '%${cuisineValue}%'`;
                });

                console.log(`🍽️ Transforming cuisine IN (...) to (${ilikeConditions.join(' OR ')})`);
                return `(${ilikeConditions.join(' OR ')})`;
              }
            );
          }

          // Inject isochrone constraint if active (from get_isoline in same request)
          if (allIsochroneSlugs.length > 0 && sql) {
            // Compute intersection for multi-party scenarios
            let isochroneSlugs: string[];
            if (allIsochroneSlugs.length === 1) {
              isochroneSlugs = allIsochroneSlugs[0];
            } else {
              // Intersection: restaurants reachable from ALL locations
              isochroneSlugs = allIsochroneSlugs.reduce((acc, slugs) =>
                acc.filter(slug => slugs.includes(slug))
              );
            }

            const slugList = isochroneSlugs.map((s) => `'${s}'`).join(",");
            const isochroneClause = `slug IN (${slugList})`;

            const whereMatch = sql.match(/\bWHERE\b/i);
            if (whereMatch) {
              // Add to existing WHERE with AND
              sql = sql.replace(/\bWHERE\b/i, `WHERE ${isochroneClause} AND `);
            } else {
              // Add WHERE before ORDER BY, GROUP BY, or LIMIT, or at end
              const insertPoint = sql.match(/\b(ORDER BY|GROUP BY|LIMIT)\b/i);
              if (insertPoint) {
                sql = sql.replace(insertPoint[0], `WHERE ${isochroneClause} ${insertPoint[0]}`);
              } else {
                sql = `${sql} WHERE ${isochroneClause}`;
              }
            }

            console.log(`🔒 execute_sql: Injected isochrone constraint (${isochroneSlugs.length} slugs from ${allIsochroneSlugs.length} isochrone(s))`);
          }

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

          console.log(`📝 execute_sql FINAL: ${sql}`);

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

          // Store for use by execute_sql/semantic_search (auto-inject isochrone constraint)
          allIsochroneSlugs.push(restaurantSlugs);
          console.log(`📍 Stored isochrone ${allIsochroneSlugs.length} with ${restaurantSlugs.length} slugs`);

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

  // Manhattan neighborhood coordinates for local geocoding fallback.
  // The MCP geocoder often returns Manhattan's centroid (Central Park) for
  // neighborhood queries, so we resolve these locally.
  const MANHATTAN_NEIGHBORHOODS: Record<string, { lat: number; lng: number; name: string }> = {
    'east village': { lat: 40.7265, lng: -73.9815, name: 'East Village' },
    'west village': { lat: 40.7336, lng: -73.9999, name: 'West Village' },
    'greenwich village': { lat: 40.7336, lng: -73.9975, name: 'Greenwich Village' },
    'lower east side': { lat: 40.7150, lng: -73.9843, name: 'Lower East Side' },
    'upper west side': { lat: 40.7870, lng: -73.9754, name: 'Upper West Side' },
    'upper east side': { lat: 40.7736, lng: -73.9566, name: 'Upper East Side' },
    'chelsea': { lat: 40.7465, lng: -74.0014, name: 'Chelsea' },
    'soho': { lat: 40.7233, lng: -73.9985, name: 'SoHo' },
    'noho': { lat: 40.7258, lng: -73.9927, name: 'NoHo' },
    'nolita': { lat: 40.7230, lng: -73.9950, name: 'NoLita' },
    'tribeca': { lat: 40.7163, lng: -74.0086, name: 'TriBeCa' },
    'chinatown': { lat: 40.7158, lng: -73.9970, name: 'Chinatown' },
    'little italy': { lat: 40.7191, lng: -73.9973, name: 'Little Italy' },
    'financial district': { lat: 40.7075, lng: -74.0089, name: 'Financial District' },
    'fidi': { lat: 40.7075, lng: -74.0089, name: 'Financial District' },
    'midtown': { lat: 40.7549, lng: -73.9840, name: 'Midtown Manhattan' },
    'midtown east': { lat: 40.7549, lng: -73.9712, name: 'Midtown East' },
    'midtown west': { lat: 40.7590, lng: -73.9937, name: 'Midtown West' },
    "hell's kitchen": { lat: 40.7638, lng: -73.9918, name: "Hell's Kitchen" },
    'hells kitchen': { lat: 40.7638, lng: -73.9918, name: "Hell's Kitchen" },
    'murray hill': { lat: 40.7479, lng: -73.9757, name: 'Murray Hill' },
    'gramercy': { lat: 40.7382, lng: -73.9860, name: 'Gramercy' },
    'gramercy park': { lat: 40.7382, lng: -73.9860, name: 'Gramercy Park' },
    'flatiron': { lat: 40.7411, lng: -73.9897, name: 'Flatiron District' },
    'flatiron district': { lat: 40.7411, lng: -73.9897, name: 'Flatiron District' },
    'union square': { lat: 40.7359, lng: -73.9911, name: 'Union Square' },
    'times square': { lat: 40.7580, lng: -73.9855, name: 'Times Square' },
    'harlem': { lat: 40.8116, lng: -73.9465, name: 'Harlem' },
    'east harlem': { lat: 40.7957, lng: -73.9425, name: 'East Harlem' },
    'washington heights': { lat: 40.8417, lng: -73.9394, name: 'Washington Heights' },
    'inwood': { lat: 40.8677, lng: -73.9212, name: 'Inwood' },
    'morningside heights': { lat: 40.8100, lng: -73.9626, name: 'Morningside Heights' },
    'hudson yards': { lat: 40.7542, lng: -74.0023, name: 'Hudson Yards' },
    'battery park city': { lat: 40.7115, lng: -74.0154, name: 'Battery Park City' },
    'battery park': { lat: 40.7033, lng: -74.0170, name: 'Battery Park' },
    'stuyvesant town': { lat: 40.7318, lng: -73.9779, name: 'Stuyvesant Town' },
    "kip's bay": { lat: 40.7425, lng: -73.9801, name: "Kip's Bay" },
    'koreatown': { lat: 40.7479, lng: -73.9870, name: 'Koreatown' },
    'two bridges': { lat: 40.7108, lng: -73.9942, name: 'Two Bridges' },
    'meatpacking': { lat: 40.7408, lng: -74.0078, name: 'Meatpacking District' },
    'meatpacking district': { lat: 40.7408, lng: -74.0078, name: 'Meatpacking District' },
    'nyu': { lat: 40.7295, lng: -73.9965, name: 'NYU' },
    'columbia': { lat: 40.8075, lng: -73.9626, name: 'Columbia University' },
    'downtown': { lat: 40.7128, lng: -74.0060, name: 'Downtown Manhattan' },
    'uptown': { lat: 40.8100, lng: -73.9553, name: 'Uptown Manhattan' },
    'columbus circle': { lat: 40.7681, lng: -73.9819, name: 'Columbus Circle' },
    'lincoln center': { lat: 40.7725, lng: -73.9835, name: 'Lincoln Center' },
    'world trade center': { lat: 40.7127, lng: -74.0134, name: 'World Trade Center' },
    'wtc': { lat: 40.7127, lng: -74.0134, name: 'World Trade Center' },
    'penn station': { lat: 40.7506, lng: -73.9935, name: 'Penn Station' },
    'grand central': { lat: 40.7527, lng: -73.9772, name: 'Grand Central Terminal' },
  };

  // Try to resolve a geocode query from the local neighborhood lookup.
  // Strips common suffixes like ", Manhattan, New York" before matching.
  function resolveNeighborhoodLocally(query: string): { lat: number; lng: number; name: string } | null {
    const cleaned = query
      .replace(/,?\s*(manhattan|new york|ny|nyc|new york city|united states|usa|us)\b/gi, '')
      .trim()
      .toLowerCase();
    return MANHATTAN_NEIGHBORHOODS[cleaned] ?? null;
  }

  // Wrap geocode to validate coordinates are within Manhattan
  const wrappedGeocode = optimizedTools.geocode
    ? {
        ...optimizedTools.geocode,
        execute: async (args: Record<string, unknown>) => {
          // Expand NYC slang/abbreviations in the query before geocoding
          const queryKey = 'address' in args ? 'address' : 'query' in args ? 'query' : 'location' in args ? 'location' : null;
          if (queryKey && typeof args[queryKey] === 'string') {
            const original = args[queryKey] as string;
            args = { ...args, [queryKey]: expandNYCSlang(original) };
            if (args[queryKey] !== original) {
              console.log(`📍 geocode: expanded "${original}" → "${args[queryKey]}"`);
            }
          }

          // Check local neighborhood lookup first — the MCP geocoder often
          // returns Manhattan's centroid for neighborhood-level queries.
          const rawQuery = (queryKey ? args[queryKey] : null) as string | null;
          if (rawQuery) {
            const local = resolveNeighborhoodLocally(rawQuery);
            if (local) {
              console.log(`📍 geocode: resolved locally "${rawQuery}" → ${local.name} (${local.lat}, ${local.lng})`);
              return {
                structuredContent: {
                  query: rawQuery,
                  results: [{
                    formattedAddress: `${local.name}, Manhattan, New York, NY`,
                    latitude: local.lat,
                    longitude: local.lng,
                    confidence: 1.0,
                    country: "United States",
                    state: "New York",
                    city: "New York",
                    postcode: null,
                  }],
                  resultCount: 1,
                },
                isError: false,
              };
            }
          }

          // Call original geocode for specific addresses / landmarks
          const result = await (optimizedTools.geocode as any).execute(args);

          // Log the full result to understand its structure
          console.log("🔍 geocode result:", JSON.stringify(result, null, 2));

          if (!result || (result as any).isError) {
            return result;
          }

          // Extract lat/lng from result (check various possible response formats)
          // MCP tools return in structuredContent.results[0].latitude/longitude
          const lat = Number(
            (result as any).structuredContent?.results?.[0]?.latitude ??
            (result as any).structuredContent?.results?.[0]?.lat ??
            (result as any).lat ??
            (result as any).latitude ??
            (result as any).results?.[0]?.lat ??
            (result as any).results?.[0]?.latitude ??
            (result as any).coordinates?.lat ??
            (result as any).coordinates?.latitude ??
            (result as any).geometry?.coordinates?.[1] ?? // GeoJSON format [lng, lat]
            (result as any).features?.[0]?.geometry?.coordinates?.[1]
          );
          const lng = Number(
            (result as any).structuredContent?.results?.[0]?.longitude ??
            (result as any).structuredContent?.results?.[0]?.lng ??
            (result as any).structuredContent?.results?.[0]?.lon ??
            (result as any).lng ??
            (result as any).lon ??
            (result as any).longitude ??
            (result as any).results?.[0]?.lng ??
            (result as any).results?.[0]?.lon ??
            (result as any).results?.[0]?.longitude ??
            (result as any).coordinates?.lng ??
            (result as any).coordinates?.lon ??
            (result as any).coordinates?.longitude ??
            (result as any).geometry?.coordinates?.[0] ?? // GeoJSON format [lng, lat]
            (result as any).features?.[0]?.geometry?.coordinates?.[0]
          );

          // Also extract postcode for additional validation
          const postcode = (result as any).structuredContent?.results?.[0]?.postcode ?? "";
          const formattedAddress = (result as any).structuredContent?.results?.[0]?.formattedAddress ?? "";

          console.log(`🔍 Extracted coordinates: lat=${lat}, lng=${lng}, postcode=${postcode}`);

          // Check for non-Manhattan indicators
          // Manhattan postcodes: 100xx, 101xx, 102xx
          const isManhattanPostcode = /^10[012]\d{2}$/.test(postcode);
          const hasBrooklynInAddress = /brooklyn/i.test(formattedAddress);
          const hasQueensInAddress = /queens/i.test(formattedAddress);
          const hasBronxInAddress = /bronx/i.test(formattedAddress);
          const hasStatenIslandInAddress = /staten\s*island/i.test(formattedAddress);

          // Brooklyn postcodes: 112xx, Queens: 11xxx (not 100-102), Bronx: 104xx, Staten Island: 103xx
          const isBrooklynPostcode = /^112\d{2}$/.test(postcode);
          const isQueensPostcode = /^11[3-9]\d{2}$/.test(postcode);
          const isBronxPostcode = /^104\d{2}$/.test(postcode);
          const isStatenIslandPostcode = /^103\d{2}$/.test(postcode);

          const isOutsideManhattanByPostcode = isBrooklynPostcode || isQueensPostcode || isBronxPostcode || isStatenIslandPostcode;
          const isOutsideManhattanByAddress = hasBrooklynInAddress || hasQueensInAddress || hasBronxInAddress || hasStatenIslandInAddress;

          if (!isNaN(lat) && !isNaN(lng)) {
            const outsideManhattanByBounds =
              lat < MANHATTAN_BOUNDS.minLat ||
              lat > MANHATTAN_BOUNDS.maxLat ||
              lng < MANHATTAN_BOUNDS.minLng ||
              lng > MANHATTAN_BOUNDS.maxLng;

            const outsideManhattan = outsideManhattanByBounds || isOutsideManhattanByPostcode || isOutsideManhattanByAddress;

            if (outsideManhattan) {
              console.log(`⚠️ geocode: Location outside Manhattan - bounds: ${outsideManhattanByBounds}, postcode: ${isOutsideManhattanByPostcode} (${postcode}), address: ${isOutsideManhattanByAddress}`);
              return {
                isError: true,
                error: "Oops! That location is outside Manhattan. NYC Eats currently covers Manhattan only. If you're interested in helping expand coverage, leave a note and perhaps a coffee at buymeacoffee.com/atmikapai. Cheers!",
                outsideManhattan: true,
              };
            }
          }

          return result;
        },
      }
    : null;

  // Combine MCP tools with our custom tools
  // Note: We explicitly exclude search_documents from MCP and use our local semantic search instead
  const allTools = {
    // Selectively include MCP tools (exclude search_documents)
    ...(wrappedGeocode ? { geocode: wrappedGeocode } : {}),
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
      model: google("gemini-2.5-flash"), // Try 2.0 if 2.5 is rate limited
      temperature: 0.3, // Slightly less Deterministic responses
      messages: await convertToModelMessages(messages),
      tools: allTools,
      toolChoice: "auto", // auto 
      system: systemPrompt,
      stopWhen: stepCountIs(10),
      abortSignal: AbortSignal.timeout(55_000), // Under Vercel's 60s limit
      onStepFinish: (step) => {
        // Log full step info for debugging
        console.log(
          `🎯 Step: ${step.finishReason}${
            Array.isArray(step.toolCalls) && step.toolCalls.length
              ? ` | Tools: ${step.toolCalls.filter(Boolean).map((t) => t?.toolName ?? "unknown").join(", ")}`
              : ""
          }${step.text ? ` | Text: "${step.text.substring(0, 100)}..."` : ""}`
        );
        // Log if step has any error or unexpected content
        if ((step as any).error) {
          console.error("❌ Step error:", (step as any).error);
        }
        if ((step as any).response?.headers) {
          console.log("📋 Response headers:", JSON.stringify((step as any).response.headers));
        }
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

    // Check for Gemini rate limit error (429)
    const errorStr = error instanceof Error ? error.message : String(error);
    const isRateLimit = errorStr.includes("429") ||
      errorStr.includes("quota") ||
      errorStr.includes("RESOURCE_EXHAUSTED") ||
      errorStr.includes("rate limit");

    if (isRateLimit) {
      return c.json(
        { error: "RATE_LIMIT", message: "My buddy, Gemini, is exhausted. He's complaining about hitting API rate limits or something. Give us ~30 seconds to catch our breath and try again!" },
        429
      );
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
