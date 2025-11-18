import { Pinecone } from '@pinecone-database/pinecone'
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
const BATCH_SIZE = 100 // Pinecone recommends batches of 100 vectors
const INDEX_NAME = 'nyc-eats'

// Load environment variables
const API_KEY = process.env.PINECONE_API_KEY
if (!API_KEY) {
  console.error('Error: PINECONE_API_KEY not found in environment variables')
  console.error('Please set PINECONE_API_KEY in your .env.local file')
  console.error('\nTo get your API key:')
  console.error('1. Sign up at https://www.pinecone.io')
  console.error('2. Create a new index named "nyc-restaurants-2025"')
  console.error('   - Dimension: 768')
  console.error('   - Metric: cosine')
  console.error('   - Cloud: AWS')
  console.error('   - Region: us-east-1 (free tier)')
  console.error('3. Copy your API key from the dashboard')
  process.exit(1)
}

/**
 * Initialize Pinecone client
 */
async function initializePinecone() {
  const pc = new Pinecone({ apiKey: API_KEY })

  try {
    // Get the index
    const index = pc.index(INDEX_NAME)
    console.log(`✅ Connected to Pinecone index: ${INDEX_NAME}`)
    return index
  } catch (error) {
    console.error(`\n❌ Error connecting to Pinecone index "${INDEX_NAME}"`)
    console.error('Make sure you have created the index with the following settings:')
    console.error('  - Name: nyc-restaurants-2025')
    console.error('  - Dimension: 768')
    console.error('  - Metric: cosine')
    console.error('  - Cloud: AWS, Region: us-east-1')
    throw error
  }
}

/**
 * Upload embeddings in batches
 */
async function uploadEmbeddings(index, embeddings) {
  const totalBatches = Math.ceil(embeddings.length / BATCH_SIZE)
  let uploaded = 0

  for (let i = 0; i < embeddings.length; i += BATCH_SIZE) {
    const batch = embeddings.slice(i, i + BATCH_SIZE)
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1

    console.log(`📦 Uploading batch ${batchNumber}/${totalBatches} (vectors ${i + 1}-${Math.min(i + BATCH_SIZE, embeddings.length)})`)

    // Format vectors for Pinecone
    const vectors = batch.map(emb => ({
      id: emb.slug,
      values: emb.embedding,
      metadata: emb.metadata
    }))

    try {
      await index.upsert(vectors)
      uploaded += vectors.length
      console.log(`   ✓ Uploaded ${vectors.length} vectors`)
      console.log(`   📊 Total progress: ${uploaded}/${embeddings.length} (${Math.round(uploaded / embeddings.length * 100)}%)\n`)
    } catch (error) {
      console.error(`   ❌ Error uploading batch ${batchNumber}:`, error.message)
      console.error('   Continuing with next batch...\n')
    }
  }

  return uploaded
}

/**
 * Verify upload by querying the index
 */
async function verifyUpload(index, totalExpected) {
  console.log('🔍 Verifying upload...')

  try {
    const stats = await index.describeIndexStats()
    const totalVectors = stats.totalRecordCount || 0

    console.log(`   ✓ Total vectors in index: ${totalVectors}`)

    if (totalVectors >= totalExpected) {
      console.log(`   ✅ All vectors uploaded successfully!`)
      return true
    } else {
      console.log(`   ⚠️  Expected ${totalExpected} vectors, but found ${totalVectors}`)
      return false
    }
  } catch (error) {
    console.error('   ❌ Error verifying upload:', error.message)
    return false
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🚀 Starting Pinecone upload...\n')

  // Load embeddings
  const embeddingsPath = path.join(__dirname, '../src/data/embeddings.json')
  console.log(`📂 Loading embeddings from: ${embeddingsPath}`)

  if (!fs.existsSync(embeddingsPath)) {
    console.error('\n❌ Error: embeddings.json not found!')
    console.error('Please run generate-embeddings.js first to create the embeddings.')
    process.exit(1)
  }

  const data = JSON.parse(fs.readFileSync(embeddingsPath, 'utf-8'))
  const embeddings = data.embeddings
  console.log(`✅ Loaded ${embeddings.length} embeddings`)
  console.log(`   Generated at: ${data.generated_at}`)
  console.log(`   Model: ${data.model}`)
  console.log(`   Dimension: ${data.dimension}\n`)

  // Initialize Pinecone
  const index = await initializePinecone()

  // Upload embeddings
  console.log('📤 Uploading embeddings to Pinecone...\n')
  const uploaded = await uploadEmbeddings(index, embeddings)

  // Verify upload
  console.log('')
  await verifyUpload(index, embeddings.length)

  console.log('\n✅ Pinecone upload complete!')
  console.log(`   📊 Total vectors uploaded: ${uploaded}/${embeddings.length}`)
  console.log('\n🎉 RAG backend is ready! Next step: Create the rag-search API endpoint')
}

// Run the script
main().catch(error => {
  console.error('\n❌ Fatal error:', error)
  process.exit(1)
})
