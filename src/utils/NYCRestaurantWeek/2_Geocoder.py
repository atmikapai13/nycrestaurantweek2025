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
    
    def extract_json_data(self, page_content: str, restaurant_name: str) -> Dict:
        """Extract address and coordinates from JSON in page source"""
        
        # Strategy 1: Look for venueAddress and location pattern
        venue_pattern = r'"venueAddress":"([^"]+)"[^}]*"location":\s*\{\s*"lon":\s*([+-]?\d+\.?\d*)\s*,\s*"lat":\s*([+-]?\d+\.?\d*)\s*\}'
        
        matches = re.findall(venue_pattern, page_content)
        
        if matches:
            address_raw, lon, lat = matches[0]
            
            # Clean up the address (it's often formatted like "320 Atlantic Ave.,Brooklyn,11201,NY")
            address = self.clean_venue_address(address_raw)
            
            return {
                'address': address,
                'latitude': float(lat),
                'longitude': float(lon),
                'extraction_success': True,
                'error': None
            }
        
        # Strategy 2: Look for broader location patterns
        location_patterns = [
            r'"location":\s*\{\s*"lon":\s*([+-]?\d+\.?\d*)\s*,\s*"lat":\s*([+-]?\d+\.?\d*)\s*\}',
            r'"lat":\s*([+-]?\d+\.?\d*)\s*,\s*"lon":\s*([+-]?\d+\.?\d*)',
            r'"longitude":\s*([+-]?\d+\.?\d*)\s*,\s*"latitude":\s*([+-]?\d+\.?\d*)',
        ]
        
        for i, pattern in enumerate(location_patterns):
            matches = re.findall(pattern, page_content)
            
            if matches:
                if i == 0:  # lon, lat format
                    lon, lat = matches[0]
                elif i == 1:  # lat, lon format  
                    lat, lon = matches[0]
                elif i == 2:  # longitude, latitude format
                    lon, lat = matches[0]
                
                # Try to find address separately
                address = self.find_address_in_content(page_content)
                
                return {
                    'address': address,
                    'latitude': float(lat),
                    'longitude': float(lon),
                    'extraction_success': True,
                    'error': None,
                    
                }
        
        # If no patterns matched, return failure
        return {
            'address': None,
            'latitude': None,
            'longitude': None,
            'extraction_success': False,
            'error': 'No coordinate patterns found in page source',
           
        }
    
    def clean_venue_address(self, address_raw: str) -> str:
        """Clean the raw venue address format"""
        
        # Format is often: "320 Atlantic Ave.,Brooklyn,11201,NY"
        # Split by comma and reconstruct
        parts = [part.strip() for part in address_raw.split(',')]
        
        if len(parts) >= 4:
            # Standard format: street, borough, zip, state
            street = parts[0]
            borough = parts[1]
            zip_code = parts[2]
            state = parts[3]
            
            return f"{street}, {borough}, {state} {zip_code}"
        
        elif len(parts) >= 3:
            # Missing zip or state
            return ', '.join(parts)
        
        else:
            # Just return as-is if unusual format
            return address_raw
    
    def find_address_in_content(self, page_content: str) -> Optional[str]:
        """Find address in page content using various patterns"""
        
        # Look for address patterns
        address_patterns = [
            r'"address":"([^"]+)"',
            r'"streetAddress":"([^"]+)"',
            r'"venueAddress":"([^"]+)"',
        ]
        
        for pattern in address_patterns:
            matches = re.findall(pattern, page_content)
            if matches:
                return matches[0]
        
        return None
    
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
    
    def save_results(self, restaurants: List[Dict], filename: str = "../data/NYCRestaurantWeek/2_Geocoded.json"):
        """Save results to JSON file"""
        
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
            '../data/NYCRestaurantWeek/1_Scraped.json',  # From utils directory
            '../data/1_Scraped.json',  # From utils directory
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
            print("❌ Error: Could not find 1_Scraped.json in ../data/NYCRestaurantWeek/")
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