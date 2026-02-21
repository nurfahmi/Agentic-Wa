const prisma = require('../config/database');
const config = require('../config');

let cache = { apiKey: null, ts: 0 };
const CACHE_TTL = 60000; // 60 seconds
const MODEL = 'gpt-4o'; // Best model with text + vision/OCR support

async function getOpenAIConfig() {
  if (Date.now() - cache.ts < CACHE_TTL && cache.apiKey) {
    return { apiKey: cache.apiKey, model: MODEL };
  }

  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'openai_api_key' } });
    const apiKey = (row && row.value) || config.openai.apiKey;

    cache = { apiKey, ts: Date.now() };
    return { apiKey, model: MODEL };
  } catch {
    return { apiKey: config.openai.apiKey, model: MODEL };
  }
}

function clearCache() {
  cache = { apiKey: null, ts: 0 };
}

module.exports = { getOpenAIConfig, clearCache };
