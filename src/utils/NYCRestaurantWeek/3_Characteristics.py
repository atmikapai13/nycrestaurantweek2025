import json
import requests
import time
from typing import List, Dict, Optional, Tuple
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
from bs4 import BeautifulSoup

class RestaurantCharacteristicsExtractor:
    def __init__(self):
        self.request_delay = 0.2  
        self.last_request_time = 0
        self.request_lock = threading.Lock()
        
        # Headers for web scraping
        self.scraping_headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
        }
    
    def extract_restaurant_characteristics(self, restaurant: Dict) -> Dict:
        """Extract specific characteristics from restaurant's individual page"""
        
        slug = restaurant.get('slug', '')
        if not slug:
            print(f"  No slug found for {restaurant['name']}")
            return restaurant
        
        # Construct the restaurant page URL
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
            
            response = requests.get(
                restaurant_url, 
                headers=self.scraping_headers, 
                timeout=10  # Reduced timeout
            )
            
            if response.status_code == 200:
                soup = BeautifulSoup(response.content, 'html.parser')
                
                # Extract characteristics
                characteristics = {}
                
                # 1. Extract telephone number
                phone = self.extract_telephone(soup)
                if phone:
                    characteristics['telephone'] = phone
                
                # 2. Extract price range
                price_range = self.extract_price_range(soup)
                if price_range:
                    characteristics['price_range'] = price_range
                
                # 3. Extract Facebook URL
                facebook_url = self.extract_facebook_url(soup)
                if facebook_url:
                    characteristics['facebook_url'] = facebook_url
                
                # 4. Extract Instagram URL
                instagram_url = self.extract_instagram_url(soup)
                if instagram_url:
                    characteristics['instagram_url'] = instagram_url
                
                # 5. Extract menu URL from S3 bucket
                menu_url = self.extract_menu_url(soup)
                if menu_url:
                    characteristics['menu_url'] = menu_url
                
                # Update restaurant with new characteristics
                restaurant_copy = restaurant.copy()
                restaurant_copy.update(characteristics)
                
                # Print what we found
                if characteristics:
                    print(f"  ✅ Found: {list(characteristics.keys())}")
                else:
                    print(f"  ❌ No characteristics found")
                
                return restaurant_copy
                    
            else:
                print(f"  ❌ HTTP {response.status_code}")
                return restaurant
                
        except Exception as e:
            print(f"  ❌ Error scraping page: {e}")
            return restaurant
    
    def extract_telephone(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract telephone number from the page"""
        # Look for phone numbers in various formats
        phone_patterns = [
            r'\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}',  # (123) 456-7890 or 123-456-7890
            r'\+\d{1,3}[\s.-]?\d{3}[\s.-]?\d{3}[\s.-]?\d{4}',  # International format
        ]
        
        # Search in all text
        page_text = soup.get_text()
        
        for pattern in phone_patterns:
            matches = re.findall(pattern, page_text)
            if matches:
                # Clean up the phone number
                phone = re.sub(r'[\s.-]', '', matches[0])
                return phone
        
        return None
    
    def extract_price_range(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract price range ($, $$, $$$, $$$$) from the page"""
        # Look for price indicators
        price_indicators = ['$', '$$', '$$$', '$$$$']
        
        page_text = soup.get_text()
        
        # Look for price range patterns
        price_patterns = [
            r'Price[:\s]*(\$+)',
            r'Cost[:\s]*(\$+)',
            r'(\$+)\s*price',
            r'(\$+)\s*range',
        ]
        
        for pattern in price_patterns:
            matches = re.findall(pattern, page_text, re.IGNORECASE)
            if matches:
                return matches[0]
        
        # Look for individual $ signs in context
        for indicator in price_indicators:
            if indicator in page_text:
                return indicator
        
        return None
    
    def extract_facebook_url(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract Facebook URL from the page"""
        # Look for Facebook links
        facebook_patterns = [
            r'https?://(?:www\.)?facebook\.com/[^\s"<>]+',
            r'https?://(?:www\.)?fb\.com/[^\s"<>]+',
        ]
        
        # Search in href attributes
        for link in soup.find_all('a', href=True):
            href = link['href']
            if 'facebook.com' in href or 'fb.com' in href:
                return href
        
        # Search in page text
        page_text = soup.get_text()
        for pattern in facebook_patterns:
            matches = re.findall(pattern, page_text)
            if matches:
                return matches[0]
        
        return None
    
    def extract_instagram_url(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract Instagram URL from the page"""
        # Look for Instagram links
        instagram_patterns = [
            r'https?://(?:www\.)?instagram\.com/[^\s"<>]+',
            r'https?://(?:www\.)?ig\.com/[^\s"<>]+',
        ]
        
        # Search in href attributes
        for link in soup.find_all('a', href=True):
            href = link['href']
            if 'instagram.com' in href or 'ig.com' in href:
                return href
        
        # Search in page text
        page_text = soup.get_text()
        for pattern in instagram_patterns:
            matches = re.findall(pattern, page_text)
            if matches:
                return matches[0]
        
        return None
    
    def extract_menu_url(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract S3 menu URL from the page"""
        # Look for S3 menu URLs
        s3_patterns = [
            r'https?://[^"\s<>]*s3\.amazonaws\.com[^"\s<>]*',
            r'https?://[^"\s<>]*nyc-tourism-public\.s3\.amazonaws\.com[^"\s<>]*',
        ]
        
        # Search in href attributes for "See Menu" or similar buttons
        for link in soup.find_all('a', href=True):
            href = link['href']
            link_text = link.get_text().lower().strip()
            
            # Check if it's a menu-related link
            if any(keyword in link_text for keyword in ['menu', 'see menu', 'view menu', 'download menu']):
                if 's3.amazonaws.com' in href:
                    return href
        
        # Search in all href attributes for S3 URLs
        for link in soup.find_all('a', href=True):
            href = link['href']
            if 's3.amazonaws.com' in href:
                return href
        
        # Search in page text for S3 URLs
        page_text = soup.get_text()
        for pattern in s3_patterns:
            matches = re.findall(pattern, page_text)
            if matches:
                return matches[0]
        
        return None
    
    def process_restaurant(self, restaurant_data: Tuple[int, int, Dict]) -> Dict:
        """Extract characteristics for a single restaurant"""
        
        index, total, restaurant = restaurant_data
        
        print(f"[{index}/{total}] {restaurant['name']}")
        
        # Extract characteristics
        result = self.extract_restaurant_characteristics(restaurant)
        
        # Reduced delay between restaurants
        time.sleep(0.1)
        
        return result
    
    def process_all_restaurants(self, restaurants: List[Dict]) -> List[Dict]:
        """Process all restaurants using parallel processing"""
        
        print(f"🏢 Starting characteristics extraction for {len(restaurants)} restaurants...")
        print(f"⏱️  Estimated time: ~{len(restaurants) * 0.3 / 60:.1f} minutes")
        
        processed_restaurants = []
        
        # Prepare data with progress info
        restaurant_data = [(i+1, len(restaurants), restaurant) 
                          for i, restaurant in enumerate(restaurants)]
        
        # Use more workers for faster processing
        with ThreadPoolExecutor(max_workers=8) as executor:
            future_to_restaurant = {
                executor.submit(self.process_restaurant, data): data[2]['name']
                for data in restaurant_data
            }
            
            for future in as_completed(future_to_restaurant):
                restaurant_name = future_to_restaurant[future]
                try:
                    result = future.result()
                    processed_restaurants.append(result)
                    
                    # Progress update
                    if len(processed_restaurants) % 25 == 0:
                        success_count = sum(1 for r in processed_restaurants if any(r.get(char) for char in ['telephone', 'price_range', 'facebook_url', 'instagram_url', 'menu_url']))
                        print(f"\n📊 Progress: {len(processed_restaurants)}/{len(restaurants)} ({success_count} with characteristics found)")
                        
                except Exception as e:
                    print(f"❌ Error processing {restaurant_name}: {e}")
        
        # Sort results to maintain original order
        processed_restaurants.sort(key=lambda x: next(i for i, r in enumerate(restaurants) if r['name'] == x['name']))
        
        print(f"\n🎉 Processing complete!")
        
        return processed_restaurants
    
    def save_data(self, restaurants: List[Dict], filename: str = "../data/NYCRestaurantWeek/3_Characteristics.json"):
        """Save restaurant data with characteristics"""
        
        try:
            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(restaurants, f, indent=2, ensure_ascii=False)
            print(f"💾 Data saved to {filename}")
            
        except Exception as e:
            print(f"Error saving data: {e}")

def main():
    """Main function"""
    
    # Load the cleaned restaurant data
    try:
        # Try different possible paths
        possible_paths = [
            '../data/NYCRestaurantWeek/2_Geocoded.json',  # From root directory
            '../data/NYCRestaurantWeek/2_Geocoded.json',  # From utils directory
        ]
        
        restaurants = None
        for path in possible_paths:
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    restaurants = json.load(f)
                print(f"📂 Loaded {len(restaurants)} restaurants from {path}")
                break
            except FileNotFoundError:
                continue
        
        if restaurants is None:
            print("❌ Error: Could not find 2_Geocoded.json in ../data/NYCRestaurantWeek/")
            return
            
    except Exception as e:
        print(f"❌ Error loading data: {e}")
        return
    
    # Initialize processor
    processor = RestaurantCharacteristicsExtractor()
    
    # Process all restaurants
    processed_restaurants = processor.process_all_restaurants(restaurants)
    
    # Save results
    processor.save_data(processed_restaurants)
    
    # Print summary
    print(f"\n📊 Final Summary:")
    
    # Count characteristics found
    characteristics_count = {
        'telephone': 0,
        'price_range': 0,
        'facebook_url': 0,
        'instagram_url': 0,
        'menu_url': 0
    }
    
    for restaurant in processed_restaurants:
        for char in characteristics_count:
            if restaurant.get(char):
                characteristics_count[char] += 1
    
    print(f"\n🔍 Characteristics Found:")
    for char, count in characteristics_count.items():
        percentage = (count / len(restaurants)) * 100
        print(f"   {char}: {count}/{len(restaurants)} ({percentage:.1f}%)")

if __name__ == "__main__":
    main()