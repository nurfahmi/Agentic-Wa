const prisma = require('../config/database');
const config = require('../config');

let cache = { apiKey: null, model: null, ts: 0 };
const CACHE_TTL = 60000; // 60 seconds

async function getOpenAIConfig() {
  if (Date.now() - cache.ts < CACHE_TTL && cache.apiKey) {
    return { apiKey: cache.apiKey, model: cache.model };
  }

  try {
    const [keyRow, modelRow] = await Promise.all([
      prisma.siteSetting.findUnique({ where: { key: 'openai_api_key' } }),
      prisma.siteSetting.findUnique({ where: { key: 'openai_model' } }),
    ]);

    const apiKey = (keyRow && keyRow.value) || config.openai.apiKey;
    const model = (modelRow && modelRow.value) || config.openai.model || 'gpt-4o';

    cache = { apiKey, model, ts: Date.now() };
    return { apiKey, model };
  } catch {
    const model = config.openai.model || 'gpt-4o';
    return { apiKey: config.openai.apiKey, model };
  }
}

function clearCache() {
  cache = { apiKey: null, model: null, ts: 0 };
}

module.exports = { getOpenAIConfig, clearCache };
