const prisma = require('../config/database');
const config = require('../config');

let cache = { data: null, ts: 0 };
const CACHE_TTL = 60000; // 60 seconds

async function getWabaConfig() {
  if (Date.now() - cache.ts < CACHE_TTL && cache.data) {
    return cache.data;
  }

  try {
    const keys = [
      'waba_token',
      'waba_phone_number_id',
      'waba_verify_token',
      'waba_app_secret',
      'waba_api_version',
    ];

    const rows = await prisma.siteSetting.findMany({
      where: { key: { in: keys } },
    });

    const dbMap = {};
    rows.forEach((r) => (dbMap[r.key] = r.value));

    const data = {
      token: dbMap.waba_token || config.waba.token,
      phoneNumberId: dbMap.waba_phone_number_id || config.waba.phoneNumberId,
      verifyToken: dbMap.waba_verify_token || config.waba.verifyToken,
      appSecret: dbMap.waba_app_secret || config.waba.appSecret,
      apiVersion: dbMap.waba_api_version || config.waba.apiVersion || 'v21.0',
    };

    data.apiUrl = `https://graph.facebook.com/${data.apiVersion}/${data.phoneNumberId}`;

    cache = { data, ts: Date.now() };
    return data;
  } catch {
    // Fallback to .env values
    return {
      token: config.waba.token,
      phoneNumberId: config.waba.phoneNumberId,
      verifyToken: config.waba.verifyToken,
      appSecret: config.waba.appSecret,
      apiVersion: config.waba.apiVersion || 'v21.0',
      apiUrl: config.waba.apiUrl,
    };
  }
}

function clearCache() {
  cache = { data: null, ts: 0 };
}

module.exports = { getWabaConfig, clearCache };
