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
import RemiBubble from "./RemiBubble";
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
import { Message, MessageContent } from "@/components/ui/message";
import { Bubble, BubbleContent, BubbleGroup } from "@/components/ui/bubble";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { ArrowUp, LoaderCircle, Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsDesktop } from "../hooks/useIsDesktop";
import { boldPicks } from "../utils/boldPicks";
import { friendLandmarkNear, isInManhattan } from "../utils/manhattan";

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
  type?: "text";
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

// Chat rows are shadcn Message + Bubble: Remi's replies are white tiles with his avatar inside
// (RemiBubble; full width, since they hold status lines and toggles); yours are charcoal, on the right.
const USER_BUBBLE_CONTENT = "rounded-2xl rounded-br-sm px-3 py-2 font-sans text-body shadow-xs whitespace-pre-wrap";

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
      filteredRestaurants,
      isochroneRegionSlugs,
      geocodedMarkers,
      markerVisibilityMap,
      allRestaurants,
      setSelectedRestaurant,
      userLocation,
      onboardingActive,
    } = useMap();
    // Desktop: Remi's picks are a list of names here and the card opens on the map
    const isDesktop = useIsDesktop();

    // Random welcome message selection
    const welcomeMessages = [
      '<span class="block text-subheading">Hey, I\'m Remi!</span><br>How can I help you find a restaurant today?',
    ];
    // After the mobile walkthrough (where Remi already introduced himself), he skips the hello
    const POST_ONBOARDING_WELCOME = "What are you craving?";

    // Quick-start prompts under the welcome message: an area search and a midpoint search.
    // **…** marks the words shown semibold in the bubble; they're stripped before the prompt is sent. Clicking one sends it straight away, so a new user sees results immediately.
    // When the browser shared a location in Manhattan, the first two start from "me".
    const userInManhattan = useMemo(
      () => !!userLocation && isInManhattan(userLocation, allRestaurants),
      [userLocation, allRestaurants]
    );
    // Midpoint prompts state a walking time (a "15-minute city" walk): with none, Remi assumes a
    // 20-min subway ride from each place, the areas overlap almost everywhere, and the picks
    // aren't really "between" you. The two places are ~1 km apart so 15-min walks overlap.
    const friendLandmark = userInManhattan && userLocation ? friendLandmarkNear(userLocation) : null;
    const quickPrompts = userInManhattan
      ? [
          "**Happy hour** spots within **10-min subway**",
          friendLandmark
            ? `My friend is at **${friendLandmark}**. Find **pasta** spots within a **15-min walk** of both of us.`
            : "My friend is at **Bryant Park**. Find **pasta** spots between us.",
        ]
      : [
          "**Happy hour** spots within **10-min subway** of **Soho**",
          "I'm in **Washington Square Park**, my friend is in **Union Square**. Find **pasta** spots within a **15-min walk** of both of us.",
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
      const selectedMessage = onboardingActive
        ? POST_ONBOARDING_WELCOME
        : welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)];

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

    // What's on the map: the travel-time area currently shown (and the places it was drawn from),
    // or null when none is visible / the user hid it. The API searches inside it on follow-ups.
    const mapRegionRef = useRef<{ places: string[]; restaurantCount: number } | null>(null);
    useEffect(() => {
      mapRegionRef.current = isochroneRegionSlugs
        ? {
            places: geocodedMarkers.filter((m) => markerVisibilityMap.get(m.id) !== false).map((m) => m.label),
            restaurantCount: isochroneRegionSlugs.length,
          }
        : null;
    }, [isochroneRegionSlugs, geocodedMarkers, markerVisibilityMap]);

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
                mapRegion: mapRegionRef.current,
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

    // Mobile walkthrough: the drawer waits off-screen, then springs up with its contents
    // following in a stagger (drawer-reveal, for as long as that takes)
    const [drawerRevealing, setDrawerRevealing] = useState(false);
    // A drawer that starts with the walkthrough never plays its usual slide-in (see drawer-onboarding)
    const [startedWithOnboarding] = useState(onboardingActive);
    const wasOnboarding = useRef(onboardingActive);
    useEffect(() => {
      if (wasOnboarding.current && !onboardingActive) {
        setDrawerRevealing(true);
        const timer = setTimeout(() => setDrawerRevealing(false), 1400);
        wasOnboarding.current = false;
        return () => clearTimeout(timer);
      }
    }, [onboardingActive]);

    // Mobile: the restaurant whose marker was tapped; its card takes the slot under Remi's latest reply
    const [tappedRestaurant, setTappedRestaurant] = useState<Restaurant | null>(null);

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

    // Close the open restaurant card as soon as Remi starts placing pins or drawing travel-time
    // areas (once per tool call), so the map is clear for the new search
    const cardClosedForTools = useRef(new Set<string>());
    useEffect(() => {
      const last = aiMessages[aiMessages.length - 1];
      for (const part of last?.parts ?? []) {
        if (!isDynamicToolPart(part)) continue;
        if (part.toolName !== "geocode" && part.toolName !== "get_isoline") continue;
        if (cardClosedForTools.current.has(part.toolCallId)) continue;
        cardClosedForTools.current.add(part.toolCallId);
        setSelectedRestaurant(null);
      }
    }, [aiMessages, setSelectedRestaurant]);

    // Once Remi finishes answering, select pick 1: the map flies to it (desktop also opens its card
    // on the map; mobile's carousel already starts on it)
    const autoOpenedPicks = useRef("");
    useEffect(() => {
      if (isLoading || recommendedPicks.length === 0) return;
      const key = recommendedPicks.map((p) => p.slug).join(",");
      if (autoOpenedPicks.current === key) return;
      autoOpenedPicks.current = key;
      const first = recommendedPicks[0];
      setSelectedRestaurant(allRestaurants.find((r) => r.slug === first.slug) ?? first);
    }, [isLoading, recommendedPicks, allRestaurants, setSelectedRestaurant]);

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

    // A new question brings new picks, which take the card slot back
    useEffect(() => {
      if (isLoading) setTappedRestaurant(null);
    }, [isLoading]);

    // Scroll the card slot into view (the top of the card at the top of the chat)
    const scrollToCardSlot = () => {
      const container = messagesContainerRef.current;
      const slot = container?.querySelector<HTMLElement>("[data-card-slot]");
      if (!container || !slot) return;
      const top = container.scrollTop + slot.getBoundingClientRect().top - container.getBoundingClientRect().top;
      container.scrollTo({ top: Math.max(0, top - 12), behavior: "smooth" });
    };

    // Mobile: a tapped marker's card (Map.tsx calls this through the ref)
    const addRestaurantCard = (restaurant: Restaurant) => {
      // Don't add cards while Remi is responding
      if (isLoading) return;

      // Expand the drawer when it's collapsed
      if (drawerHeight === 8) setDrawerHeight(55);

      setTappedRestaurant(restaurant);
      // Double requestAnimationFrame so the new card is laid out first
      requestAnimationFrame(() => requestAnimationFrame(scrollToCardSlot));
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

    // Quick-start prompt: send it as if typed (on mobile, open the drawer enough to see results)
    const handleQuickPrompt = (prompt: string) => {
      if (window.innerWidth <= 768 && drawerHeight === 8) {
        setDrawerHeight(55);
      }
      handleSend(prompt);
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

      // Clear the tapped marker's card and geocoded pins when starting a new conversation turn
      setTappedRestaurant(null);
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

      return convertedAiMessages as (Message & {
        id?: string;
        parts?: UIMessagePart<any, any>[];
      })[];
    }, [aiMessages]);

    const conversationStarted = allMessages.some((m) => m.role === "user");
    const isLastMessageAssistant =
      allMessages.length > 0 &&
      allMessages[allMessages.length - 1].role === "assistant";
    const canMergeLoading = isLoading && isLastMessageAssistant;
    // One in-place status line ("✻ Mapping…") until Remi's reply starts streaming
    const lastAssistantParts = isLastMessageAssistant ? allMessages[allMessages.length - 1].parts ?? [] : [];
    const remiReplyStarted = lastAssistantParts.some((p) => isTextPart(p) && p.text.trim() !== "");
    // Before anything streams, open on "Geocoding…" if the message sounds like a location search
    const lastUserMessage = [...allMessages].reverse().find((m) => m.role === "user");
    const lastUserText =
      lastUserMessage?.content ||
      (lastUserMessage?.parts ?? []).map((p) => (isTextPart(p) ? p.text : "")).join(" ");
    const openingStage = classifyQuery(lastUserText || "") === "location" ? "Geocoding" : "Tasting";

    // Remi's picks in a message, once it has finished streaming
    const picksOf = (msg: (typeof allMessages)[number], isLastMessage: boolean): Restaurant[] => {
      const part = msg.parts?.find((p) => p.type === "tool-displayRestaurants") as
        | { state?: string; output?: { restaurants?: Restaurant[] } }
        | undefined;
      if (part?.state !== "output-available" || (isLoading && isLastMessage)) return [];
      return part.output?.restaurants ?? [];
    };

    // Mobile: a carousel of restaurant cards. Swiping past the last one walks on to the nearest
    // restaurants; `picks` get their "Remi's pick #N" label.
    const renderCards = (
      restaurants: Restaurant[],
      { picks, startIndex = 0, slot = false }: { picks: Restaurant[]; startIndex?: number; slot?: boolean }
    ) => (
      <div className="restaurant-cards-container" data-card-slot={slot || undefined}>
        <RestaurantCarousel
          key={`${restaurants[0]?.slug}-${startIndex}`}
          restaurants={restaurants}
          startIndex={startIndex}
          pickNumberFor={(r) => {
            const index = picks.findIndex((p) => p.slug === r.slug);
            return index >= 0 ? index + 1 : undefined;
          }}
          continueWith={filteredRestaurants}
          onRestaurantSelect={(restaurant) => {
            onRestaurantSelect?.(restaurant);
            // Expand the drawer when it's collapsed
            if (window.innerWidth <= 768 && drawerHeight === 8) setDrawerHeight(55);
          }}
          favorites={favorites}
          onToggleFavorite={onToggleFavorite}
          onRequestReviewHighlights={handleRestaurantSuggestionClick}
          onExpandDrawer={() => {
            if (window.innerWidth <= 768) setDrawerHeight(80);
          }}
        />
      </div>
    );

    // Mobile: Remi's picks below his message (desktop opens them on the map). Under his latest
    // reply, a tapped marker takes the slot: one of his picks jumps there (the numbered pins on the
    // map still mark them all); any other restaurant replaces them.
    const renderPicks = (msg: (typeof allMessages)[number], isLastMessage: boolean) => {
      if (isDesktop) return null;
      const picks = picksOf(msg, isLastMessage);
      if (picks.length === 0) return null;
      if (!isLastMessage) return renderCards(picks, { picks });
      if (!tappedRestaurant) return renderCards(picks, { picks, slot: true });
      const pickIndex = picks.findIndex((p) => p.slug === tappedRestaurant.slug);
      return pickIndex >= 0
        ? renderCards(picks, { picks, startIndex: pickIndex, slot: true })
        : renderCards([tappedRestaurant], { picks, slot: true });
    };
    // A tapped marker's card when Remi's latest reply has no picks to replace: it goes at the end
    const lastMessage = allMessages[allMessages.length - 1];
    const tappedCardAtEnd =
      !isDesktop && tappedRestaurant && !(lastMessage?.role === "assistant" && picksOf(lastMessage, true).length > 0);

    return (
      <div className="chat-interface">
        <div
          ref={drawerRef}
          className={cn(
            `chat-bubble drawer-${drawerHeight}`,
            startedWithOnboarding && "drawer-onboarding",
            onboardingActive && "drawer-hidden",
            drawerRevealing && "drawer-reveal"
          )}
        >
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
              src={asset("/remi.png")}
              alt="Remi"
              className="drawer-collapsed-logo"
            />
            <span className="drawer-collapsed-text text-label font-semibold">Chat with Remi</span>
          </div>

          {/* Messages */}
          <div ref={messagesContainerRef} className="chat-messages">
            {allMessages.map((msg, idx) => {
              const isLastMessage = idx === allMessages.length - 1;

              return msg.role === "assistant" ? (
                <Message
                  key={idx}
                  className="chat-message assistant"
                  ref={isLastMessage ? lastMessageRef : null}
                >
                  <MessageContent>
                    <RemiBubble>
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

                                  // Remi's picks in this answer, so their names are bold in his text
                                  const picksPart = msg.parts.find((p) => p.type === "tool-displayRestaurants") as
                                    | { output?: { restaurants?: Restaurant[] } }
                                    | undefined;
                                  const messagePicks = picksPart?.output?.restaurants ?? [];

                                  return deduplicatedParts.map((part, pIdx: number) => {
                                  if (isTextPart(part)) {
                                    return (
                                      <div key={pIdx}>
                                        <div
                                          className="message-content"
                                          dangerouslySetInnerHTML={{
                                            __html: linkifyText(boldPicks(part.text, messagePicks)),
                                          }}
                                        />
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
                                        return null; // Rendered below the bubble (see renderPicks)

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
                    </RemiBubble>

                    {/* Mobile: Remi's picks sit below his message, like a tapped marker's card */}
                    {renderPicks(msg, isLastMessage)}

                    {/* Quick prompts: shadcn's "Links and Buttons" bubble pattern, right-aligned tinted
                        bubbles that send when clicked. Gone once the conversation has started, or
                        once a tapped marker's card is showing (mobile). */}
                    {idx === 0 && !conversationStarted && !tappedRestaurant && (
                      <BubbleGroup>
                        {quickPrompts.map((prompt) => (
                          <Bubble key={prompt} variant="tinted" align="end">
                            <BubbleContent asChild className="shadow-xs hover:border-primary">
                              <button type="button" onClick={() => handleQuickPrompt(prompt.replace(/\*\*/g, ""))}>
                                {/* **…** marks the key words (semibold here, stripped before sending) */}
                                {prompt.split(/\*\*/).map((part, j) => (j % 2 ? <strong key={j} className="font-semibold">{part}</strong> : part))}
                              </button>
                            </BubbleContent>
                          </Bubble>
                        ))}
                      </BubbleGroup>
                    )}
                  </MessageContent>
                </Message>
              ) : (
                <Message
                  key={idx}
                  align="end"
                  className="chat-message user"
                  ref={isLastMessage ? lastMessageRef : null}
                >
                  <MessageContent>
                    <Bubble variant="user" align="end" className="max-w-[90%]">
                      <BubbleContent
                        className={USER_BUBBLE_CONTENT}
                        dangerouslySetInnerHTML={{ __html: linkifyText(msg.content) }}
                      />
                    </Bubble>
                  </MessageContent>
                </Message>
              );
            })}

            {/* A tapped marker's card, when there are no picks for it to replace */}
            {tappedCardAtEnd && tappedRestaurant && renderCards([tappedRestaurant], { picks: recommendedPicks, slot: true })}

            {isLoading && !canMergeLoading && (
              <Message className="chat-message assistant">
                <MessageContent>
                  <RemiBubble>
                    <RemiStatus stage={openingStage} />
                  </RemiBubble>
                </MessageContent>
              </Message>
            )}
          </div>

          {/* Input: shadcn InputGroup (auto-growing textarea, mic and send buttons inside) */}
          <InputGroup className="chat-input-container rounded-2xl border-border bg-background/95 shadow-xs backdrop-blur-sm has-[[data-slot=input-group-control]:focus-visible]:border-border has-[[data-slot=input-group-control]:focus-visible]:ring-0">
            <InputGroupTextarea
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
                    inputRef.current.style.height = "auto";
                  }
                }
              }}
              placeholder={isListening ? "Listening... tap mic to stop" : isTranscribing ? "Transcribing..." : "Search for a restaurant..."}
              disabled={isLoading || isListening || isTranscribing}
              // 14px keeps iOS from zooming in on focus; height is managed by autoResizeTextarea
              className="min-h-0 py-2.5 pl-4 font-sans text-[14px] leading-[1.4] [scrollbar-width:none] placeholder:text-grey"
              rows={1}
            />
            <InputGroupAddon align="inline-end" className="self-end pb-1.5">
              <InputGroupButton
                size="icon-sm"
                variant="ghost"
                onClick={toggleListening}
                disabled={isLoading || isTranscribing}
                className={cn(
                  "rounded-full text-muted-foreground hover:bg-secondary hover:text-primary",
                  isListening && "animate-pulse bg-secondary text-primary",
                  isTranscribing && "text-isochrone"
                )}
                title={isTranscribing ? "Transcribing..." : isListening ? "Click to stop" : "Voice input"}
                aria-label={isTranscribing ? "Transcribing..." : isListening ? "Click to stop" : "Voice input"}
              >
                {isTranscribing ? <LoaderCircle className="animate-spin" /> : <Mic />}
              </InputGroupButton>
              <InputGroupButton
                size="icon-sm"
                variant="default"
                onClick={() => {
                  handleSend();
                  // Reset textarea height after sending
                  if (inputRef.current) {
                    inputRef.current.style.height = "auto";
                  }
                }}
                disabled={isLoading || !input.trim()}
                className="rounded-full bg-charcoal text-white hover:bg-charcoal/85"
                aria-label="Send"
              >
                <ArrowUp />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </div>

      </div>
    );
  }
);

export default ChatInterface;
