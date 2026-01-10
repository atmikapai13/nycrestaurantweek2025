import { GoogleGenerativeAI } from '@google/generative-ai';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env.local
const envPath = join(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      value = value.replace(/^["']|["']$/g, '');
      process.env[key] = value;
    }
  });
}

const apiKey = process.env.GOOGLE_API_KEY;

if (!apiKey) {
  console.error('❌ GOOGLE_API_KEY not found in .env.local');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

async function listModels() {
  try {
    console.log('🔍 Fetching available Gemini models...\n');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.models || data.models.length === 0) {
      console.log('⚠️  No models found');
      return;
    }

    console.log(`✅ Found ${data.models.length} models\n`);
    console.log('━'.repeat(80));

    // Filter for models that support generateContent
    const contentModels = data.models.filter(model =>
      model.supportedGenerationMethods?.includes('generateContent')
    );

    console.log(`\n📝 Models supporting generateContent (${contentModels.length}):\n`);

    contentModels.forEach(model => {
      const name = model.name.replace('models/', '');
      const methods = model.supportedGenerationMethods || [];
      const hasTools = methods.includes('generateContent');

      console.log(`  • ${name}`);
      console.log(`    Description: ${model.description || 'N/A'}`);
      console.log(`    Methods: ${methods.join(', ')}`);
      console.log('');
    });

    console.log('━'.repeat(80));

    // List ALL models for reference
    console.log(`\n📋 All available models (${data.models.length}):\n`);
    data.models.forEach(model => {
      const name = model.name.replace('models/', '');
      console.log(`  • ${name} - ${model.supportedGenerationMethods?.join(', ') || 'N/A'}`);
    });

  } catch (error) {
    console.error('❌ Error fetching models:', error.message);
    console.error(error);
  }
}

listModels();
