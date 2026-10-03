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
import RemiStatus, { remiStage } from "./RemiStatus";
import RestaurantCarousel from "./RestaurantCarousel";
import type { UIMessagePart } from "ai";
import {
  type DynamicToolPart,
  type TextUIPart,
  isDynamicToolPart,
  isTextPart,
  isToolInvocationPart,
  hasDynamicToolOutput,
  extractToolResult,
  type IsolineResult,
} from "../types/ai-message";
import "./ChatInterface.css";
import { colors } from "@/styles/tokens";
import { Button } from "@/components/ui/button";
import { useIsDesktop } from "../hooks/useIsDesktop";
import RemiPickList from "./RemiPickList";

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

// Map pins for searched places, one per person/place in a search (public/characters order)
const CHARACTER_IMAGES = [
  asset("/characters/1_alfredo.png"),
  asset("/characters/2_collette.png"),
  asset("/characters/3_anton.png"),
  asset("/characters/4_skinner.png"),
];

// Isochrone layer styling
const ISOCHRONE_COLORS = {
  fill: colors.isochrone,   // Electric purple
  stroke: colors.isochroneOutline, // Deeper purple for outline
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

interface ChatInterfaceProps {
  onRestaurantSelect: (restaurant: Restaurant) => void;
  onToggleFavorite?: (restaurantName: string) => void;
}

// Kill-switch for the backend AI. When true, Remi shows CHATBOT_DOWN_MESSAGE
// instead of hitting the API. Set to true to take the chatbot offline again.
const CHATBOT_DOWN = false;
const CHATBOT_DOWN_MESSAGE =
  "Oof — my kitchen is temporarily closed! 🍳 My sous-chef (the AI behind the scenes) has stepped out, so I can't whisk up recommendations right now. We're working to get NYC Eats back up and running soon.<br><br>In the meantime, you can still explore the map, browse restaurant markers, and favorite your spots. Merci for your patience — please check back shortly!";

const ChatInterface = forwardRef<ChatInterfaceHandle, ChatInterfaceProps>(
  ({ onRestaurantSelect, onToggleFavorite }, ref) => {
    // Use MapContext for data and state management
    const {
      favorites,
      addLayers,
      filterPoolSlugs,
      setRestaurantWeekActive,
      addGeocodedMarker,
      clearGeocodedMarkers,
      setRecommendedPicks,
      recommendedPicks,
      allRestaurants,
      setSelectedRestaurant,
      userLocation,
    } = useMap();
    // Desktop: Remi's picks are a list of names here and the card opens on the map
    const isDesktop = useIsDesktop();

    // Random welcome message selection
    const welcomeMessages = [
      '<span class="block text-subheading">Hey, I\'m Remi!</span><br>I\'m here in NYC for the winter, scouting the latest epicurean finds. Let\'s help you find the finest spots by:',
    ];

    // Quick-start suggestions - clicking these triggers Remi to ask a guiding question
    const suggestions = [
      {
        label: "Area",
        type: "guided" as const,
        remiResponse: "<strong>How far are you willing to travel and by what mode of transit?</strong> I can recommend restaurants within your vicinity. \n\nFor example: *I'm in <strong>Soho</strong>. Find <strong>happy hour</strong> spots within <strong>10 min walk</strong>.*",
        example: "I'm in Soho. Find happy hour spots within 10 min walk.",
      },
      {
        label: "Midpoint",
        type: "guided" as const,
        remiResponse:
          "<strong>Meeting up with a friend?</strong> Tell me where you both are, and I'll find restaurants in between! \n\nFor example: *I'm at <strong>AMC Times Square</strong>, and my friend is by <strong>One Manhattan West</strong>. We can travel <strong>15 minutes by subway</strong>. Find <strong>happy hour, vegan</strong> spots between us, Remi.*",
        example: "I'm by AMC Times Square, and my friend is at One Manhattan West. We can travel 15 mins by subway. Find lively happy hour spots between us, Remi.",
      },
      {
        label: "Vibes",
        type: "guided" as const,
        remiResponse: "<strong>Going for a vibe?</strong> I can suggest:\n• Happy hour spots\n• Cozy date night places\n• Vegan-friendly deals",
        example: "Find me cozy date night spots around the city, Remi. My gf is vegan. A candleight dinner for our anniversary, perhaps?",
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

    // Desktop: once Remi finishes answering, open his first pick's card on the map
    const autoOpenedPicks = useRef("");
    useEffect(() => {
      if (!isDesktop || isLoading || recommendedPicks.length === 0) return;
      const key = recommendedPicks.map((p) => p.slug).join(",");
      if (autoOpenedPicks.current === key) return;
      autoOpenedPicks.current = key;
      const first = recommendedPicks[0];
      setSelectedRestaurant(allRestaurants.find((r) => r.slug === first.slug) ?? first);
    }, [isDesktop, isLoading, recommendedPicks, allRestaurants, setSelectedRestaurant]);

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
          p.toolName === "get_isoline"
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
              // Handle geocode results - drop a character pin at the geocoded location
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
                    // Each place in a search gets its own character, in public/characters order:
                    // place 1 → Alfredo, 2 → Collette, 3 → Anton, 4 → Skinner
                    const placeIndex = (msg.parts || []).filter(
                      (p) => isDynamicToolPart(p) && p.toolName === "geocode"
                    ).findIndex((p) => isDynamicToolPart(p) && p.toolCallId === part.toolCallId);
                    const characterImage = CHARACTER_IMAGES[Math.max(placeIndex, 0) % CHARACTER_IMAGES.length];

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
          // semantic_search_restaurants - turns on the Restaurant Week filter if the query was about it
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

          // displayRestaurants - Remi's picks become red markers (replacing the previous answer's)
          if (
            part.type === "tool-displayRestaurants" &&
            (part as any).state === "output-available" &&
            !processedToolCallIds.current.has((part as any).toolCallId)
          ) {
            processedToolCallIds.current.add((part as any).toolCallId);
            const restaurants: Restaurant[] = (part as any).output?.restaurants ?? [];
            if (restaurants.length) setRecommendedPicks(restaurants);
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
                color: ISOCHRONE_COLORS.fill,
                strokeColor: ISOCHRONE_COLORS.stroke,
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
        '<a href="$2" target="_blank" rel="noopener noreferrer" style="color: var(--color-pink-light); text-decoration: underline;">$1</a>'
      );

      // URLs with protocol (but not already inside href attributes)
      result = result.replace(
        /(?<!href=")(https?:\/\/[^\s<>"]+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer" style="color: var(--color-pink-light); text-decoration: underline;">$1</a>'
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
            `<a href="https://${url}" target="_blank" rel="noopener noreferrer" style="color: var(--color-pink-light); text-decoration: underline;">${url}</a>`
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
      } else if (clampedHeight < 65) {
        setDrawerHeight(55);
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
    // One in-place status line ("✻ Mapping…") until Remi's reply starts streaming
    const lastAssistantParts = isLastMessageAssistant ? allMessages[allMessages.length - 1].parts ?? [] : [];
    const remiReplyStarted = lastAssistantParts.some((p) => isTextPart(p) && p.text.trim() !== "");
    // Before anything streams, open on "Geocoding…" if the message sounds like a location search
    const lastUserMessage = [...allMessages].reverse().find((m) => m.role === "user");
    const lastUserText =
      lastUserMessage?.content ||
      (lastUserMessage?.parts ?? []).map((p) => (isTextPart(p) ? p.text : "")).join(" ");
    const openingStage = classifyQuery(lastUserText || "") === "location" ? "Geocoding" : "Tasting";

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
            <span className="drawer-collapsed-text text-label font-semibold">Chat with Remi</span>
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
                        <div className="message-bubble font-sans text-body">
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
                                              className="try-it-button text-caption font-medium"
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
                                    // Progress is shown by the single RemiStatus line, not per tool.
                                    return null;
                                  } else if (part.type === "tool-displayRestaurants") {
                                    // Generative UI: Render restaurant cards
                                    switch (part.state) {
                                      case "input-available":
                                        return null;

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
                                              `[ChatInterface] No restaurants found: search for "${part.output?.query || 'unknown'}"`
                                            );
                                          }
                                          return null;
                                        }

                                        // Desktop: names only; the cards open on the map
                                        if (isDesktop) {
                                          return <RemiPickList key={pIdx} picks={displayRestaurantsPool} />;
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
                                                  setDrawerHeight(80);
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
                              <div className="message-content" style={{ color: colors.grey, fontStyle: "italic" }}>
                                Hmm, let me try that again. Could you rephrase your question?
                              </div>
                            )}

                            {/* Status line while Remi works, merged into his message */}
                            {isLastMessage && canMergeLoading && !remiReplyStarted && (
                              <RemiStatus stage={remiStage(lastAssistantParts, openingStage)} />
                            )}

                            {/* Controls Section (with divider) - Toggle button only */}
                            {msg.parts &&
                            msg.parts.some((p) => {
                              if (isDynamicToolPart(p)) {
                                return (
                                  p.toolName === "get_isoline" &&
                                  p.state === "output-available"
                                );
                              }
                              if (isToolInvocationPart(p)) {
                                return p.toolName === "get_isoline";
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
                                      <Button
                                        key={suggestionIdx}
                                        variant="secondary"
                                        size="pill"
                                        className="border border-solid border-primary/40 font-sans font-normal shadow-none"
                                        onClick={() => {
                                          handleGuidedSuggestion(suggestion.remiResponse, suggestion.example);
                                        }}
                                      >
                                        {suggestion.label}
                                      </Button>
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
                      className="message-bubble user-bubble font-sans text-body"
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
                            setDrawerHeight(80);
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
                <div className="message-bubble font-sans text-body">
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
                    <RemiStatus stage={openingStage} />
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
