import { GoogleGenerativeAI } from '@google/generative-ai'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load environment variables from .env.local
const envPath = path.join(__dirname, '../.env.local')
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8')
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/)
    if (match) {
      const key = match[1].trim()
      let value = match[2].trim()
      // Remove quotes if present
      value = value.replace(/^["']|["']$/g, '')
      process.env[key] = value
    }
  })
}

// Configuration
const BATCH_SIZE = 10 // Process 10 restaurants at a time
const DELAY_MS = 1000 // 1 second delay between batches to respect rate limits

// Load environment variables
const API_KEY = process.env.GOOGLE_API_KEY
if (!API_KEY) {
  console.error('Error: GOOGLE_API_KEY not found in environment variables')
  console.error('Please set GOOGLE_API_KEY in your .env.local file')
  process.exit(1)
}

// Initialize Gemini
const genAI = new GoogleGenerativeAI(API_KEY)
const embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-004' })

/**
 * Create embedding text from restaurant data
 */
function createEmbeddingText(restaurant) {
  const parts = [
    // Restaurant name and basic info
    `${restaurant.name} - ${restaurant.cuisine} restaurant in ${restaurant.neighborhood}`,

    // Price and rating
    `Price: ${restaurant.price}, Rating: ${restaurant.yelp_rating}/5`,

    // Summary description
    restaurant.summary || '',

    // Extended summary (richer descriptive language)
    restaurant.summary2 || '',

    // Yelp review highlights (most important for semantic search)
    restaurant.yelp_review_highlights ? `Yelp highlights: ${restaurant.yelp_review_highlights}` : '',

    // Collections/vibes
    restaurant.collections && restaurant.collections.length > 0
      ? `Vibes: ${restaurant.collections.join(', ')}`
      : '',

    // Michelin/NYT awards
    restaurant.michelin_award ? `Michelin: ${restaurant.michelin_award}` : '',
    restaurant.nyttop100_rank ? `NYT Top 100 #${restaurant.nyttop100_rank}` : ''
  ]

  return parts.filter(p => p.trim().length > 0).join('\n')
}

/**
 * Generate embedding for a single restaurant
 */
async function generateEmbedding(restaurant) {
  const text = createEmbeddingText(restaurant)

  try {
    const result = await embeddingModel.embedContent(text)
    return {
      slug: restaurant.slug,
      embedding: result.embedding.values,
      metadata: {
        name: restaurant.name || '',
        cuisine: restaurant.cuisine || '',
        price: restaurant.price || '',
        neighborhood: restaurant.neighborhood || '',
        borough: restaurant.borough || '',
        rating: restaurant.yelp_rating || 0,
        michelin: restaurant.michelin_award || '',
        nyt: restaurant.nyttop100_rank || ''
      }
    }
  } catch (error) {
    console.error(`Error generating embedding for ${restaurant.name}:`, error.message)
    return null
  }
}

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Main function
 */
async function main() {
  console.log('🚀 Starting embedding generation...\n')

  // Load restaurant data
  const dataPath = path.join(__dirname, '../src/data/FinalData.json')
  console.log(`📂 Loading restaurants from: ${dataPath}`)

  const restaurants = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))
  console.log(`✅ Loaded ${restaurants.length} restaurants\n`)

  // Generate embeddings in batches
  const embeddings = []
  const totalBatches = Math.ceil(restaurants.length / BATCH_SIZE)

  for (let i = 0; i < restaurants.length; i += BATCH_SIZE) {
    const batch = restaurants.slice(i, i + BATCH_SIZE)
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1

    console.log(`📦 Processing batch ${batchNumber}/${totalBatches} (restaurants ${i + 1}-${Math.min(i + BATCH_SIZE, restaurants.length)})`)

    // Generate embeddings for this batch
    const batchPromises = batch.map(restaurant => generateEmbedding(restaurant))
    const batchResults = await Promise.all(batchPromises)

    // Filter out any failed embeddings
    const successfulEmbeddings = batchResults.filter(e => e !== null)
    embeddings.push(...successfulEmbeddings)

    console.log(`   ✓ Generated ${successfulEmbeddings.length}/${batch.length} embeddings`)
    console.log(`   📊 Total progress: ${embeddings.length}/${restaurants.length} (${Math.round(embeddings.length / restaurants.length * 100)}%)\n`)

    // Rate limiting: wait between batches (except for the last batch)
    if (i + BATCH_SIZE < restaurants.length) {
      await sleep(DELAY_MS)
    }
  }

  // Save embeddings to file
  const outputPath = path.join(__dirname, '../src/data/embeddings.json')
  console.log(`💾 Saving embeddings to: ${outputPath}`)

  const output = {
    generated_at: new Date().toISOString(),
    model: 'text-embedding-004',
    dimension: 768,
    total_restaurants: restaurants.length,
    total_embeddings: embeddings.length,
    embeddings: embeddings
  }

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2))

  console.log('\n✅ Embedding generation complete!')
  console.log(`   📊 Total embeddings: ${embeddings.length}/${restaurants.length}`)
  console.log(`   📁 File size: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)} MB`)
  console.log('\n🎉 Next step: Run upload-to-pinecone.js to upload embeddings to Pinecone')
}

// Run the script
main().catch(error => {
  console.error('\n❌ Fatal error:', error)
  process.exit(1)
})
