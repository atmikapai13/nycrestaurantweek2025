import json
import pandas as pd
from typing import Dict, List, Tuple
from collections import Counter

def load_json_file(filepath: str) -> List[Dict]:
    """Load JSON file and return list of dictionaries"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Handle different JSON structures
        if isinstance(data, list):
            # Direct list of dictionaries
            print(f"✅ Loaded {len(data)} records from {filepath}")
            return data
        elif isinstance(data, dict) and 'restaurants' in data:
            # Object with restaurants array
            restaurants = data['restaurants']
            print(f"✅ Loaded {len(restaurants)} restaurants from {filepath}")
            return data
        else:
            # Other dictionary structure
            print(f"✅ Loaded JSON object with {len(data)} keys from {filepath}")
            return data
    except Exception as e:
        print(f"❌ Error loading {filepath}: {e}")
        return []

def normalize_string(s: str) -> str:
    """Normalize string for better matching with robust handling of variations"""
    if not s:
        return ""
    
    import unicodedata
    import re
    
    # Convert to lowercase and strip whitespace
    normalized = s.lower().strip()
    
    # Remove accents and diacritics
    normalized = unicodedata.normalize('NFD', normalized)
    normalized = ''.join(c for c in normalized if not unicodedata.combining(c))
    
    # Replace common variations
    replacements = {
        "'": "",           # Remove apostrophes
        '"': "",           # Remove quotes
        "'": "",           # Remove smart quotes
        '"': "",           # Remove smart quotes
        "&": "and",        # Replace & with and
        "-": " ",          # Replace hyphens with spaces
        "_": " ",          # Replace underscores with spaces
        ".": "",           # Remove periods
        ",": "",           # Remove commas
        "!": "",           # Remove exclamation marks
        "?": "",           # Remove question marks
        "(": "",           # Remove parentheses
        ")": "",
        "[": "",
        "]": "",
        "{": "",
        "}": "",
        "st.": "street",   # Common abbreviations
        "ave.": "avenue",
        "rd.": "road",
        "blvd.": "boulevard",
        "dr.": "drive",
        "ln.": "lane",
        "pl.": "place",
        "ct.": "court",
        "sq.": "square",
        "n.": "north",
        "s.": "south",
        "e.": "east",
        "w.": "west",
        "co.": "company",
        "inc.": "",
        "llc": "",
        "ltd": "",
        "restaurant": "rest",
        "restaurants": "rest",
        "cafe": "café",
        "café": "cafe",
    }
    
    # Apply replacements
    for old, new in replacements.items():
        normalized = normalized.replace(old, new)
    
    # Remove extra whitespace and normalize spaces
    normalized = re.sub(r'\s+', ' ', normalized).strip()
    
    return normalized

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

def join_michelin_data(characteristics_data: List[Dict], michelin_data: List[Dict], join_key: str) -> List[Dict]:
    """Join the two datasets using the specified key"""
    
    print(f"\n🔗 Joining Michelin data using '{join_key}' field...")
    
    # Join the data
    joined_data = []
    matched_count = 0
    potential_matches = []
    
    for char_item in characteristics_data:
        # Create a copy of the characteristics item
        joined_item = char_item.copy()
        
        # Try to find matching Michelin data using enhanced matching
        michelin_match = find_best_michelin_match(char_item.get(join_key, ''), michelin_data)
        
        if michelin_match:
            # Add Michelin fields with 'michelin_' prefix to avoid conflicts
            joined_item['michelin_award'] = michelin_match.get('michelin_award', '')
            joined_item['michelin_slug'] = michelin_match.get('slug', '')
            matched_count += 1
            print(f"✅ Matched: '{char_item.get(join_key, '')}' ↔ '{michelin_match.get('name', '')}' (Award: {michelin_match.get('michelin_award', '')})")
        else:
            # Add empty Michelin fields for unmatched restaurants
            joined_item['michelin_award'] = ''
            joined_item['michelin_slug'] = ''
            
            # Check for potential matches (fuzzy matching)
            original_name = char_item.get(join_key, '')
            for michelin_item in michelin_data:
                michelin_name = michelin_item.get('name', '')
                if original_name.lower() in michelin_name.lower() or michelin_name.lower() in original_name.lower():
                    potential_matches.append({
                        'restaurant_name': original_name,
                        'michelin_name': michelin_name,
                        'michelin_award': michelin_item.get('michelin_award', '')
                    })
        
        joined_data.append(joined_item)
    
    print(f"✅ Joined {len(joined_data)} restaurants")
    print(f"✅ Matched {matched_count} restaurants with Michelin data")
    print(f"✅ {len(joined_data) - matched_count} restaurants without Michelin data")
    
    # Show potential matches that might need manual review
    if potential_matches:
        print(f"\n🔍 Potential Michelin matches that might need manual review:")
        for i, match in enumerate(potential_matches[:10]):  # Show first 10
            print(f"   {i+1}. '{match['restaurant_name']}' ↔ '{match['michelin_name']}' (Award: {match['michelin_award']})")
        if len(potential_matches) > 10:
            print(f"   ... and {len(potential_matches) - 10} more potential matches")
    
    return joined_data

def find_best_match(restaurant_name: str, reference_data: List[Dict], data_type: str = "reference") -> Dict:
    """Find the best match for a restaurant name using various strategies"""
    normalized_name = normalize_string(restaurant_name)
    
    # Strategy 1: Exact normalized match
    for ref_item in reference_data:
        ref_normalized = normalize_string(ref_item.get('name', ''))
        if normalized_name == ref_normalized:
            return ref_item
    
    # Strategy 2: Check if one name contains the other (for cases like "The Dining Room at Gramercy Tavern" vs "Gramercy Tavern")
    for ref_item in reference_data:
        ref_name = ref_item.get('name', '')
        ref_normalized = normalize_string(ref_name)
        
        # Check if one contains the other (but not too short to avoid false positives)
        if (len(normalized_name) > 5 and len(ref_normalized) > 5 and 
            (normalized_name in ref_normalized or ref_normalized in normalized_name)):
            return ref_item
    
    # Strategy 3: Check for common words/phrases
    restaurant_words = set(normalized_name.split())
    for ref_item in reference_data:
        ref_name = ref_item.get('name', '')
        ref_normalized = normalize_string(ref_name)
        ref_words = set(ref_normalized.split())
        
        # If they share significant words, it might be a match
        common_words = restaurant_words & ref_words
        if len(common_words) >= 2 and len(common_words) >= min(len(restaurant_words), len(ref_words)) * 0.7:
            return ref_item
    
    return None

def find_best_nyt_match(restaurant_name: str, nyt_data: List[Dict]) -> Dict:
    """Find the best NYT match for a restaurant name using various strategies"""
    return find_best_match(restaurant_name, nyt_data, "NYT")

def find_best_michelin_match(restaurant_name: str, michelin_data: List[Dict]) -> Dict:
    """Find the best Michelin match for a restaurant name using various strategies"""
    return find_best_match(restaurant_name, michelin_data, "Michelin")

def join_nyt_data(joined_data: List[Dict], nyt_data: List[Dict]) -> List[Dict]:
    """Left join joined data with NYT data on restaurant name"""
    
    print(f"\n🔗 Joining NYT data using 'name' field...")
    
    # Join the data
    final_joined_data = []
    matched_count = 0
    potential_matches = []
    
    for item in joined_data:
        # Create a copy of the item
        final_item = item.copy()
        
        # Try to find matching NYT data using enhanced matching
        nyt_match = find_best_nyt_match(item.get('name', ''), nyt_data)
        
        if nyt_match:
            # Add NYT rank field
            final_item['nyttop100_rank'] = nyt_match.get('rank', '')
            matched_count += 1
            print(f"✅ Matched: '{item.get('name', '')}' ↔ '{nyt_match.get('name', '')}' (Rank: {nyt_match.get('rank', '')})")
        else:
            # Add empty NYT rank for unmatched restaurants
            final_item['nyttop100_rank'] = ''
            
            # Check for potential matches (fuzzy matching)
            original_name = item.get('name', '')
            for nyt_item in nyt_data:
                nyt_name = nyt_item.get('name', '')
                if original_name.lower() in nyt_name.lower() or nyt_name.lower() in original_name.lower():
                    potential_matches.append({
                        'restaurant_name': original_name,
                        'nyt_name': nyt_name,
                        'nyt_rank': nyt_item.get('rank', '')
                    })
        
        final_joined_data.append(final_item)
    
    print(f"✅ Joined {len(final_joined_data)} restaurants")
    print(f"✅ Matched {matched_count} restaurants with NYT data")
    print(f"✅ {len(final_joined_data) - matched_count} restaurants without NYT data")
    
    # Show potential matches that might need manual review
    if potential_matches:
        print(f"\n🔍 Potential matches that might need manual review:")
        for i, match in enumerate(potential_matches[:10]):  # Show first 10
            print(f"   {i+1}. '{match['restaurant_name']}' ↔ '{match['nyt_name']}' (Rank: {match['nyt_rank']})")
        if len(potential_matches) > 10:
            print(f"   ... and {len(potential_matches) - 10} more potential matches")
    
    return final_joined_data

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
    
    # Count restaurants with NYT data
    with_nyt = sum(1 for item in joined_data if item.get('nyttop100_rank'))
    without_nyt = len(joined_data) - with_nyt
    
    # Find restaurants that appear in both lists
    both_michelin_and_nyt = [item for item in joined_data if item.get('michelin_award') and item.get('nyttop100_rank')]
    
    print(f"   Total restaurants: {len(joined_data)}")
    print(f"   With Michelin data: {with_michelin} ({(with_michelin/len(joined_data)*100):.1f}%)")
    print(f"   Without Michelin data: {without_michelin} ({(without_michelin/len(joined_data)*100):.1f}%)")
    print(f"   With NYT data: {with_nyt} ({(with_nyt/len(joined_data)*100):.1f}%)")
    print(f"   Without NYT data: {without_nyt} ({(without_nyt/len(joined_data)*100):.1f}%)")
    print(f"   In BOTH Michelin & NYT: {len(both_michelin_and_nyt)} ({(len(both_michelin_and_nyt)/len(joined_data)*100):.1f}%)")
    
    # Show restaurants that appear in both lists
    if both_michelin_and_nyt:
        print(f"\n🏆📰 Restaurants in BOTH Michelin & NYT Top 100:")
        for i, restaurant in enumerate(both_michelin_and_nyt):
            print(f"   {i+1}. {restaurant['name']}")
            print(f"      Michelin Award: {restaurant['michelin_award']}")
            print(f"      NYT Rank: {restaurant['nyttop100_rank']}")
            print(f"      Borough: {restaurant.get('borough', 'N/A')}")
            print(f"      Cuisine: {restaurant.get('cuisine', 'N/A')}")
            print()

def main():
    """Main function to join Michelin and NYT data with restaurant characteristics"""
    
    print("🔗 NYC Restaurant Week - Michelin & NYT Data Join")
    print("=" * 60)
    
    # File paths
    characteristics_file = "src/data/NYCRestaurantWeek/3_Characteristics.json"
    michelin_file = "src/data/Lists/MichelinNYC.json"
    nyt_file = "src/data/Lists/NYTTop100.json"
    michelin_output_file = "src/data/NYCRestaurantWeek/4_JoinMichelin.json"
    nyttop100_output_file = "src/data/NYCRestaurantWeek/5_JoinNYT.json"
    
    # Load data
    print("\n📂 Loading data files...")
    characteristics_data = load_json_file(characteristics_file)
    michelin_data = load_json_file(michelin_file)
    
    # Load NYT data
    nyt_raw_data = load_json_file(nyt_file)
    if nyt_raw_data and 'restaurants' in nyt_raw_data:
        nyt_data = nyt_raw_data['restaurants']
    else:
        nyt_data = []
        print("❌ Failed to load NYT data")
    
    if not characteristics_data or not michelin_data:
        print("❌ Failed to load data files")
        return
    
    # Step 1: Join with Michelin data
    print("\n" + "="*50)
    print("STEP 1: Joining with Michelin data")
    print("="*50)
    
    # Find best join key for Michelin
    join_key, match_count, total_count = find_best_join_key(characteristics_data, michelin_data)
    
    # Join the data with Michelin
    joined_data = join_michelin_data(characteristics_data, michelin_data, join_key)
    
    # Save intermediate result
    save_joined_data(joined_data, michelin_output_file)
    
    # Step 2: Join with NYT data
    print("\n" + "="*50)
    print("STEP 2: Joining with NYT data")
    print("="*50)
    
    # Join with NYT data
    final_joined_data = join_nyt_data(joined_data, nyt_data)
    
    # Save final result
    save_joined_data(final_joined_data, nyttop100_output_file)
    
    # Also save as FinalData.json for easy access
    final_data_file = "src/data/FinalData.json"
    save_joined_data(final_joined_data, final_data_file)
    
    # Analyze results
    analyze_join_results(final_joined_data)
    
    print(f"\n🎉 Join completed successfully!")
    print(f"📁 Michelin output file: {michelin_output_file}")
    print(f"📁 NYT Top 100 output file: {nyttop100_output_file}")
    print(f"📁 Final data file: {final_data_file}")

if __name__ == "__main__":
    main() 