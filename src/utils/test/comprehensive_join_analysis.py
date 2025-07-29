import json
import pandas as pd
from typing import Dict, List, Tuple
from collections import Counter
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

def extract_cuisine_info(restaurant: Dict, source: str) -> str:
    """Extract cuisine information from a restaurant record"""
    cuisine = restaurant.get('cuisine', '')
    
    if isinstance(cuisine, list):
        return ', '.join(cuisine)
    elif isinstance(cuisine, dict):
        # Handle Michelin's cuisine format
        if 'label' in cuisine:
            return cuisine['label']
        else:
            return str(cuisine)
    else:
        return str(cuisine)

def comprehensive_join_analysis(restaurant_week_data: List[Dict], michelin_data: List[Dict], nyt_data: List[Dict]) -> Dict:
    """Perform comprehensive join analysis for ALL restaurants"""
    
    print("\n🔍 Performing comprehensive join analysis for ALL restaurants...")
    
    # Initialize analysis results
    analysis_results = {
        'all_restaurants': [],
        'join_statistics': {},
        'cuisine_analysis': {},
        'match_quality': {}
    }
    
    # Process each restaurant from Restaurant Week data (base dataset)
    total_restaurants = len(restaurant_week_data)
    matched_michelin = 0
    matched_nyt = 0
    matched_both = 0
    
    for i, rw_restaurant in enumerate(restaurant_week_data):
        restaurant_name = rw_restaurant.get('name', '')
        
        # Create base record
        restaurant_record = {
            'restaurant_name': restaurant_name,
            'restaurant_week_data': {
                'name': restaurant_name,
                'cuisine': extract_cuisine_info(rw_restaurant, 'Restaurant Week'),
                'borough': rw_restaurant.get('borough', ''),
                'neighborhood': rw_restaurant.get('neighborhood', ''),
                'summary': rw_restaurant.get('summary', ''),
                'website': rw_restaurant.get('website', ''),
                'address': rw_restaurant.get('address', ''),
                'latitude': rw_restaurant.get('latitude', ''),
                'longitude': rw_restaurant.get('longitude', ''),
                'price_range': rw_restaurant.get('price_range', '')
            },
            'michelin_data': None,
            'nyt_data': None,
            'match_quality': {
                'michelin_match': 'none',
                'nyt_match': 'none'
            }
        }
        
        # Try to find Michelin match
        michelin_match = find_best_michelin_match(restaurant_name, michelin_data)
        if michelin_match:
            restaurant_record['michelin_data'] = {
                'name': michelin_match.get('name', ''),
                'cuisine': extract_cuisine_info(michelin_match, 'Michelin'),
                'michelin_award': michelin_match.get('michelin_award', ''),
                'slug': michelin_match.get('slug', ''),
                'latitude': michelin_match.get('latitude', ''),
                'longitude': michelin_match.get('longitude', ''),
                'description': michelin_match.get('description', '')
            }
            restaurant_record['match_quality']['michelin_match'] = 'exact' if normalize_string(restaurant_name) == normalize_string(michelin_match.get('name', '')) else 'fuzzy'
            matched_michelin += 1
        
        # Try to find NYT match
        nyt_match = find_best_nyt_match(restaurant_name, nyt_data)
        if nyt_match:
            restaurant_record['nyt_data'] = {
                'name': nyt_match.get('name', ''),
                'cuisine': extract_cuisine_info(nyt_match, 'NYT Top 100'),
                'rank': nyt_match.get('rank', ''),
                'price': nyt_match.get('price', ''),
                'full_address': nyt_match.get('full_address', ''),
                'website': nyt_match.get('website', ''),
                'description': nyt_match.get('description', ''),
                'stars': nyt_match.get('stars', '')
            }
            restaurant_record['match_quality']['nyt_match'] = 'exact' if normalize_string(restaurant_name) == normalize_string(nyt_match.get('name', '')) else 'fuzzy'
            matched_nyt += 1
        
        # Check if matched both
        if restaurant_record['michelin_data'] and restaurant_record['nyt_data']:
            matched_both += 1
        
        analysis_results['all_restaurants'].append(restaurant_record)
        
        # Progress update
        if (i + 1) % 50 == 0:
            print(f"   Processed {i + 1}/{total_restaurants} restaurants...")
    
    # Calculate statistics
    analysis_results['join_statistics'] = {
        'total_restaurants': total_restaurants,
        'matched_michelin': matched_michelin,
        'matched_nyt': matched_nyt,
        'matched_both': matched_both,
        'michelin_match_rate': (matched_michelin / total_restaurants * 100) if total_restaurants > 0 else 0,
        'nyt_match_rate': (matched_nyt / total_restaurants * 100) if total_restaurants > 0 else 0,
        'both_match_rate': (matched_both / total_restaurants * 100) if total_restaurants > 0 else 0
    }
    
    # Analyze cuisine consistency for matched restaurants
    cuisine_analysis = analyze_cuisine_consistency(analysis_results['all_restaurants'])
    analysis_results['cuisine_analysis'] = cuisine_analysis
    
    # Analyze match quality
    match_quality = analyze_match_quality(analysis_results['all_restaurants'])
    analysis_results['match_quality'] = match_quality
    
    return analysis_results

def analyze_cuisine_consistency(restaurants: List[Dict]) -> Dict:
    """Analyze cuisine consistency across matched restaurants"""
    
    cuisine_comparisons = []
    
    for restaurant in restaurants:
        rw_cuisine = restaurant['restaurant_week_data']['cuisine']
        michelin_cuisine = restaurant['michelin_data']['cuisine'] if restaurant['michelin_data'] else None
        nyt_cuisine = restaurant['nyt_data']['cuisine'] if restaurant['nyt_data'] else None
        
        cuisines = {}
        if rw_cuisine:
            cuisines['Restaurant Week'] = rw_cuisine
        if michelin_cuisine:
            cuisines['Michelin'] = michelin_cuisine
        if nyt_cuisine:
            cuisines['NYT Top 100'] = nyt_cuisine
        
        if len(cuisines) >= 2:  # At least 2 datasets have cuisine info
            cuisine_comparisons.append({
                'restaurant_name': restaurant['restaurant_name'],
                'cuisines': cuisines,
                'datasets_count': len(cuisines)
            })
    
    # Analyze consistency
    exact_matches = []
    partial_matches = []
    completely_different = []
    
    for comparison in cuisine_comparisons:
        cuisine_values = list(comparison['cuisines'].values())
        
        # Normalize cuisine values for comparison
        normalized_cuisines = []
        for cuisine in cuisine_values:
            if cuisine:
                parts = [part.strip().lower() for part in cuisine.split(',')]
                normalized_cuisines.append(set(parts))
        
        if len(normalized_cuisines) < 2:
            continue
        
        # Check for exact matches
        if all(cuisine_set == normalized_cuisines[0] for cuisine_set in normalized_cuisines):
            exact_matches.append(comparison)
        else:
            # Check for partial matches (shared cuisines)
            common_cuisines = set.intersection(*normalized_cuisines)
            if common_cuisines:
                partial_matches.append({
                    **comparison,
                    'common_cuisines': list(common_cuisines)
                })
            else:
                completely_different.append(comparison)
    
    return {
        'total_comparisons': len(cuisine_comparisons),
        'exact_matches': len(exact_matches),
        'partial_matches': len(partial_matches),
        'completely_different': len(completely_different),
        'exact_match_rate': (len(exact_matches) / len(cuisine_comparisons) * 100) if cuisine_comparisons else 0,
        'partial_match_rate': (len(partial_matches) / len(cuisine_comparisons) * 100) if cuisine_comparisons else 0,
        'different_rate': (len(completely_different) / len(cuisine_comparisons) * 100) if cuisine_comparisons else 0,
        'examples': {
            'exact_matches': exact_matches[:5],
            'partial_matches': partial_matches[:5],
            'completely_different': completely_different[:5]
        }
    }

def analyze_match_quality(restaurants: List[Dict]) -> Dict:
    """Analyze the quality of matches"""
    
    exact_michelin = sum(1 for r in restaurants if r['match_quality']['michelin_match'] == 'exact')
    fuzzy_michelin = sum(1 for r in restaurants if r['match_quality']['michelin_match'] == 'fuzzy')
    exact_nyt = sum(1 for r in restaurants if r['match_quality']['nyt_match'] == 'exact')
    fuzzy_nyt = sum(1 for r in restaurants if r['match_quality']['nyt_match'] == 'fuzzy')
    
    return {
        'michelin_matches': {
            'exact': exact_michelin,
            'fuzzy': fuzzy_michelin,
            'total': exact_michelin + fuzzy_michelin
        },
        'nyt_matches': {
            'exact': exact_nyt,
            'fuzzy': fuzzy_nyt,
            'total': exact_nyt + fuzzy_nyt
        }
    }

def save_analysis_results(analysis_results: Dict, output_dir: str):
    """Save comprehensive analysis results"""
    
    # Create output directory if it doesn't exist
    os.makedirs(output_dir, exist_ok=True)
    
    # Save full analysis
    analysis_file = os.path.join(output_dir, 'comprehensive_join_analysis.json')
    with open(analysis_file, 'w', encoding='utf-8') as f:
        json.dump(analysis_results, f, indent=2, ensure_ascii=False)
    print(f"💾 Full analysis saved to {analysis_file}")
    
    # Create CSV files for easier analysis
    create_csv_files(analysis_results, output_dir)

def create_csv_files(analysis_results: Dict, output_dir: str):
    """Create CSV files for different aspects of the analysis"""
    
    # Create summary CSV
    summary_data = []
    for restaurant in analysis_results['all_restaurants']:
        row = {
            'restaurant_name': restaurant['restaurant_name'],
            'has_michelin_match': restaurant['michelin_data'] is not None,
            'has_nyt_match': restaurant['nyt_data'] is not None,
            'michelin_match_quality': restaurant['match_quality']['michelin_match'],
            'nyt_match_quality': restaurant['match_quality']['nyt_match'],
            'rw_cuisine': restaurant['restaurant_week_data']['cuisine'],
            'michelin_cuisine': restaurant['michelin_data']['cuisine'] if restaurant['michelin_data'] else '',
            'nyt_cuisine': restaurant['nyt_data']['cuisine'] if restaurant['nyt_data'] else '',
            'rw_borough': restaurant['restaurant_week_data']['borough'],
            'rw_neighborhood': restaurant['restaurant_week_data']['neighborhood']
        }
        summary_data.append(row)
    
    summary_df = pd.DataFrame(summary_data)
    summary_csv = os.path.join(output_dir, 'comprehensive_join_summary.csv')
    summary_df.to_csv(summary_csv, index=False)
    print(f"💾 Summary CSV saved to {summary_csv}")
    
    # Create matched restaurants CSV
    matched_data = []
    for restaurant in analysis_results['all_restaurants']:
        if restaurant['michelin_data'] or restaurant['nyt_data']:
            row = {
                'restaurant_name': restaurant['restaurant_name'],
                'michelin_award': restaurant['michelin_data']['michelin_award'] if restaurant['michelin_data'] else '',
                'nyt_rank': restaurant['nyt_data']['rank'] if restaurant['nyt_data'] else '',
                'rw_cuisine': restaurant['restaurant_week_data']['cuisine'],
                'michelin_cuisine': restaurant['michelin_data']['cuisine'] if restaurant['michelin_data'] else '',
                'nyt_cuisine': restaurant['nyt_data']['cuisine'] if restaurant['nyt_data'] else '',
                'rw_borough': restaurant['restaurant_week_data']['borough'],
                'rw_neighborhood': restaurant['restaurant_week_data']['neighborhood']
            }
            matched_data.append(row)
    
    matched_df = pd.DataFrame(matched_data)
    matched_csv = os.path.join(output_dir, 'matched_restaurants.csv')
    matched_df.to_csv(matched_csv, index=False)
    print(f"💾 Matched restaurants CSV saved to {matched_csv}")

def print_analysis_summary(analysis_results: Dict):
    """Print a summary of the comprehensive analysis"""
    
    print("\n" + "="*80)
    print("🔗 COMPREHENSIVE JOIN ANALYSIS SUMMARY")
    print("="*80)
    
    stats = analysis_results['join_statistics']
    print(f"\n📊 JOIN STATISTICS:")
    print(f"   Total restaurants analyzed: {stats['total_restaurants']}")
    print(f"   Matched with Michelin: {stats['matched_michelin']} ({stats['michelin_match_rate']:.1f}%)")
    print(f"   Matched with NYT Top 100: {stats['matched_nyt']} ({stats['nyt_match_rate']:.1f}%)")
    print(f"   Matched with both: {stats['matched_both']} ({stats['both_match_rate']:.1f}%)")
    
    cuisine_stats = analysis_results['cuisine_analysis']
    print(f"\n🍽️ CUISINE CONSISTENCY (for matched restaurants):")
    print(f"   Total cuisine comparisons: {cuisine_stats['total_comparisons']}")
    print(f"   Exact matches: {cuisine_stats['exact_matches']} ({cuisine_stats['exact_match_rate']:.1f}%)")
    print(f"   Partial matches: {cuisine_stats['partial_matches']} ({cuisine_stats['partial_match_rate']:.1f}%)")
    print(f"   Completely different: {cuisine_stats['completely_different']} ({cuisine_stats['different_rate']:.1f}%)")
    
    match_quality = analysis_results['match_quality']
    print(f"\n🎯 MATCH QUALITY:")
    print(f"   Michelin exact matches: {match_quality['michelin_matches']['exact']}")
    print(f"   Michelin fuzzy matches: {match_quality['michelin_matches']['fuzzy']}")
    print(f"   NYT exact matches: {match_quality['nyt_matches']['exact']}")
    print(f"   NYT fuzzy matches: {match_quality['nyt_matches']['fuzzy']}")

def main():
    """Main function to run comprehensive join analysis"""
    
    print("🔗 NYC Restaurant Comprehensive Join Analysis")
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
    
    # Run comprehensive analysis
    analysis_results = comprehensive_join_analysis(restaurant_week_data, michelin_data, nyt_data)
    
    # Save results
    save_analysis_results(analysis_results, output_dir)
    
    # Print summary
    print_analysis_summary(analysis_results)
    
    print(f"\n🎉 Comprehensive join analysis completed!")
    print(f"📁 Results saved to: {output_dir}")

if __name__ == "__main__":
    main() 