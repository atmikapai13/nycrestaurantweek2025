import requests
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict, Any

class FastRestaurantWeekScraper:
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
        
    def get_restaurants_page(self, page: int) -> Dict[str, Any]:
        """Get a single page of restaurants"""
        payload = {
            "page": page,
            "limit": 12,
            "filters": {}
        }
        
        try:
            response = requests.post(
                self.base_url,
                headers=self.headers,
                json=payload,
                timeout=10  # Reduced timeout
            )
            
            if response.status_code == 200:
                return response.json()
            else:
                print(f"Error on page {page}: {response.status_code}")
                return None
                
        except Exception as e:
            print(f"Request failed for page {page}: {e}")
            return None

    def get_all_restaurants_fast(self) -> List[Dict[str, Any]]:
        """Scrape all restaurants using parallel requests"""
        
        print("🚀 Fast scraping all restaurants...")
        
        # First, get page 1 to find total count
        first_page = self.get_restaurants_page(1)
        if not first_page:
            print("Failed to get first page")
            return []
            
        total_restaurants = first_page.get('total', 606)
        restaurants_per_page = len(first_page.get('items', []))
        total_pages = (total_restaurants + restaurants_per_page - 1) // restaurants_per_page
        
        print(f"Total restaurants: {total_restaurants}")
        print(f"Total pages to fetch: {total_pages}")
        
        all_restaurants = first_page.get('items', [])
        
        # Parallel fetch remaining pages
        with ThreadPoolExecutor(max_workers=8) as executor:  # 8 concurrent requests
            # Submit all page requests
            future_to_page = {
                executor.submit(self.get_restaurants_page, page): page 
                for page in range(2, total_pages + 1)
            }
            
            # Collect results as they complete
            for future in as_completed(future_to_page):
                page_num = future_to_page[future]
                try:
                    data = future.result()
                    if data and 'items' in data:
                        restaurants = data['items']
                        all_restaurants.extend(restaurants)
                        print(f"✅ Page {page_num}: {len(restaurants)} restaurants")
                    else:
                        print(f"❌ Page {page_num}: No data")
                except Exception as e:
                    print(f"❌ Page {page_num}: {e}")
        
        print(f"\n🎉 Completed! Got {len(all_restaurants)} total restaurants")
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
                    'cuisine': restaurant.get('tags', []),
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
    
    def save_data(self, restaurants: List[Dict], filename: str):
        """Save restaurant data to JSON file"""
        
        try:
            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(restaurants, f, indent=2, ensure_ascii=False)
            print(f"💾 Data saved to {filename}")
            
        except Exception as e:
            print(f"Error saving data: {e}")

def main():
    """Main scraping function using parallel requests"""
    
    scraper = FastRestaurantWeekScraper()
    
    print("🚀 Starting parallel scraping using parallel requests (8 concurrent threads)...")
    
    start_time = time.time()
    raw_restaurants = scraper.get_all_restaurants_fast()
    end_time = time.time()
    
    if raw_restaurants:
        print(f"\n⏱️  Scraping completed in {end_time - start_time:.1f} seconds!")
        print(f"📊 Total restaurants: {len(raw_restaurants)}")
        
        # Clean and save data
        clean_restaurants = scraper.clean_restaurant_data(raw_restaurants)
        scraper.save_data(raw_restaurants, "raw_restaurant_data.json")
        scraper.save_data(clean_restaurants, "clean_restaurant_data.json")
        
        # Print summary stats
        boroughs = {}
        for restaurant in clean_restaurants:
            borough = restaurant['borough']
            boroughs[borough] = boroughs.get(borough, 0) + 1
        
        print(f"\n📍 By Borough:")
        for borough, count in sorted(boroughs.items()):
            print(f"   {borough}: {count}")
    
    else:
        print("❌ Scraping failed")

if __name__ == "__main__":
    main()