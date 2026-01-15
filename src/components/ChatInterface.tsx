import {
  useState,
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useMemo,
} from "react";
import { flushSync } from "react-dom";
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
  onResetAll?: () => void;
  onToggleFavorite?: (restaurantName: string) => void;
}

const ChatInterface = forwardRef<ChatInterfaceHandle, ChatInterfaceProps>(
  ({ onRestaurantSelect, onMapFocus, onResetAll, onToggleFavorite }, ref) => {
    // Use MapContext for data and state management
    const {
      allRestaurants,
      favorites,
      addLayers,
      isochroneRegionSlugs,
      clearAllLayers,
      filterPoolSlugs,
      setRestaurantWeekActive,
      setHighlightedRestaurantIds,
    } = useMap();

    // Random welcome message selection
    const welcomeMessages = [
      '<span class="welcome-greeting">I\'m Remi!</span> <br>Let\'s help you find the best restaurants and 2026 Restaurant Week deals:',
    ];

    // Quick-start suggestions for new users
    const suggestions = [
      {
        label: "By Area",
        prompt: [
          "Here's an example scenario: 'I'm in Soho, hunting for spots I can reach in under 15 mins by subway. What's on the menu, Remi?'",
          "Here's an example scenario: 'Any places within a 15 min subway of West Village?'",
          "Here's an example scenario: 'Show me hole in the wall restaurants by Roosevelt Island Tramway by E61 st within 20 minute walk.'"
        ],
      },
      {
        label: "By Meeting Point",
        prompt: [
          "Here's an example scenario: 'My friend is in Midtown, I'm in Murray Hill — what's some restaurants in between us within a short 10 min transit?'",
          "Here's an example scenario: 'I'm in Chelsea. Show me restaurants around the area excluding MSG, because it's always too busy. I'm willing to walk up to 20 mins.'",
          "Here's an example scenario: 'I'm by AMC Times Square, and my friend is at One Manhattan West. We are willing to travel 15 minutes walking. Find spots between us, Remi.'"
        ],
      },
      {
        label: "By Vibes",
        prompt: [
          "Here's an example scenario: 'Remi, give me couple places that are good for date night.'",
          "Here's an example scenario: 'Remi, show me happy hour spots in Soho. Willing to travel 10 mins by subway.'",
          "Here's an example scenario: 'Remi, find me a couple restaurants that are modest and cozy.'",
          "Here's an example scenario: 'Remi, find me hole in the wall restaurants, and tell me what's your definition for it.'"
        ],
      },
    ];


    // Tips shown while loading
    const tips = [
      "Tap a restaurant marker and hit the heart to save it to your favorites.",
      "Click 'match your vibe' in the map legend to only see those restaurants.",
      "Award-winning spots—Michelin, Bib Gourmand, or NYC Top 100—appear as orange pins.",
      "Ask Remi about vibe and ambiance—think cozy, romantic, lively, and beyond.",
      "Ask Remi about the best ramen or happy hour in town.",
      "Once an isochrone is drawn, refine results by price, Yelp rating, or cuisine using the top filter bar.",
      "Isochrone, simply put, is a map boundary showing how far you can travel within a set time.",
      "The current restaurant pool is limited to NYC Restaurant Week within Manhattan.",
      "Click any restaurant on the map to see Yelp reviews, socials, and more.",
      "Enjoying NYC Eats? Buy my creator a coffee at buymeacoffee.com/atmikapai. Cheers.",
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
      console.log("🔗 Using API endpoint:", API_ENDPOINT);
    }, []);

    // Store filterPoolSlugs in a ref so transport can access current value
    const filterPoolRef = useRef<string[]>([]);
    useEffect(() => {
      filterPoolRef.current = filterPoolSlugs;
      console.log(`🎯 Filter pool updated: ${filterPoolSlugs.length} restaurants`);
    }, [filterPoolSlugs]);

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
              },
            };

            console.log(`📤 Sending request with filterPool: ${filterPoolRef.current.length} slugs`);

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
        // Add a friendly error message from Remi to the chat history
        const errorMessage = {
          id: `error-${Date.now()}`,
          role: "assistant" as const,
          content: `I'm terribly sorry, but something went wrong while I was whisking through your request. It seems my whiskers got tangled! <br><br> Could you try rephrasing or asking again?`,
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

    const [input, setInput] = useState("");
    const [isResetting, setIsResetting] = useState(false);

    // Watch messages for new tool results
    useEffect(() => {
      console.log("🔔 Messages updated - checking for tool results", {
        messageCount: aiMessages.length,
        isResetting,
        hasMessages: aiMessages.length > 0,
      });

      // Only process if we have messages and are not already resetting
      if (aiMessages.length > 0 && !isResetting) {
        console.log("✅ Triggering processToolResults()");
        processToolResults();
      } else {
        console.log(
          "⏸️ Skipping processToolResults (no messages or resetting)"
        );
      }
    }, [aiMessages, isResetting]);

    // Manually seed messages on mount if empty
    useEffect(() => {
      if (aiMessages.length === 0) {
        console.log("🌱 Seeding initial welcome message");
        setMessages([initialMessage]);
      }
    }, []); // Only run once on mount

    // Debug: Log messages
    useEffect(() => {
      console.log(
        "🔍 AI Messages:",
        aiMessages.length,
        aiMessages
        // JSON.stringify(aiMessages, null, 2)
      );
    }, [aiMessages]);

    const [currentTip, setCurrentTip] = useState("");
    const [customMessages, setCustomMessages] = useState<Message[]>([]); // For restaurant cards

    const lastMessageRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

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
      console.log("🔍 processToolResults called - scanning messages...");

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

      console.log(
        `📊 Found ${unprocessedIsolineParts.length} NEW isoline parts (${allIsolineParts.length} total in message)`
      );

      // If there are multiple isoline CALLS in the message, wait for ALL to complete
      let isolineParts: DynamicToolPart[];

      if (allIsolineParts.length > 1) {
        const completedCount = allIsolineParts.filter((p) =>
          hasDynamicToolOutput(p)
        ).length;

        console.log(
          `⏳ Multi-isoline query: ${completedCount}/${allIsolineParts.length} calls completed`
        );

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
                    console.log(
                      `🔎 Found ${foundSlugs.length} restaurants in search results within active area`
                    );
                    if (onMapFocus) {
                      onMapFocus(foundSlugs);
                    }
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

            // Highlight results as yellow markers (don't filter, just color them)
            if (output?.restaurantSlugs && output.restaurantSlugs.length > 0) {
              console.log(`🌟 Highlighting ${output.restaurantSlugs.length} restaurants from semantic search`);
              setHighlightedRestaurantIds(new Set(output.restaurantSlugs));
            }

            // Auto-activate Restaurant Week filter if detected
            if (output?.restaurantWeekDetected) {
              console.log("🎄 Auto-activating Restaurant Week filter from semantic search");
              setRestaurantWeekActive(true);
            }
          }

          // displayRestaurants - only highlight for direct lookups (1 restaurant)
          // For semantic search results, the highlights are already set above (up to 10)
          if (
            part.type === "tool-displayRestaurants" &&
            (part as any).state === "output-available" &&
            !processedToolCallIds.current.has((part as any).toolCallId)
          ) {
            processedToolCallIds.current.add((part as any).toolCallId);
            const output = (part as any).output;

            // Only highlight if this is a direct lookup (1-2 restaurants), not after semantic search
            // Semantic search already set highlights for up to 10 restaurants
            if (output?.restaurants && output.restaurants.length > 0 && output.restaurants.length <= 2) {
              const slugs = output.restaurants.map((r: any) => r.slug).filter(Boolean);
              if (slugs.length > 0) {
                console.log(`🌟 Highlighting ${slugs.length} restaurant(s) from direct lookup`);
                setHighlightedRestaurantIds(new Set(slugs));
              }
            }
          }
        });
      });

      // 2. Handle Isochrone/Isoline results with "Between Us" support
      if (isolineParts.length > 0) {
        console.log(`🗺️ Processing ${isolineParts.length} isoline result(s)`);

        // Find newest isoline part that hasn't been processed yet
        const newIsolineParts = isolineParts.filter(
          (p) => !processedToolCallIds.current.has(p.toolCallId)
        );

        console.log(
          `📝 New (unprocessed) isoline parts: ${newIsolineParts.length}`
        );

        if (newIsolineParts.length > 0) {
          // Mark all as processed
          newIsolineParts.forEach((p) => {
            console.log(`✅ Marking ${p.toolCallId} as processed`);
            processedToolCallIds.current.add(p.toolCallId);
          });

          if (isolineParts.length > 1) {
            console.log("🗺️ Processing multiple isoline results (Between Us)");
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
                  color: i === 0 ? "#FF69B4" : "#4169E1",
                  strokeColor: i === 0 ? "#FF1493" : "#00008B",
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
                  color: "#8A2BE2",
                  strokeColor: "#4B0082",
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
                color: "#FF69B4",
                strokeColor: "#FF1493",
                opacity: 0.3,
              };

              console.log("🗺️ Using MapContext to add single layer");
              addLayers([singleLayer], messageId);

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

    // Randomly show a tip when loading starts (60% chance)
    useEffect(() => {
      if (isLoading) {
        const shouldShowTip = Math.random() < 0.6;
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

      // Expand drawer from 8vh to 40vh on mobile when marker is clicked
      if (isMobile && drawerHeight === 8) {
        setDrawerHeight(40);
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

      // URLs with protocol
      result = result.replace(
        /(https?:\/\/[^\s]+)/g,
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

      if (clampedHeight < 25) {
        setDrawerHeight(8);
      } else if (clampedHeight < 60) {
        setDrawerHeight(40);
      } else {
        setDrawerHeight(80);
      }
    };

    const handleTouchEnd = () => {
      setIsDragging(false);
    };

    const handleSuggestionClick = (suggestionText: string) => {
      handleSend(suggestionText);
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
      const userMessage =
        typeof textOverride === "string" ? textOverride : input.trim();

      if (!userMessage || isLoading) return;

      // Clear restaurant cards when starting a new conversation turn
      setCustomMessages([]);

      setInput("");

      // Send message using AI SDK
      sendMessage({ text: userMessage });
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    };

    const handleClearHistory = async () => {
      setIsResetting(true);

      try {
        console.log("🧹 Starting reset...");

        // Clear chat state
        flushSync(() => {
          setMessages([initialMessage]);
          setCustomMessages([]);
        });

        console.log("✅ Frontend chat state cleared");

        // Use MapContext to clear all layers
        clearAllLayers();

        // Trigger full app reset
        if (onResetAll) {
          onResetAll();
        }

        console.log("✅ Full reset complete");
      } finally {
        setIsResetting(false);
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

    // Expand drawer to 40vh after first message on mobile
    useEffect(() => {
      const isMobile = window.innerWidth <= 768;
      const hasUserMessage = allMessages.some(msg => msg.role === 'user');
      if (isMobile && hasUserMessage && drawerHeight === 30) {
        setDrawerHeight(40);
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
            onClick={() => setDrawerHeight(40)}
          >
            <img
              src="/remi_transparent.png"
              alt="Remi"
              className="drawer-collapsed-logo"
            />
            <span className="drawer-collapsed-text">Chat with Remi</span>
          </div>

          {/* Messages */}
          <div ref={messagesContainerRef} className="chat-messages">
            {allMessages.map((msg, idx) => {
              const isLastMessage = idx === allMessages.length - 1;

              return (
                <div
                  key={idx}
                  className={`chat-message ${msg.role}`}
                  ref={isLastMessage ? lastMessageRef : null}
                >
                  {msg.role === "assistant" ? (
                    msg.type === "restaurant_card" && msg.restaurant ? (
                      <div
                        className="restaurant-card-message"
                        onClick={() => {
                          // Zoom to restaurant on map when card is clicked
                          if (onRestaurantSelect && msg.restaurant) {
                            onRestaurantSelect(msg.restaurant);
                          }
                          // Collapse drawer to 40vh on mobile when clicking top section
                          // (accordion clicks stopPropagation, so this only fires for non-accordion areas)
                          if (window.innerWidth <= 768 && drawerHeight !== 40) {
                            setDrawerHeight(40);
                          }
                        }}
                        style={{ cursor: "pointer" }}
                      >
                        <div className="message-avatar-outside desktop-only">
                          <img src="/remi.png" alt="remi" />
                        </div>
                        <div className="restaurant-card-content">
                          <div className="restaurant-card-wrapper">
                            <RestaurantCard
                              restaurant={msg.restaurant}
                              isFavorited={favorites.includes(
                                msg.restaurant.name
                              )}
                              onToggleFavorite={
                                onToggleFavorite
                                  ? () => onToggleFavorite(msg.restaurant!.name)
                                  : undefined
                              }
                              onRequestReviewHighlights={
                                handleRestaurantSuggestionClick
                              }
                              onExpandDrawer={() => {
                                if (window.innerWidth <= 768) {
                                  setDrawerHeight(80);
                                }
                              }}
                              onClose={() => {
                                // Find the index of this custom message and remove it
                                const customMsgIndex = customMessages.findIndex(
                                  (cm) =>
                                    cm.restaurant?.slug === msg.restaurant?.slug
                                );
                                if (customMsgIndex !== -1) {
                                  removeRestaurantCard(customMsgIndex);
                                }
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    ) : (
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
                            <img src="/remi.png" alt="remi" />
                          </div>
                          <div className="message-avatar-mobile mobile-only">
                            <img src="/remi.png" alt="remi" />
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

                                  return sortedParts.map((part, pIdx: number) => {
                                  if (isTextPart(part)) {
                                    return (
                                      <div
                                        key={pIdx}
                                        className="message-content"
                                        dangerouslySetInnerHTML={{
                                          __html: linkifyText(part.text),
                                        }}
                                      />
                                    );
                                  } else if (
                                    isToolInvocationPart(part) ||
                                    isDynamicToolPart(part)
                                  ) {
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
                                      "And there's the third location!",
                                    ];

                                    // Varied messages for isochrone
                                    const isochroneDoneMessages = [
                                      "We're about to map!",
                                      "Mapping the second isochrone too!",
                                      "All areas are about to map!",
                                    ];

                                    if (toolName === "execute_sql") {
                                      statusText = isPending
                                        ? "I'm scurrying through the database..."
                                        : "I'm consulting Bourdain and Gusteau for recs...";
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
                                        return (
                                          <div
                                            key={pIdx}
                                            className="restaurant-cards-container"
                                          >
                                            {displayRestaurantsPool.map(
                                              (
                                                restaurant: Restaurant,
                                                rIdx: number
                                              ) => (
                                                <div
                                                  key={restaurant.slug || rIdx}
                                                  className="restaurant-card-message"
                                                  onClick={() => {
                                                    // Zoom to restaurant on map when card is clicked
                                                    if (onRestaurantSelect) {
                                                      onRestaurantSelect(
                                                        restaurant
                                                      );
                                                    }
                                                    // Collapse drawer to 40vh on mobile when clicking top section
                                                    // (accordion clicks stopPropagation, so this only fires for non-accordion areas)
                                                    if (window.innerWidth <= 768 && drawerHeight !== 40) {
                                                      setDrawerHeight(40);
                                                    }
                                                  }}
                                                  style={{ cursor: "pointer" }}
                                                >
                                                  <div className="restaurant-card-wrapper">
                                                    <RestaurantCard
                                                      restaurant={restaurant}
                                                      isFavorited={favorites.includes(
                                                        restaurant.name
                                                      )}
                                                      onToggleFavorite={
                                                        onToggleFavorite
                                                          ? () =>
                                                              onToggleFavorite(
                                                                restaurant.name
                                                              )
                                                          : undefined
                                                      }
                                                      onRequestReviewHighlights={
                                                        handleRestaurantSuggestionClick
                                                      }
                                                      onExpandDrawer={() => {
                                                        if (
                                                          window.innerWidth <=
                                                          768
                                                        ) {
                                                          setDrawerHeight(80);
                                                        }
                                                      }}
                                                    />
                                                  </div>
                                                </div>
                                              )
                                            )}
                                            {displayRestaurantsPool.length ===
                                              0 && !part.output?.error && (
                                              <p
                                                style={{
                                                  padding: "16px",
                                                  color: "#666",
                                                }}
                                              >
                                                {part.type === "tool-lookup_restaurant"
                                                  ? `I couldn't find a restaurant called "${part.output?.restaurant_name || 'that'}"`
                                                  : `No restaurants found for "${part.output?.query || 'your search'}"`}
                                              </p>
                                            )}
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
                                    {currentTip}
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
                                          const randomPrompt =
                                            suggestion.prompt[
                                              Math.floor(
                                                Math.random() *
                                                  suggestion.prompt.length
                                              )
                                            ];
                                          handleSuggestionClick(randomPrompt);
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
                    )
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

            {isLoading && !canMergeLoading && (
              <div className="chat-message assistant">
                <div className="message-bubble">
                  <div className="message-avatar-inside desktop-only">
                    <img src="/remi.png" alt="remi" />
                  </div>
                  <div className="message-avatar-mobile mobile-only">
                    <img src="/remi.png" alt="remi" />
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
                        {currentTip}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="chat-input-container">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Find a restaurant in NYC..."
              disabled={isLoading || isResetting}
              className="chat-input"
            />
            <button
              onClick={handleSend}
              disabled={isLoading || isResetting || !input.trim()}
              className="chat-send-button"
            >
              ➤
            </button>
            <button
              onClick={handleClearHistory}
              className="chat-clear-button"
              title="Reset Chat"
              disabled={isResetting}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                <path d="M3 21v-5h5" />
              </svg>
            </button>
          </div>
        </div>

      </div>
    );
  }
);

export default ChatInterface;
