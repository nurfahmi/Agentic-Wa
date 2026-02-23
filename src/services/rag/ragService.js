const OpenAI = require('openai');
const config = require('../../config');
const prisma = require('../../config/database');
const logger = require('../../utils/logger');
const { getOpenAIConfig } = require('../../utils/getOpenAIConfig');
const { getRedis } = require('../../config/redis');

const RAG_CACHE_TTL = 300; // 5 min cache for RAG results
const EMBEDDING_CACHE_TTL = 600; // 10 min cache for KB embeddings

async function search(query, topK = 5) {
  try {
    const aiConfig = await getOpenAIConfig();
    if (!aiConfig.apiKey) {
      logger.warn('OpenAI API key not configured, skipping RAG search');
      return [];
    }

    // Check Redis cache for this query
    const redis = getRedis();
    if (redis) {
      try {
        const cached = await redis.get(`rag:${query}`);
        if (cached) return JSON.parse(cached);
      } catch {}
    }

    // Generate embedding for query
    const embedding = await generateEmbedding(query);
    if (!embedding) return [];

    // Get all active embeddings (cached in Redis or from DB)
    const allEmbeddings = await getKBEmbeddings();

    // Filter active ones and compute cosine similarity
    const scored = allEmbeddings
      .filter((e) => e.isActive)
      .map((e) => ({
        id: e.knowledgeBaseId,
        title: e.title,
        category: e.category,
        content: e.chunkText,
        score: cosineSimilarity(embedding, e.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    const results = scored.filter((s) => s.score > 0.3);

    // Cache results
    if (redis && results.length > 0) {
      try { await redis.set(`rag:${query}`, JSON.stringify(results), 'EX', RAG_CACHE_TTL); } catch {}
    }

    return results;
  } catch (error) {
    logger.error('RAG search error:', error);
    return [];
  }
}

// Cache KB embeddings in Redis to avoid fetching all from DB every request
async function getKBEmbeddings() {
  const redis = getRedis();
  if (redis) {
    try {
      const cached = await redis.get('rag:kb_embeddings');
      if (cached) return JSON.parse(cached);
    } catch {}
  }

  const allEmbeddings = await prisma.vectorEmbedding.findMany({
    include: { knowledgeBase: { select: { id: true, title: true, category: true, isActive: true } } },
  });

  const mapped = allEmbeddings.map((e) => ({
    knowledgeBaseId: e.knowledgeBaseId,
    title: e.knowledgeBase.title,
    category: e.knowledgeBase.category,
    isActive: e.knowledgeBase.isActive,
    chunkText: e.chunkText,
    embedding: e.embedding,
  }));

  if (redis) {
    try { await redis.set('rag:kb_embeddings', JSON.stringify(mapped), 'EX', EMBEDDING_CACHE_TTL); } catch {}
  }

  return mapped;
}

// Clear KB cache when knowledge base is updated
function clearKBCache() {
  const redis = getRedis();
  if (redis) {
    try { redis.del('rag:kb_embeddings'); } catch {}
  }
}

async function generateEmbedding(text) {
  try {
    const aiConfig = await getOpenAIConfig();
    const openai = new OpenAI({ apiKey: aiConfig.apiKey });
    const res = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return res.data[0].embedding;
  } catch (error) {
    logger.error('Embedding generation error:', error);
    return null;
  }
}

async function indexKnowledgeBase(knowledgeBaseId) {
  try {
    const entry = await prisma.knowledgeBase.findUnique({ where: { id: knowledgeBaseId } });
    if (!entry) return;

    // Delete existing embeddings
    await prisma.vectorEmbedding.deleteMany({ where: { knowledgeBaseId } });

    // Chunk the content
    const chunks = chunkText(entry.content);

    for (const chunk of chunks) {
      const embedding = await generateEmbedding(chunk);
      if (embedding) {
        await prisma.vectorEmbedding.create({
          data: { knowledgeBaseId, chunkText: chunk, embedding },
        });
      }
    }

    // Clear cache so new data is picked up
    clearKBCache();

    logger.info(`Indexed KB entry ${knowledgeBaseId}: ${chunks.length} chunks`);
  } catch (error) {
    logger.error('Index KB error:', error);
  }
}

function chunkText(text, maxChunkSize = 500) {
  const sentences = text.split(/[.!?\n]+/).filter((s) => s.trim());
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    if ((current + sentence).length > maxChunkSize && current) {
      chunks.push(current.trim());
      current = '';
    }
    current += sentence + '. ';
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text];
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB);
  return mag === 0 ? 0 : dot / mag;
}

module.exports = { search, generateEmbedding, indexKnowledgeBase, clearKBCache };
