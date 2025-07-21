import json
import pandas as pd
from typing import Dict, List, Tuple
from collections import Counter

def load_json_file(filepath: str) -> List[Dict]:
    """Load JSON file and return list of dictionaries"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        print(f"✅ Loaded {len(data)} records from {filepath}")
        return data
    except Exception as e:
        print(f"❌ Error loading {filepath}: {e}")
        return []

def normalize_string(s: str) -> str:
    """Normalize string for better matching"""
    if not s:
        return ""
    return s.lower().strip().replace("'", "").replace('"', "").replace("-", " ").replace("&", "and")

def find_best_join_key(characteristics_data: List[Dict], michelin_data: List[Dict]) -> Tuple[str, int, int]:
    """Test both 'name' and 'slug' fields to see which performs better"""
    
    print("\n🔍 Testing join keys...")
    
    # Normalize all names and slugs for comparison
    char_names = {normalize_string(item.get('name', '')): item for item in characteristics_data}
    char_slugs = {normalize_string(item.get('slug', '')): item for item in characteristics_data}
    
    michelin_names = {normalize_string(item.get('name', '')): item for item in michelin_data}
    michelin_slugs = {normalize_string(item.get('slug', '')): item for item in michelin_data}
    
    # Test name matching
    name_matches = set(char_names.keys()) & set(michelin_names.keys())
    name_match_count = len(name_matches)
    
    # Test slug matching  
    slug_matches = set(char_slugs.keys()) & set(michelin_slugs.keys())
    slug_match_count = len(slug_matches)
    
    print(f"📊 Name matches: {name_match_count}")
    print(f"📊 Slug matches: {slug_match_count}")
    
    # Determine best key
    if name_match_count >= slug_match_count:
        best_key = 'name'
        best_match_count = name_match_count
        print(f"🏆 Using 'name' as join key ({best_match_count} matches)")
    else:
        best_key = 'slug'
        best_match_count = slug_match_count
        print(f"🏆 Using 'slug' as join key ({best_match_count} matches)")
    
    return best_key, best_match_count, len(characteristics_data)

def join_data(characteristics_data: List[Dict], michelin_data: List[Dict], join_key: str) -> List[Dict]:
    """Join the two datasets using the specified key"""
    
    print(f"\n🔗 Joining data using '{join_key}' field...")
    
    # Create lookup dictionaries
    michelin_lookup = {}
    for item in michelin_data:
        key = normalize_string(item.get(join_key, ''))
        if key:
            michelin_lookup[key] = item
    
    # Join the data
    joined_data = []
    matched_count = 0
    
    for char_item in characteristics_data:
        # Create a copy of the characteristics item
        joined_item = char_item.copy()
        
        # Try to find matching Michelin data
        char_key = normalize_string(char_item.get(join_key, ''))
        michelin_match = michelin_lookup.get(char_key)
        
        if michelin_match:
            # Add Michelin fields with 'michelin_' prefix to avoid conflicts
            joined_item['michelin_award'] = michelin_match.get('michelin_award', '')
            joined_item['michelin_slug'] = michelin_match.get('slug', '')
            matched_count += 1
        else:
            # Add empty Michelin fields for unmatched restaurants
            joined_item['michelin_award'] = ''
            joined_item['michelin_slug'] = ''
        
        joined_data.append(joined_item)
    
    print(f"✅ Joined {len(joined_data)} restaurants")
    print(f"✅ Matched {matched_count} restaurants with Michelin data")
    print(f"✅ {len(joined_data) - matched_count} restaurants without Michelin data")
    
    return joined_data

def save_joined_data(data: List[Dict], output_path: str):
    """Save joined data to JSON file"""
    try:
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"💾 Joined data saved to {output_path}")
    except Exception as e:
        print(f"❌ Error saving data: {e}")

def analyze_join_results(joined_data: List[Dict]):
    """Analyze the results of the join operation"""
    
    print(f"\n📊 Join Analysis:")
    
    # Count restaurants with Michelin data
    with_michelin = sum(1 for item in joined_data if item.get('michelin_award'))
    without_michelin = len(joined_data) - with_michelin
    
    print(f"   Total restaurants: {len(joined_data)}")
    print(f"   With Michelin data: {with_michelin} ({(with_michelin/len(joined_data)*100):.1f}%)")
    print(f"   Without Michelin data: {without_michelin} ({(without_michelin/len(joined_data)*100):.1f}%)")
    
    # Show some examples of matched restaurants
    michelin_restaurants = [item for item in joined_data if item.get('michelin_award')]
    if michelin_restaurants:
        print(f"\n🏆 Sample Michelin restaurants:")
        for i, restaurant in enumerate(michelin_restaurants[:5]):
            print(f"   {i+1}. {restaurant['name']}")
            print(f"      Award: {restaurant['michelin_award']}")
            print(f"      Borough: {restaurant.get('borough', 'N/A')}")
            print(f"      Cuisine: {restaurant.get('cuisine', 'N/A')}")

def main():
    """Main function to join Michelin data with restaurant characteristics"""
    
    print("🔗 NYC Restaurant Week - Michelin Data Join")
    print("=" * 50)
    
    # File paths
    characteristics_file = "src/data/NYCRestaurantWeek/3_Characteristics.json"
    michelin_file = "src/data/Lists/MichelinNYC.json"
    output_file = "src/data/NYCRestaurantWeek/4_JoinMichelin.json"
    
    # Load data
    print("\n📂 Loading data files...")
    characteristics_data = load_json_file(characteristics_file)
    michelin_data = load_json_file(michelin_file)
    
    if not characteristics_data or not michelin_data:
        print("❌ Failed to load data files")
        return
    
    # Find best join key
    join_key, match_count, total_count = find_best_join_key(characteristics_data, michelin_data)
    
    # Join the data
    joined_data = join_data(characteristics_data, michelin_data, join_key)
    
    # Save joined data
    save_joined_data(joined_data, output_file)
    
    # Analyze results
    analyze_join_results(joined_data)
    
    print(f"\n🎉 Join completed successfully!")
    print(f"📁 Output file: {output_file}")

if __name__ == "__main__":
    main() 