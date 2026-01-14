import { Hono } from "hono";
import { cors } from "hono/cors";
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
import type { Restaurant } from "../src/types/restaurant";
import { GeometryCache } from "./utils/geometryOptimizer";
import { wrapToolsWithGeometryOptimization } from "./utils/toolWrapper";
import { env, getGoogleApiKey } from "./env";
import { safeParseChatRequest } from "./schemas/chat";

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
app.post("/chat", async (c) => {
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

  const { messages: rawMessages } = parseResult.data;
  console.log(`📨 Received ${rawMessages.length} messages from client`);

  // Normalize messages: ensure parts is always an array (AI SDK requirement)
  // Type assertion is safe here because we've validated the structure with Zod
  const messages = rawMessages.map((msg) => ({
    ...msg,
    parts: msg.parts ?? [], // Convert undefined to empty array
  })) as UIMessage[];

  const analysisId = env.MCP_ANALYSIS_ID;
  let mcpTools: ToolSet = {};
  let datasetContext = "";
  let mcpClient: Awaited<ReturnType<typeof createMCPClient>>;
  let sqlTables = "";
  let docCollections = "";
  let spatialReference = "";

  // Initialize geometry cache for this request
  const geometryCache = new GeometryCache();

  // 1. Connect and Fetch Tools/Resources (Let it fail if server is down)
  const transport = new StreamableHTTPClientTransport(
    new URL(env.MCP_SERVER_URL),
    {
      requestInit: {
        headers: { Authorization: `Bearer ${env.MCP_API_KEY}` },
      },
    }
  );

  mcpClient = await createMCPClient({ transport });
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
  const optimizedTools = wrapToolsWithGeometryOptimization(
    mcpTools,
    geometryCache
  );

  // Create a custom tool for displaying restaurant cards
  const displayRestaurantsTool = {
    description:
      "Render interactive restaurant cards in the chat UI. Call this ONLY after finding specific restaurants via search_documents or execute_sql. Pass the names or slugs of the restaurants you found.",
    inputSchema: z.object({
      restaurant_names: z
        .array(z.string())
        .describe(
          "List of restaurant names or slugs to display as cards, extracted from previous search results."
        ),
      query: z
        .string()
        .optional()
        .describe("The original search query (e.g., 'Italian restaurants')."),
    }),
    execute: async (params: { restaurant_names: string[]; query?: string }) => {
      const { restaurant_names, query } = params;
      try {
        console.log(
          `🍽️ displayRestaurants resolving cards for: ${JSON.stringify(
            restaurant_names
          )}`
        );

        const namesLower = restaurant_names.map((n) => n.toLowerCase());

        // Find restaurants matching the provided names/slugs in our local database
        const foundRestaurants = allRestaurants
          .filter((r) => {
            const rNameLower = r.name?.toLowerCase() || "";
            const rSlugLower = r.slug?.toLowerCase() || "";
            return namesLower.some(
              (name) =>
                rNameLower.includes(name) ||
                name.includes(rNameLower) ||
                rSlugLower === name
            );
          })
          // Sort to match the order provided by the LLM
          .sort((a, b) => {
            const aName = a.name.toLowerCase();
            const bName = b.name.toLowerCase();
            const aIndex = namesLower.findIndex(
              (n) => aName.includes(n) || n.includes(aName)
            );
            const bIndex = namesLower.findIndex(
              (n) => bName.includes(n) || n.includes(bName)
            );
            return aIndex - bIndex;
          });

        console.log(`✅ Resolved ${foundRestaurants.length} restaurant cards`);

        // Return results with clean data structure
        const restaurants: Restaurant[] = foundRestaurants
          .slice(0, 20)
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
            yelp_review_highlights: r.yelp_review_highlights || "",
            opentable_id: r.opentable_id || "",
            telephone: r.telephone || "",
            address: r.address || "",
            collections: r.collections || [],
          }));

        return {
          restaurants,
          count: restaurants.length,
          query: query || "",
        };
      } catch (error) {
        console.error("❌ Error in displayRestaurantsTool:", error);
        return {
          restaurants: [] as Restaurant[],
          count: 0,
          query: query || "",
          error: String(error),
        };
      }
    },
  };

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
  let toolInstructions = "";
  if (sqlTables && docCollections) {
    toolInstructions = `
- execute_sql: Use ONLY for SQL Tables. Wrap UUIDs in double quotes.
- search_documents: Use ONLY for Document Collections (for information gathering).
- displayRestaurants: Show restaurant cards to user after searches or queries.`;
  } else if (sqlTables) {
    toolInstructions = `
- execute_sql: Use for spatial DuckDB queries. Wrap UUIDs in double quotes.
- search_documents: NOT AVAILABLE. No document collections found.
- displayRestaurants: Show restaurant cards to user after searches or queries.`;
  } else if (docCollections) {
    toolInstructions = `
- execute_sql: NOT AVAILABLE. No SQL tables found. Use search_documents instead.
- search_documents: Use for restaurant lookups and guide info (information gathering).
- displayRestaurants: Show restaurant cards to user after searches or queries.`;
  }

  const systemPrompt = `You are Remy, the rat from Ratatouille, a restaurant concierge sommelier.
${datasetContext}
${spatialReference}

Available Tools for analysis "${analysisId}":${toolInstructions}
- geocode: Convert addresses. Always append ", New York City".
  * When users mention neighborhoods (e.g., "Greenwich Village", "Chelsea", "Williamsburg"), geocode the neighborhood name directly without asking for clarification. Use your best judgment for the neighborhood center.
  * Example: User says "show me restaurants near Greenwich Village" → geocode("Greenwich Village, New York City") - NO follow-up questions needed!
- get_isoline: Calculate reachable areas (isochrones).

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
2. Use execute_sql for precise spatial queries and search_documents for descriptive lookups.
3. You MUST use the displayRestaurants tool to show the restaurant cards to the user.
4. **GEO_REF IDs expire after each response**. Never reference IDs from previous messages. Always call get_isoline fresh when needed.
5. **NEVER** type out actual coordinates.
6. **When users mention neighborhoods, geocode them directly**. Don't ask clarifying questions about specific addresses within the neighborhood. Trust your judgment!
7. **NEVER mention technical details like GEO_REF IDs, table UUIDs, or internal tool mechanics to the user**. Keep your responses natural and conversational - the user doesn't need to know about the backend magic!
8. Be concise, charming, and follow the recipe!`;

  console.log("🔍 System prompt:", systemPrompt);

  // Combine MCP tools with our custom displayRestaurants tool
  const allTools = {
    ...optimizedTools,
    displayRestaurants: displayRestaurantsTool,
  };
  console.log("🛠️ All tools available:", Object.keys(allTools).join(", "));

  try {
    const result = streamText({
      model: google("gemini-2.5-flash"),
      messages: await convertToModelMessages(messages),
      tools: allTools,
      system: systemPrompt,
      stopWhen: stepCountIs(10),
      abortSignal: AbortSignal.timeout(120_000),
      onStepFinish: (step) => {
        console.log(
          `🎯 Step: ${step.finishReason}${
            step.toolCalls.length
              ? ` | Tools: ${step.toolCalls.map((t) => t.toolName).join(", ")}`
              : ""
          }`
        );
        step.toolCalls.forEach((tc) => {
          // Log tool arguments
          const args = "args" in tc ? tc.args : undefined;
          console.log(`   🛠️  ${tc.toolName}(${JSON.stringify(args)})`);
        });
        step.toolResults.forEach((tr) => {
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
        if (mcpClient) await mcpClient.close();
        console.log("✅ MCP client closed");
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error("❌ Fatal error in stream:", error);
    return c.json(
      { error: error instanceof Error ? error.message : String(error) },
      500
    );
  }
});

export default app;
