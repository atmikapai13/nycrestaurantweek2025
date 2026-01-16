import json
import requests
import time
from typing import List, Dict, Optional, Tuple
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
from bs4 import BeautifulSoup
import os

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

                # 6. Extract longer description (summary2)
                description = self.extract_description(soup)
                if description:
                    characteristics['summary2'] = description

                # Update restaurant with new characteristics
                restaurant_copy = restaurant.copy()
                restaurant_copy.update(characteristics)

                # 7. Clean meal_types to remove "Price" suffix
                if 'meal_types' in restaurant_copy:
                    restaurant_copy['meal_types'] = self.clean_meal_types(restaurant_copy['meal_types'])

                # 8. Add participation_weeks2 field (BEFORE cleaning participation_weeks)
                if 'participation_weeks' in restaurant_copy:
                    participation_weeks2 = self.extract_participation_dates(restaurant_copy['participation_weeks'])
                    if participation_weeks2:
                        restaurant_copy['participation_weeks2'] = participation_weeks2

                # 9. Clean participation_weeks to remove "Week X " prefix (AFTER extracting participation_weeks2)
                if 'participation_weeks' in restaurant_copy:
                    restaurant_copy['participation_weeks'] = self.clean_participation_weeks(restaurant_copy['participation_weeks'])

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
                # Skip placeholder nyctourism URLs
                if 'nyctourism' in href.lower():
                    continue
                return href

        # Search in page text
        page_text = soup.get_text()
        for pattern in facebook_patterns:
            matches = re.findall(pattern, page_text)
            if matches:
                # Skip placeholder nyctourism URLs
                if 'nyctourism' in matches[0].lower():
                    continue
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
                # Skip placeholder nyctourism URLs
                if 'nyctourism' in href.lower():
                    continue
                return href

        # Search in page text
        page_text = soup.get_text()
        for pattern in instagram_patterns:
            matches = re.findall(pattern, page_text)
            if matches:
                # Skip placeholder nyctourism URLs
                if 'nyctourism' in matches[0].lower():
                    continue
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

    def extract_description(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract the longer description from the page"""
        # Strategy 1: Look for paragraphs with BodyText classes (the full description)
        # These typically have classes like "BodyText_bodytext___ZHWy" or "RichText_bodyText__aZFuf"
        for p_tag in soup.find_all('p'):
            class_list = p_tag.get('class', [])
            class_str = ' '.join(class_list)

            # Check if it's a BodyText paragraph (the detailed description)
            if 'BodyText_bodytext' in class_str or 'RichText_bodyText' in class_str:
                text = p_tag.get_text(strip=True)
                # Filter out short texts and price indicators
                if text and len(text) > 100 and not text.startswith('$'):
                    return text

        # Strategy 2: Look for the Description section specifically
        # Find divs/sections that might contain "Description" heading
        description_section = soup.find(['div', 'section'], class_=re.compile(r'description', re.IGNORECASE))
        if description_section:
            # Get the first substantial paragraph
            for p_tag in description_section.find_all('p'):
                text = p_tag.get_text(strip=True)
                if text and len(text) > 100:
                    return text

        # Strategy 3: Look for the longest paragraph on the page (likely the main description)
        all_paragraphs = soup.find_all('p')
        longest_paragraph = None
        max_length = 100  # Minimum length threshold

        for p_tag in all_paragraphs:
            text = p_tag.get_text(strip=True)
            # Skip paragraphs that look like prices, contact info, or very short text
            if text and len(text) > max_length:
                # Exclude paragraphs that are primarily addresses or contact info
                if not re.search(r'^\d+\s+[NSEW]\.?\s+\w+', text) and not text.startswith('('):
                    if len(text) > len(longest_paragraph or ''):
                        longest_paragraph = text

        return longest_paragraph

    def clean_meal_types(self, meal_types: list) -> list:
        """Remove 'Price' suffix from meal_types array items"""
        if not meal_types or not isinstance(meal_types, list):
            return meal_types

        cleaned_types = []
        for meal_type in meal_types:
            if isinstance(meal_type, str):
                # Remove " Price" suffix (case-insensitive)
                cleaned = meal_type.replace(" Price", "").replace(" price", "")
                cleaned_types.append(cleaned)
            else:
                cleaned_types.append(meal_type)

        return cleaned_types

    def clean_participation_weeks(self, participation_weeks: list) -> list:
        """Remove 'Week X ' prefix from participation_weeks array items.

        Example:
        Input: ["Week 1 (Jan 20 - Jan 25)", "Week 2 (Jan 26 - Feb 1)"]
        Output: ["Jan 20 - Jan 25", "Jan 26 - Feb 1"]
        """
        if not participation_weeks or not isinstance(participation_weeks, list):
            return participation_weeks

        cleaned_weeks = []
        # Pattern to match "Week X (dates)" and extract just the dates
        # Matches "Week" (case insensitive) + number + "(" + content + ")"
        pattern = r'(?i)Week\s*\d+\s*\((.+?)\)\s*$'

        for week in participation_weeks:
            if isinstance(week, str):
                # Try to match the "Week X (dates)" pattern
                match = re.match(pattern, week.strip())

                if match:
                    # Extract just the dates part (inside parentheses)
                    cleaned = match.group(1).strip()
                    cleaned_weeks.append(cleaned)
                else:
                    # If pattern doesn't match, keep original (already cleaned)
                    cleaned_weeks.append(week.strip())
            else:
                cleaned_weeks.append(week)

        return cleaned_weeks

    def extract_participation_dates(self, participation_weeks: list) -> str:
        """Extract first and last dates from participation_weeks array.

        Example:
        Input: ["Week 1 (Jan 20 - Jan 25)", "Week 2 (Jan 26 - Feb 1)", "Week 3 (Feb 2 - Feb 8)", "Week 4 (Feb 9 - Feb 12)"]
        Output: "Jan 20 - Feb 12"
        """
        if not participation_weeks or not isinstance(participation_weeks, list) or len(participation_weeks) == 0:
            return None

        # Get first and last week
        first_week = participation_weeks[0]
        last_week = participation_weeks[-1]

        # Extract dates from format "Week X (Date1 - Date2)"
        # Pattern: anything in parentheses containing dates
        date_pattern = r'\(([^)]+)\)'

        # Extract from first week
        first_match = re.search(date_pattern, first_week)
        if not first_match:
            return None

        first_dates = first_match.group(1)  # e.g., "Jan 20 - Jan 25"
        first_date = first_dates.split(' - ')[0].strip()  # Get "Jan 20"

        # Extract from last week
        last_match = re.search(date_pattern, last_week)
        if not last_match:
            return None

        last_dates = last_match.group(1)  # e.g., "Feb 9 - Feb 12"
        last_date = last_dates.split(' - ')[-1].strip()  # Get "Feb 12"

        # Combine them
        return f"{first_date} - {last_date}"

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
                        success_count = sum(1 for r in processed_restaurants if any(r.get(char) for char in ['telephone', 'price_range', 'facebook_url', 'instagram_url', 'menu_url', 'summary2']))
                        print(f"\n📊 Progress: {len(processed_restaurants)}/{len(restaurants)} ({success_count} with characteristics found)")
                        
                except Exception as e:
                    print(f"❌ Error processing {restaurant_name}: {e}")
        
        # Sort results to maintain original order
        processed_restaurants.sort(key=lambda x: next(i for i, r in enumerate(restaurants) if r['name'] == x['name']))
        
        print(f"\n🎉 Processing complete!")
        
        return processed_restaurants
    
    def save_data(self, restaurants: List[Dict], filename: str = None):
        """Save restaurant data with characteristics"""

        # Try different possible output paths
        if filename is None:
            possible_output_paths = [
                'src/data/NYCRestaurantWeek/3_Characteristics.json',  # From project root
                '../../data/NYCRestaurantWeek/3_Characteristics.json',  # From src/utils/NYCRestaurantWeek directory
            ]

            # Try to find a valid output directory
            for path in possible_output_paths:
                try:
                    # Test if directory exists
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
            print(f"💾 Data saved to {filename}")
            
        except Exception as e:
            print(f"Error saving data: {e}")

def main():
    """Main function"""
    
    # Load the cleaned restaurant data
    try:
        # Try different possible paths
        possible_paths = [
            'src/data/NYCRestaurantWeek/2_Geocoded.json',  # From project root
            '../../data/NYCRestaurantWeek/2_Geocoded.json',  # From src/utils/NYCRestaurantWeek directory
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
            print("❌ Error: Could not find 2_Geocoded.json")
            print(f"   Tried paths: {possible_paths}")
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
        'menu_url': 0,
        'summary2': 0
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