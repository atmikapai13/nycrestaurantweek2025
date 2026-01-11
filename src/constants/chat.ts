/**
 * Chat interface constants
 * Welcome messages, suggestions, tips, and configuration values
 */

export interface Suggestion {
  label: string;
  prompt: string[];
}

// =============================================================================
// Welcome Messages
// =============================================================================

export const WELCOME_MESSAGES = [
  "Welcome to NYC Eats! I'm Remi. Unlike my cousins in the subway, I've been vector-embedded with thousands of Yelp reviews and have a rather refined palate for semantic similarity. What are we looking for today? <br><br> If you're new here, click on one of the suggestions to see how I can help you in your culinary adventures:",
  "Welcome to NYC Eats! I'm Remi. You're in New York, where the only real sin is eating somewhere forgettable. Give me a neighborhood, a mood, or a friend you're meeting halfway—I'll point you toward the right places. <br><br> If you're new here, click on one of the suggestions to see how I can help you in your culinary adventures:",
  "Welcome to NYC Eats! I'm Remi, here to help you find the sort of restaurant that lingers — the way a good Barolo does. Give me a neighborhood or a mood, and I'll pour you a shortlist worth considering.<br><br> If you're new here, click on one of the suggestions to see how I can help you in your culinary adventures:",
];

// =============================================================================
// Quick-start Suggestions
// =============================================================================

export const SUGGESTIONS: Suggestion[] = [
  {
    label: "Near Me",
    prompt: [
      "I'm in Soho, hunting for $$ spot I can reach in under 15 mins. What's on the menu, Remi?",
      "Any good italian places by 15 min transit from 46th and 7th ave?",
      "Any places with good drinks within 15 min of West Village?",
      "Show me hole in the wall restaurants by Roosevelt Island Tramway with 4 rating or higher",
    ],
  },
  {
    label: "Between Us",
    prompt: [
      "My friend is in Midtown, I'm in Murray Hill — what's some restaurants in between us within a short 10 min transit?",
      "I'm in Chelsea. Show me restaurants around the area excluding Hudson Yards, because it is a bit expensive.",
      "I'm in Greenwich village, and I can travel 15 minutes by subway. My friend is in Midtown. Find spots between us, Remi.",
    ],
  },
  {
    label: "Vibes",
    prompt: [
      "Remi, give me couple places that are good for date night and perhaps $$.",
      "Remi, show me award-winning restaurants at $$ or $$$ price point.",
      "Remi, find me a couple restaurants that are modest and cozy.",
      "Remi, find me hole in the wall restaurants, and tell me what's your definition for it.",
    ],
  },
];

// =============================================================================
// Meta-learning Suggestions
// =============================================================================

export const META_LEARNING_SUGGESTIONS = [
  "How do you work, Remi?",
  "What was the genesis of this project?",
];

// =============================================================================
// Loading Tips
// =============================================================================

export const TIPS = [
  "Tap a restaurant on the map, then hit the heart to favorite it.",
  "To get curated restaurant recs, stack queries in one prompt (e.g., Italian restaurants with 4★ or higher).",
  "Click 'match your taste' in the map legend to isolate those restaurants on the map.",
  "Ask 'find me a spot between us' when meeting a friend—Remi will find restaurants in the overlap zone.",
  "Award-winning spots—Michelin, Bib Gourmand, or NYC Top 100—are marked with orange pins.",
  "Hit refresh in chat to clear the map and start over.",
  "Ask Remi about vibes and ambiance—he can search for 'cozy', 'romantic', 'lively', and more.",
  "After an isochrone is generated, refine it further by cuisine, rating, or vibes (e.g., Italian, 4.5★ or higher, lively).",
  "Remi can find restaurants you can reach by walking, transit, or driving — à la isochrones!",
  "An isochrone is a boundary on the map showing how far you can go in a set time. Remi is good at making isochrones!",
  "The current restaurant pool is limited to NYC Restaurant Week and Manhattan. Buy me creator a coffee with a note if you want to expand the pool: buymeacoffee.com/atmikapai",
  "Click on a restaurant in the map to learn more.",
  "If you like this, buy me creator a coffee: buymeacoffee.com/atmikapai . Cheers!",
];

// =============================================================================
// Breakout Phrases (for isochrone conflict detection)
// =============================================================================

export const BREAKOUT_PHRASES = [
  "across all of nyc",
  "across nyc",
  "all of nyc",
  "everywhere in nyc",
  "citywide",
  "all restaurants",
  "throughout nyc",
  "anywhere in nyc",
];

// =============================================================================
// Drawer Height Constants
// =============================================================================

export const DRAWER_HEIGHT_THRESHOLDS = {
  COLLAPSED: 8,
  PARTIAL: 40,
  FULL: 80,
  SNAP_THRESHOLD_LOW: 25,
  SNAP_THRESHOLD_HIGH: 60,
} as const;

// =============================================================================
// Feature Configuration
// =============================================================================

export const CHAT_CONFIG = {
  TIP_PROBABILITY: 0.6, // 60% chance to show a tip while loading
  SCROLL_DELAY_MS: 100,
  RESET_DELAY_MS: 100,
} as const;

