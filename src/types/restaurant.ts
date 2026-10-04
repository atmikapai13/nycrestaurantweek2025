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
  // Set on chat results only: why Remi picked it (api/_lib/matchReasons.ts)
  match_reason?: MatchReason;
}

export interface MatchReason {
  /** Travel time from each pinned place by the search's mode, e.g. "7 min from Union Square" (miles if routing failed). */
  distances: string[];
  /** The pinned place behind each distance (same order), to match it to its map marker. */
  pins?: Array<{ latitude: number; longitude: number; isUser: boolean }>;
  /** How the search assumed people travel, for the distance-line icon. */
  travelMode?: "walking" | "cycling" | "driving" | "transit";
  /** Mode actually used per distance line (a transit search walks short hops); null = miles. */
  legModes?: Array<"walking" | "cycling" | "driving" | "transit" | null>;
  /** Minutes from each pinned place (same order) on foot, by bike and by transit ("within N"); null = unavailable. */
  times?: Array<{ walking: number | null; cycling: number | null; transit: number | null }>;
  /** Filters it passed, e.g. "Italian", "$45 Lunch · $60 Dinner". */
  facts: string[];
  /** For vibe searches: the restaurant's own sentence that best matches the vibe, verbatim. */
  quote?: {
    text: string;
    field: "summary" | "summary2" | "yelp_review_highlights";
    source: "NYC Tourism" | "Yelp reviews";
  };
} 