import json
import pandas as pd
from typing import Dict, List, Tuple, Set
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

def perform_outer_join_analysis(restaurant_week_data: List[Dict], michelin_data: List[Dict], nyt_data: List[Dict]) -> Dict:
    """Perform outer join analysis including ALL restaurants from all three datasets"""
    
    print("\n🔍 Performing outer join analysis for ALL restaurants across all datasets...")
    
    # Create lookup dictionaries for each dataset
    rw_lookup = {normalize_string(item.get('name', '')): item for item in restaurant_week_data}
    michelin_lookup = {normalize_string(item.get('name', '')): item for item in michelin_data}
    nyt_lookup = {normalize_string(item.get('name', '')): item for item in nyt_data}
    
    # Get all unique restaurant names across all datasets
    all_names = set(rw_lookup.keys()) | set(michelin_lookup.keys()) | set(nyt_lookup.keys())
    
    print(f"📊 Total unique restaurants across all datasets: {len(all_names)}")
    
    # Initialize analysis results
    analysis_results = {
        'all_restaurants': [],
        'join_statistics': {},
        'dataset_coverage': {},
        'overlap_analysis': {}
    }
    
    # Process each unique restaurant
    total_processed = 0
    rw_only = 0
    michelin_only = 0
    nyt_only = 0
    rw_michelin = 0
    rw_nyt = 0
    michelin_nyt = 0
    all_three = 0
    
    for normalized_name in all_names:
        rw_restaurant = rw_lookup.get(normalized_name)
        michelin_restaurant = michelin_lookup.get(normalized_name)
        nyt_restaurant = nyt_lookup.get(normalized_name)
        
        # Determine which datasets this restaurant appears in
        datasets_present = []
        if rw_restaurant:
            datasets_present.append('Restaurant Week')
        if michelin_restaurant:
            datasets_present.append('Michelin')
        if nyt_restaurant:
            datasets_present.append('NYT Top 100')
        
        # Count overlaps
        if len(datasets_present) == 1:
            if 'Restaurant Week' in datasets_present:
                rw_only += 1
            elif 'Michelin' in datasets_present:
                michelin_only += 1
            elif 'NYT Top 100' in datasets_present:
                nyt_only += 1
        elif len(datasets_present) == 2:
            if 'Restaurant Week' in datasets_present and 'Michelin' in datasets_present:
                rw_michelin += 1
            elif 'Restaurant Week' in datasets_present and 'NYT Top 100' in datasets_present:
                rw_nyt += 1
            elif 'Michelin' in datasets_present and 'NYT Top 100' in datasets_present:
                michelin_nyt += 1
        elif len(datasets_present) == 3:
            all_three += 1
        
        # Create comprehensive restaurant record
        restaurant_record = {
            'restaurant_name': rw_restaurant.get('name', '') if rw_restaurant else 
                             michelin_restaurant.get('name', '') if michelin_restaurant else 
                             nyt_restaurant.get('name', ''),
            'datasets_present': datasets_present,
            'datasets_count': len(datasets_present),
            'restaurant_week_data': None,
            'michelin_data': None,
            'nyt_data': None,
            'match_quality': {
                'michelin_match': 'none',
                'nyt_match': 'none'
            }
        }
        
        # Add Restaurant Week data
        if rw_restaurant:
            restaurant_record['restaurant_week_data'] = {
                'name': rw_restaurant.get('name', ''),
                'cuisine': extract_cuisine_info(rw_restaurant, 'Restaurant Week'),
                'borough': rw_restaurant.get('borough', ''),
                'neighborhood': rw_restaurant.get('neighborhood', ''),
                'summary': rw_restaurant.get('summary', ''),
                'website': rw_restaurant.get('website', ''),
                'address': rw_restaurant.get('address', ''),
                'latitude': rw_restaurant.get('latitude', ''),
                'longitude': rw_restaurant.get('longitude', ''),
                'price_range': rw_restaurant.get('price_range', '')
            }
        
        # Add Michelin data
        if michelin_restaurant:
            restaurant_record['michelin_data'] = {
                'name': michelin_restaurant.get('name', ''),
                'cuisine': extract_cuisine_info(michelin_restaurant, 'Michelin'),
                'michelin_award': michelin_restaurant.get('michelin_award', ''),
                'slug': michelin_restaurant.get('slug', ''),
                'latitude': michelin_restaurant.get('latitude', ''),
                'longitude': michelin_restaurant.get('longitude', ''),
                'description': michelin_restaurant.get('description', '')
            }
            restaurant_record['match_quality']['michelin_match'] = 'exact'
        
        # Add NYT data
        if nyt_restaurant:
            restaurant_record['nyt_data'] = {
                'name': nyt_restaurant.get('name', ''),
                'cuisine': extract_cuisine_info(nyt_restaurant, 'NYT Top 100'),
                'rank': nyt_restaurant.get('rank', ''),
                'price': nyt_restaurant.get('price', ''),
                'full_address': nyt_restaurant.get('full_address', ''),
                'website': nyt_restaurant.get('website', ''),
                'description': nyt_restaurant.get('description', ''),
                'stars': nyt_restaurant.get('stars', '')
            }
            restaurant_record['match_quality']['nyt_match'] = 'exact'
        
        analysis_results['all_restaurants'].append(restaurant_record)
        total_processed += 1
        
        # Progress update
        if total_processed % 50 == 0:
            print(f"   Processed {total_processed}/{len(all_names)} restaurants...")
    
    # Calculate statistics
    analysis_results['join_statistics'] = {
        'total_unique_restaurants': len(all_names),
        'restaurant_week_only': rw_only,
        'michelin_only': michelin_only,
        'nyt_only': nyt_only,
        'restaurant_week_and_michelin': rw_michelin,
        'restaurant_week_and_nyt': rw_nyt,
        'michelin_and_nyt': michelin_nyt,
        'all_three_datasets': all_three,
        'total_restaurant_week': len(restaurant_week_data),
        'total_michelin': len(michelin_data),
        'total_nyt': len(nyt_data)
    }
    
    # Calculate dataset coverage
    total_rw = rw_only + rw_michelin + rw_nyt + all_three
    total_michelin = michelin_only + rw_michelin + michelin_nyt + all_three
    total_nyt = nyt_only + rw_nyt + michelin_nyt + all_three
    
    analysis_results['dataset_coverage'] = {
        'restaurant_week_coverage': total_rw,
        'michelin_coverage': total_michelin,
        'nyt_coverage': total_nyt,
        'restaurant_week_percentage': (total_rw / len(all_names) * 100) if all_names else 0,
        'michelin_percentage': (total_michelin / len(all_names) * 100) if all_names else 0,
        'nyt_percentage': (total_nyt / len(all_names) * 100) if all_names else 0
    }
    
    # Analyze overlaps
    analysis_results['overlap_analysis'] = {
        'restaurants_in_multiple_datasets': rw_michelin + rw_nyt + michelin_nyt + all_three,
        'restaurants_in_single_dataset': rw_only + michelin_only + nyt_only,
        'overlap_percentage': ((rw_michelin + rw_nyt + michelin_nyt + all_three) / len(all_names) * 100) if all_names else 0
    }
    
    return analysis_results

def analyze_cuisine_consistency(restaurants: List[Dict]) -> Dict:
    """Analyze cuisine consistency across restaurants in multiple datasets"""
    
    cuisine_comparisons = []
    
    for restaurant in restaurants:
        if restaurant['datasets_count'] < 2:
            continue
            
        cuisines = {}
        if restaurant['restaurant_week_data']:
            cuisines['Restaurant Week'] = restaurant['restaurant_week_data']['cuisine']
        if restaurant['michelin_data']:
            cuisines['Michelin'] = restaurant['michelin_data']['cuisine']
        if restaurant['nyt_data']:
            cuisines['NYT Top 100'] = restaurant['nyt_data']['cuisine']
        
        if len(cuisines) >= 2:
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

def save_analysis_results(analysis_results: Dict, output_dir: str):
    """Save outer join analysis results"""
    
    # Create output directory if it doesn't exist
    os.makedirs(output_dir, exist_ok=True)
    
    # Save full analysis
    analysis_file = os.path.join(output_dir, 'outer_join_analysis.json')
    with open(analysis_file, 'w', encoding='utf-8') as f:
        json.dump(analysis_results, f, indent=2, ensure_ascii=False)
    print(f"💾 Full outer join analysis saved to {analysis_file}")
    
    # Create CSV files for easier analysis
    create_csv_files(analysis_results, output_dir)

def create_csv_files(analysis_results: Dict, output_dir: str):
    """Create CSV files for different aspects of the outer join analysis"""
    
    # Create comprehensive summary CSV
    summary_data = []
    for restaurant in analysis_results['all_restaurants']:
        row = {
            'restaurant_name': restaurant['restaurant_name'],
            'datasets_present': ', '.join(restaurant['datasets_present']),
            'datasets_count': restaurant['datasets_count'],
            'has_restaurant_week': restaurant['restaurant_week_data'] is not None,
            'has_michelin': restaurant['michelin_data'] is not None,
            'has_nyt': restaurant['nyt_data'] is not None,
            'rw_cuisine': restaurant['restaurant_week_data']['cuisine'] if restaurant['restaurant_week_data'] else '',
            'michelin_cuisine': restaurant['michelin_data']['cuisine'] if restaurant['michelin_data'] else '',
            'nyt_cuisine': restaurant['nyt_data']['cuisine'] if restaurant['nyt_data'] else '',
            'rw_borough': restaurant['restaurant_week_data']['borough'] if restaurant['restaurant_week_data'] else '',
            'rw_neighborhood': restaurant['restaurant_week_data']['neighborhood'] if restaurant['restaurant_week_data'] else '',
            'michelin_award': restaurant['michelin_data']['michelin_award'] if restaurant['michelin_data'] else '',
            'nyt_rank': restaurant['nyt_data']['rank'] if restaurant['nyt_data'] else ''
        }
        summary_data.append(row)
    
    summary_df = pd.DataFrame(summary_data)
    summary_csv = os.path.join(output_dir, 'outer_join_summary.csv')
    summary_df.to_csv(summary_csv, index=False)
    print(f"💾 Outer join summary CSV saved to {summary_csv}")
    
    # Create dataset-specific CSVs
    create_dataset_specific_csvs(analysis_results, output_dir)

def create_dataset_specific_csvs(analysis_results: Dict, output_dir: str):
    """Create CSV files for restaurants in specific dataset combinations"""
    
    # Restaurants in multiple datasets
    multiple_datasets = [r for r in analysis_results['all_restaurants'] if r['datasets_count'] >= 2]
    if multiple_datasets:
        multiple_df = pd.DataFrame([{
            'restaurant_name': r['restaurant_name'],
            'datasets_present': ', '.join(r['datasets_present']),
            'rw_cuisine': r['restaurant_week_data']['cuisine'] if r['restaurant_week_data'] else '',
            'michelin_cuisine': r['michelin_data']['cuisine'] if r['michelin_data'] else '',
            'nyt_cuisine': r['nyt_data']['cuisine'] if r['nyt_data'] else '',
            'michelin_award': r['michelin_data']['michelin_award'] if r['michelin_data'] else '',
            'nyt_rank': r['nyt_data']['rank'] if r['nyt_data'] else ''
        } for r in multiple_datasets])
        
        multiple_csv = os.path.join(output_dir, 'restaurants_in_multiple_datasets.csv')
        multiple_df.to_csv(multiple_csv, index=False)
        print(f"💾 Multiple datasets CSV saved to {multiple_csv}")
    
    # Restaurants in all three datasets
    all_three = [r for r in analysis_results['all_restaurants'] if r['datasets_count'] == 3]
    if all_three:
        all_three_df = pd.DataFrame([{
            'restaurant_name': r['restaurant_name'],
            'rw_cuisine': r['restaurant_week_data']['cuisine'] if r['restaurant_week_data'] else '',
            'michelin_cuisine': r['michelin_data']['cuisine'] if r['michelin_data'] else '',
            'nyt_cuisine': r['nyt_data']['cuisine'] if r['nyt_data'] else '',
            'michelin_award': r['michelin_data']['michelin_award'] if r['michelin_data'] else '',
            'nyt_rank': r['nyt_data']['rank'] if r['nyt_data'] else ''
        } for r in all_three])
        
        all_three_csv = os.path.join(output_dir, 'restaurants_in_all_three_datasets.csv')
        all_three_df.to_csv(all_three_csv, index=False)
        print(f"💾 All three datasets CSV saved to {all_three_csv}")

def print_analysis_summary(analysis_results: Dict):
    """Print a summary of the outer join analysis"""
    
    print("\n" + "="*80)
    print("🔗 OUTER JOIN ANALYSIS SUMMARY")
    print("="*80)
    
    stats = analysis_results['join_statistics']
    coverage = analysis_results['dataset_coverage']
    overlap = analysis_results['overlap_analysis']
    
    print(f"\n📊 DATASET STATISTICS:")
    print(f"   Total unique restaurants across all datasets: {stats['total_unique_restaurants']}")
    print(f"   Restaurant Week restaurants: {stats['total_restaurant_week']}")
    print(f"   Michelin restaurants: {stats['total_michelin']}")
    print(f"   NYT Top 100 restaurants: {stats['total_nyt']}")
    
    print(f"\n🔗 OVERLAP BREAKDOWN:")
    print(f"   Restaurant Week only: {stats['restaurant_week_only']}")
    print(f"   Michelin only: {stats['michelin_only']}")
    print(f"   NYT Top 100 only: {stats['nyt_only']}")
    print(f"   Restaurant Week + Michelin: {stats['restaurant_week_and_michelin']}")
    print(f"   Restaurant Week + NYT Top 100: {stats['restaurant_week_and_nyt']}")
    print(f"   Michelin + NYT Top 100: {stats['michelin_and_nyt']}")
    print(f"   All three datasets: {stats['all_three_datasets']}")
    
    print(f"\n📈 DATASET COVERAGE:")
    print(f"   Restaurant Week coverage: {coverage['restaurant_week_coverage']} ({coverage['restaurant_week_percentage']:.1f}%)")
    print(f"   Michelin coverage: {coverage['michelin_coverage']} ({coverage['michelin_percentage']:.1f}%)")
    print(f"   NYT Top 100 coverage: {coverage['nyt_coverage']} ({coverage['nyt_percentage']:.1f}%)")
    
    print(f"\n🔄 OVERLAP ANALYSIS:")
    print(f"   Restaurants in multiple datasets: {overlap['restaurants_in_multiple_datasets']}")
    print(f"   Restaurants in single dataset: {overlap['restaurants_in_single_dataset']}")
    print(f"   Overlap percentage: {overlap['overlap_percentage']:.1f}%")

def main():
    """Main function to run outer join analysis"""
    
    print("🔗 NYC Restaurant Outer Join Analysis")
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
    
    # Run outer join analysis
    analysis_results = perform_outer_join_analysis(restaurant_week_data, michelin_data, nyt_data)
    
    # Add cuisine consistency analysis
    cuisine_analysis = analyze_cuisine_consistency(analysis_results['all_restaurants'])
    analysis_results['cuisine_analysis'] = cuisine_analysis
    
    # Save results
    save_analysis_results(analysis_results, output_dir)
    
    # Print summary
    print_analysis_summary(analysis_results)
    
    print(f"\n🎉 Outer join analysis completed!")
    print(f"📁 Results saved to: {output_dir}")

if __name__ == "__main__":
    main() 