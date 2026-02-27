const axios = require('axios');
const logger = require('../utils/logger');
const prisma = require('../config/database');

let configCache = { data: null, ts: 0 };
const CACHE_TTL = 60000;

async function getUnofficialConfig() {
  if (Date.now() - configCache.ts < CACHE_TTL && configCache.data) return configCache.data;

  const keys = ['wa_unofficial_base_url', 'wa_unofficial_session_id', 'wa_unofficial_api_key'];
  const rows = await prisma.siteSetting.findMany({ where: { key: { in: keys } } });
  const map = {};
  rows.forEach(r => (map[r.key] = r.value));

  const data = {
    baseUrl: (map.wa_unofficial_base_url || '').replace(/\/$/, ''),
    sessionId: map.wa_unofficial_session_id || '',
    apiKey: map.wa_unofficial_api_key || '',
  };
  configCache = { data, ts: Date.now() };
  return data;
}

function clearCache() {
  configCache = { data: null, ts: 0 };
}

/**
 * Send a text message via WA Gateway
 * POST /api/sessions/:sessionId/send-message
 */
async function sendText(to, text) {
  try {
    const cfg = await getUnofficialConfig();
    // Convert phone to JID format: 6281234567890@s.whatsapp.net
    const jid = to.replace(/^\+/, '') + '@s.whatsapp.net';
    const res = await axios.post(
      `${cfg.baseUrl}/api/sessions/${cfg.sessionId}/send-message`,
      {
        jid,
        message: { text },
      },
      { headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { 'x-api-key': cfg.apiKey } : {}) }, timeout: 15000 }
    );
    return res.data;
  } catch (error) {
    logger.error('WA Unofficial send text error:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Send an image via WA Gateway
 */
async function sendImage(to, imageUrl, caption = '') {
  try {
    const cfg = await getUnofficialConfig();
    const jid = to.replace(/^\+/, '') + '@s.whatsapp.net';
    const res = await axios.post(
      `${cfg.baseUrl}/api/sessions/${cfg.sessionId}/send-message`,
      {
        jid,
        message: {
          image: { url: imageUrl },
          ...(caption ? { caption } : {}),
        },
      },
      { headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { 'x-api-key': cfg.apiKey } : {}) }, timeout: 15000 }
    );
    return res.data;
  } catch (error) {
    logger.error('WA Unofficial send image error:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Send a document via WA Gateway
 */
async function sendDocument(to, docUrl, fileName, mimeType = 'application/pdf') {
  try {
    const cfg = await getUnofficialConfig();
    const jid = to.replace(/^\+/, '') + '@s.whatsapp.net';
    const res = await axios.post(
      `${cfg.baseUrl}/api/sessions/${cfg.sessionId}/send-message`,
      {
        jid,
        message: {
          document: { url: docUrl },
          mimetype: mimeType,
          fileName,
        },
      },
      { headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { 'x-api-key': cfg.apiKey } : {}) }, timeout: 15000 }
    );
    return res.data;
  } catch (error) {
    logger.error('WA Unofficial send document error:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Send read receipt (blue ticks) for a message
 */
async function sendReadReceipt(to, messageId) {
  try {
    const cfg = await getUnofficialConfig();
    const jid = to.replace(/^\+/, '') + '@s.whatsapp.net';
    await axios.post(
      `${cfg.baseUrl}/api/sessions/${cfg.sessionId}/send-message`,
      { jid, message: { read: true }, readMessages: [{ remoteJid: jid, id: messageId }] },
      { headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { 'x-api-key': cfg.apiKey } : {}) }, timeout: 5000 }
    );
  } catch (error) {
    logger.warn('WA read receipt error (non-fatal):', error.message);
  }
}

/**
 * Send typing/composing presence
 */
async function sendPresence(to, composing = true) {
  try {
    const cfg = await getUnofficialConfig();
    const jid = to.replace(/^\+/, '') + '@s.whatsapp.net';
    await axios.post(
      `${cfg.baseUrl}/api/sessions/${cfg.sessionId}/send-message`,
      { jid, message: { presenceUpdate: composing ? 'composing' : 'paused' } },
      { headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { 'x-api-key': cfg.apiKey } : {}) }, timeout: 5000 }
    );
  } catch (error) {
    logger.warn('WA presence error (non-fatal):', error.message);
  }
}

// markAsRead uses sendReadReceipt
async function markAsRead(messageId, to) {
  if (messageId && to) await sendReadReceipt(to, messageId);
}

// downloadMedia is not applicable for unofficial — incoming media comes via webhook URL
async function downloadMedia() {
  return null;
}

module.exports = { sendText, sendImage, sendDocument, markAsRead, sendPresence, sendReadReceipt, downloadMedia, getUnofficialConfig, clearCache };
