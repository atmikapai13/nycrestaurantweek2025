import json
import pandas as pd
from typing import Dict, List, Set, Tuple
from collections import defaultdict, Counter
import os

def load_json_file(filepath: str) -> List[Dict]:
    """Load JSON file and return list of dictionaries"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Handle different JSON structures
        if isinstance(data, list):
            print(f"✅ Loaded {len(data)} records from {filepath}")
            return data
        elif isinstance(data, dict) and 'restaurants' in data:
            restaurants = data['restaurants']
            print(f"✅ Loaded {len(restaurants)} restaurants from {filepath}")
            return restaurants
        else:
            print(f"✅ Loaded JSON object with {len(data)} keys from {filepath}")
            return data
    except Exception as e:
        print(f"❌ Error loading {filepath}: {e}")
        return []

def normalize_string(s: str) -> str:
    """Normalize string for better matching"""
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

def find_matching_restaurants(restaurant_name: str, reference_data: List[Dict], data_type: str = "reference") -> Dict:
    """Find the best match for a restaurant name using various strategies"""
    normalized_name = normalize_string(restaurant_name)
    
    # Strategy 1: Exact normalized match
    for ref_item in reference_data:
        ref_normalized = normalize_string(ref_item.get('name', ''))
        if normalized_name == ref_normalized:
            return ref_item
    
    # Strategy 2: Check if one name contains the other
    for ref_item in reference_data:
        ref_name = ref_item.get('name', '')
        ref_normalized = normalize_string(ref_name)
        
        if (len(normalized_name) > 5 and len(ref_normalized) > 5 and 
            (normalized_name in ref_normalized or ref_normalized in normalized_name)):
            return ref_item
    
    # Strategy 3: Check for common words/phrases
    restaurant_words = set(normalized_name.split())
    for ref_item in reference_data:
        ref_name = ref_item.get('name', '')
        ref_normalized = normalize_string(ref_name)
        ref_words = set(ref_normalized.split())
        
        common_words = restaurant_words & ref_words
        if len(common_words) >= 2 and len(common_words) >= min(len(restaurant_words), len(ref_words)) * 0.7:
            return ref_item
    
    return None

def extract_cuisine_info(restaurant: Dict, source: str) -> Dict:
    """Extract cuisine information from a restaurant record"""
    cuisine_info = {
        'source': source,
        'name': restaurant.get('name', ''),
        'cuisine': restaurant.get('cuisine', ''),
        'raw_cuisine': restaurant.get('cuisine', '')
    }
    
    # Handle different cuisine formats
    cuisine = restaurant.get('cuisine', '')
    if isinstance(cuisine, list):
        cuisine_info['cuisine'] = ', '.join(cuisine)
    elif isinstance(cuisine, dict):
        # Handle Michelin's cuisine format
        if 'label' in cuisine:
            cuisine_info['cuisine'] = cuisine['label']
        else:
            cuisine_info['cuisine'] = str(cuisine)
    
    return cuisine_info

def analyze_cuisine_overlap(restaurant_week_data: List[Dict], michelin_data: List[Dict], nyt_data: List[Dict]) -> Dict:
    """Analyze cuisine overlap across all three datasets"""
    
    print("\n🔍 Analyzing cuisine overlap across datasets...")
    
    # Create lookup dictionaries for each dataset
    rw_lookup = {normalize_string(item.get('name', '')): item for item in restaurant_week_data}
    michelin_lookup = {normalize_string(item.get('name', '')): item for item in michelin_data}
    nyt_lookup = {normalize_string(item.get('name', '')): item for item in nyt_data}
    
    # Find restaurants that appear in multiple datasets
    all_names = set(rw_lookup.keys()) | set(michelin_lookup.keys()) | set(nyt_lookup.keys())
    
    overlap_analysis = {
        'restaurants_in_multiple_datasets': [],
        'cuisine_comparisons': [],
        'summary_stats': {}
    }
    
    # Analyze each restaurant
    for normalized_name in all_names:
        rw_restaurant = rw_lookup.get(normalized_name)
        michelin_restaurant = michelin_lookup.get(normalized_name)
        nyt_restaurant = nyt_lookup.get(normalized_name)
        
        # Count how many datasets this restaurant appears in
        datasets_present = sum([
            rw_restaurant is not None,
            michelin_restaurant is not None,
            nyt_restaurant is not None
        ])
        
        if datasets_present >= 2:  # Restaurant appears in at least 2 datasets
            restaurant_analysis = {
                'name': rw_restaurant.get('name', '') if rw_restaurant else 
                       michelin_restaurant.get('name', '') if michelin_restaurant else 
                       nyt_restaurant.get('name', ''),
                'datasets_present': datasets_present,
                'datasets': []
            }
            
            cuisine_comparison = {
                'name': restaurant_analysis['name'],
                'datasets_present': datasets_present,
                'cuisines': {}
            }
            
            # Extract cuisine information from each dataset
            if rw_restaurant:
                rw_cuisine = extract_cuisine_info(rw_restaurant, 'Restaurant Week')
                restaurant_analysis['datasets'].append('Restaurant Week')
                cuisine_comparison['cuisines']['Restaurant Week'] = rw_cuisine['cuisine']
            
            if michelin_restaurant:
                michelin_cuisine = extract_cuisine_info(michelin_restaurant, 'Michelin')
                restaurant_analysis['datasets'].append('Michelin')
                cuisine_comparison['cuisines']['Michelin'] = michelin_cuisine['cuisine']
            
            if nyt_restaurant:
                nyt_cuisine = extract_cuisine_info(nyt_restaurant, 'NYT Top 100')
                restaurant_analysis['datasets'].append('NYT Top 100')
                cuisine_comparison['cuisines']['NYT Top 100'] = nyt_cuisine['cuisine']
            
            overlap_analysis['restaurants_in_multiple_datasets'].append(restaurant_analysis)
            overlap_analysis['cuisine_comparisons'].append(cuisine_comparison)
    
    # Calculate summary statistics
    total_overlap = len(overlap_analysis['restaurants_in_multiple_datasets'])
    rw_michelin = sum(1 for r in overlap_analysis['restaurants_in_multiple_datasets'] 
                     if 'Restaurant Week' in r['datasets'] and 'Michelin' in r['datasets'])
    rw_nyt = sum(1 for r in overlap_analysis['restaurants_in_multiple_datasets'] 
                if 'Restaurant Week' in r['datasets'] and 'NYT Top 100' in r['datasets'])
    michelin_nyt = sum(1 for r in overlap_analysis['restaurants_in_multiple_datasets'] 
                      if 'Michelin' in r['datasets'] and 'NYT Top 100' in r['datasets'])
    all_three = sum(1 for r in overlap_analysis['restaurants_in_multiple_datasets'] 
                   if len(r['datasets']) == 3)
    
    overlap_analysis['summary_stats'] = {
        'total_restaurants_in_multiple_datasets': total_overlap,
        'restaurant_week_and_michelin': rw_michelin,
        'restaurant_week_and_nyt': rw_nyt,
        'michelin_and_nyt': michelin_nyt,
        'all_three_datasets': all_three
    }
    
    return overlap_analysis

def analyze_cuisine_consistency(cuisine_comparisons: List[Dict]) -> Dict:
    """Analyze consistency of cuisine classifications"""
    
    print("\n🍽️ Analyzing cuisine consistency...")
    
    consistency_analysis = {
        'exact_matches': [],
        'partial_matches': [],
        'completely_different': [],
        'cuisine_variations': defaultdict(list),
        'consistency_stats': {}
    }
    
    for comparison in cuisine_comparisons:
        cuisines = comparison['cuisines']
        cuisine_values = list(cuisines.values())
        
        # Normalize cuisine values for comparison
        normalized_cuisines = []
        for cuisine in cuisine_values:
            if cuisine:
                # Split by comma and clean up
                parts = [part.strip().lower() for part in cuisine.split(',')]
                normalized_cuisines.append(set(parts))
        
        if len(normalized_cuisines) < 2:
            continue
        
        # Check for exact matches
        if all(cuisine_set == normalized_cuisines[0] for cuisine_set in normalized_cuisines):
            consistency_analysis['exact_matches'].append(comparison)
        else:
            # Check for partial matches (shared cuisines)
            common_cuisines = set.intersection(*normalized_cuisines)
            if common_cuisines:
                consistency_analysis['partial_matches'].append({
                    **comparison,
                    'common_cuisines': list(common_cuisines)
                })
            else:
                consistency_analysis['completely_different'].append(comparison)
        
        # Track cuisine variations
        for cuisine in cuisine_values:
            if cuisine:
                consistency_analysis['cuisine_variations'][cuisine].append(comparison['name'])
    
    # Calculate consistency statistics
    total_comparisons = len(cuisine_comparisons)
    exact_count = len(consistency_analysis['exact_matches'])
    partial_count = len(consistency_analysis['partial_matches'])
    different_count = len(consistency_analysis['completely_different'])
    
    consistency_analysis['consistency_stats'] = {
        'total_comparisons': total_comparisons,
        'exact_matches': exact_count,
        'partial_matches': partial_count,
        'completely_different': different_count,
        'exact_match_rate': (exact_count / total_comparisons * 100) if total_comparisons > 0 else 0,
        'partial_match_rate': (partial_count / total_comparisons * 100) if total_comparisons > 0 else 0,
        'different_rate': (different_count / total_comparisons * 100) if total_comparisons > 0 else 0
    }
    
    return consistency_analysis

def save_analysis_results(overlap_analysis: Dict, consistency_analysis: Dict, output_dir: str):
    """Save analysis results to JSON files"""
    
    # Create output directory if it doesn't exist
    os.makedirs(output_dir, exist_ok=True)
    
    # Save overlap analysis
    overlap_file = os.path.join(output_dir, 'cuisine_overlap_analysis.json')
    with open(overlap_file, 'w', encoding='utf-8') as f:
        json.dump(overlap_analysis, f, indent=2, ensure_ascii=False)
    print(f"💾 Overlap analysis saved to {overlap_file}")
    
    # Save consistency analysis
    consistency_file = os.path.join(output_dir, 'cuisine_consistency_analysis.json')
    with open(consistency_file, 'w', encoding='utf-8') as f:
        json.dump(consistency_analysis, f, indent=2, ensure_ascii=False)
    print(f"💾 Consistency analysis saved to {consistency_file}")
    
    # Create a summary report
    summary_file = os.path.join(output_dir, 'cuisine_analysis_summary.json')
    summary = {
        'overlap_summary': overlap_analysis['summary_stats'],
        'consistency_summary': consistency_analysis['consistency_stats'],
        'total_restaurants_analyzed': len(overlap_analysis['restaurants_in_multiple_datasets'])
    }
    with open(summary_file, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
    print(f"💾 Summary report saved to {summary_file}")

def print_analysis_summary(overlap_analysis: Dict, consistency_analysis: Dict):
    """Print a summary of the analysis results"""
    
    print("\n" + "="*80)
    print("🍽️ CUISINE COMPARISON ANALYSIS SUMMARY")
    print("="*80)
    
    # Overlap summary
    overlap_stats = overlap_analysis['summary_stats']
    print(f"\n📊 DATASET OVERLAP:")
    print(f"   Total restaurants in multiple datasets: {overlap_stats['total_restaurants_in_multiple_datasets']}")
    print(f"   Restaurant Week + Michelin: {overlap_stats['restaurant_week_and_michelin']}")
    print(f"   Restaurant Week + NYT Top 100: {overlap_stats['restaurant_week_and_nyt']}")
    print(f"   Michelin + NYT Top 100: {overlap_stats['michelin_and_nyt']}")
    print(f"   All three datasets: {overlap_stats['all_three_datasets']}")
    
    # Consistency summary
    consistency_stats = consistency_analysis['consistency_stats']
    print(f"\n🍽️ CUISINE CONSISTENCY:")
    print(f"   Total comparisons: {consistency_stats['total_comparisons']}")
    print(f"   Exact matches: {consistency_stats['exact_matches']} ({consistency_stats['exact_match_rate']:.1f}%)")
    print(f"   Partial matches: {consistency_stats['partial_matches']} ({consistency_stats['partial_match_rate']:.1f}%)")
    print(f"   Completely different: {consistency_stats['completely_different']} ({consistency_stats['different_rate']:.1f}%)")
    
    # Show some examples
    print(f"\n🏆 EXAMPLES OF EXACT MATCHES:")
    for i, comparison in enumerate(consistency_analysis['exact_matches'][:5]):
        print(f"   {i+1}. {comparison['name']}")
        for dataset, cuisine in comparison['cuisines'].items():
            print(f"      {dataset}: {cuisine}")
        print()
    
    if consistency_analysis['completely_different']:
        print(f"⚠️  EXAMPLES OF COMPLETELY DIFFERENT CLASSIFICATIONS:")
        for i, comparison in enumerate(consistency_analysis['completely_different'][:5]):
            print(f"   {i+1}. {comparison['name']}")
            for dataset, cuisine in comparison['cuisines'].items():
                print(f"      {dataset}: {cuisine}")
            print()

def main():
    """Main function to run the cuisine comparison analysis"""
    
    print("🍽️ NYC Restaurant Cuisine Comparison Analysis")
    print("=" * 60)
    
    # File paths
    restaurant_week_file = "../../data/NYCRestaurantWeek/3_Characteristics.json"
    michelin_file = "../../data/Lists/MichelinNYC.json"
    nyt_file = "../../data/Lists/NYTTop100.json"
    output_dir = "../../data/Lists/test"
    
    # Load data
    print("\n📂 Loading data files...")
    restaurant_week_data = load_json_file(restaurant_week_file)
    michelin_data = load_json_file(michelin_file)
    nyt_raw_data = load_json_file(nyt_file)
    
    # Handle NYT data structure
    if nyt_raw_data and isinstance(nyt_raw_data, dict) and 'restaurants' in nyt_raw_data:
        nyt_data = nyt_raw_data['restaurants']
    else:
        nyt_data = nyt_raw_data
    
    if not restaurant_week_data or not michelin_data or not nyt_data:
        print("❌ Failed to load one or more data files")
        return
    
    print(f"📊 Data loaded:")
    print(f"   Restaurant Week: {len(restaurant_week_data)} restaurants")
    print(f"   Michelin: {len(michelin_data)} restaurants")
    print(f"   NYT Top 100: {len(nyt_data)} restaurants")
    
    # Run overlap analysis
    overlap_analysis = analyze_cuisine_overlap(restaurant_week_data, michelin_data, nyt_data)
    
    # Run consistency analysis
    consistency_analysis = analyze_cuisine_consistency(overlap_analysis['cuisine_comparisons'])
    
    # Save results
    save_analysis_results(overlap_analysis, consistency_analysis, output_dir)
    
    # Print summary
    print_analysis_summary(overlap_analysis, consistency_analysis)
    
    print(f"\n🎉 Cuisine comparison analysis completed!")
    print(f"📁 Results saved to: {output_dir}")

if __name__ == "__main__":
    main() 