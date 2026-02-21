const OpenAI = require('openai');
const config = require('../../config');
const prisma = require('../../config/database');
const logger = require('../../utils/logger');
const { getOpenAIConfig } = require('../../utils/getOpenAIConfig');

async function search(query, topK = 5) {
  try {
    const aiConfig = await getOpenAIConfig();
    if (!aiConfig.apiKey) {
      logger.warn('OpenAI API key not configured, skipping RAG search');
      return [];
    }

    // Generate embedding for query
    const embedding = await generateEmbedding(query);
    if (!embedding) return [];

    // Get all active embeddings
    const allEmbeddings = await prisma.vectorEmbedding.findMany({
      include: { knowledgeBase: { select: { id: true, title: true, category: true, isActive: true } } },
    });

    // Filter active ones and compute cosine similarity
    const scored = allEmbeddings
      .filter((e) => e.knowledgeBase.isActive)
      .map((e) => ({
        id: e.knowledgeBaseId,
        title: e.knowledgeBase.title,
        category: e.knowledgeBase.category,
        content: e.chunkText,
        score: cosineSimilarity(embedding, e.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored.filter((s) => s.score > 0.3);
  } catch (error) {
    logger.error('RAG search error:', error);
    return [];
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

module.exports = { search, generateEmbedding, indexKnowledgeBase };
