import {
  useState,
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useMemo,
} from "react";
import { asset } from "../utils/asset";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { intersectPolygons } from "../utils/geospatial";
import type { Restaurant } from "../types/restaurant";
import { API_CONFIG } from "../config/features";
import {
  useMap,
  type IsochroneLayer,
  type GeoJSONGeometry,
} from "../contexts/MapContext";
import { IsochroneMessage } from "./IsochroneMessage";
import RestaurantCard from "./RestaurantCard";
import RestaurantCarousel from "./RestaurantCarousel";
import type { UIMessagePart } from "ai";
import {
  type DynamicToolPart,
  type TextUIPart,
  type ToolInvocationPart,
  isDynamicToolPart,
  isTextPart,
  isToolInvocationPart,
  hasDynamicToolOutput,
  extractToolResult,
  type SqlQueryResult,
  type IsolineResult,
  type SearchDocumentsResult,
} from "../types/ai-message";
import "./ChatInterface.css";

// Google Analytics gtag declaration
declare function gtag(command: 'event', eventName: string, eventParams?: Record<string, unknown>): void;

// Classify query type for analytics
const classifyQuery = (query: string): string => {
  const q = query.toLowerCase();
  if (/\b(near|within|walk|walking|transit|subway|min|minute|between|midpoint)\b/.test(q)) return 'location';
  if (/\b(michelin|award|star|top 100|bib gourmand|nyt)\b/.test(q)) return 'awards';
  if (/\b(cozy|romantic|date|vibe|trendy|quiet|lively|rooftop|outdoor|ambiance)\b/.test(q)) return 'vibes';
  if (/\b(vegan|vegetarian|gluten|dietary|kosher|halal)\b/.test(q)) return 'dietary';
  if (/\b(italian|japanese|korean|chinese|mexican|french|indian|thai|mediterranean|american|sushi|ramen)\b/.test(q)) return 'cuisine';
  if (/\b(cheap|\$|affordable|splurge|fancy|budget|expensive)\b/.test(q)) return 'price';
  if (/\b(more|another|other options|else|different)\b/.test(q)) return 'more_results';
  if (/\b(restaurant week|prix fixe|rw)\b/.test(q)) return 'restaurant_week';
  return 'general';
};

// Isochrone layer styling
const ISOCHRONE_COLORS = {
  fill: "#B3A0F0",   // Electric purple
  stroke: "#31004a", // Deeper purple for outline
};

interface Message {
  role: "user" | "assistant";
  content: string;
  type?: "text" | "restaurant_card";
  restaurant?: Restaurant;
}

// Expose methods to parent component
export interface ChatInterfaceHandle {
  addRestaurantCard: (restaurant: Restaurant) => void;
}

/**
 * Computes aggregate metadata from restaurant array for intelligent summaries
 * Performance: O(n) single pass, ~5-10ms for 628 restaurants
 * NOTE: Currently unused but kept for potential future use
 */
// @ts-expect-error - Unused function kept for potential future use
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function computeResultMetadata(restaurants: Restaurant[]) {
  if (restaurants.length === 0) {
    return {
      total_count: 0,
      message: "No restaurants match your current filters.",
    };
  }

  const metadata: Record<string, any> = {
    total_count: restaurants.length,
    cuisine_breakdown: {} as Record<string, number>,
    top_cuisines: [] as string[],
    borough_breakdown: {} as Record<string, number>,
    top_neighborhoods: [] as string[],
    price_breakdown: { $: 0, $$: 0, $$$: 0, $$$$: 0 },
    avg_rating: 0,
    rating_range: [5, 0] as [number, number],
    michelin_count: 0,
    michelin_types: [] as string[],
    nyt_count: 0,
    collections_present: [] as string[],
    has_awards: false,
  };

  let totalRating = 0;
  let ratingCount = 0;
  const neighborhoodCounts: Record<string, number> = {};
  const collectionSet = new Set<string>();
  const michelinSet = new Set<string>();

  // Single pass through restaurants
  restaurants.forEach((r) => {
    // Cuisine
    if (r.cuisine) {
      metadata.cuisine_breakdown[r.cuisine] =
        (metadata.cuisine_breakdown[r.cuisine] || 0) + 1;
    }

    // Borough
    if (r.borough) {
      metadata.borough_breakdown[r.borough] =
        (metadata.borough_breakdown[r.borough] || 0) + 1;
    }

    // Neighborhood
    if (r.neighborhood) {
      neighborhoodCounts[r.neighborhood] =
        (neighborhoodCounts[r.neighborhood] || 0) + 1;
    }

    // Price
    if (r.price && r.price in metadata.price_breakdown) {
      metadata.price_breakdown[
        r.price as keyof typeof metadata.price_breakdown
      ]++;
    }

    // Rating
    if (r.yelp_rating && r.yelp_rating > 0) {
      totalRating += r.yelp_rating;
      ratingCount++;
      metadata.rating_range[0] = Math.min(
        metadata.rating_range[0],
        r.yelp_rating
      );
      metadata.rating_range[1] = Math.max(
        metadata.rating_range[1],
        r.yelp_rating
      );
    }

    // Awards
    if (r.michelin_award) {
      metadata.michelin_count++;
      michelinSet.add(r.michelin_award);
      metadata.has_awards = true;
    }

    if (r.nyttop100_rank) {
      metadata.nyt_count++;
      metadata.has_awards = true;
    }

    // Collections
    r.collections?.forEach((c) => collectionSet.add(c));
  });

  // Compute derived fields
  metadata.avg_rating =
    ratingCount > 0 ? Math.round((totalRating / ratingCount) * 10) / 10 : 0;

  // Top 3 cuisines
  metadata.top_cuisines = Object.entries(metadata.cuisine_breakdown)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 3)
    .map(([cuisine]) => cuisine);

  // Top 3 neighborhoods
  metadata.top_neighborhoods = Object.entries(neighborhoodCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([hood]) => hood);

  metadata.michelin_types = Array.from(michelinSet);
  metadata.collections_present = Array.from(collectionSet);

  return metadata;
}

interface ChatInterfaceProps {
  onRestaurantSelect: (restaurant: Restaurant) => void;
  onMapFocus?: (restaurantIds: string[]) => void;
  onToggleFavorite?: (restaurantName: string) => void;
}

// Kill-switch for the backend AI. When true, Remi shows CHATBOT_DOWN_MESSAGE
// instead of hitting the API. Set to true to take the chatbot offline again.
const CHATBOT_DOWN = false;
const CHATBOT_DOWN_MESSAGE =
  "Oof — my kitchen is temporarily closed! 🍳 My sous-chef (the AI behind the scenes) has stepped out, so I can't whisk up recommendations right now. We're working to get NYC Eats back up and running soon.<br><br>In the meantime, you can still explore the map, browse restaurant markers, and favorite your spots. Merci for your patience — please check back shortly!";

const ChatInterface = forwardRef<ChatInterfaceHandle, ChatInterfaceProps>(
  ({ onRestaurantSelect, onMapFocus, onToggleFavorite }, ref) => {
    // Use MapContext for data and state management
    const {
      allRestaurants,
      favorites,
      addLayers,
      isochroneRegionSlugs,
      clearAllLayers,
      filterPoolSlugs,
      setRestaurantWeekActive,
      addGeocodedMarker,
      clearGeocodedMarkers,
      geocodedMarkers,
      userLocation,
    } = useMap();

    // Random welcome message selection
    const welcomeMessages = [
      '<span class="welcome-greeting">I\'m Remi!</span><br>Let\'s help you find the best restaurants and 2026 Restaurant Week deals:',
    ];

    // Quick-start suggestions - clicking these triggers Remi to ask a guiding question
    const suggestions = [
      {
        label: "By Area",
        type: "guided" as const,
        remiResponse: "<strong>Where are you?</strong> Tell me how far you're willing to travel, and I can recommend restaurants within your vicinity. \n\n*e.g. I'm by Soho. I'd like to find happy hour spots within 10 min walk from me.*",
        example: "I'm by Soho. I'd like to find happy hour spots within 10 min walk from me.",
      },
      {
        label: "By Midpoint",
        type: "guided" as const,
        remiResponse:
          "<strong>Meeting up with a friend?</strong> Tell me where you both are, and I'll find restaurants in between! \n\n*e.g. I'm by AMC Times Square, and my friend is at One Manhattan West. We can travel 15 minutes by subway. Find spots between us, Remi.*",
        example: "I'm by AMC Times Square, and my friend is at One Manhattan West. We can travel 15 minutes by subway. Find spots between us, Remi.",
      },
      {
        label: "By Vibes",
        type: "guided" as const,
        remiResponse: "<strong>Going for a vibe?</strong> I can find:\n\n• Happy hour spots\n• Cozy date night places\n• Vegan-friendly Restaurant Week deals\n\n*e.g. Find me cozy date night spots, Remi.*",
        example: "Find me cozy date night spots, Remi.",
      },
    ];

    const test = [
      // Location-based (isochrone)
      "I'm in Soho, hunting for spots I can reach in under 15 mins by subway. What's on the menu, Remi?",
      "Any places within a 15 min subway of West Village?",
      "What's near Grand Central? I can walk 10 minutes.",
      "Show me restaurants within 20 min cycling from Chelsea Market.",

      // Between two locations (intersection)
      "My friend is in Midtown, I'm in Murray Hill — what's some restaurants in between us within a short 10 min transit?",
      "I'm by AMC Times Square, and my friend is at One Manhattan West. We are willing to travel 15 minutes walking. Find spots between us, Remi.",
      "Find spots between Union Square and Gramercy, 10 min walk each.",

      // Vibes & ambiance (semantic search)
      "Remi, give me couple places that are good for date night.",
      "Remi, find me a couple restaurants that are modest and cozy.",
      "Remi, find me hole in the wall restaurants, and tell me what's your definition for it.",
      "Looking for somewhere trendy and Instagram-worthy.",
      "I need a quiet spot for a business dinner.",
      "Where can I find a lively atmosphere with great cocktails?",
      "Anything good for big events?",

      // Location + vibes combo
      "Remi, show me happy hour spots in Soho. Willing to travel 10 mins by subway.",
      "Cozy date spots within 15 min walk of Washington Square Park.",
      "Romantic restaurants near Lincoln Center, 10 min walking.",

      // Specific restaurant queries
      "Show me Carbone.",
      "Where is Gramercy Tavern?",
      "Tell me about Le Bernardin.",
      "What's the deal with Hangawi?",

      // Cuisine queries
      "Show me Italian restaurants.",
      "Any good Korean spots?",
      "I'm craving Japanese — what do you have?",
      "Mediterranean places in the East Village.",
      "Best Thai food in Midtown?",

      // Award winners
      "Show me Michelin star restaurants.",
      "What are the NYT Top 100 picks?",
      "Bib Gourmand spots near me — I'm at Penn Station, 15 min walk.",
      "Any award-winning Italian places?",

      // Dietary & preferences (semantic)
      "Vegetarian-friendly spots, please.",
      "Where can I find good vegan options?",
      "Gluten-free friendly restaurants in Lower East Side.",

      // Price-based
      "Cheap eats in Chinatown.",
      "Splurge-worthy spots for a special occasion.",
      "Mid-range Italian near Union Square.",

      // Complex multi-criteria
      "Michelin restaurants within 10 min walk of Bryant Park.",
      "Cozy Italian spots with good wine near Greenwich Village, 15 min subway.",
      "Date night Japanese within 20 min of my place at 72nd and Broadway.",
      "Happy hour near FiDi with outdoor seating.",

      // Edge cases
      "What's good?",
      "Surprise me, Remi!",
      "I don't know what I want.",
      "Anything in Brooklyn?"
    ];


    // Tips shown while loading
    const tips = [
      
      "Tap a restaurant marker and hit the heart to favorite it.",
      "Your favorites appear as pink markers—toggle the heart filter to show only those.",
      "Award-winning spots—Michelin, Bib Gourmand, or New York Times Top 100—appear as red markers.",
      "Ask me for a specific vibe or ambiance (cozy, romantic, lively).",
      "Ask me for the best ramen or happy hour in town.",
      "Once an isochrone is drawn, refine results by price, Yelp rating, or cuisine in the filter bar.",
      "Isochrone is a map boundary showing how far you can travel within a set time.",
      "The current restaurant pool is limited to NYC Restaurant Week within Manhattan.",
      "Tap on a restaurant for reviews, socials, and more.",
      "Isochrones support walking, biking, transit, or driving—just tell me your preferred mode.",
      "Use the '500+ Reviews' in filter bar to find crowd-tested favorites.",
      "Ask me to find restaurants between two places—just give two addresses and travel times!",
      "Enjoying NYC Eats? Buy my creator a <a href=\"https://buymeacoffee.com/atmikapai\" target=\"_blank\" rel=\"noopener noreferrer\" style=\"color: #FF69B4; text-decoration: underline;\">coffee</a>. Cheers!",
    ];

    

    // Initialize with welcome message
    const [initialMessage] = useState(() => {
      // Select welcome message once to ensure consistency
      const selectedMessage =
        welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)];

      return {
        id: "welcome",
        role: "assistant" as const,
        content: selectedMessage,
        createdAt: new Date(),
        parts: [
          {
            type: "text" as const,
            text: selectedMessage,
          },
        ],
      };
    });

    // Use AI SDK's useChat hook for streaming
    // Use centralized API config for chat endpoint
    const API_ENDPOINT = API_CONFIG.CHAT_URL;

    useEffect(() => {
      
    }, []);

    // Store filterPoolSlugs in a ref so transport can access current value
    const filterPoolRef = useRef<string[]>([]);
    useEffect(() => {
      filterPoolRef.current = filterPoolSlugs;

    }, [filterPoolSlugs]);

    // Store userLocation in a ref so transport can access current value
    const userLocationRef = useRef<{ latitude: number; longitude: number } | null>(null);
    useEffect(() => {
      userLocationRef.current = userLocation;
    }, [userLocation]);

    // Custom transport that injects filterPool into requests
    const transport = useMemo(
      () =>
        new DefaultChatTransport({
          api: API_ENDPOINT,
          fetch: async (url, options) => {
            // Parse the original body and inject filterPool
            const originalBody = options?.body ? JSON.parse(options.body as string) : {};
            const enhancedBody = {
              ...originalBody,
              context: {
                ...originalBody.context,
                filterPool: filterPoolRef.current,
                userLocation: userLocationRef.current,
              },
            };

            

            return fetch(url, {
              ...options,
              body: JSON.stringify(enhancedBody),
            });
          },
        }),
      [API_ENDPOINT]
    );

    const {
      messages: aiMessages,
      sendMessage,
      status,
      setMessages,
    } = useChat({
      transport,
      id: "nyc-restaurant-chat",
      onError: (error) => {
        console.error("Chat error:", error);
        // Check if it's a rate limit error
        const errorStr = error?.message || String(error);
        const isRateLimit = errorStr.includes("429") ||
          errorStr.includes("RATE_LIMIT") ||
          errorStr.includes("quota") ||
          errorStr.includes("rate limit");

        const errorContent = isRateLimit
          ? "Wheeew, we've been busy! My buddy, Gemini, is exhausted. He's complaining about hitting API rate limits or something. Give us ~30 seconds to catch our breath and try again!"
          : "Something went wrong while I was whisking through your request. It seems my whiskers got tangled! <br><br> Could you try rephrasing or asking again?";

        const errorMessage = {
          id: `error-${Date.now()}`,
          role: "assistant" as const,
          content: errorContent,
          createdAt: new Date(),
          parts: [],
        };
        setMessages([...aiMessages, errorMessage]);
      },
      onFinish: (message) => {
        console.log("✅ Chat finished:", message);
      },
    });

    // Track processed tool calls to avoid duplicates
    const processedToolCallIds = useRef<Set<string>>(new Set());
    const guidedExamplesRef = useRef<Map<string, string>>(new Map());

    const [input, setInput] = useState("");
    const [isListening, setIsListening] = useState(false);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);

    // Watch messages for new tool results
    useEffect(() => {
      if (aiMessages.length > 0) {
        console.log("✅ Triggering processToolResults()");
        processToolResults();
      } else {
        console.log("⏸️ Skipping processToolResults (no messages)");
      }
    }, [aiMessages]);

    // Manually seed messages on mount if empty
    useEffect(() => {
      if (aiMessages.length === 0) {
        
        setMessages([initialMessage]);
      }
    }, []); // Only run once on mount

    // Debug: Log messages
    useEffect(() => {
      
    }, [aiMessages]);

    const [currentTip, setCurrentTip] = useState("");
    const [customMessages, setCustomMessages] = useState<Message[]>([]); // For restaurant cards

    const lastMessageRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Auto-resize textarea based on content
    const autoResizeTextarea = () => {
      const textarea = inputRef.current;
      if (textarea) {
        // Reset height to auto to get the correct scrollHeight
        textarea.style.height = 'auto';
        const isMobile = window.innerWidth <= 768;
        const minHeight = 24; // Single line height
        const maxHeight = isMobile ? 90 : 120; // Mobile: ~3-4 lines, Desktop: ~4-5 lines
        const newHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
        textarea.style.height = `${newHeight}px`;
        // Only enable scrolling when at max height
        textarea.style.overflowY = newHeight >= maxHeight ? 'auto' : 'hidden';
      }
    };

    // Mobile drawer state - use context for coordination with FilterBar
    const { drawerHeight, setDrawerHeight } = useMap();
    const [isDragging, setIsDragging] = useState(false);
    const [dragStartY, setDragStartY] = useState(0);
    const [dragStartHeight, setDragStartHeight] = useState(30);
    const drawerRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);

    // Update CSS variable for drawer height (used by FloatingHeader)
    useEffect(() => {
      document.documentElement.style.setProperty('--drawer-height', `${drawerHeight}vh`);
    }, [drawerHeight]);

    const isLoading = status === "submitted" || status === "streaming";

    // Process tool results from AI SDK messages
    const processToolResults = () => {
      

      // Find NEW (unprocessed) isoline/isochrone parts from the LAST message only
      // This prevents processing the same parts multiple times and creating duplicate layers
      const lastMessage = aiMessages[aiMessages.length - 1];
      if (!lastMessage) return;

      // Find ALL isoline parts in the last message (processed or not)
      const allIsolineParts = (lastMessage.parts || []).filter(
        (p): p is DynamicToolPart =>
          isDynamicToolPart(p) &&
          (p.toolName === "get_isochrone" || p.toolName === "get_isoline")
      );

      // Find UNPROCESSED isoline parts with results
      const unprocessedIsolineParts = allIsolineParts.filter(
        (p) =>
          hasDynamicToolOutput(p) &&
          !processedToolCallIds.current.has(p.toolCallId)
      );

      

      // If there are multiple isoline CALLS in the message, wait for ALL to complete
      let isolineParts: DynamicToolPart[];

      if (allIsolineParts.length > 1) {
        const completedCount = allIsolineParts.filter((p) =>
          hasDynamicToolOutput(p)
        ).length;

        

        // Don't process until ALL isoline calls are complete
        if (completedCount < allIsolineParts.length) {
          console.log("⏸️ Waiting for all isoline calls to complete...");
          return;
        }

        console.log(
          `✅ All isoline calls complete, processing ${completedCount} polygons`
        );

        // For multi-isoline: use ALL completed parts to calculate intersection
        isolineParts = allIsolineParts.filter((p) => hasDynamicToolOutput(p));
      } else {
        // Single isoline: use only unprocessed parts
        isolineParts = unprocessedIsolineParts;
      }

      if (isolineParts.length > 0) {
        console.log(
          "🗺️ Isoline parts details:",
          isolineParts.map((p) => ({
            toolName: p.toolName,
            toolCallId: p.toolCallId,
            state: p.state,
            hasOutput: hasDynamicToolOutput(p),
            outputStructure: hasDynamicToolOutput(p)
              ? Object.keys(p.output as object)
              : [],
            result: hasDynamicToolOutput(p) ? extractToolResult(p) : undefined,
          }))
        );
      }

      // 1. Handle SQL results and other non-isoline tools
      let geocodeCountThisRender = 0;
      aiMessages.forEach((msg) => {
        if (!msg.parts) return;

        msg.parts.forEach((part) => {
          if (
            isDynamicToolPart(part) &&
            hasDynamicToolOutput(part) &&
            !processedToolCallIds.current.has(part.toolCallId)
          ) {
            const result = extractToolResult(part);

            try {
              // Handle SQL results
              if (part.toolName === "execute_sql") {
                processedToolCallIds.current.add(part.toolCallId);
                const sqlResult = result as SqlQueryResult;
                if (sqlResult.rows) {
                  const potentialRestaurants = sqlResult.rows.filter(
                    (row) => row.name && (row.cuisine || row.neighborhood)
                  );

                  if (potentialRestaurants.length > 0) {
                    const slugs = potentialRestaurants
                      .map((r) => r.slug)
                      .filter((slug): slug is string => Boolean(slug));
                    potentialRestaurants.forEach((r) => {
                      // Add restaurant card - cast is safe as SQL should return all fields
                      addRestaurantCard(r as unknown as Restaurant);
                    });
                    if (onMapFocus && slugs.length > 0) {
                      onMapFocus(slugs);
                    }
                  }
                }
                // Note: geojson from displayRestaurants is ignored -
                // isochrones are handled by get_isoline tool via MapContext
              }

              // Handle search_documents results - try to find matching restaurants to highlight
              if (part.toolName === "search_documents") {
                processedToolCallIds.current.add(part.toolCallId);
                const searchResult = result as SearchDocumentsResult;
                if (searchResult.chunks && Array.isArray(searchResult.chunks)) {
                  // Filter pool: if isochrone is active, only search for names within that area
                  // to prevent zooming out to other boroughs for common names
                  const searchPool =
                    isochroneRegionSlugs && isochroneRegionSlugs.length > 0
                      ? allRestaurants.filter((r) =>
                          isochroneRegionSlugs.includes(r.slug)
                        )
                      : allRestaurants;

                  const foundSlugs: string[] = [];
                  searchResult.chunks.forEach((chunk) => {
                    const text = (chunk.text || "").toLowerCase();
                    searchPool.forEach((r) => {
                      const name = r.name.toLowerCase();
                      // Strict matching: only match names > 3 chars to avoid false positives with words like "The", "In", etc.
                      if (name.length > 3 && text.includes(name)) {
                        if (!foundSlugs.includes(r.slug)) {
                          foundSlugs.push(r.slug);
                        }
                      }
                    });
                  });

                  if (foundSlugs.length > 0) {

                    if (onMapFocus) {
                      onMapFocus(foundSlugs);
                    }
                  }
                }
              }

              // Handle geocode results - drop a teardrop pin at the geocoded location
              // Colors match isochrone colors: person 1 = pink, person 2 = blue
              if (part.toolName === "geocode") {
                processedToolCallIds.current.add(part.toolCallId);
                const geocodeResult = result as {
                  query: string;
                  results: Array<{
                    latitude: number;
                    longitude: number;
                    formatted_address?: string;
                  }>;
                };
                if (geocodeResult.results && geocodeResult.results.length > 0) {
                  const firstResult = geocodeResult.results[0];
                  if (firstResult.latitude && firstResult.longitude) {
                    // Cycle characters using existing markers + ones added this render pass
                    const characterImages = [asset("/characters/collette.png"), asset("/characters/anton.png"), asset("/characters/skinner.png")];
                    const currentCount = geocodedMarkers.length + geocodeCountThisRender;
                    geocodeCountThisRender++;
                    const characterImage = characterImages[currentCount % characterImages.length];

                    addGeocodedMarker({
                      latitude: firstResult.latitude,
                      longitude: firstResult.longitude,
                      label: geocodeResult.query || firstResult.formatted_address || "Location",
                      color: ISOCHRONE_COLORS.fill,
                      characterImage,
                      messageId: msg.id, // Link to message for visibility toggling
                    });
                  }
                }
              }

            } catch (err) {
              console.error("❌ Error processing tool result:", err);
            }
          }

          // Handle local tools (type: "tool-{toolName}" format)
          // semantic_search_restaurants - highlight results as yellow markers on map
          if (
            part.type === "tool-semantic_search_restaurants" &&
            (part as any).state === "output-available" &&
            !processedToolCallIds.current.has((part as any).toolCallId)
          ) {
            processedToolCallIds.current.add((part as any).toolCallId);
            const output = (part as any).output;

            // Auto-activate Restaurant Week filter if detected
            if (output?.restaurantWeekDetected) {
              setRestaurantWeekActive(true);
            }
          }

        });
      });

      // 2. Handle Isochrone/Isoline results with "Between Us" support
      if (isolineParts.length > 0) {
        

        // Find newest isoline part that hasn't been processed yet
        const newIsolineParts = isolineParts.filter(
          (p) => !processedToolCallIds.current.has(p.toolCallId)
        );

        

        if (newIsolineParts.length > 0) {
          // Mark all as processed
          newIsolineParts.forEach((p) => {
            
            processedToolCallIds.current.add(p.toolCallId);
          });

          if (isolineParts.length > 1) {
            
            const messageId = lastMessage.id;
            const layers: IsochroneLayer[] = isolineParts
              .filter(
                (
                  p
                ): p is Extract<
                  DynamicToolPart,
                  { state: "output-available" }
                > => hasDynamicToolOutput(p)
              )
              .map((p, i) => {
                const res = extractToolResult(p) as IsolineResult;

                const geometry =
                  res.geojson || res.geometry || res.results?.[0]?.geojson;

                console.log(`📍 Creating layer ${i + 1}:`, {
                  id: `${messageId}-person-${i + 1}`,
                  hasGeometry: !!geometry,
                  geometryType:
                    geometry?.type || (geometry as any)?.geometry?.type,
                });

                return {
                  id: `${messageId}-person-${i + 1}`,
                  polygon: geometry as GeoJSONGeometry, // GeoJSON geometry from API
                  label: `Person ${i + 1}`,
                  color: ISOCHRONE_COLORS.fill,
                  strokeColor: ISOCHRONE_COLORS.stroke,
                  opacity: 0.2,
                };
              });

            console.log(
              `✅ Created ${layers.length} base layers:`,
              layers.map((l) => l.id)
            );

            // Calculate intersection for "Between Us"
            const polygons = layers.map((l) => l.polygon).filter(Boolean);
            console.log(
              `🔀 Attempting to intersect ${polygons.length} polygons`
            );

            if (polygons.length > 1) {
              const intersection = intersectPolygons(...polygons);

              if (intersection) {
                console.log(
                  "💎 Found overlap area! Adding intersection layer.",
                  {
                    intersectionType:
                      intersection.type || (intersection as any).geometry?.type,
                  }
                );
                layers.push({
                  id: `${messageId}-intersection`,
                  polygon: intersection as GeoJSONGeometry, // Result from Turf.js intersection
                  label: "Overlap",
                  color: ISOCHRONE_COLORS.fill,
                  strokeColor: ISOCHRONE_COLORS.stroke,
                  opacity: 0.4,
                });

                console.log(
                  `🗺️ Final layers array (${layers.length} total):`,
                  layers.map((l) => ({
                    id: l.id,
                    label: l.label,
                    color: l.color,
                  }))
                );

                console.log("🗺️ Using MapContext to add layers");
                addLayers(layers, messageId);
                // clearGeocodedMarkers(); // Keep center markers visible after isochrones render

                console.log(
                  `📌 Added ${layers.length} layers for message ${messageId}`
                );
              } else {
                console.warn("⚠️ No intersection found between polygons");
                // If no intersection, just show the layers
                console.log(
                  "🗺️ Using MapContext to add layers (no intersection)"
                );
                addLayers(layers, messageId);
                // clearGeocodedMarkers(); // Keep center markers visible after isochrones render

                console.log(
                  `📌 Added ${layers.length} layers for message ${messageId}`
                );
              }
            } else {
              console.warn(
                `⚠️ Only ${polygons.length} valid polygon(s), cannot calculate intersection`
              );
            }
          } else {
            // Single isoline - convert to multi-layer format for consistency
            console.log("🗺️ Processing single isoline result");
            const messageId = lastMessage.id;
            const singlePart = isolineParts[0];

            if (!hasDynamicToolOutput(singlePart)) {
              console.error("❌ Single isoline part doesn't have output");
              return;
            }

            const res = extractToolResult(singlePart) as IsolineResult;
            console.log(
              "📍 Single isoline raw result:",
              JSON.stringify(res).substring(0, 300)
            );

            const geometry =
              res.geojson || res.geometry || res.results?.[0]?.geojson;

            console.log(
              "📍 Extracted geometry:",
              geometry ? "✅ Found" : "❌ Missing"
            );

            if (geometry) {
              // Convert single isochrone to multi-layer format
              const layerId = `${messageId}-single-isochrone`;
              const singleLayer: IsochroneLayer = {
                id: layerId,
                polygon: geometry as GeoJSONGeometry, // GeoJSON geometry from API
                label: "Nearby",
                color: ISOCHRONE_COLORS.fill,
                strokeColor: ISOCHRONE_COLORS.stroke,
                opacity: 0.3,
              };

              console.log("🗺️ Using MapContext to add single layer");
              addLayers([singleLayer], messageId);
              // clearGeocodedMarkers(); // Keep center markers visible after isochrone renders

              console.log(
                `📌 Added single isochrone layer ${layerId} for message ${messageId}`
              );
            } else {
              console.error(
                "❌ Could not extract geometry from isoline result"
              );
            }
          }
        } else {
          console.log("ℹ️ All isoline parts have already been processed");
        }
      } else {
        console.log("ℹ️ No isoline parts found in current messages");
      }
    };

    const scrollToLastMessage = () => {
      // Scroll the messages container to the absolute bottom
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTo({
          top: messagesContainerRef.current.scrollHeight,
          behavior: "smooth",
        });
      }
    };

    // Scroll to show the top of the last message/card
    const scrollToLastCardTop = (offset: number = 40) => {
      if (messagesContainerRef.current) {
        const container = messagesContainerRef.current;
        // Select .chat-message elements (direct children of scroll container)
        const chatMessages = container.querySelectorAll('.chat-message');
        const lastChatMessage = chatMessages[chatMessages.length - 1] as HTMLElement;

        if (lastChatMessage) {
          // Scroll to position the top of the message at the top of the scroll area
          container.scrollTo({
            top: Math.max(0, lastChatMessage.offsetTop - offset),
            behavior: "smooth",
          });
        }
      }
    };

    // Scroll to the first text content in the last assistant message (skips tool statuses)
    const scrollToLastMessageText = () => {
      if (messagesContainerRef.current) {
        const container = messagesContainerRef.current;
        // Find the last assistant message
        const assistantMessages = container.querySelectorAll('.chat-message.assistant');
        const lastAssistantMessage = assistantMessages[assistantMessages.length - 1] as HTMLElement;

        if (lastAssistantMessage) {
          // Find the first .message-content within it (the actual text, not tool statuses)
          const firstTextContent = lastAssistantMessage.querySelector('.message-content') as HTMLElement;

          // Calculate position relative to scroll container using getBoundingClientRect
          const containerRect = container.getBoundingClientRect();
          const targetElement = firstTextContent || lastAssistantMessage;
          const targetRect = targetElement.getBoundingClientRect();

          // Calculate the scroll position: current scroll + target's position relative to container
          const scrollTarget = container.scrollTop + (targetRect.top - containerRect.top) - 40;

          container.scrollTo({
            top: Math.max(0, scrollTarget),
            behavior: "smooth",
          });
        }
      }
    };

    // Auto-scroll for new messages
    const prevMessagesLengthRef = useRef(aiMessages.length);
    const lastMessageContentRef = useRef<string>("");

    useEffect(() => {
      if (prevMessagesLengthRef.current === 0 && aiMessages.length > 0) {
        prevMessagesLengthRef.current = aiMessages.length;
        return;
      }

      if (aiMessages.length > prevMessagesLengthRef.current) {
        // Check for tool results whenever messages update
        processToolResults();

        // Scroll to show the top of the new message so user can read from the beginning
        setTimeout(() => scrollToLastCardTop(0), 100);
        prevMessagesLengthRef.current = aiMessages.length;
      }
    }, [aiMessages]);

    // Auto-scroll during streaming (when message content is being updated)
    useEffect(() => {
      if (aiMessages.length > 0) {
        const lastMessage = aiMessages[aiMessages.length - 1];
        let currentContent = "";

        // Extract content from the last message parts
        if (lastMessage.parts && Array.isArray(lastMessage.parts)) {
          currentContent = lastMessage.parts
            .filter((p): p is TextUIPart => isTextPart(p))
            .map((p) => p.text)
            .join("");
        }

        // If content has changed (streaming), scroll to Remi's text (skips tool statuses)
        if (currentContent !== lastMessageContentRef.current) {
          lastMessageContentRef.current = currentContent;
          scrollToLastMessageText();
        }
      }
    }, [aiMessages]);

    useEffect(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }, []);

    // Auto-resize textarea when input changes (handles voice input and other programmatic changes)
    useEffect(() => {
      autoResizeTextarea();
    }, [input]);

    // Scroll when custom messages (restaurant cards) are added
    // On mobile: scroll to show top of card; on desktop: scroll to bottom
    useEffect(() => {
      if (customMessages.length > 0) {
        const isMobile = window.innerWidth <= 768;
        // Use requestAnimationFrame to ensure DOM is fully updated and laid out
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (isMobile) {
              scrollToLastCardTop();
            } else {
              scrollToLastMessage();
            }
          });
        });
      }
    }, [customMessages]);

    // Show a tip when loading starts (mobile: 100%, desktop: 70%)
    useEffect(() => {
      if (isLoading) {
        const isMobile = window.innerWidth <= 768;
        const probability = isMobile ? 1.0 : 0.7;
        const shouldShowTip = Math.random() < probability;
        if (shouldShowTip) {
          const randomTip = tips[Math.floor(Math.random() * tips.length)];
          setCurrentTip(randomTip);
        } else {
          setCurrentTip("");
        }
      } else {
        // Clear tip when loading finishes
        setCurrentTip("");
      }
    }, [isLoading]);

    // Expose addRestaurantCard method to parent via ref
    const addRestaurantCard = (restaurant: Restaurant) => {
      // Don't add cards while Remi is responding
      if (isLoading) return;

      const isMobile = window.innerWidth <= 768;

      // Expand drawer to 45vh on mobile when marker is clicked (from 8vh or 30vh landing)
      if (isMobile && (drawerHeight === 8 || drawerHeight === 30)) {
        setDrawerHeight(55);
      }

      const card: Message = {
        role: "assistant",
        content: "",
        type: "restaurant_card",
        restaurant,
      };

      setCustomMessages((prev) => [...prev, card]);

      // Use double requestAnimationFrame to ensure layout is complete
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          // On mobile, scroll to show top of the card; on desktop, scroll to bottom
          if (isMobile) {
            scrollToLastCardTop();
          } else {
            scrollToLastMessage();
          }
        });
      });
    };

    // Function to remove a restaurant card by index
    const removeRestaurantCard = (index: number) => {
      setCustomMessages((prev) => prev.filter((_, i) => i !== index));
    };

    useImperativeHandle(ref, () => ({
      addRestaurantCard,
    }));

    // Convert markdown and URLs in text to HTML
    const linkifyText = (text: string): string => {
      let result = text;

      // Handle markdown list items
      result = result.replace(/^[\*\-]\s+(.+)$/gm, "• $1");

      // Bold: **text** → <strong>text</strong>
      result = result.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

      // Italic: *text* → <em>text</em>
      result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");

      // Markdown links: [text](url) → <a href="url">text</a>
      result = result.replace(
        /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer" style="color: #FF69B4; text-decoration: underline;">$1</a>'
      );

      // URLs with protocol (but not already inside href attributes)
      result = result.replace(
        /(?<!href=")(https?:\/\/[^\s<>"]+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer" style="color: #FF69B4; text-decoration: underline;">$1</a>'
      );

      // URLs without protocol
      result = result.replace(
        /(?<!href="|">)(?:^|\s)((?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s<]*)?)/g,
        (match, url, offset) => {
          const beforeMatch = result.substring(0, offset);
          if (beforeMatch.lastIndexOf("<a") > beforeMatch.lastIndexOf("</a>")) {
            return match;
          }
          return match.replace(
            url,
            `<a href="https://${url}" target="_blank" rel="noopener noreferrer" style="color: #FF69B4; text-decoration: underline;">${url}</a>`
          );
        }
      );

      return result;
    };

    // Mobile drawer touch handlers
    const handleTouchStart = (e: React.TouchEvent) => {
      setIsDragging(true);
      setDragStartY(e.touches[0].clientY);
      setDragStartHeight(drawerHeight);
    };

    const handleTouchMove = (e: React.TouchEvent) => {
      if (!isDragging) return;

      const currentY = e.touches[0].clientY;
      const deltaY = dragStartY - currentY;
      const viewportHeight = window.innerHeight;
      const deltaPercent = (deltaY / viewportHeight) * 100;

      const newHeight = dragStartHeight + deltaPercent;
      const clampedHeight = Math.max(8, Math.min(100, newHeight));

      if (clampedHeight < 20) {
        setDrawerHeight(8);
      } else if (clampedHeight < 42) {
        setDrawerHeight(30);
      } else {
        setDrawerHeight(55);
      }
    };

    const handleTouchEnd = () => {
      setIsDragging(false);
    };

    const handleSuggestionClick = (suggestionText: string) => {
      handleSend(suggestionText);
    };

    // Handle guided suggestions where Remi asks a question
    const handleGuidedSuggestion = (remiResponse: string, example?: string) => {
      // Clear restaurant cards when starting a new guided conversation
      setCustomMessages([]);

      // Expand drawer to 55vh on mobile (only from smaller states)
      const isMobile = window.innerWidth <= 768;
      if (isMobile && (drawerHeight === 8 || drawerHeight === 30)) {
        setDrawerHeight(55);
      }

      const msgId = `guided-${Date.now()}`;
      if (example) {
        guidedExamplesRef.current.set(msgId, example);
      }
      const guidedMessage = {
        id: msgId,
        role: "assistant" as const,
        content: remiResponse,
        createdAt: new Date(),
        parts: [
          {
            type: "text" as const,
            text: remiResponse,
          },
        ],
      };
      setMessages([...aiMessages, guidedMessage]);
    };

    const handleRestaurantSuggestionClick = (
      suggestionText: string,
      _slug: string
    ) => {
      handleSuggestionClick(suggestionText);
    };

    const handleSend = async (
      textOverride?: string | React.MouseEvent | unknown
    ) => {
      let userMessage =
        typeof textOverride === "string" ? textOverride : input.trim();

      if (!userMessage || isLoading) return;

      // Chatbot is temporarily offline (backend AI unavailable). Instead of
      // hitting the API, Remi acknowledges that he's out of the kitchen.
      if (CHATBOT_DOWN) {
        setInput("");
        const downMessage = {
          id: `down-${Date.now()}`,
          role: "assistant" as const,
          content: CHATBOT_DOWN_MESSAGE,
          createdAt: new Date(),
          parts: [{ type: "text" as const, text: CHATBOT_DOWN_MESSAGE }],
        };
        setMessages([...aiMessages, downMessage]);
        return;
      }

      // Dev shortcut: "/test" sends a random test prompt
      if (userMessage === "/test") {
        userMessage = test[Math.floor(Math.random() * test.length)];
      }

      // Track query in Google Analytics
      try {
        gtag('event', 'chat_query', {
          'event_category': 'chat',
          'query_type': classifyQuery(userMessage),
          'query_text': userMessage.substring(0, 100), // Truncate for GA limits
          'query_length': userMessage.length
        });
      } catch (e) {
        // Silently fail if gtag not available
        console.debug('GA tracking skipped:', e);
      }

      // Clear restaurant cards and geocoded pins when starting a new conversation turn
      setCustomMessages([]);
      clearGeocodedMarkers();

      setInput("");

      // Send message using AI SDK
      sendMessage({ text: userMessage });
    };

    // Voice input - uses Web Speech API on desktop, MediaRecorder on mobile
    const toggleListening = async () => {
      const isMobile = window.innerWidth <= 768 || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const useMediaRecorder = isMobile || !SpeechRecognition;

      // If already listening, stop
      if (isListening) {
        if (mediaRecorderRef.current) {
          mediaRecorderRef.current.stop();
        } else if (recognitionRef.current) {
          recognitionRef.current.stop();
        }
        return;
      }

      if (useMediaRecorder) {
        // Mobile: Use MediaRecorder + Gemini transcription
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

          // Detect supported mimeType (iOS doesn't support webm)
          const mimeTypes = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav'];
          let selectedMimeType = '';
          for (const type of mimeTypes) {
            if (MediaRecorder.isTypeSupported(type)) {
              selectedMimeType = type;
              break;
            }
          }

          const recorderOptions = selectedMimeType ? { mimeType: selectedMimeType } : undefined;
          const mediaRecorder = new MediaRecorder(stream, recorderOptions);
          const actualMimeType = mediaRecorder.mimeType || 'audio/webm';
          console.log('🎤 Using mimeType:', actualMimeType);

          mediaRecorderRef.current = mediaRecorder;
          audioChunksRef.current = [];

          mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              audioChunksRef.current.push(event.data);
            }
          };

          mediaRecorder.onstop = async () => {
            setIsListening(false);
            setIsTranscribing(true);

            // Stop all tracks
            stream.getTracks().forEach(track => track.stop());

            // Convert to base64 and send to backend
            const audioBlob = new Blob(audioChunksRef.current, { type: actualMimeType });
            console.log('🎤 Audio blob size:', audioBlob.size, 'bytes, type:', actualMimeType);

            if (audioBlob.size === 0) {
              console.error('🎤 No audio recorded');
              setIsTranscribing(false);
              mediaRecorderRef.current = null;
              return;
            }

            const reader = new FileReader();
            reader.onloadend = async () => {
              const base64Audio = (reader.result as string).split(',')[1];
              console.log('🎤 Sending to transcribe, base64 length:', base64Audio?.length);

              try {
                const response = await fetch(API_CONFIG.TRANSCRIBE_URL, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ audio: base64Audio, mimeType: actualMimeType }),
                });

                if (response.ok) {
                  const data = await response.json();
                  console.log('🎤 Transcription result:', data);
                  if (data.text) {
                    setInput(prev => prev ? `${prev} ${data.text}` : data.text);
                  }
                } else {
                  const errorText = await response.text();
                  console.error("Transcription failed:", response.status, errorText);
                }
              } catch (error) {
                console.error("Transcription error:", error);
              } finally {
                setIsTranscribing(false);
                mediaRecorderRef.current = null;
              }
            };
            reader.readAsDataURL(audioBlob);
          };

          mediaRecorder.onstart = () => {
            setIsListening(true);
          };

          mediaRecorder.start();
        } catch (error) {
          console.error("Microphone access denied:", error);
          setIsListening(false);
        }
      } else {
        // Desktop: Use Web Speech API (real-time)
        const recognition = new SpeechRecognition();
        recognitionRef.current = recognition;
        recognition.lang = 'en-US';
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onstart = () => setIsListening(true);
        recognition.onend = () => {
          setIsListening(false);
          recognitionRef.current = null;
        };
        recognition.onerror = (event) => {
          console.error("Speech recognition error:", event.error);
          setIsListening(false);
          recognitionRef.current = null;
        };
        recognition.onresult = (event) => {
          let finalTranscript = '';
          let interimTranscript = '';
          for (let i = 0; i < event.results.length; i++) {
            const result = event.results[i];
            if (result.isFinal) {
              finalTranscript += result[0].transcript;
            } else {
              interimTranscript += result[0].transcript;
            }
          }
          setInput(finalTranscript + interimTranscript);
        };

        recognition.start();
      }
    };


    // Combine AI messages with custom messages (restaurant cards)
    // Simple approach: AI messages first, then restaurant cards at the end
    const allMessages = useMemo(() => {
      // Convert AI SDK messages to our Message format
      const convertedAiMessages = aiMessages.map((msg) => {
        let textContent = "";

        // Extract text content from message parts
        if (msg.parts && Array.isArray(msg.parts) && msg.parts.length > 0) {
          textContent = msg.parts
            .filter((p): p is TextUIPart => isTextPart(p))
            .map((p) => p.text)
            .join("\n\n");
        }

        return {
          id: msg.id,
          role: msg.role as "user" | "assistant",
          content: textContent,
          parts: msg.parts || [],
          type: "text" as const,
        };
      });

      // Restaurant cards always appear at the end
      return [...convertedAiMessages, ...customMessages] as (Message & {
        id?: string;
        parts?: UIMessagePart<any, any>[];
      })[];
    }, [aiMessages, customMessages]);

    // Expand drawer to 45vh after first message on mobile
    useEffect(() => {
      const isMobile = window.innerWidth <= 768;
      const hasUserMessage = allMessages.some(msg => msg.role === 'user');
      if (isMobile && hasUserMessage && drawerHeight === 30) {
        setDrawerHeight(55);
      }
    }, [allMessages, drawerHeight, setDrawerHeight]);

    const isLastMessageAssistant =
      allMessages.length > 0 &&
      allMessages[allMessages.length - 1].role === "assistant";
    const isLastMessageRestaurantCard =
      allMessages.length > 0 &&
      allMessages[allMessages.length - 1].type === "restaurant_card";
    const canMergeLoading =
      isLoading && isLastMessageAssistant && !isLastMessageRestaurantCard;

    return (
      <div className="chat-interface">
        <div ref={drawerRef} className={`chat-bubble drawer-${drawerHeight}`}>
          {/* Drag handle - mobile only */}
          <div
            className="drawer-handle"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <div className="drawer-handle-bar"></div>
          </div>

          {/* Collapsed header */}
          <div
            className="drawer-collapsed-header"
            onClick={() => setDrawerHeight(55)}
          >
            <img
              src={asset("/remi_transparent.png")}
              alt="Remi"
              className="drawer-collapsed-logo"
            />
            <span className="drawer-collapsed-text">Chat with Remi</span>
          </div>

          {/* Messages */}
          <div ref={messagesContainerRef} className="chat-messages">
            {allMessages.map((msg, idx) => {
              // Skip restaurant_card messages - they're rendered as a carousel below
              if (msg.type === "restaurant_card" && msg.restaurant) {
                return null;
              }

              const isLastMessage = idx === allMessages.length - 1;

              return (
                <div
                  key={idx}
                  className={`chat-message ${msg.role}`}
                  ref={isLastMessage ? lastMessageRef : null}
                >
                  {msg.role === "assistant" ? (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "8px",
                          width: "100%",
                        }}
                      >
                        <div className="message-bubble">
                          <div className="message-avatar-inside desktop-only">
                            <img src={asset("/remi.png")} alt="remi" />
                          </div>
                          <div className="message-avatar-mobile mobile-only">
                            <img src={asset("/remi.png")} alt="remi" />
                          </div>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: "8px",
                              flex: 1,
                            }}
                          >
                            {msg.parts && msg.parts.length > 0 ? (
                              <>
                                {(() => {
                                  // Track tool occurrences for varied messages
                                  const toolCounts: Record<string, number> = {};

                                  // Sort parts: tool results (cards) come last, everything else maintains original order
                                  const sortedParts = [...msg.parts].sort((a, b) => {
                                    const getPriority = (part: typeof a) => {
                                      if (isTextPart(part) || isToolInvocationPart(part) || isDynamicToolPart(part)) return 0;
                                      return 1; // Tool results (cards) last
                                    };
                                    return getPriority(a) - getPriority(b);
                                  });

                                  // Deduplicate consecutive text parts with same content (AI SDK streaming artifact)
                                  const seenTextContent = new Set<string>();
                                  const deduplicatedParts = sortedParts.filter((part) => {
                                    if (isTextPart(part)) {
                                      const text = part.text.trim();
                                      if (seenTextContent.has(text)) {
                                        return false; // Skip duplicate
                                      }
                                      seenTextContent.add(text);
                                    }
                                    return true;
                                  });

                                  // Hide tool statuses when loading completes (same as tips)
                                  const shouldHideToolStatuses = !isLoading || !isLastMessage;

                                  return deduplicatedParts.map((part, pIdx: number) => {
                                  if (isTextPart(part)) {
                                    const tryItExample = guidedExamplesRef.current.get(msg.id);
                                    return (
                                      <div key={pIdx}>
                                        <div
                                          className="message-content"
                                          dangerouslySetInnerHTML={{
                                            __html: linkifyText(part.text),
                                          }}
                                        />
                                        {tryItExample && (
                                          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                            <button
                                              className="try-it-button"
                                              onClick={() => handleSend(tryItExample)}
                                            >
                                              Test it↩
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  } else if (
                                    isToolInvocationPart(part) ||
                                    isDynamicToolPart(part)
                                  ) {
                                    // Hide tool statuses when loading completes (same trigger as tips)
                                    if (shouldHideToolStatuses) {
                                      return null;
                                    }

                                    const isPending =
                                      isToolInvocationPart(part);
                                    let statusText = "";

                                    const toolName = isDynamicToolPart(part)
                                      ? part.toolName
                                      : (part as ToolInvocationPart).toolName;

                                    // Track occurrence count for this tool
                                    const toolKey = toolName === "get_isoline" ? "get_isochrone" : toolName;
                                    toolCounts[toolKey] = (toolCounts[toolKey] || 0) + 1;
                                    const occurrenceNum = toolCounts[toolKey];

                                    // Varied messages for geocode
                                    const geocodeDoneMessages = [
                                      "My friends in the subway helped me figure out the coordinates!",
                                      "Found the second spot too!",
                                      "And there's the next location!",
                                    ];

                                    // Varied messages for isochrone
                                    const isochroneDoneMessages = [
                                      "We're about to map!",
                                      "Mapping the second isochrone too!",
                                      "All areas are about to map!",
                                    ];

                                    // Varied messages for execute_sql
                                    const sqlDoneMessages = [
                                      "Perusing Yelp and Reddit Reviews...",
                                      "Checking what the rats are raving about...",
                                      "Consulting Bourdain's Kitchen Confidential...",
                                      "Taking a look at Michelin Guide...",
                                    ];

                                    if (toolName === "execute_sql") {
                                      statusText = isPending
                                        ? "I'm scurrying through the database..."
                                        : sqlDoneMessages[Math.min(occurrenceNum - 1, sqlDoneMessages.length - 1)];
                                    } else if (
                                      toolName === "get_isochrone" ||
                                      toolName === "get_isoline"
                                    ) {
                                      statusText = isPending
                                        ? "My friends in the subway have helped me map NYC pretty accurately..."
                                        : isochroneDoneMessages[Math.min(occurrenceNum - 1, isochroneDoneMessages.length - 1)];
                                    } else if (toolName === "geocode") {
                                      statusText = isPending
                                        ? "I'm locating the spot on the map..."
                                        : geocodeDoneMessages[Math.min(occurrenceNum - 1, geocodeDoneMessages.length - 1)];
                                    } else if (
                                      toolName === "search_documents"
                                    ) {
                                      statusText = isPending
                                        ? "I'm leafing through my recipe books..."
                                        : "I've found some delectable spots!";
                                    } else if (
                                      toolName === "displayRestaurants"
                                    ) {
                                      statusText = isPending
                                        ? "I'm plating your recommendations..."
                                        : "Bon appétit! Here are your options:";
                                    } else if (
                                      toolName === "lookup_restaurant"
                                    ) {
                                      statusText = isPending
                                        ? "I'm looking up that restaurant..."
                                        : "Found it! Here's what I know:";
                                    } else {
                                      statusText = isPending
                                        ? `I'm using my ${toolName} trick...`
                                        : `The ${toolName} is served!`;
                                    }

                                    return (
                                      <div
                                        key={pIdx}
                                        className="tool-status interlined-tool-status"
                                      >
                                        {isPending && (
                                          <span className="tool-spinner"></span>
                                        )}
                                        {!isPending && (
                                          <span className="tool-done">✓</span>
                                        )}
                                        {statusText}
                                      </div>
                                    );
                                  } else if (
                                    part.type === "tool-displayRestaurants" ||
                                    part.type === "tool-lookup_restaurant"
                                  ) {
                                    // Generative UI: Render restaurant cards
                                    switch (part.state) {
                                      case "input-available":
                                        return (
                                          <div
                                            key={pIdx}
                                            className="tool-loading"
                                          >
                                            🍽️ {part.type === "tool-lookup_restaurant" ? "Looking up restaurant..." : "Plating your recommendations..."}
                                          </div>
                                        );

                                      case "output-available":
                                        // Delay rendering cards until streaming ends (only for current message)
                                        if (isLoading && isLastMessage) {
                                          return null;
                                        }

                                        const displayRestaurantsPool =
                                          part.output?.restaurants || [];

                                        if (displayRestaurantsPool.length === 0) {
                                          if (!part.output?.error) {
                                            console.log(
                                              `[ChatInterface] No restaurants found:`,
                                              part.type === "tool-lookup_restaurant"
                                                ? `lookup for "${part.output?.restaurant_name || 'unknown'}"`
                                                : `search for "${part.output?.query || 'unknown'}"`
                                            );
                                          }
                                          return null;
                                        }

                                        return (
                                          <div
                                            key={pIdx}
                                            className="restaurant-cards-container"
                                          >
                                            <RestaurantCarousel
                                              restaurants={displayRestaurantsPool}
                                              onRestaurantSelect={(restaurant) => {
                                                if (onRestaurantSelect) {
                                                  onRestaurantSelect(restaurant);
                                                }
                                                // Expand drawer to 55vh on mobile when navigating cards (only from smaller states)
                                                if (window.innerWidth <= 768 && (drawerHeight === 8 || drawerHeight === 30)) {
                                                  setDrawerHeight(55);
                                                }
                                              }}
                                              favorites={favorites}
                                              onToggleFavorite={onToggleFavorite}
                                              onRequestReviewHighlights={handleRestaurantSuggestionClick}
                                              onExpandDrawer={() => {
                                                if (window.innerWidth <= 768) {
                                                  setDrawerHeight(55);
                                                }
                                              }}
                                            />
                                          </div>
                                        );

                                      case "output-error":
                                        return (
                                          <div
                                            key={pIdx}
                                            className="tool-error"
                                          >
                                            ❌ Error loading restaurants:{" "}
                                            {part.errorText}
                                          </div>
                                        );

                                      default:
                                        return null;
                                    }
                                  }
                                  return null;
                                });
                                })()}
                              </>
                            ) : msg.content ? (
                              <div
                                className="message-content"
                                dangerouslySetInnerHTML={{
                                  __html: linkifyText(msg.content),
                                }}
                              />
                            ) : (
                              <div className="message-content" style={{ color: "#888", fontStyle: "italic" }}>
                                Hmm, let me try that again. Could you rephrase your question?
                              </div>
                            )}

                            {/* Render loading ellipsis if merged */}
                            {isLastMessage && canMergeLoading && (
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "8px",
                                }}
                              >
                                <div className="message-content typing-content">
                                  <span></span>
                                  <span></span>
                                  <span></span>
                                </div>
                                {currentTip && (
                                  <div className="loading-tip">
                                    <span
                                      style={{
                                        color: "#f63996",
                                        fontFamily: "Times New Roman, serif",
                                        fontWeight: "bold",
                                      }}
                                    >
                                      Tip:
                                    </span>{" "}
                                    <span style={{ color: '#666' }} dangerouslySetInnerHTML={{ __html: linkifyText(currentTip) }} />
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Controls Section (with divider) - Toggle button only */}
                            {msg.parts &&
                            msg.parts.some((p) => {
                              if (isDynamicToolPart(p)) {
                                return (
                                  (p.toolName === "get_isochrone" ||
                                    p.toolName === "get_isoline") &&
                                  p.state === "output-available"
                                );
                              }
                              if (isToolInvocationPart(p)) {
                                return (
                                  p.toolName === "get_isochrone" ||
                                  p.toolName === "get_isoline"
                                );
                              }
                              return false;
                            }) &&
                            msg.id ? (
                              <IsochroneMessage messageId={msg.id} />
                            ) : null}

                            {/* Intro suggestions after first welcome message */}
                            {idx === 0 && (
                              <div className="intro-suggestions-wrapper">
                                <div className="suggestions-container">
                                  {suggestions.map(
                                    (suggestion, suggestionIdx) => (
                                      <button
                                        key={suggestionIdx}
                                        className="suggestion-pill"
                                        onClick={() => {
                                          handleGuidedSuggestion(suggestion.remiResponse, suggestion.example);
                                        }}
                                      >
                                        {suggestion.label}
                                      </button>
                                    )
                                  )}
                                </div>
                              </div>
                            )}

                          </div>
                        </div>
                      </div>
                  ) : (
                    <div
                      className="message-bubble user-bubble"
                      dangerouslySetInnerHTML={{
                        __html: linkifyText(msg.content),
                      }}
                    />
                  )}
                </div>
              );
            })}

            {/* Custom restaurant cards carousel (from marker clicks) */}
            {(() => {
              const customRestaurants = customMessages
                .filter((msg) => msg.type === "restaurant_card" && msg.restaurant)
                .map((msg) => msg.restaurant)
                .filter((r): r is Restaurant => r !== undefined);

              if (customRestaurants.length === 0) return null;

              return (
                <div className="chat-message assistant" ref={lastMessageRef}>
                  <div className="restaurant-card-message">
                    <div className="message-avatar-outside desktop-only">
                      <img src={asset("/remi.png")} alt="remi" />
                    </div>
                    <div className="restaurant-card-content">
                      <RestaurantCarousel
                        restaurants={customRestaurants}
                        startFromLast={true}
                        collapsible={false}
                        onRestaurantSelect={(restaurant) => {
                          if (onRestaurantSelect) {
                            onRestaurantSelect(restaurant);
                          }
                          if (window.innerWidth <= 768 && (drawerHeight === 8 || drawerHeight === 30)) {
                            setDrawerHeight(55);
                          }
                        }}
                        favorites={favorites}
                        onToggleFavorite={onToggleFavorite}
                        onRequestReviewHighlights={handleRestaurantSuggestionClick}
                        onExpandDrawer={() => {
                          if (window.innerWidth <= 768) {
                            setDrawerHeight(55);
                          }
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })()}

            {isLoading && !canMergeLoading && (
              <div className="chat-message assistant">
                <div className="message-bubble">
                  <div className="message-avatar-inside desktop-only">
                    <img src={asset("/remi.png")} alt="remi" />
                  </div>
                  <div className="message-avatar-mobile mobile-only">
                    <img src={asset("/remi.png")} alt="remi" />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                      flex: 1,
                    }}
                  >
                    <div className="message-content typing-content">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                    {currentTip && (
                      <div className="loading-tip">
                        <span
                          style={{
                            color: "#f63996",
                            fontFamily: "Times New Roman, serif",
                            fontWeight: "bold",
                          }}
                        >
                          Tip:
                        </span>{" "}
                        <span style={{ color: '#666' }} dangerouslySetInnerHTML={{ __html: linkifyText(currentTip) }} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="chat-input-container">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                autoResizeTextarea();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                  // Reset textarea height after sending
                  if (inputRef.current) {
                    inputRef.current.style.height = 'auto';
                  }
                }
              }}
              placeholder={isListening ? "Listening... tap mic to stop" : isTranscribing ? "Transcribing..." : "Search for a restaurant..."}
              disabled={isLoading || isListening || isTranscribing}
              className="chat-input"
              rows={1}
            />
            <button
              onClick={toggleListening}
              disabled={isLoading || isTranscribing}
              className={`chat-mic-button ${isListening ? 'listening' : ''} ${isTranscribing ? 'transcribing' : ''}`}
              title={isTranscribing ? "Transcribing..." : isListening ? "Click to stop" : "Voice input"}
              aria-label={isTranscribing ? "Transcribing..." : isListening ? "Click to stop" : "Voice input"}
            >
              {isTranscribing ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="transcribing-spinner">
                  <circle cx="12" cy="12" r="10" strokeDasharray="31.4" strokeDashoffset="10" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              )}
            </button>
            <button
              onClick={() => {
                handleSend();
                // Reset textarea height after sending
                if (inputRef.current) {
                  inputRef.current.style.height = 'auto';
                }
              }}
              disabled={isLoading || !input.trim()}
              className="chat-send-button"
            >
              ➤
            </button>
          </div>
        </div>

      </div>
    );
  }
);

export default ChatInterface;
