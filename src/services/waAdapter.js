/**
 * Unified WhatsApp adapter — routes to Official (WABA) or Unofficial (WA Gateway)
 * based on the wa_type setting in SiteSettings.
 */
const prisma = require('../config/database');
const logger = require('../utils/logger');

let waTypeCache = { value: null, ts: 0 };
const CACHE_TTL = 60000;

async function getWaType() {
  if (Date.now() - waTypeCache.ts < CACHE_TTL && waTypeCache.value) return waTypeCache.value;
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'wa_type' } });
    const value = row?.value || 'official';
    waTypeCache = { value, ts: Date.now() };
    return value;
  } catch {
    return 'official';
  }
}

function getService(type) {
  if (type === 'unofficial') {
    return require('./waUnofficialService');
  }
  return require('./whatsappService');
}

async function sendText(to, text) {
  const type = await getWaType();
  return getService(type).sendText(to, text);
}

async function sendTemplate(to, templateName, languageCode, components) {
  const type = await getWaType();
  const svc = getService(type);
  // Unofficial doesn't support templates — fallback to text
  if (type === 'unofficial') {
    logger.warn('Unofficial WA does not support templates, sending as text');
    return svc.sendText(to, `Template: ${templateName}`);
  }
  return svc.sendTemplate(to, templateName, languageCode, components);
}

async function downloadMedia(mediaId) {
  const type = await getWaType();
  return getService(type).downloadMedia(mediaId);
}

async function markAsRead(messageId) {
  const type = await getWaType();
  return getService(type).markAsRead(messageId);
}

function clearCache() {
  waTypeCache = { value: null, ts: 0 };
}

module.exports = { sendText, sendTemplate, downloadMedia, markAsRead, getWaType, clearCache };
