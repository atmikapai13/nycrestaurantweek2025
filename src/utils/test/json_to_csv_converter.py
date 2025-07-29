import json
import pandas as pd
import os

def load_json_file(filepath: str) -> dict:
    """Load JSON file and return dictionary"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        print(f"✅ Loaded JSON from {filepath}")
        return data
    except Exception as e:
        print(f"❌ Error loading {filepath}: {e}")
        return {}

def convert_cuisine_analysis_to_csv(json_file: str, output_dir: str):
    """Convert cuisine consistency analysis JSON to CSV format"""
    
    # Load the JSON data
    data = load_json_file(json_file)
    if not data:
        return
    
    # Create output directory if it doesn't exist
    os.makedirs(output_dir, exist_ok=True)
    
    # Convert exact matches to CSV
    if 'exact_matches' in data and data['exact_matches']:
        exact_matches_df = []
        for item in data['exact_matches']:
            row = {
                'restaurant_name': item['name'],
                'datasets_present': item['datasets_present'],
                'match_type': 'exact_match'
            }
            
            # Add cuisine columns for each dataset
            for dataset, cuisine in item['cuisines'].items():
                row[f'{dataset}_cuisine'] = cuisine
            
            exact_matches_df.append(row)
        
        exact_df = pd.DataFrame(exact_matches_df)
        exact_csv_path = os.path.join(output_dir, 'exact_matches.csv')
        exact_df.to_csv(exact_csv_path, index=False)
        print(f"💾 Exact matches saved to {exact_csv_path}")
    
    # Convert partial matches to CSV
    if 'partial_matches' in data and data['partial_matches']:
        partial_matches_df = []
        for item in data['partial_matches']:
            row = {
                'restaurant_name': item['name'],
                'datasets_present': item['datasets_present'],
                'match_type': 'partial_match',
                'common_cuisines': ', '.join(item.get('common_cuisines', []))
            }
            
            # Add cuisine columns for each dataset
            for dataset, cuisine in item['cuisines'].items():
                row[f'{dataset}_cuisine'] = cuisine
            
            partial_matches_df.append(row)
        
        partial_df = pd.DataFrame(partial_matches_df)
        partial_csv_path = os.path.join(output_dir, 'partial_matches.csv')
        partial_df.to_csv(partial_csv_path, index=False)
        print(f"💾 Partial matches saved to {partial_csv_path}")
    
    # Convert completely different to CSV
    if 'completely_different' in data and data['completely_different']:
        different_df = []
        for item in data['completely_different']:
            row = {
                'restaurant_name': item['name'],
                'datasets_present': item['datasets_present'],
                'match_type': 'completely_different'
            }
            
            # Add cuisine columns for each dataset
            for dataset, cuisine in item['cuisines'].items():
                row[f'{dataset}_cuisine'] = cuisine
            
            different_df.append(row)
        
        different_pd = pd.DataFrame(different_df)
        different_csv_path = os.path.join(output_dir, 'completely_different.csv')
        different_pd.to_csv(different_csv_path, index=False)
        print(f"💾 Completely different saved to {different_csv_path}")
    
    # Create a combined CSV with all data
    all_data = []
    
    # Add exact matches
    if 'exact_matches' in data:
        for item in data['exact_matches']:
            row = {
                'restaurant_name': item['name'],
                'datasets_present': item['datasets_present'],
                'match_type': 'exact_match',
                'common_cuisines': ''
            }
            for dataset, cuisine in item['cuisines'].items():
                row[f'{dataset}_cuisine'] = cuisine
            all_data.append(row)
    
    # Add partial matches
    if 'partial_matches' in data:
        for item in data['partial_matches']:
            row = {
                'restaurant_name': item['name'],
                'datasets_present': item['datasets_present'],
                'match_type': 'partial_match',
                'common_cuisines': ', '.join(item.get('common_cuisines', []))
            }
            for dataset, cuisine in item['cuisines'].items():
                row[f'{dataset}_cuisine'] = cuisine
            all_data.append(row)
    
    # Add completely different
    if 'completely_different' in data:
        for item in data['completely_different']:
            row = {
                'restaurant_name': item['name'],
                'datasets_present': item['datasets_present'],
                'match_type': 'completely_different',
                'common_cuisines': ''
            }
            for dataset, cuisine in item['cuisines'].items():
                row[f'{dataset}_cuisine'] = cuisine
            all_data.append(row)
    
    # Save combined CSV
    if all_data:
        combined_df = pd.DataFrame(all_data)
        combined_csv_path = os.path.join(output_dir, 'cuisine_consistency_analysis.csv')
        combined_df.to_csv(combined_csv_path, index=False)
        print(f"💾 Combined analysis saved to {combined_csv_path}")
        
        # Print summary
        print(f"\n📊 CSV Summary:")
        print(f"   Total restaurants: {len(combined_df)}")
        print(f"   Exact matches: {len(combined_df[combined_df['match_type'] == 'exact_match'])}")
        print(f"   Partial matches: {len(combined_df[combined_df['match_type'] == 'partial_match'])}")
        print(f"   Completely different: {len(combined_df[combined_df['match_type'] == 'completely_different'])}")

def main():
    """Main function to convert JSON to CSV"""
    
    print("📊 Converting Cuisine Consistency Analysis JSON to CSV")
    print("=" * 60)
    
    # File paths
    json_file = "../../data/Lists/test/cuisine_consistency_analysis.json"
    output_dir = "../../data/Lists/test"
    
    # Convert to CSV
    convert_cuisine_analysis_to_csv(json_file, output_dir)
    
    print(f"\n🎉 Conversion completed!")
    print(f"📁 CSV files saved to: {output_dir}")

if __name__ == "__main__":
    main() 