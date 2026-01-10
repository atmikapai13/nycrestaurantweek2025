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
  // Michelin data (from join_michelin_data.py)
  michelin_award?: string;
  michelin_slug?: string;
  // NYT Top 100 data (from join_nyt_data.py)
  nyttop100_rank?: string;
  // Yelp data
  yelp_rating?: number;
  yelp_review_count?: number;
  yelp_url?: string;
  yelp_review_highlights?: string;
  // Additional fields
  price?: string;
  reddit?: string;
} 