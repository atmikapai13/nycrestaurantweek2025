import json
import os
from typing import List, Dict

def load_json_file(filepath: str) -> List[Dict]:
    """Load a JSON file and return its contents"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading {filepath}: {e}")
        return []

def generate_geojson(data: List[Dict], output_path: str):
    """Generate a GeoJSON file from the restaurant data"""
    features = []
    
    for restaurant in data:
        # Skip if coordinates are missing
        if not restaurant.get("latitude") or not restaurant.get("longitude"):
            continue
            
        # Fix mixed types for GeoJSON validation
        props = restaurant.copy()
        
        # Ensure yelp_rating is consistently a float
        if props.get("yelp_rating") is not None and props.get("yelp_rating") != "":
            try:
                props["yelp_rating"] = float(props["yelp_rating"])
            except (ValueError, TypeError):
                pass
                
        # Ensure yelp_review_count is consistently an int
        if props.get("yelp_review_count") is not None and props.get("yelp_review_count") != "":
            try:
                props["yelp_review_count"] = int(props["yelp_review_count"])
            except (ValueError, TypeError):
                pass
            
        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [float(restaurant["longitude"]), float(restaurant["latitude"])]
            },
            "properties": props
        }
        features.append(feature)
        
    geojson = {
        "type": "FeatureCollection",
        "features": features
    }
    
    try:
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(geojson, f, indent=2)
        print(f"✅ Generated GeoJSON: {output_path} ({len(features)} features)")
    except Exception as e:
        print(f"Error saving GeoJSON: {e}")

def generate_unstructured_markdown(data: List[Dict], output_path: str):
    """Generate an unstructured Markdown file from the restaurant data"""
    lines = ["# NYC Restaurants Yelp Guide\n"]

    for restaurant in data:
        lines.append(f"## {restaurant.get('name', 'Unknown')}\n")

        # Cuisine type (critical for search)
        cuisine = restaurant.get('cuisine', '')
        if cuisine:
            lines.append(f"**Cuisine:** {cuisine}\n")

        summary = restaurant.get('summary', '')
        if summary:
            lines.append(f"**Description:** {summary}\n")

        # Additional summary info
        summary2 = restaurant.get('summary2', '')
        if summary2:
            lines.append(f"**Additional Info:** {summary2}\n")

        # Collections/Vibes (critical for vibe-based search)
        collections = restaurant.get('collections', [])
        if collections and len(collections) > 0:
            lines.append(f"**Vibes/Collections:** {', '.join(collections)}\n")

        highlights = restaurant.get('yelp_review_highlights', '')
        if highlights:
            lines.append(f"{highlights}\n")

        neighborhood = restaurant.get('neighborhood', '')
        if neighborhood:
            lines.append(f"**Neighborhood:** {neighborhood}\n")
            
        address = restaurant.get('address', '')
        if address:
            lines.append(f"**Address:** {address}\n")
            
        lat = restaurant.get('latitude')
        lng = restaurant.get('longitude')
        if lat is not None and lng is not None:
            lines.append(f"**Coordinates:** {lat}, {lng}\n")
            
        price = restaurant.get('price', '')
        if price:
            lines.append(f"**Price:** {price}\n")
            
        available = restaurant.get('available', '')
        if available:
            lines.append(f"**Available:** {available}\n")
        else:
            lines.append(f"**Available:** N/A\n")
            
        michelin = restaurant.get('michelin_award', '')
        if michelin:
            lines.append(f"**Michelin Award:** {michelin}\n")
        else:
            lines.append(f"**Michelin Award:** N/A\n")
            
        nyt = restaurant.get('nyttop100_rank', '')
        if nyt:
            lines.append(f"**NYT Top 100 Rank:** {nyt}\n")
        else:
            lines.append(f"**NYT Top 100 Rank:** N/A\n")
            
        yelp_rating = restaurant.get('yelp_rating')
        if yelp_rating is not None:
            lines.append(f"**Yelp Rating:** {yelp_rating}\n")
            
        yelp_count = restaurant.get('yelp_review_count')
        if yelp_count is not None:
            lines.append(f"**Yelp Review Count:** {yelp_count}\n")
            
        opentable = restaurant.get('opentable_id', '')
        if opentable:
            lines.append(f"**OpenTable ID:** {opentable}\n")
            
        yelp_url = restaurant.get('yelp_url', '')
        if yelp_url:
            lines.append(f"**Yelp:** [{yelp_url}]({yelp_url})\n")
            
        website = restaurant.get('website', '')
        if website:
            lines.append(f"**Website:** [{website}]({website})\n")
            
        fb = restaurant.get('facebook_url', '')
        if fb:
            lines.append(f"**Facebook:** [{fb}]({fb})\n")
            
        ig = restaurant.get('instagram_url', '')
        if ig:
            lines.append(f"**Instagram:** [{ig}]({ig})\n")
            
        lines.append("---\n")
        
    try:
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write("\n".join(lines))
        print(f"✅ Generated Markdown: {output_path}")
    except Exception as e:
        print(f"Error saving Markdown: {e}")

def main():
    # Define paths relative to this script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    input_file = os.path.join(script_dir, "../../data/FinalData.json")
    geojson_output = os.path.join(script_dir, "../../data/FinalData.geojson")
    markdown_output = os.path.join(script_dir, "../../data/restaurant_guide_generated.md")
    
    print(f"Reading data from {input_file}...")
    data = load_json_file(input_file)
    
    if not data:
        print("No data found. Please run 4_join_data.py first.")
        return
        
    print(f"Found {len(data)} restaurants.")
    
    generate_geojson(data, geojson_output)
    generate_unstructured_markdown(data, markdown_output)

if __name__ == "__main__":
    main()

