import requests
import json
import time
from typing import List, Dict, Optional
import urllib.parse
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor, as_completed

class MichelinAlgoliaScraper:
    def __init__(self):
        # Algolia API configuration from your network analysis
        self.algolia_api_key = "3222e669cf890dc73fa5f38241117ba5"
        self.algolia_app_id = "8NVHRD7ONV"
        
        # Build the Algolia search URL (correct format from your trace)
        self.base_url = f"https://{self.algolia_app_id}-1.algolianet.com/1/indexes/*/queries"
        
        # Headers from your network analysis
        self.headers = {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
            'Origin': 'https://guide.michelin.com',
            'Referer': 'https://guide.michelin.com/us/en/new-york-state/new-york/restaurants/all-starred?sort=distance',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'cross-site',
        }
        
        # Headers for individual page requests
        self.page_headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
        }
    
    def search_michelin_restaurants(self, page: int = 0, hits_per_page: int = 48, include_bib_gourmand: bool = True) -> Optional[Dict]:
        """Search for Michelin starred restaurants using Algolia API"""
        
        # URL parameters (from your network trace)
        url_params = {
            'x-algolia-agent': 'Algolia for JavaScript (4.19.1); Browser (lite)',
            'x-algolia-api-key': self.algolia_api_key,
            'x-algolia-application-id': self.algolia_app_id
        }
        
        # Build URL with query parameters
        url_with_params = f"{self.base_url}?" + "&".join([f"{k}={urllib.parse.quote(str(v))}" for k, v in url_params.items()])
        
        # Build facet filters - include both stars and Bib Gourmand
        distinction_filters = [
            "distinction.slug:1-star-michelin",
            "distinction.slug:2-stars-michelin", 
            "distinction.slug:3-stars-michelin"
        ]
        
        if include_bib_gourmand:
            distinction_filters.append("distinction.slug:bib-gourmand")
        
        # Build the facet filter string properly
        quoted_filters = [f'"{f}"' for f in distinction_filters]
        facet_filters = f'[[{",".join(quoted_filters)}]]'
        
        # Build the request parameters (URL-encoded as seen in your trace)
        request_params = {
            "aroundLatLng": "40.7130466,-74.0072301",
            "aroundLatLngViaIP": "false",
            "aroundRadius": "30000",
            "attributesToHighlight": "[]",
            "attributesToRetrieve": '["name","slug","cuisines","chef","michelin_award","distinction","city","area_name","_geoloc","description","summary","about","content","text"]',
            "facetFilters": facet_filters,
            "facets": '["area_slug","booking_provider","categories.lvl0","city.slug","country.cname","country.slug","cuisines.slug","distinction.slug","facilities.slug","good_menu","green_star.slug","meal_times","new_table","offers","online_booking","price_category.slug","region.slug","take_away","with_michelin_guide_hotels"]',
            "filters": "status:Published",
            "hitsPerPage": str(hits_per_page),
            "maxValuesPerFacet": "200",
            "optionalFilters": "sites:us",
            "page": str(page),
            "query": "",
            "tagFilters": ""
        }
        
        # Create the params string (URL-encoded)
        params_string = "&".join([f"{key}={urllib.parse.quote(str(value))}" for key, value in request_params.items()])
        
        # Create the payload structure exactly like your network trace
        payload = {
            "requests": [
                {
                    "indexName": "prod-restaurants-en_sort_geo",
                    "params": params_string
                }
            ]
        }
        
        # Convert payload to JSON string
        payload_json = json.dumps(payload)
        
        try:
            filter_type = "Michelin stars + Bib Gourmand" if include_bib_gourmand else "Michelin stars only"
            print(f"🔍 Searching page {page + 1} ({filter_type}, up to {hits_per_page} restaurants)...")
            
            response = requests.post(
                url_with_params,
                headers=self.headers,
                data=payload_json,
                timeout=30
            )
            
            if response.status_code == 200:
                data = response.json()
                # Algolia returns results in a "results" array
                if 'results' in data and len(data['results']) > 0:
                    result = data['results'][0]  # First (and only) query result
                    hits = result.get('hits', [])
                    print(f"✅ Found {len(hits)} restaurants on page {page + 1}")
                    return result
                else:
                    print(f"⚠️ No results in response")
                    return None
            else:
                print(f"❌ Error: HTTP {response.status_code}")
                print(f"Response: {response.text}")
                return None
                
        except Exception as e:
            print(f"❌ Request failed: {e}")
            return None
    
    def get_all_michelin_restaurants(self, include_bib_gourmand: bool = True) -> List[Dict]:
        """Get all Michelin starred restaurants in NYC area"""
        
        filter_type = "Michelin stars + Bib Gourmand" if include_bib_gourmand else "Michelin stars only"
        print(f"🌟 Starting Michelin restaurant scraping ({filter_type})...")
        
        all_restaurants = []
        page = 0
        hits_per_page = 48  # Default from your network trace
        
        while True:
            data = self.search_michelin_restaurants(page, hits_per_page, include_bib_gourmand)
            
            if not data:
                print(f"No data returned for page {page + 1}, stopping...")
                break
            
            hits = data.get('hits', [])
            
            if not hits:
                print(f"No restaurants found on page {page + 1}, stopping...")
                break
            
            all_restaurants.extend(hits)
            
            # Check if we've got all results
            total_hits = data.get('nbHits', 0)
            print(f"Page {page + 1}: {len(hits)} restaurants. Total so far: {len(all_restaurants)}/{total_hits}")
            
            # If we got fewer results than requested, we're done
            if len(hits) < hits_per_page:
                print("✅ Reached end of results")
                break
            
            # If we've collected all available results
            if len(all_restaurants) >= total_hits:
                print("✅ All restaurants collected!")
                break
            
            page += 1
            
            # Safety break to avoid infinite loops
            if page > 20:  # Reasonable limit
                print("⚠️ Reached page limit, stopping...")
                break
        
        return all_restaurants
    
    def get_restaurant_description(self, slug: str) -> Optional[str]:
        """Extract description from a restaurant's individual page"""
        
        url = f"https://guide.michelin.com/us/en/new-york-state/new-york/restaurant/{slug}"
        
        try:
            response = requests.get(url, headers=self.page_headers, timeout=30)
            
            if response.status_code == 200:
                soup = BeautifulSoup(response.content, 'html.parser')
                
                # Look for the data-sheet__description element
                description_element = soup.find('div', class_='data-sheet__description')
                
                if description_element:
                    description = description_element.get_text(strip=True)
                    return description
                else:
                    return None
                    
            else:
                return None
                
        except Exception as e:
            print(f"❌ Error fetching description for {slug}: {e}")
            return None
    
    def extract_descriptions_for_restaurants(self, restaurants: List[Dict], max_workers: int = 5, delay_seconds: float = 0.5) -> List[Dict]:
        """Extract descriptions for all restaurants using parallel processing"""
        
        print(f"🌟 Starting parallel description extraction for {len(restaurants)} restaurants...")
        print(f"   Using {max_workers} workers with {delay_seconds}s delay between requests")
        
        restaurants_with_descriptions = []
        successful = 0
        failed = 0
        
        # Create a thread-safe counter for progress tracking
        from threading import Lock
        progress_lock = Lock()
        
        def extract_single_description(restaurant):
            """Extract description for a single restaurant"""
            nonlocal successful, failed
            
            try:
                description = self.get_restaurant_description(restaurant['slug'])
                
                # Add description to restaurant data
                restaurant_with_desc = restaurant.copy()
                if description:
                    restaurant_with_desc['description'] = description
                    with progress_lock:
                        successful += 1
                    print(f"   ✅ [{restaurant['name']}] Found description ({len(description)} characters)")
                else:
                    restaurant_with_desc['description'] = None
                    with progress_lock:
                        failed += 1
                    print(f"   ⚠️ [{restaurant['name']}] No description found")
                
                return restaurant_with_desc
                
            except Exception as e:
                with progress_lock:
                    failed += 1
                print(f"   ❌ [{restaurant['name']}] Error: {e}")
                restaurant_with_desc = restaurant.copy()
                restaurant_with_desc['description'] = None
                return restaurant_with_desc
        
        # Use ThreadPoolExecutor for parallel processing
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # Submit all tasks
            future_to_restaurant = {
                executor.submit(extract_single_description, restaurant): restaurant 
                for restaurant in restaurants
            }
            
            # Process completed tasks
            for i, future in enumerate(as_completed(future_to_restaurant), 1):
                restaurant_with_desc = future.result()
                restaurants_with_descriptions.append(restaurant_with_desc)
                
                # Progress update
                print(f"📝 Progress: {i}/{len(restaurants)} restaurants processed")
                
                # Small delay to be respectful to servers
                if i < len(restaurants):
                    time.sleep(delay_seconds)
        
        # Sort results to maintain original order using slug
        restaurants_with_descriptions.sort(key=lambda x: next(i for i, r in enumerate(restaurants) if r['slug'] == x['slug']))
        
        print(f"\n📊 Description extraction summary:")
        print(f"   Total restaurants: {len(restaurants)}")
        print(f"   Successful extractions: {successful}")
        print(f"   Failed extractions: {failed}")
        print(f"   Success rate: {(successful/len(restaurants)*100):.1f}%")
        
        return restaurants_with_descriptions
    
    def clean_restaurant_data(self, restaurants: List[Dict]) -> List[Dict]:
        """Extract and clean restaurant data"""
        
        cleaned = []
        
        for restaurant in restaurants:
            try:
                # Extract first cuisine label only
                cuisines = restaurant.get('cuisines', [])
                cuisine_label = None
                if cuisines and len(cuisines) > 0:
                    first_cuisine = cuisines[0]
                    if isinstance(first_cuisine, dict) and 'label' in first_cuisine:
                        cuisine_label = first_cuisine['label']
                    elif isinstance(first_cuisine, str):
                        cuisine_label = first_cuisine
                
                # Extract latitude and longitude from _geoloc
                geoloc = restaurant.get('_geoloc', {})
                latitude = geoloc.get('lat') if geoloc else None
                longitude = geoloc.get('lng') if geoloc else None
                
                # Extract only the specified fields
                clean_data = {
                    'name': restaurant.get('name', ''),
                    'slug': restaurant.get('slug', ''),
                    'michelin_award': restaurant.get('michelin_award', ''),
                    'cuisine': cuisine_label,
                    'latitude': latitude,
                    'longitude': longitude,
                    'description': restaurant.get('description', None)
                }
                
                cleaned.append(clean_data)
                
            except Exception as e:
                print(f"Error cleaning restaurant data: {e}")
                continue
        
        return cleaned
    
    def save_data(self, restaurants: List[Dict], filename: str = "../data/Lists/MichelinNYC.json"):
        """Save restaurant data to JSON file"""
        
        try:
            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(restaurants, f, indent=2, ensure_ascii=False)
            print(f"💾 Data saved to {filename}")
            
        except Exception as e:
            print(f"Error saving data: {e}")

def main():
    """Main scraping function"""
    
    scraper = MichelinAlgoliaScraper()
    
    # Get all Michelin restaurants (including Bib Gourmand by default)
    raw_restaurants = scraper.get_all_michelin_restaurants(include_bib_gourmand=True)
    
    if raw_restaurants:
        print(f"\n🎉 Successfully scraped {len(raw_restaurants)} Michelin restaurants!")
        
        # Extract descriptions for all restaurants using parallel processing
        print(f"\n🌟 Starting description extraction...")
        restaurants_with_descriptions = scraper.extract_descriptions_for_restaurants(
            raw_restaurants, 
            max_workers=5,  # Process 5 restaurants simultaneously
            delay_seconds=0.5  # 0.5 second delay between requests
        )
        
        # Clean the data (now including descriptions)
        clean_restaurants = scraper.clean_restaurant_data(restaurants_with_descriptions)
        
        # Save both raw and cleaned data
        scraper.save_data(restaurants_with_descriptions, "../data/Lists/MichelinNYC_Raw.json")
        scraper.save_data(clean_restaurants, "../data/Lists/MichelinNYC.json")
        
        # Print summary stats
        print(f"\n📊 Summary:")
        print(f"Total restaurants: {len(clean_restaurants)}")
        
        # Count restaurants with descriptions
        with_descriptions = sum(1 for r in clean_restaurants if r.get('description'))
        print(f"Restaurants with descriptions: {with_descriptions}")
        
        # Show some examples
        print(f"\n📋 Sample restaurants:")
        for i, restaurant in enumerate(clean_restaurants[:5]):
            print(f"\n   {i+1}. {restaurant['name']}")
            print(f"      Slug: {restaurant['slug']}")
            print(f"      Award: {restaurant['michelin_award']}")
            print(f"      Cuisine: {restaurant.get('cuisine', 'N/A')}")
            print(f"      Location: {restaurant.get('latitude', 'N/A')}, {restaurant.get('longitude', 'N/A')}")
            if restaurant.get('description'):
                print(f"      Description: {restaurant['description'][:100]}...")
            else:
                print(f"      Description: Not available")
    
    else:
        print("❌ Failed to scrape restaurants")

if __name__ == "__main__":
    main()