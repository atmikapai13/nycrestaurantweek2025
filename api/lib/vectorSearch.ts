/**
 * Semantic restaurant search over the local embeddings file (the same vectors
 * that were uploaded to Pinecone). With only ~650 restaurants an exact scan is
 * a few milliseconds, scoring happens *within* the given candidate set (so a
 * small isochrone never comes back empty because its restaurants weren't in a
 * global top-K), and the only network call is embedding the query — cached.
 *
 * Scoring: 70% cosine similarity + 30% keyword boost, ties broken by slug so
 * the same query and candidates always produce the same order.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Restaurant } from "../../src/types/restaurant.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EMBEDDING_MODEL = "gemini-embedding-001";
const MIN_SIMILARITY = 0.2;
const STOP_WORDS = new Set(["the", "a", "an", "with", "for", "in", "at", "to", "and", "or", "but"]);

interface StoredEmbedding {
  vector: Float32Array;
  norm: number;
}

let embeddingsBySlug: Map<string, StoredEmbedding> | null = null;
const queryEmbeddingCache = new Map<string, Float32Array>();

function loadEmbeddings(): Map<string, StoredEmbedding> {
  if (!embeddingsBySlug) {
    const file = path.join(__dirname, "../../src/data/embeddings.json");
    const raw: { embeddings: Array<{ slug: string; embedding: number[] }> } = JSON.parse(fs.readFileSync(file, "utf8"));
    embeddingsBySlug = new Map(
      raw.embeddings.map((e) => {
        const vector = Float32Array.from(e.embedding);
        return [e.slug, { vector, norm: Math.hypot(...vector) }];
      })
    );
  }
  return embeddingsBySlug;
}

async function embedQuery(text: string, useCache: boolean): Promise<Float32Array> {
  if (useCache && queryEmbeddingCache.has(text)) return queryEmbeddingCache.get(text)!;
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY not configured");
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: EMBEDDING_MODEL });
  const result = await model.embedContent({
    content: { role: "user", parts: [{ text }] },
    outputDimensionality: 768,
  } as any);
  const vector = Float32Array.from(result.embedding.values);
  queryEmbeddingCache.set(text, vector);
  return vector;
}

function cosine(a: Float32Array, aNorm: number, b: Float32Array, bNorm: number): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot / (aNorm * bNorm);
}

/** 0–1 boost for query terms/phrases appearing in name, summary, reviews, collections. */
function keywordBoost(query: string, restaurant: Restaurant): number {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
  if (terms.length === 0) return 0;

  const name = (restaurant.name || "").toLowerCase();
  const summary = (restaurant.summary || "").toLowerCase();
  const reviews = (restaurant.yelp_review_highlights || "").toLowerCase();
  const collections = (restaurant.collections || []).filter(Boolean).map((c) => c.toLowerCase());
  const phrase = query.toLowerCase();

  let boost = 0;
  if (name.includes(phrase)) boost += 20;
  if (summary.includes(phrase)) boost += 10;
  if (reviews.includes(phrase)) boost += 10;
  if (collections.some((c) => c.includes(phrase))) boost += 10;

  const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const term of terms) {
    const re = new RegExp(escape(term), "g");
    if (name.includes(term)) boost += 5;
    boost += (summary.match(re) || []).length * 3;
    boost += (reviews.match(re) || []).length * 3;
    if (collections.some((c) => c.includes(term))) boost += 4;
  }
  return Math.min(boost / (terms.length * 20), 1);
}

export interface ScoredRestaurant {
  restaurant: Restaurant;
  score: number;
  similarity: number;
}

/** Rank `candidates` by semantic + keyword relevance to `query`. */
export async function semanticRank(
  query: string,
  candidates: Restaurant[],
  useCache = true
): Promise<ScoredRestaurant[]> {
  const embeddings = loadEmbeddings();
  const queryVector = await embedQuery(query, useCache);
  const queryNorm = Math.hypot(...queryVector);

  const scored: ScoredRestaurant[] = [];
  for (const restaurant of candidates) {
    const stored = embeddings.get(restaurant.slug);
    if (!stored) continue;
    const similarity = cosine(queryVector, queryNorm, stored.vector, stored.norm);
    if (similarity < MIN_SIMILARITY) continue;
    scored.push({ restaurant, similarity, score: similarity * 0.7 + keywordBoost(query, restaurant) * 0.3 });
  }
  return scored.sort((a, b) => b.score - a.score || a.restaurant.slug.localeCompare(b.restaurant.slug));
}
