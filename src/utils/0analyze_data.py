import json
from collections import Counter, defaultdict
from typing import Dict, List, Any

def analyze_restaurant_data(filename: str = "clean_restaurant_data.json"):
    """Analyze the clean restaurant data and provide comprehensive statistics"""
    
    try:
        with open(filename, 'r', encoding='utf-8') as f:
            restaurants = json.load(f)
    except FileNotFoundError:
        print(f"File {filename} not found!")
        return
    except json.JSONDecodeError:
        print(f"Error reading JSON file {filename}")
        return
    
    print(f"=== NYC Restaurant Week 2025 Data Analysis ===\n")
    print(f"Total Restaurants: {len(restaurants)}")
    
    # Basic structure analysis
    if restaurants:
        sample = restaurants[0]
        print(f"\n=== Data Structure ===")
        print(f"JSON Categories/Fields:")
        for key, value in sample.items():
            if isinstance(value, list):
                print(f"  - {key}: List with {len(value)} items")
            elif isinstance(value, dict):
                print(f"  - {key}: Dictionary with {len(value)} keys")
            else:
                print(f"  - {key}: {type(value).__name__}")
    
    # Borough analysis
    boroughs = Counter()
    neighborhoods = Counter()
    
    # Cuisine analysis
    all_cuisines = []
    
    # Pricing analysis
    pricing_stats = {
        'lunch_30': 0, 'lunch_45': 0, 'lunch_60': 0,
        'dinner_30': 0, 'dinner_45': 0, 'dinner_60': 0
    }
    
    # Meal types analysis
    meal_types = Counter()
    
    # Collections analysis
    collections = Counter()
    
    # Participation weeks analysis
    participation_weeks = Counter()
    
    # Website analysis
    has_website = 0
    has_image = 0
    has_menu = 0
    has_opentable = 0
    
    for restaurant in restaurants:
        # Borough and neighborhood
        borough = restaurant.get('borough', 'Unknown')
        boroughs[borough] += 1
        
        neighborhood = restaurant.get('neighborhood', 'Unknown')
        neighborhoods[neighborhood] += 1
        
        # Cuisines
        cuisines = restaurant.get('cuisine', [])
        all_cuisines.extend(cuisines)
        
        # Pricing
        pricing = restaurant.get('pricing', {})
        for price_type, has_price in pricing.items():
            if has_price:
                pricing_stats[price_type] += 1
        
        # Meal types
        meal_types_list = restaurant.get('meal_types', [])
        meal_types.update(meal_types_list)
        
        # Collections
        collections_list = restaurant.get('collections', [])
        collections.update(collections_list)
        
        # Participation weeks
        weeks = restaurant.get('participation_weeks', [])
        participation_weeks.update(weeks)
        
        # Other features
        if restaurant.get('website'):
            has_website += 1
        if restaurant.get('image_url'):
            has_image += 1
        if restaurant.get('menu_url'):
            has_menu += 1
        if restaurant.get('opentable_id'):
            has_opentable += 1
    
    # Print borough stats
    print(f"\n=== By Borough ===")
    for borough, count in boroughs.most_common():
        percentage = (count / len(restaurants)) * 100
        print(f"  {borough}: {count} restaurants ({percentage:.1f}%)")
    
    # Print top neighborhoods
    print(f"\n=== Top 15 Neighborhoods ===")
    for neighborhood, count in neighborhoods.most_common(15):
        percentage = (count / len(restaurants)) * 100
        print(f"  {neighborhood}: {count} restaurants ({percentage:.1f}%)")
    
    # Print cuisine stats
    cuisine_counter = Counter(all_cuisines)
    print(f"\n=== Top 20 Cuisines ===")
    for cuisine, count in cuisine_counter.most_common(20):
        percentage = (count / len(restaurants)) * 100
        print(f"  {cuisine}: {count} restaurants ({percentage:.1f}%)")
    
    # Print pricing stats
    print(f"\n=== Pricing Analysis ===")
    for price_type, count in pricing_stats.items():
        percentage = (count / len(restaurants)) * 100
        print(f"  {price_type}: {count} restaurants ({percentage:.1f}%)")
    
    # Print meal types
    print(f"\n=== Meal Types ===")
    for meal_type, count in meal_types.most_common():
        percentage = (count / len(restaurants)) * 100
        print(f"  {meal_type}: {count} restaurants ({percentage:.1f}%)")
    
    # Print collections
    print(f"\n=== Collections ===")
    for collection, count in collections.most_common():
        percentage = (count / len(restaurants)) * 100
        print(f"  {collection}: {count} restaurants ({percentage:.1f}%)")
    
    # Print participation weeks
    print(f"\n=== Participation Weeks ===")
    for week, count in participation_weeks.most_common():
        percentage = (count / len(restaurants)) * 100
        print(f"  {week}: {count} restaurants ({percentage:.1f}%)")
    
    # Print feature stats
    print(f"\n=== Feature Analysis ===")
    print(f"  Restaurants with website: {has_website} ({(has_website/len(restaurants)*100):.1f}%)")
    print(f"  Restaurants with image: {has_image} ({(has_image/len(restaurants)*100):.1f}%)")
    print(f"  Restaurants with menu: {has_menu} ({(has_menu/len(restaurants)*100):.1f}%)")
    print(f"  Restaurants with OpenTable: {has_opentable} ({(has_opentable/len(restaurants)*100):.1f}%)")
    
    # Sample restaurant data
    print(f"\n=== Sample Restaurant Data ===")
    if restaurants:
        sample = restaurants[0]
        print(f"Sample restaurant: {sample.get('name', 'Unknown')}")
        print(f"  Borough: {sample.get('borough', 'Unknown')}")
        print(f"  Neighborhood: {sample.get('neighborhood', 'Unknown')}")
        print(f"  Cuisines: {sample.get('cuisine', [])}")
        print(f"  Meal Types: {sample.get('meal_types', [])}")
        print(f"  Pricing: {sample.get('pricing', {})}")
        print(f"  Collections: {sample.get('collections', [])}")
        print(f"  Participation Weeks: {sample.get('participation_weeks', [])}")

if __name__ == "__main__":
    analyze_restaurant_data() 