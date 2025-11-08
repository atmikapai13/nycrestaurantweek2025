import json
import time
import os
from openai import OpenAI
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Initialize OpenAI client
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
def generate_summary(categories, highlights, restaurant_name):
    """Send prompt to OpenAI and get summary"""

    # Build prompt based on what data we have
    if categories and highlights:
        prompt = f"""You are summarizing Yelp review highlights for a restaurant recommendation platform.

Given the following review highlights data and Yelp categories, create a concise summary that:
1. Starts with ONE sentence: "Yelp categorizes this spot as [list categories]."
2. Follows with 2-4 sentences starting with "In Yelp reviews,..." that naturally weaves together what reviewers discuss
3. CRITICAL: The percentages show how many reviews MENTION a topic, NOT whether reviews are positive or negative. DO NOT assume sentiment is universal.
4. Use neutral framing like "talk about," "mention," "discuss," or "bring up" - NEVER "rave about," "love," or "praise"
5. Include percentages naturally: "mentioned in X% of reviews" or "X% of reviewers discuss..."
6. Extract and name ALL specific dishes, drinks, and staff members mentioned in the example sentences
7. Keep it conversational - imagine explaining to a friend what people are saying about this place

CRITICAL RULES:
- Total length: 3-5 sentences (1 for categories + 2-4 for highlights)
- Only include highlights where review_count_percent > 3%
- List highlights in order from highest to lowest percentage
- When mentioning dishes/drinks, use the EXACT names from the sentences
- Be specific but concise - no meta-commentary
- Avoid repetitive phrases - vary your language
- Write naturally, not formally
- NEVER generalize sentiment - the example sentence shows ONE person's view, not everyone's

BAD example (overgeneralizes sentiment):
"In Yelp reviews, the service is deemed exceptional, with 47% raving about bartender Kayla's excellent Cosmopolitans."

GOOD example (neutral, factual):
"In Yelp reviews, service comes up in 47% of reviews, with one diner mentioning bartender Kayla's Cosmopolitan and fresh food."

ANOTHER GOOD example:
"In Yelp reviews, drinks are discussed in 45% of reviews, with mentions of the We Limin' and Henneycolada. The Oxtail Flatbread comes up too, along with dishes like the Ackee & Saltfish Stuffed Plantains."

Now summarize this restaurant:

yelp_categories: {json.dumps(categories)}

review_highlights: {json.dumps(highlights, indent=2)}"""
    else:
        # No categories, just highlights
        prompt = f"""You are summarizing Yelp review highlights for a restaurant recommendation platform.

Given the following review highlights data (no categories available), create a concise summary that:
1. Starts with 2-4 sentences starting with "In Yelp reviews..." that naturally weaves together what reviewers discuss
2. CRITICAL: The percentages show how many reviews MENTION a topic, NOT whether reviews are positive or negative. DO NOT assume sentiment is universal.
3. Use neutral framing like "talk about," "mention," "discuss," or "bring up" - NEVER "rave about," "love," or "praise"
4. Include percentages naturally: "mentioned in X% of reviews" or "X% of reviewers discuss..."
5. Extract and name ALL specific dishes, drinks, and staff members mentioned in the example sentences
6. Keep it conversational - imagine explaining to a friend what people are saying about this place

CRITICAL RULES:
- Total length: 2-4 sentences
- Only include highlights where review_count_percent > 3%
- List highlights in order from highest to lowest percentage
- When mentioning dishes/drinks, use the EXACT names from the sentences
- Be specific but concise - no meta-commentary
- Avoid repetitive phrases - vary your language
- Write naturally, not formally
- NEVER generalize sentiment - the example sentence shows ONE person's view, not everyone's

BAD example (overgeneralizes sentiment):
"Yelpers rave about the pasta, with 31.5% loving the pesto pasta with shrimp."

GOOD example (neutral, factual):
"Yelpers discuss pasta in 31.5% of reviews, with mentions of the pesto pasta with shrimp and pine nuts."

Now summarize this restaurant:

review_highlights: {json.dumps(highlights, indent=2)}"""
    
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a concise assistant that summarizes what topics restaurant reviewers mention, WITHOUT assuming everyone shares the same opinion. Stay neutral and factual."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=300
        )
        
        usage = response.usage
        return response.choices[0].message.content.strip(), usage
            
    except Exception as e:
        print(f"  ✗ Error: {e}")
        return None, None


def test_first_10_restaurants(input_file, output_file):
    """Test on first 10 restaurants only"""
    
    print(f"Loading restaurants from {input_file}...")
    with open(input_file, 'r', encoding='utf-8') as f:
        all_restaurants = json.load(f)
    
    # Take only first 10
    restaurants = all_restaurants[:10]
    
    print(f"Testing on first {len(restaurants)} restaurants\n")
    print("="*60)
    
    processed = 0
    successful = 0
    skipped = 0
    failed = 0
    start_time = time.time()
    
    # Cost tracking
    total_input_tokens = 0
    total_output_tokens = 0
    
    for idx, restaurant in enumerate(restaurants, 1):
        name = restaurant.get('name', 'Unknown')
        categories = restaurant.get('yelp_categories', [])
        highlights_data = restaurant.get('yelp_highlights', {})
        highlights = highlights_data.get('review_highlights', [])
        
        # Filter highlights > 5%
        filtered_highlights = []
        for h in highlights:
            percent_str = h.get('review_count_percent', '0%')
            try:
                percent = float(percent_str.rstrip('%'))
                if percent > 5.0:
                    filtered_highlights.append(h)
            except (ValueError, AttributeError):
                continue
        
        print(f"\n[{idx}/10] {name}")
        print("-" * 60)
        
        # Skip if no valid data
        if not filtered_highlights or not categories:
            reason = "no categories" if not categories else "no highlights > 5%"
            print(f"⊘ SKIPPED ({reason})")
            restaurant['yelp_summary'] = None
            skipped += 1
            processed += 1
            continue
        
        # Show what we're processing
        print(f"Categories: {', '.join(categories)}")
        print(f"Highlights to process: {len(filtered_highlights)}")
        
        # Generate summary
        summary, usage = generate_summary(categories, filtered_highlights, name)
        
        if summary and usage:
            restaurant['yelp_summary'] = summary
            successful += 1
            
            # Track tokens
            total_input_tokens += usage.prompt_tokens
            total_output_tokens += usage.completion_tokens
            
            print(f"\n✓ GENERATED SUMMARY:")
            print(f"{summary}")
            print(f"\nTokens - Input: {usage.prompt_tokens}, Output: {usage.completion_tokens}")
        else:
            restaurant['yelp_summary'] = None
            failed += 1
            print("✗ FAILED to generate")
        
        processed += 1
    
    # Save results
    print(f"\n{'='*60}")
    print(f"💾 Saving test results to {output_file}...")
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(restaurants, f, indent=2, ensure_ascii=False)
    
    # Calculate costs
    input_cost = (total_input_tokens / 1_000_000) * 0.150
    output_cost = (total_output_tokens / 1_000_000) * 0.600
    total_cost = input_cost + output_cost
    
    # Extrapolate to 700 restaurants
    if successful > 0:
        avg_input_per_restaurant = total_input_tokens / successful
        avg_output_per_restaurant = total_output_tokens / successful
        projected_700_input = avg_input_per_restaurant * 700
        projected_700_output = avg_output_per_restaurant * 700
        projected_700_cost = (projected_700_input / 1_000_000 * 0.150) + (projected_700_output / 1_000_000 * 0.600)
    else:
        projected_700_cost = 0
    
    # Final stats
    elapsed = time.time() - start_time
    print(f"\n{'='*60}")
    print(f"TEST COMPLETE!")
    print(f"{'='*60}")
    print(f"Processed: {processed}/10")
    print(f"Successful: {successful}")
    print(f"Skipped: {skipped}")
    print(f"Failed: {failed}")
    print(f"\n--- TOKEN USAGE ---")
    print(f"Total tokens: {total_input_tokens + total_output_tokens:,}")
    print(f"  Input: {total_input_tokens:,} tokens")
    print(f"  Output: {total_output_tokens:,} tokens")
    print(f"\n--- COST BREAKDOWN ---")
    print(f"Test cost (10 restaurants): ${total_cost:.4f}")
    print(f"  Input: ${input_cost:.4f}")
    print(f"  Output: ${output_cost:.4f}")
    print(f"\n--- PROJECTION FOR 700 RESTAURANTS ---")
    print(f"Estimated total cost: ${projected_700_cost:.2f}")
    if projected_700_cost > 4:
        print(f"⚠️  WARNING: Projected cost exceeds $4 budget!")
    else:
        print(f"✓ Within $4 budget")
    print(f"\nTime: {elapsed:.1f} seconds")
    print(f"Average: {elapsed/processed:.1f}s per restaurant")
    print(f"{'='*60}")


if __name__ == "__main__":
    # Use paths relative to script location
    import os
    script_dir = os.path.dirname(os.path.abspath(__file__))
    INPUT_FILE = os.path.join(script_dir, "restaurant_yelp.json")
    OUTPUT_FILE = os.path.join(script_dir, "restaurant_yelp_summarization.json")

    test_first_10_restaurants(INPUT_FILE, OUTPUT_FILE)