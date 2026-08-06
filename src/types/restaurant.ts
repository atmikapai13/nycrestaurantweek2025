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
  gallery_images?: { url: string; alt: string }[];
  meal_types?: string[];
  // From 7_join_menu_tags.py — derived from extracted Restaurant Week menu PDFs
  raw_bar?: boolean;
  drinks_tag?: "wine_pairing" | "included" | "discount";
  course_counts?: ("2" | "3" | "4+")[];
  bonus_course?: boolean;
  participation_weeks?: string[];
  participation_weeks2?: string;
  collections?: string[];
  // World Cup 2026 (Five Borough Winners Special) fields
  promotions?: string[];
  limited_edition_cup?: boolean;
  has_26_offer?: boolean;
  // Deal categories (from 5_TagDeals.py) — drive the deal filter toggles
  deal_tags?: string[];
  offer_url?: string;
  image_credit?: string;
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
} 