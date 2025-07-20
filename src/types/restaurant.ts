export interface Restaurant {
  name: string;
  slug: string;
  borough: string;
  neighborhood: string;
  cuisine: string[];
  summary: string;
  website?: string;
  image_url?: string;
  meal_types: string[];
  participation_weeks: string[];
  collections: string[];
  opentable_id?: string;
  menu_url?: string;
  primary_location?: string;
  pricing: {
    lunch_30: boolean;
    lunch_45: boolean;
    lunch_60: boolean;
    dinner_30: boolean;
    dinner_45: boolean;
    dinner_60: boolean;
  };
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
} 