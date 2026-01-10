import json
import requests
import time
import threading
from typing import List, Dict, Optional, Tuple
import re
from concurrent.futures import ThreadPoolExecutor, as_completed

class RestaurantCoordinateExtractor:
    def __init__(self):
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
        }

        # Rate limiting for faster but respectful scraping
        self.request_delay = 0.1  # 100ms between requests
        self.last_request_time = 0
        self.request_lock = threading.Lock()

        # Rate limiting for Mapbox API
        self.mapbox_request_count = 0
        self.mapbox_request_limit = 100  # Max 100 requests per minute (free tier safety)
        self.mapbox_last_reset = time.time()
    
    def extract_restaurant_data(self, restaurant: Dict) -> Dict:
        """Extract coordinates and address from restaurant's page source"""
        
        slug = restaurant.get('slug', '')
        restaurant_name = restaurant.get('name', 'Unknown')
        
        if not slug:
            print(f"  ❌ No slug found")
            return {
                'address': None,
                'latitude': None,
                'longitude': None
            }
        
        restaurant_url = f"https://www.nyctourism.com/restaurant-week/{slug}/"
        
        try:
            # Rate limiting
            with self.request_lock:
                current_time = time.time()
                time_since_last = current_time - self.last_request_time
                
                if time_since_last < self.request_delay:
                    sleep_time = self.request_delay - time_since_last
                    time.sleep(sleep_time)
                
                self.last_request_time = time.time()
            
            print(f"  🌐 Fetching: {restaurant_url}")
            
            response = requests.get(restaurant_url, headers=self.headers, timeout=10)
            
            if response.status_code == 200:
                page_content = response.text
                
                # Extract JSON data from page source
                extracted_data = self.extract_json_data(page_content, restaurant_name)
                
                if extracted_data['extraction_success']:
                    print(f"  ✅ Found: {extracted_data['address']} -> ({extracted_data['latitude']:.4f}, {extracted_data['longitude']:.4f})")
                else:
                    print(f"  ❌ {extracted_data['error']}")
                
                # Remove tracking fields before returning
                clean_data = {
                    'address': extracted_data.get('address'),
                    'latitude': extracted_data.get('latitude'),
                    'longitude': extracted_data.get('longitude'),
                }
                return clean_data
                
            else:
                print(f"  ❌ HTTP {response.status_code}")
                return {
                    'address': None,
                    'latitude': None,
                    'longitude': None
                }
                
        except Exception as e:
            print(f"  ❌ Error: {e}")
            return {
                'address': None,
                'latitude': None,
                'longitude': None
            }

    def extract_from_staticmap(self, page_content: str) -> Optional[Tuple[float, float]]:
        """Extract coordinates from Google Maps staticmap URL with full precision"""
        # Pattern captures all decimal places (typically 7+ decimals from Google Maps)
        pattern = r'maps\.googleapis\.com/maps/api/staticmap\?center=([+-]?\d+\.\d+),([+-]?\d+\.\d+)'
        matches = re.search(pattern, page_content)

        if matches:
            lat_str, lon_str = matches.groups()
            # Convert to float preserving all decimal places
            return (float(lat_str), float(lon_str))

        return None

    def extract_address_from_html(self, page_content: str) -> Optional[str]:
        """Extract address from HTML content"""

        # Try pattern 1: locationAddress div
        pattern1 = r'<div[^>]*class="[^"]*locationAddress[^"]*"[^>]*>(.*?)</div>'
        matches = re.search(pattern1, page_content, re.DOTALL)
        if matches:
            html_block = matches.group(1)
            # Extract text from <p> tags
            text_pattern = r'<p[^>]*>(.*?)</p>'
            text_matches = re.findall(text_pattern, html_block, re.DOTALL)
            if text_matches:
                # Clean HTML entities and whitespace
                address = text_matches[0].strip()
                address = re.sub(r'\s+', ' ', address)  # Normalize whitespace
                if len(address) > 10:  # Sanity check
                    return address

        # Try pattern 2: Location section
        pattern2 = r'<p[^>]*>\s*(\d+[^<]+(?:Manhattan|Brooklyn|Queens|Bronx|Staten Island)[^<]*\d{5})\s*</p>'
        matches = re.search(pattern2, page_content, re.IGNORECASE)
        if matches:
            return matches.group(1).strip()

        # Try pattern 3: Broader NYC address pattern
        pattern3 = r'(\d+\s+[NSEW]\.?\s+\w+\s+(?:St\.|Street|Ave\.|Avenue|Blvd\.|Boulevard|Rd\.|Road|Pl\.|Place)[^,]*,\s*(?:Manhattan|Brooklyn|Queens|Bronx|Staten Island),?\s*NY,?\s*\d{5})'
        matches = re.search(pattern3, page_content, re.IGNORECASE)
        if matches:
            return matches.group(1).strip()

        return None

    def geocode_with_mapbox(self, address: str) -> Optional[Tuple[float, float, str]]:
        """Geocode address using Mapbox Geocoding API"""
        import urllib.parse

        MAPBOX_TOKEN = 'pk.eyJ1IjoiYXRtaWthcGFpMTMiLCJhIjoiY21idHR4eTJpMDdhMjJsb20zNmZheTZ6ayJ9.d_bQSBzesyiCUMA-YHRoIA'
        MANHATTAN_BBOX = '-74.02,40.68,-73.91,40.88'  # [minLon,minLat,maxLon,maxLat]
        NYC_CENTER = '-73.9712,40.7831'  # [lon,lat]

        # Check rate limit
        current_time = time.time()
        if current_time - self.mapbox_last_reset > 60:
            # Reset counter every minute
            self.mapbox_request_count = 0
            self.mapbox_last_reset = current_time

        if self.mapbox_request_count >= self.mapbox_request_limit:
            print(f"      ⚠️  Mapbox rate limit reached, waiting...")
            time.sleep(60 - (current_time - self.mapbox_last_reset))
            self.mapbox_request_count = 0
            self.mapbox_last_reset = time.time()

        self.mapbox_request_count += 1

        try:
            # URL encode the address
            encoded_address = urllib.parse.quote(address)

            params = {
                'access_token': MAPBOX_TOKEN,
                'bbox': MANHATTAN_BBOX,
                'proximity': NYC_CENTER,
                'limit': 1,
                'types': 'address,poi'  # Focus on addresses and points of interest
            }

            url = f'https://api.mapbox.com/geocoding/v5/mapbox.places/{encoded_address}.json'

            response = requests.get(url, params=params, timeout=5)

            if response.status_code == 200:
                data = response.json()
                if data.get('features') and len(data['features']) > 0:
                    feature = data['features'][0]

                    # Mapbox returns coordinates as [lon, lat]
                    lon, lat = feature['geometry']['coordinates']

                    # Get formatted address
                    formatted = feature.get('place_name', address)

                    return (lat, lon, formatted)

            return None

        except Exception as e:
            print(f"      Mapbox error: {e}")
            return None

    def extract_json_data(self, page_content: str, restaurant_name: str) -> Dict:
        """Extract address and coordinates using staticmap and Mapbox geocoding"""

        # STRATEGY 1: Extract from Google Maps staticmap URL (PRIMARY)
        coords = self.extract_from_staticmap(page_content)
        if coords:
            lat, lon = coords
            # Try to get address separately
            address = self.extract_address_from_html(page_content)

            return {
                'address': address or 'Address not found',
                'latitude': lat,
                'longitude': lon,
                'extraction_success': True,
                'error': None
            }

        # STRATEGY 2: Extract address and geocode via Mapbox (SECONDARY)
        address = self.extract_address_from_html(page_content)
        if address:
            geocode_result = self.geocode_with_mapbox(address)
            if geocode_result:
                lat, lon, formatted_address = geocode_result

                return {
                    'address': formatted_address,
                    'latitude': lat,
                    'longitude': lon,
                    'extraction_success': True,
                    'error': None
                }

        # If both strategies fail
        return {
            'address': None,
            'latitude': None,
            'longitude': None,
            'extraction_success': False,
            'error': 'Both extraction strategies failed'
        }

    def process_restaurant_with_progress(self, restaurant_data) -> Dict:
        """Process a single restaurant with progress tracking"""
        
        index, total, restaurant = restaurant_data
        restaurant_name = restaurant.get('name', 'Unknown')
        
        print(f"[{index}/{total}] {restaurant_name}")
        
        extracted_data = self.extract_restaurant_data(restaurant)
        
        # Add extracted data to restaurant
        restaurant_copy = restaurant.copy()
        restaurant_copy.update(extracted_data)
        
        return restaurant_copy
    
    def extract_all_coordinates(self, restaurants: List[Dict]) -> List[Dict]:
        """Extract coordinates for all restaurants"""
        
        print(f"📍 Starting coordinate extraction for {len(restaurants)} restaurants...")
        print(f"⏱️  Estimated time: ~{len(restaurants) * 0.5 / 60:.1f} minutes")
        
        results = []
        
        # Prepare data with progress info
        restaurant_data = [(i+1, len(restaurants), restaurant) 
                          for i, restaurant in enumerate(restaurants)]
        
        # Use parallel processing for speed
        with ThreadPoolExecutor(max_workers=10) as executor:
            future_to_restaurant = {
                executor.submit(self.process_restaurant_with_progress, data): data[2]['name']
                for data in restaurant_data
            }
            
            for future in as_completed(future_to_restaurant):
                restaurant_name = future_to_restaurant[future]
                try:
                    result = future.result()
                    results.append(result)
                    
                    # Progress update
                    if len(results) % 25 == 0:
                        print(f"\n📊 Progress: {len(results)}/{len(restaurants)}")
                        
                except Exception as e:
                    print(f"❌ Error processing {restaurant_name}: {e}")
        
        # Sort results to maintain original order
        results.sort(key=lambda x: next(i for i, r in enumerate(restaurants) if r['name'] == x['name']))
        
        return results
    
    def save_results(self, restaurants: List[Dict], filename: str = None):
        """Save results to JSON file"""

        # Try different possible output paths
        if filename is None:
            possible_output_paths = [
                'src/data/NYCRestaurantWeek/2_Geocoded.json',  # From project root
                '../../data/NYCRestaurantWeek/2_Geocoded.json',  # From src/utils/NYCRestaurantWeek directory
            ]

            # Try to find a valid output directory
            import os
            for path in possible_output_paths:
                try:
                    directory = os.path.dirname(path)
                    if os.path.exists(directory):
                        filename = path
                        break
                except:
                    continue

            # Fallback to first option if nothing found
            if filename is None:
                filename = possible_output_paths[0]
                # Create directory if it doesn't exist
                os.makedirs(os.path.dirname(filename), exist_ok=True)

        try:
            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(restaurants, f, indent=2, ensure_ascii=False)
            print(f"💾 Results saved to {filename}")
            
        except Exception as e:
            print(f"Error saving results: {e}")

def main():
    """Main function"""
    
    # Load the cleaned restaurant data
    try:
        # Try different possible paths
        possible_paths = [
            'src/data/NYCRestaurantWeek/1_Scraped.json',  # From project root
            '../data/NYCRestaurantWeek/1_Scraped.json',  # From src/utils/NYCRestaurantWeek directory
        ]
        
        restaurants = None
        for path in possible_paths:
            try:
                # Try different encodings to handle invalid UTF-8
                for encoding in ['utf-8', 'utf-8-sig', 'latin-1', 'cp1252']:
                    try:
                        with open(path, 'r', encoding=encoding) as f:
                            restaurants = json.load(f)
                        print(f"📂 Loaded {len(restaurants)} restaurants from {path} (encoding: {encoding})")
                        break
                    except UnicodeDecodeError:
                        continue
                    except json.JSONDecodeError as e:
                        print(f"❌ JSON decode error with {encoding} encoding: {e}")
                        continue
                if restaurants:
                    break
            except FileNotFoundError:
                continue
        
        if restaurants is None:
            print("❌ Error: Could not find 1_Scraped.json")
            print(f"   Tried paths: {possible_paths}")
            return
            
    except Exception as e:
        print(f"❌ Error loading data: {e}")
        return
    
    # Initialize extractor
    extractor = RestaurantCoordinateExtractor()
    
    # Extract coordinates
    restaurants_with_coords = extractor.extract_all_coordinates(restaurants)
    
    # Save results
    extractor.save_results(restaurants_with_coords)
    
    # Print summary
    print(f"\n📊 Summary:")
    
    success_count = sum(1 for r in restaurants_with_coords if r.get('latitude') is not None and r.get('longitude') is not None)
    failed_count = len(restaurants_with_coords) - success_count
    
    print(f"✅ Coordinates extracted: {success_count}")
    print(f"❌ Failed extractions: {failed_count}")
    
    # Count by extraction method
    methods = {}
    for restaurant in restaurants_with_coords:
        if restaurant.get('latitude') is not None and restaurant.get('longitude') is not None:
            method = restaurant.get('extraction_method', 'unknown')
            methods[method] = methods.get(method, 0) + 1
    
    print(f"\n🔍 Extraction methods used:")
    for method, count in methods.items():
        percentage = (count / success_count * 100) if success_count > 0 else 0
        print(f"   {method}: {count} ({percentage:.1f}%)")
    
    # Show which strategies are working
    print(f"\n📈 Strategy Analysis:")
    venue_address_count = methods.get('venueAddress_location_pattern', 0)
    location_patterns_count = sum(count for method, count in methods.items() if 'location_pattern_' in method)
    failed_count = sum(1 for r in restaurants_with_coords if r.get('latitude') is None or r.get('longitude') is None)
    
    print(f"   Strategy 1 (venueAddress + location): {venue_address_count}")
    print(f"   Strategy 2 (location patterns only): {location_patterns_count}")
    print(f"   Failed extractions: {failed_count}")
    
    # Show some examples
    print(f"\n📋 Sample results:")
    count = 0
    for restaurant in restaurants_with_coords:
        if restaurant.get('latitude') is not None and restaurant.get('longitude') is not None and count < 5:
            print(f"   {restaurant['name']}")
            print(f"      Address: {restaurant['address']}")
            print(f"      Coordinates: ({restaurant['latitude']:.4f}, {restaurant['longitude']:.4f})")
            count += 1
    
    # Show failures for debugging
    if failed_count > 0:
        print(f"\n❌ Failed extractions (first 5):")
        count = 0
        for restaurant in restaurants_with_coords:
            if (restaurant.get('latitude') is None or restaurant.get('longitude') is None) and count < 5:
                print(f"   {restaurant['name']}: No coordinates found")
                count += 1

if __name__ == "__main__":
    main()