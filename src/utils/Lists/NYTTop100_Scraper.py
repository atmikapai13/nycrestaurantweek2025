import requests
from bs4 import BeautifulSoup
import json
import re
import time

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

def save_restaurants_json(restaurants, filename='../data/Lists/NYTTop100.json'):
    """
    Save restaurants data to JSON file
    """
    try:
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
    url = "https://www.nytimes.com/interactive/2025/dining/best-nyc-restaurants.html"
    
    print("🍽️  NY Times Best NYC Restaurants Scraper")
    print("=" * 50)
    
    # Scrape the data
    restaurants = scrape_nytimes_restaurants(url)
    
    if restaurants:
        # Display results
        print(f"\n📋 Found {len(restaurants)} restaurants:")
        print("-" * 40)
        
        for restaurant in restaurants[:10]:  # Show first 10
            print(f"{restaurant['rank']:2d}. {restaurant['name']}")
        
        if len(restaurants) > 10:
            print(f"    ... and {len(restaurants) - 10} more")
        
        # Save to JSON
        success = save_restaurants_json(restaurants)
        
        if success:
            print(f"\n🎉 Successfully scraped and saved {len(restaurants)} restaurants!")
            print("📁 Check 'src/data/Lists/NYTTop100' for the complete data")
        
        return restaurants
    else:
        print("❌ No restaurants found. The site structure may have changed or access was blocked.")
        print("\n🔧 Troubleshooting tips:")
        print("1. The site may be blocking automated requests")
        print("2. Try saving the page manually and parsing the HTML file")
        print("3. The site structure may have changed since the script was created")
        return []

if __name__ == "__main__":
    results = main()