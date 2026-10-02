export interface Restaurant {
  name: string;
  slug: string;
  borough: string;
  neighborhood: string;
  cuisine: string;
  summary: string;
  summary2?: string;
  website?: string;
  image_url?: string;
  meal_types?: string[];
  participation_weeks?: string[];
  participation_weeks2?: string;
  collections: string[];
  opentable_id?: string;
  table_res?: string;
  menu_url?: string;
  primary_location?: string;
  // Coordinates (from 2restaurant_geocoder.py)
  address?: string;
  latitude?: number;
  longitude?: number;
  extraction_success?: boolean;
  extraction_method?: string;
  // Characteristics (from 3restaurant_characteristics.py)
  telephone?: string;
  price_range?: string;
  facebook_url?: string;
  instagram_url?: string;
  nytourism_url?: string;
  // Michelin data (from join_michelin_data.py)
  michelin_award?: string;
  michelin_slug?: string;
  michelin_url?: string;
  // NYT Top 100 data (from join_nyt_data.py)
  nyttop100_rank?: string;
  nyt_url?: string;
  // Yelp data
  yelp_rating?: number;
  yelp_review_count?: number;
  yelp_url?: string;
  yelp_review_highlights?: string;
  // Additional fields
  price?: string;
  reddit?: string;
  // Set on chat results only: why Remi picked it (api/lib/matchReasons.ts)
  match_reason?: MatchReason;
}

export interface MatchReason {
  /** Straight-line distance from each pinned place, e.g. "0.4 mi from Union Square". */
  distances: string[];
  /** Filters it passed, e.g. "Italian", "$45 Lunch · $60 Dinner". */
  facts: string[];
  /** For vibe searches: the restaurant's own sentence that best matches the vibe, verbatim. */
  quote?: {
    text: string;
    field: "summary" | "summary2" | "yelp_review_highlights";
    source: "NYC Tourism" | "Yelp reviews";
  };
} 