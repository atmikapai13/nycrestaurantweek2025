import requests
from bs4 import BeautifulSoup
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict, Optional

def scrape_nytimes_restaurants(url):
    """
    Scrape the NY Times Best NYC Restaurants list and return as JSON
    Targets: https://www.nytimes.com/interactive/2025/dining/best-nyc-restaurants.html
    """
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
    }
    
    restaurants = []
    
    try:
        print(f"Fetching: {url}")
        response = requests.get(url, headers=headers, timeout=30)
        response.raise_for_status()
        
        print(f"Response status: {response.status_code}")
        print(f"Content length: {len(response.content)} bytes")
        
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Method 1: Look for the exact structure from your screenshots
        # <span data-rank="1">1</span> ... <h5 class="svelte-imhqoc"><span>Restaurant Name</span></h5>
        print("\n--- Method 1: Using rank data attributes ---")
        rank_elements = soup.find_all('span', {'data-rank': True})
        print(f"Found {len(rank_elements)} elements with data-rank")
        
        for rank_elem in rank_elements:
            try:
                rank = int(rank_elem.get('data-rank'))
                
                # Find the next h5 element with restaurant name
                # Look in the same container or nearby elements
                container = rank_elem.parent
                h5_elem = None
                
                # Search within the same parent container
                if container:
                    h5_elem = container.find('h5', class_='svelte-imhqoc')
                    if not h5_elem:
                        h5_elem = container.find('h5')
                
                # If not found, search in following siblings
                if not h5_elem:
                    current = rank_elem
                    for _ in range(10):  # Look at next 10 elements
                        current = current.find_next()
                        if current and current.name == 'h5':
                            h5_elem = current
                            break
                
                if h5_elem:
                    name_span = h5_elem.find('span')
                    if name_span:
                        name = name_span.get_text().strip()
                        if name and len(name) > 1:
                            restaurants.append({
                                'rank': rank,
                                'name': name
                            })
                            print(f"  #{rank}: {name}")
                
            except Exception as e:
                print(f"  Error processing rank element: {e}")
                continue
        
        # Method 2: If Method 1 didn't work, try finding all h5 elements
        if len(restaurants) < 50:
            print(f"\n--- Method 2: Direct h5 search (found {len(restaurants)} so far) ---")
            h5_elements = soup.find_all('h5', class_='svelte-imhqoc')
            print(f"Found {len(h5_elements)} h5 elements with svelte-imhqoc class")
            
            for i, h5 in enumerate(h5_elements, 1):
                span = h5.find('span')
                if span:
                    name = span.get_text().strip()
                    if name and len(name) > 1:
                        # Try to find associated rank
                        rank = i  # Default to position
                        
                        # Look for nearby rank element
                        container = h5.parent
                        if container:
                            rank_elem = container.find('span', {'data-rank': True})
                            if rank_elem:
                                try:
                                    rank = int(rank_elem.get('data-rank'))
                                except:
                                    pass
                        
                        # Check if we already have this restaurant
                        if not any(r['name'] == name for r in restaurants):
                            restaurants.append({
                                'rank': rank,
                                'name': name
                            })
                            print(f"  #{rank}: {name}")
        
        # Method 3: Regex fallback on HTML source
        if len(restaurants) < 50:
            print(f"\n--- Method 3: Regex search (found {len(restaurants)} so far) ---")
            html_content = str(soup)
            
            # Pattern 1: Look for the rank and name pattern
            pattern1 = r'data-rank="(\d+)".*?<h5[^>]*>\s*<span[^>]*>([^<]+)</span>'
            matches1 = re.findall(pattern1, html_content, re.DOTALL)
            
            for rank_str, name in matches1:
                try:
                    rank = int(rank_str)
                    name = name.strip()
                    if name and not any(r['name'] == name for r in restaurants):
                        restaurants.append({
                            'rank': rank,
                            'name': name
                        })
                        print(f"  #{rank}: {name}")
                except:
                    continue
            
            # Pattern 2: Just h5 span pattern
            if len(restaurants) < 50:
                pattern2 = r'<h5[^>]*>\s*<span[^>]*>([^<]+)</span>'
                matches2 = re.findall(pattern2, html_content)
                
                for i, name in enumerate(matches2, 1):
                    name = name.strip()
                    if name and len(name) > 1 and not any(r['name'] == name for r in restaurants):
                        restaurants.append({
                            'rank': i,
                            'name': name
                        })
                        print(f"  #{i}: {name}")
        
        # Sort by rank
        restaurants.sort(key=lambda x: x['rank'])
        
        # Limit to top 100
        restaurants = restaurants[:100]
        
        print(f"\n=== FINAL RESULTS ===")
        print(f"Total restaurants found: {len(restaurants)}")
        
        return restaurants
        
    except requests.exceptions.RequestException as e:
        print(f"Request error: {e}")
        return []
    except Exception as e:
        print(f"Parsing error: {e}")
        return []

def get_restaurant_details(restaurant_name: str, base_url: str) -> Optional[Dict]:
    """Extract detailed information from individual restaurant page"""
    
    # Convert restaurant name to URL-friendly format
    # Remove special characters, convert to lowercase, replace spaces with hyphens
    url_name = re.sub(r'[^\w\s-]', '', restaurant_name.lower())
    url_name = re.sub(r'[-\s]+', '-', url_name).strip('-')
    
    restaurant_url = f"{base_url}#{url_name}"
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
    }
    
    try:
        response = requests.get(restaurant_url, headers=headers, timeout=30)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Debug: Check what's in the HTML
        print(f"   🔍 HTML contains restaurant name '{restaurant_name}': {restaurant_name.lower() in soup.get_text().lower()}")
        print(f"   🔍 Found {len(soup.find_all('p', class_='g-text'))} g-text elements in entire page")
        print(f"   🔍 Found {len(soup.find_all('div', class_='restaurant-section'))} restaurant-section divs")
        
        # Extract restaurant details
        details = {}
        
        # Find the restaurant section - try multiple approaches
        restaurant_section = None
        
        # Method 1: Look for div with restaurant ID (most reliable)
        # Convert restaurant name to ID format (e.g., "Tatiana by Kwame Onwuachi" -> "tatiana-by-kwame-onwuachi")
        restaurant_id = re.sub(r'[^\w\s-]', '', restaurant_name.lower())
        restaurant_id = re.sub(r'[-\s]+', '-', restaurant_id).strip('-')
        
        restaurant_section = soup.find('div', id=restaurant_id)
        if restaurant_section:
            print(f"   🔍 Found restaurant via ID: {restaurant_id}")
        
        # Method 2: Look for h2 with restaurant name
        if not restaurant_section:
            for h2 in soup.find_all('h2'):
                if restaurant_name.lower() in h2.get_text().lower():
                    restaurant_section = h2.parent
                    print(f"   🔍 Found restaurant via h2: {h2.get_text().strip()}")
                    break
        
        # Method 3: Look for div with restaurant-section class
        if not restaurant_section:
            for div in soup.find_all('div', class_='restaurant-section'):
                # Check if this section contains the restaurant name
                if restaurant_name.lower() in div.get_text().lower():
                    restaurant_section = div
                    print(f"   🔍 Found restaurant via div.restaurant-section")
                    break
        
        # Method 4: Look for any element containing the restaurant name
        if not restaurant_section:
            for elem in soup.find_all(['div', 'section', 'article']):
                if restaurant_name.lower() in elem.get_text().lower():
                    # Check if it has restaurant-related classes
                    classes = elem.get('class', [])
                    if any('restaurant' in str(c).lower() for c in classes):
                        restaurant_section = elem
                        print(f"   🔍 Found restaurant via general search")
                        break
        
        if restaurant_section:
            # Debug: Print what we found
            print(f"   🔍 Found restaurant section for: {restaurant_name}")
            
            # Debug: Check what elements are in the restaurant section
            print(f"   🔍 Restaurant section contains {len(restaurant_section.find_all('dd'))} dd elements")
            print(f"   🔍 Restaurant section contains {len(restaurant_section.find_all('p', class_='g-text'))} g-text elements")
            
            # Extract cuisine - try multiple approaches
            cuisine_elem = restaurant_section.find('dd', class_='cuisine')
            if not cuisine_elem:
                # Try finding cuisine in other ways
                for elem in restaurant_section.find_all(['dd', 'span', 'div']):
                    if 'cuisine' in str(elem.get('class', [])).lower():
                        cuisine_elem = elem
                        break
            if cuisine_elem:
                details['cuisine'] = cuisine_elem.get_text().strip()
                print(f"   ✅ Found cuisine: {details['cuisine']}")
            
            # Extract price - try multiple approaches
            price_elem = restaurant_section.find('dd', class_='price')
            if not price_elem:
                # Look for price patterns like $$$, $$, etc.
                for elem in restaurant_section.find_all(['dd', 'span', 'div']):
                    text = elem.get_text().strip()
                    if text and all(c in '$' for c in text) and len(text) <= 4:
                        price_elem = elem
                        break
            if price_elem:
                details['price'] = price_elem.get_text().strip()
                print(f"   ✅ Found price: {details['price']}")
            
            # Extract address and neighborhood - try multiple approaches
            address_elem = restaurant_section.find('dd', class_='address')
            neighborhood_elem = restaurant_section.find('dd', class_='neighborhood')
            
            # If not found, try other approaches
            if not address_elem:
                for elem in restaurant_section.find_all(['dd', 'span', 'div']):
                    if 'address' in str(elem.get('class', [])).lower():
                        address_elem = elem
                        break
            
            if not neighborhood_elem:
                for elem in restaurant_section.find_all(['dd', 'span', 'div']):
                    if 'neighborhood' in str(elem.get('class', [])).lower():
                        neighborhood_elem = elem
                        break
            
            address = address_elem.get_text().strip() if address_elem else ""
            neighborhood = neighborhood_elem.get_text().strip() if neighborhood_elem else ""
            
            # Combine address and neighborhood
            if address and neighborhood:
                details['full_address'] = f"{address}, {neighborhood}"
            elif address:
                details['full_address'] = address
            elif neighborhood:
                details['full_address'] = neighborhood
            else:
                details['full_address'] = None
            
            if details['full_address']:
                print(f"   ✅ Found address: {details['full_address']}")
            
            # Extract website - try multiple approaches
            website_elem = restaurant_section.find('dd', class_='website')
            if not website_elem:
                # Look for any link in the section
                website_link = restaurant_section.find('a', href=True)
                if website_link:
                    details['website'] = website_link.get('href', '').strip()
            else:
                website_link = website_elem.find('a')
                if website_link:
                    details['website'] = website_link.get('href', '').strip()
                else:
                    details['website'] = website_elem.get_text().strip()
            
            if details.get('website'):
                print(f"   ✅ Found website: {details['website']}")
            
            # Extract review/description from g-text paragraph
            # Look for all g-text paragraphs and find the one with the actual review
            g_text_elements = restaurant_section.find_all('p', class_='g-text')
            if g_text_elements:
                print(f"   📝 Found {len(g_text_elements)} g-text elements")
                # Find the paragraph with the longest text (likely the main review)
                longest_text = ""
                for i, elem in enumerate(g_text_elements):
                    text = elem.get_text().strip()
                    print(f"   📄 Element {i+1}: {text[:100]}...")
                    # Skip elements that are just review dates or very short
                    if (len(text) > len(longest_text) and 
                        not text.startswith("Last reviewed") and 
                        not text.startswith("★") and
                        len(text) > 50):  # Ensure it's a substantial description
                        longest_text = text
                
                if longest_text:
                    details['description'] = longest_text
                    print(f"   ✅ Selected description: {longest_text[:100]}...")
                elif g_text_elements:
                    # If no long text found, try to find any non-date description
                    for elem in g_text_elements:
                        text = elem.get_text().strip()
                        if (not text.startswith("Last reviewed") and 
                            not text.startswith("★") and
                            len(text) > 20):
                            details['description'] = text
                            print(f"   ⚠️ Using alternative description: {text[:100]}...")
                            break
                    else:
                        # Last resort: use first element
                        details['description'] = g_text_elements[0].get_text().strip()
                        print(f"   ⚠️ Using fallback description")
            else:
                print(f"   ❌ No g-text elements found")
            
            # Extract stars/rating - try multiple approaches
            stars_elem = restaurant_section.find('dd', class_='stars')
            if not stars_elem:
                # Look for star patterns like ★★★, etc.
                for elem in restaurant_section.find_all(['dd', 'span', 'div']):
                    text = elem.get_text().strip()
                    if text and ('★' in text or '*' in text):
                        stars_elem = elem
                        break
            if stars_elem:
                details['stars'] = stars_elem.get_text().strip()
                print(f"   ✅ Found stars: {details['stars']}")
            
            # Check if we found any details
            if details:
                print(f"   ✅ Found {len(details)} details for {restaurant_name}")
            else:
                print(f"   ❌ No details found for {restaurant_name}")
                
        else:
            print(f"   ❌ Could not find restaurant section for: {restaurant_name}")
            print(f"   🔍 Available h2 elements: {[h2.get_text().strip() for h2 in soup.find_all('h2')[:5]]}")
            return None
        
        return details
        
    except Exception as e:
        print(f"❌ Error extracting details for {restaurant_name}: {e}")
        return None

def extract_restaurant_details_batch(restaurants: List[Dict], base_url: str, max_workers: int = 5, delay_seconds: float = 0.5) -> List[Dict]:
    """Extract detailed information for all restaurants using batch processing"""
    
    print(f"🌟 Starting batch extraction of restaurant details...")
    print(f"   Using {max_workers} workers with {delay_seconds}s delay between requests")
    
    enriched_restaurants = []
    successful = 0
    failed = 0
    
    # Create a thread-safe counter for progress tracking
    from threading import Lock
    progress_lock = Lock()
    
    def extract_single_restaurant_details(restaurant):
        """Extract details for a single restaurant"""
        nonlocal successful, failed
        
        try:
            details = get_restaurant_details(restaurant['name'], base_url)
            
            # Combine basic info with detailed info
            enriched_restaurant = restaurant.copy()
            if details:
                enriched_restaurant.update(details)
                with progress_lock:
                    successful += 1
                print(f"   ✅ [{restaurant['name']}] Found details")
            else:
                with progress_lock:
                    failed += 1
                print(f"   ⚠️ [{restaurant['name']}] No details found")
            
            return enriched_restaurant
            
        except Exception as e:
            with progress_lock:
                failed += 1
            print(f"   ❌ [{restaurant['name']}] Error: {e}")
            return restaurant.copy()
    
    # Use ThreadPoolExecutor for parallel processing
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all tasks
        future_to_restaurant = {
            executor.submit(extract_single_restaurant_details, restaurant): restaurant 
            for restaurant in restaurants
        }
        
        # Process completed tasks
        for i, future in enumerate(as_completed(future_to_restaurant), 1):
            enriched_restaurant = future.result()
            enriched_restaurants.append(enriched_restaurant)
            
            # Progress update
            print(f"📝 Progress: {i}/{len(restaurants)} restaurants processed")
            
            # Small delay to be respectful to servers
            if i < len(restaurants):
                time.sleep(delay_seconds)
    
    # Sort results to maintain original order
    enriched_restaurants.sort(key=lambda x: next(i for i, r in enumerate(restaurants) if r['name'] == x['name']))
    
    print(f"\n📊 Restaurant details extraction summary:")
    print(f"   Total restaurants: {len(restaurants)}")
    print(f"   Successful extractions: {successful}")
    print(f"   Failed extractions: {failed}")
    print(f"   Success rate: {(successful/len(restaurants)*100):.1f}%")
    
    return enriched_restaurants

def save_restaurants_json(restaurants, filename='src/data/Lists/NYTTop100.json'):
    """
    Save restaurants data to JSON file
    """
    try:
        # Ensure the directory exists
        import os
        os.makedirs(os.path.dirname(filename), exist_ok=True)
        
        # Create the final JSON structure
        data = {
            'title': 'Best NYC Restaurants 2025 - New York Times',
            'source_url': 'https://www.nytimes.com/interactive/2025/dining/best-nyc-restaurants.html',
            'scraped_date': time.strftime('%Y-%m-%d %H:%M:%S'),
            'total_restaurants': len(restaurants),
            'restaurants': restaurants
        }
        
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        
        print(f"✅ Saved {len(restaurants)} restaurants to {filename}")
        return True
        
    except Exception as e:
        print(f"❌ Error saving JSON: {e}")
        return False

def main():
    """
    Main function to scrape and save restaurant data
    """
    base_url = "https://www.nytimes.com/interactive/2025/dining/best-nyc-restaurants.html"
    
    print("🍽️  NY Times Best NYC Restaurants Scraper")
    print("=" * 50)
    
    # Scrape the basic restaurant list
    restaurants = scrape_nytimes_restaurants(base_url)
    
    if restaurants:
        print(f"\n📋 Found {len(restaurants)} restaurants in basic list")
        
        # Extract detailed information using batch processing
        print(f"\n🌟 Starting detailed information extraction...")
        enriched_restaurants = extract_restaurant_details_batch(
            restaurants, 
            base_url,
            max_workers=5,  # Process 5 restaurants simultaneously
            delay_seconds=0.5  # 0.5 second delay between requests
        )
        
        # Display sample results
        print(f"\n📋 Sample enriched restaurants:")
        print("-" * 40)
        
        for restaurant in enriched_restaurants[:5]:  # Show first 5
            print(f"{restaurant['rank']:2d}. {restaurant['name']}")
            print(f"    Cuisine: {restaurant.get('cuisine', 'N/A')}")
            print(f"    Price: {restaurant.get('price', 'N/A')}")
            print(f"    Address: {restaurant.get('full_address', 'N/A')}")
            if restaurant.get('description'):
                print(f"    Description: {restaurant['description'][:100]}...")
            print()
        
        # Save to JSON
        success = save_restaurants_json(enriched_restaurants)
        
        if success:
            print(f"\n🎉 Successfully scraped and saved {len(enriched_restaurants)} restaurants with details!")
            print("📁 Check 'src/data/Lists/NYTTop100.json' for the complete data")
        
        return enriched_restaurants
    else:
        print("❌ No restaurants found. The site structure may have changed or access was blocked.")
        print("\n🔧 Troubleshooting tips:")
        print("1. The site may be blocking automated requests")
        print("2. Try saving the page manually and parsing the HTML file")
        print("3. The site structure may have changed since the script was created")
        return []

if __name__ == "__main__":
    results = main()