import requests
import json
import time
from typing import List, Dict, Any

class RestaurantWeekScraper:
    def __init__(self):
        self.base_url = "https://program-api.nyctourism.com/restaurant-week"
        self.api_key = "lTQSe929f34fohKaNq0OH53mdVL0yncvtqmuUG6i"
        self.headers = {
            "Content-Type": "application/json",
            "X-Api-Key": self.api_key,
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Accept-Encoding": "gzip, deflate, br",
            "Accept-Language": "en-US,en;q=0.9",
            "Origin": "https://www.nyctourism.com",
            "Referer": "https://www.nyctourism.com/restaurant-week",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-site",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache"
        }
        
    def get_restaurants_page(self, page: int = 1, filters: Dict = None) -> Dict[str, Any]:
        """Get a single page of restaurants"""
        
        # Default payload structure based on the API response
        payload = {
            "page": page,
            "limit": 12,  # Based on the 12 restaurants per page shown on site
            "filters": filters or {}
        }
        
        try:
            print(f"Making request to: {self.base_url}")
            print(f"Headers: {self.headers}")
            print(f"Payload: {payload}")
            
            response = requests.post(
                self.base_url,
                headers=self.headers,
                json=payload,
                timeout=30
            )
            
            print(f"Response status: {response.status_code}")
            print(f"Response headers: {dict(response.headers)}")
            
            if response.status_code == 200:
                return response.json()
            else:
                print(f"Error {response.status_code}: {response.text}")
                return None
                
        except Exception as e:
            print(f"Request failed: {e}")
            return None
    
    def get_all_restaurants(self) -> List[Dict[str, Any]]:
        """Scrape all restaurants from all pages"""
        
        all_restaurants = []
        page = 1
        
        print("Starting to scrape all restaurants...")
        
        while True:
            print(f"Fetching page {page}...")
            
            data = self.get_restaurants_page(page)
            
            if not data or 'items' not in data:
                print(f"No data found for page {page}, stopping...")
                break
                
            restaurants = data['items']
            
            if not restaurants:
                print(f"No restaurants found on page {page}, stopping...")
                break
                
            all_restaurants.extend(restaurants)
            
            # Check if we've got all restaurants
            total_count = data.get('total', 0)
            current_count = len(all_restaurants)
            
            print(f"Got {len(restaurants)} restaurants from page {page}. Total so far: {current_count}/{total_count}")
            
            if current_count >= total_count:
                print("All restaurants collected!")
                break
                
            page += 1
            
            # Be nice to the API
            time.sleep(1)
        
        return all_restaurants
    
    def clean_restaurant_data(self, restaurants: List[Dict]) -> List[Dict]:
        """Extract and clean the essential data for each restaurant"""
        
        cleaned = []
        
        for restaurant in restaurants:
            try:
                # Extract key information
                clean_data = {
                    'name': restaurant.get('shortTitle', ''),
                    'slug': restaurant.get('slug', ''),
                    'borough': restaurant.get('borough', ''),
                    'neighborhood': restaurant.get('neighborhood', ''),
                    'cuisine': restaurant.get('tags', []),  # First tag is usually cuisine
                    'summary': restaurant.get('summary', ''),
                    'website': restaurant.get('website', ''),
                    'image_url': restaurant.get('image', {}).get('url', ''),
                    'meal_types': restaurant.get('mealTypes', []),
                    'participation_weeks': restaurant.get('restaurantInclusionWeek', []),
                    'collections': restaurant.get('collections', []),
                    'opentable_id': restaurant.get('ecommerce', {}).get('partnerId', ''),
                    'menu_url': restaurant.get('menuFileUrl', ''),
                    'primary_location': restaurant.get('primaryLocation', '')
                }
                
                # Extract pricing info from meal types
                pricing = {
                    'lunch_30': any('$30 Lunch' in meal for meal in clean_data['meal_types']),
                    'lunch_45': any('$45 Lunch' in meal for meal in clean_data['meal_types']),
                    'lunch_60': any('$60 Lunch' in meal for meal in clean_data['meal_types']),
                    'dinner_30': any('$30 Dinner' in meal for meal in clean_data['meal_types']),
                    'dinner_45': any('$45 Dinner' in meal for meal in clean_data['meal_types']),
                    'dinner_60': any('$60 Dinner' in meal for meal in clean_data['meal_types'])
                }
                
                clean_data['pricing'] = pricing
                
                cleaned.append(clean_data)
                
            except Exception as e:
                print(f"Error cleaning restaurant data: {e}")
                continue
                
        return cleaned
    
    def save_data(self, restaurants: List[Dict], filename: str = "nyc_restaurant_week_2025.json"):
        """Save restaurant data to JSON file"""
        
        try:
            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(restaurants, f, indent=2, ensure_ascii=False)
            print(f"Data saved to {filename}")
            
        except Exception as e:
            print(f"Error saving data: {e}")

def main():
    """Main scraping function"""
    
    scraper = RestaurantWeekScraper()
    
    # Get all restaurants
    raw_restaurants = scraper.get_all_restaurants()
    
    if raw_restaurants:
        print(f"\nSuccessfully scraped {len(raw_restaurants)} restaurants!")
        
        # Clean the data
        clean_restaurants = scraper.clean_restaurant_data(raw_restaurants)
        
        # Save both raw and cleaned data
        scraper.save_data(raw_restaurants, "raw_restaurant_data.json")
        scraper.save_data(clean_restaurants, "clean_restaurant_data.json")
        
        # Print some stats
        print(f"\nSummary:")
        print(f"Total restaurants: {len(clean_restaurants)}")
        
        boroughs = {}
        cuisines = {}
        
        for restaurant in clean_restaurants:
            borough = restaurant['borough']
            boroughs[borough] = boroughs.get(borough, 0) + 1
            
            for cuisine in restaurant['cuisine']:
                cuisines[cuisine] = cuisines.get(cuisine, 0) + 1
        
        print(f"\nBy Borough:")
        for borough, count in sorted(boroughs.items()):
            print(f"  {borough}: {count}")
            
        print(f"\nTop 10 Cuisines:")
        for cuisine, count in sorted(cuisines.items(), key=lambda x: x[1], reverse=True)[:10]:
            print(f"  {cuisine}: {count}")
    
    else:
        print("Failed to scrape restaurants")

if __name__ == "__main__":
    main() 