import json
from collections import Counter, defaultdict
from typing import Dict, List, Any

def analyze_restaurant_data(filename: str = "src/data/NYCRestaurantWeek/3_Characteristics.json"):
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
    
    # Cuisine analysis
    all_cuisines = []
    
    # Meal types analysis
    meal_types = Counter()
    
    # Price_Range analysis
    price_ranges = Counter()
    
    # Collections analysis
    collections = Counter()
    
    # Participation weeks analysis
    participation_weeks = Counter()
    
    # Feature analysis
    has_website = 0
    has_image = 0
    has_menu = 0
    has_opentable = 0
    has_telephone = 0
    has_facebook = 0
    has_instagram = 0
    
    for restaurant in restaurants:
        # Cuisines
        cuisine = restaurant.get('cuisine', '')
        if cuisine:  # Only add if cuisine is not empty
            all_cuisines.append(cuisine)
        
        # Meal types
        meal_types_list = restaurant.get('meal_types', [])
        meal_types.update(meal_types_list)
        
        # Price Range types
        price_range_list = restaurant.get('price_range', [])
        price_ranges.update(price_range_list)
        
        # Collections
        collections_list = restaurant.get('collections', [])
        collections.update(collections_list)
        
        # Participation weeks
        weeks = restaurant.get('participation_weeks', [])
        participation_weeks.update(weeks)
        
        # Other features
        if restaurant.get('website') and restaurant.get('website').strip():
            has_website += 1
        if restaurant.get('image_url') and restaurant.get('image_url').strip():
            has_image += 1
        if restaurant.get('menu_url') and restaurant.get('menu_url').strip():
            has_menu += 1
        if restaurant.get('opentable_id') and restaurant.get('opentable_id').strip():
            has_opentable += 1
        if restaurant.get('telephone') and restaurant.get('telephone').strip():
            has_telephone += 1
        if restaurant.get('facebook_url') and restaurant.get('facebook_url').strip():
            has_facebook += 1
        if restaurant.get('instagram_url') and restaurant.get('instagram_url').strip():
            has_instagram += 1
    
    # Print borough stats
    print(f"\n=== By Borough ===")
    for borough, count in boroughs.most_common():
        percentage = (count / len(restaurants)) * 100
        print(f"  {borough}: {count} restaurants ({percentage:.1f}%)")
    print(f"  All boroughs: {list(boroughs.keys())}")
    
    # Print cuisine stats
    cuisine_counter = Counter(all_cuisines)
    print(f"\n=== By Cuisine ===")
    for cuisine, count in cuisine_counter.most_common():
        percentage = (count / len(restaurants)) * 100
        print(f"  {cuisine}: {count} restaurants ({percentage:.1f}%)")
    print(f"  All cuisines: {list(cuisine_counter.keys())}")

    
    # Print meal types
    print(f"\n=== By Meal Types ===")
    for meal_type, count in meal_types.most_common():
        percentage = (count / len(restaurants)) * 100
        print(f"  {meal_type}: {count} restaurants ({percentage:.1f}%)")
    print(f"  All price range types: {list(meal_types.keys())}")
    
    # Print price range types
    print(f"\n=== By Price Range Types ===")
    for price_range, count in price_ranges.most_common():
        percentage = (count / len(restaurants)) * 100
        print(f"  {price_range}: {count} restaurants ({percentage:.1f}%)")
    print(f"  All meal types: {list(price_ranges.keys())}")
    
    # Print collections
    print(f"\n=== By Collections ===")
    for collection, count in collections.most_common():
        percentage = (count / len(restaurants)) * 100
        print(f"  {collection}: {count} restaurants ({percentage:.1f}%)")
    print(f"  All collections: {list(collections.keys())}")
    
    # Print participation weeks
    print(f"\n=== By Participation Weeks ===")
    for week, count in participation_weeks.most_common():
        percentage = (count / len(restaurants)) * 100
        print(f"  {week}: {count} restaurants ({percentage:.1f}%)")
    print(f"  All participation weeks: {list(participation_weeks.keys())}")
    
    # Print feature stats
    print(f"\n=== By Features ===")
    print(f"  Restaurants with website: {has_website} ({(has_website/len(restaurants)*100):.1f}%)")
    print(f"  Restaurants with image: {has_image} ({(has_image/len(restaurants)*100):.1f}%)")
    print(f"  Restaurants with menu: {has_menu} ({(has_menu/len(restaurants)*100):.1f}%)")
    print(f"  Restaurants with OpenTable: {has_opentable} ({(has_opentable/len(restaurants)*100):.1f}%)")
    print(f"  Restaurants with telephone: {has_telephone} ({(has_telephone/len(restaurants)*100):.1f}%)")
    print(f"  Restaurants with Facebook: {has_facebook} ({(has_facebook/len(restaurants)*100):.1f}%)")
    print(f"  Restaurants with Instagram: {has_instagram} ({(has_instagram/len(restaurants)*100):.1f}%)")
    
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