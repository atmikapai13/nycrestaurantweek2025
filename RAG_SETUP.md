# RAG Setup Guide - NYC Restaurant Week Chatbot

This guide will help you set up the RAG (Retrieval-Augmented Generation) system for semantic restaurant search.

## Prerequisites

- Node.js installed
- Google API Key (for Gemini embeddings)
- Pinecone account (free tier)

## Step 1: Set Up Pinecone Account

1. **Create Pinecone Account**
   - Go to https://www.pinecone.io
   - Sign up for a free account
   - Verify your email

2. **Create an Index**
   - Go to the Pinecone dashboard
   - Click "Create Index"
   - Use these settings:
     - **Name**: `nyc-restaurants-2025`
     - **Dimensions**: `768` (Gemini embedding size)
     - **Metric**: `cosine`
     - **Cloud**: `AWS`
     - **Region**: `us-east-1` (free tier)
   - Click "Create Index"

3. **Get Your API Key**
   - In the Pinecone dashboard, go to "API Keys"
   - Copy your API key

4. **Add to Environment Variables**
   - Open `.env.local` (or create it if it doesn't exist)
   - Add:
     ```
     PINECONE_API_KEY=your-pinecone-api-key-here
     GOOGLE_API_KEY=your-existing-google-api-key
     ```

## Step 2: Generate Embeddings

Run the embedding generation script to create vector embeddings for all 628 restaurants:

```bash
npm run embeddings:generate
```

This will:
- Read all restaurants from `src/data/FinalData.json`
- Generate embeddings using Gemini's `text-embedding-004` model
- Create rich embedding text from:
  - Restaurant name, cuisine, location
  - Summary description
  - Yelp review highlights
  - Collections/vibes
  - Awards (Michelin, NYT)
- Save embeddings to `src/data/embeddings.json`
- Takes approximately 2-3 minutes to complete (628 restaurants)

**Expected Output:**
```
🚀 Starting embedding generation...
📂 Loading restaurants from: /path/to/FinalData.json
✅ Loaded 628 restaurants

📦 Processing batch 1/63 (restaurants 1-10)
   ✓ Generated 10/10 embeddings
   📊 Total progress: 10/628 (2%)

...

✅ Embedding generation complete!
   📊 Total embeddings: 628/628
   📁 File size: 12.45 MB
```

## Step 3: Upload Embeddings to Pinecone

Upload the generated embeddings to your Pinecone index:

```bash
npm run embeddings:upload
```

This will:
- Load embeddings from `src/data/embeddings.json`
- Upload to Pinecone in batches of 100 vectors
- Store metadata (slug, name, cuisine, price, neighborhood, rating)
- Verify the upload was successful
- Takes approximately 1-2 minutes

**Expected Output:**
```
🚀 Starting Pinecone upload...
📂 Loading embeddings from: /path/to/embeddings.json
✅ Loaded 628 embeddings
   Generated at: 2025-01-09T18:30:00.000Z
   Model: text-embedding-004
   Dimension: 768

✅ Connected to Pinecone index: nyc-restaurants-2025

📤 Uploading embeddings to Pinecone...

📦 Uploading batch 1/7 (vectors 1-100)
   ✓ Uploaded 100 vectors
   📊 Total progress: 100/628 (16%)

...

🔍 Verifying upload...
   ✓ Total vectors in index: 628
   ✅ All vectors uploaded successfully!

✅ Pinecone upload complete!
   📊 Total vectors uploaded: 628/628
```

## Step 4: Test the RAG System

Once setup is complete, test the system with these queries:

### Test 1: Vibe/Ambiance Search
**Query:** "Find cozy restaurants"

**Expected:**
- Gemini calls `rag_search({ query: "cozy intimate atmosphere" })`
- Returns restaurants with "cozy", "intimate", "romantic" mentioned in reviews
- Map focuses on top results

### Test 2: Dish-Specific Search
**Query:** "Best ramen in NYC"

**Expected:**
- Gemini calls `rag_search({ query: "best ramen", pre_filters: { cuisines: ["Japanese"] } })`
- Returns Japanese restaurants with "ramen" highly mentioned in reviews
- Filters UI shows Japanese cuisine selected

### Test 3: Combined Search
**Query:** "Romantic Italian in Williamsburg"

**Expected:**
- Gemini calls `rag_search({ query: "romantic", pre_filters: { cuisines: ["Italian"], neighborhoods: ["Williamsburg"] } })`
- Returns Italian restaurants in Williamsburg with romantic ambiance
- Filters UI shows Italian + Williamsburg selected

### Test 4: Fallback Behavior
**Query:** "Cozy $ Japanese"

**Expected:**
- RAG search finds no $ Japanese restaurants
- Automatically falls back to $$ Japanese
- Chatbot explains: "No $ options found, showing $$ Japanese restaurants"
- Map shows results (never blank!)

## Step 5: Monitor Performance

Check the browser console for logs:

```javascript
// Successful RAG search
RAG Search Request: { query: "cozy", pre_filters: {}, top_k: 20 }
Generating query embedding...
Querying Pinecone...
Returning 20 results

// Frontend logs
Calling RAG search API: { query: "cozy", pre_filters: {} }
RAG search results: 20 restaurants
Fallback info: null
```

## Troubleshooting

### Error: "PINECONE_API_KEY not configured"
- Make sure you added `PINECONE_API_KEY` to `.env.local`
- Restart your dev server after adding the key

### Error: "GOOGLE_API_KEY not configured"
- Make sure `GOOGLE_API_KEY` is in `.env.local`
- This is the same key you're already using for the chatbot

### Error: "Index 'nyc-restaurants-2025' not found"
- Check that you created the Pinecone index with the exact name: `nyc-restaurants-2025`
- Verify the index exists in your Pinecone dashboard

### Embeddings file is too large
- The `embeddings.json` file (~12MB) is normal
- It contains 628 restaurants × 768-dimensional vectors
- You can add it to `.gitignore` if you want (it can be regenerated)

### Slow RAG searches
- First search may be slow (~2-3 seconds) as Pinecone initializes
- Subsequent searches should be faster (<1 second)
- If consistently slow, check your Pinecone region (should be us-east-1 for free tier)

## Next Steps

Once RAG is working:

1. **Add Geographic Midpoint Functionality**
   - Implement geographic calculations for "find spots between X and Y"
   - Combine RAG semantic search with geographic proximity

2. **Add Prompt Caching**
   - Cache the system prompt to save ~70% on token costs
   - See Gemini's caching documentation

3. **Optimize FinalData.json Further**
   - Remove any remaining unused fields
   - Reduce file size for faster loading

4. **Fine-tune RAG Search**
   - Adjust similarity thresholds
   - Experiment with different pre-filter combinations
   - Add user feedback to improve results

## Cost Breakdown

### One-Time Setup Costs
- **Embedding Generation**: $0 (Gemini embeddings are free)
- **Pinecone Storage**: $0 (free tier: 100k vectors, we use 628)

### Ongoing Costs
- **Per RAG Search**:
  - Query embedding: $0 (Gemini free)
  - Pinecone query: $0 (free tier: unlimited queries)
  - **Total: $0 per search**

### Free Tier Limits
- **Gemini**: 15 requests/minute, 1M tokens/day (plenty for dev)
- **Pinecone**: 100k vectors (we use 628), unlimited queries

**You can run the entire RAG system on free tiers indefinitely!**

## Maintenance

### Re-generating Embeddings
If you update FinalData.json (add/remove restaurants):

```bash
npm run embeddings:setup
```

This runs both `generate` and `upload` sequentially.

### Deleting the Index
If you need to start over:

1. Go to Pinecone dashboard
2. Select your index
3. Click "Delete Index"
4. Recreate with the same settings
5. Re-run `npm run embeddings:upload`

## Architecture Diagram

```
User Query: "cozy restaurants"
        ↓
Gemini AI (extracts intent)
        ↓
rag_search({ query: "cozy intimate atmosphere" })
        ↓
api/rag-search.js
        ↓
Generate query embedding (Gemini)
        ↓
Query Pinecone (vector similarity search)
        ↓
Get top 50 semantic matches
        ↓
Load full restaurant data (FinalData.json)
        ↓
Generate explanations ("Matched 'cozy' - reviews mention 'intimate setting'")
        ↓
Return ranked results to frontend
        ↓
Update map + UI filters
```

## Success!

If you see this output when testing "cozy restaurants":

```javascript
RAG search results: 20 restaurants
Fallback info: null
```

And the map shows restaurants with cozy/intimate vibes mentioned in their reviews, **your RAG system is working!** 🎉
