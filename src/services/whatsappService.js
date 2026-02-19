const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

const WABA_URL = `https://graph.facebook.com/${config.waba.apiVersion}`;

async function sendText(to, text) {
  try {
    const res = await axios.post(
      `${WABA_URL}/${config.waba.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      },
      { headers: { Authorization: `Bearer ${config.waba.token}`, 'Content-Type': 'application/json' } }
    );
    return res.data;
  } catch (error) {
    logger.error('WABA send text error:', error.response?.data || error.message);
    throw error;
  }
}

async function sendTemplate(to, templateName, languageCode = 'ms', components = []) {
  try {
    const res = await axios.post(
      `${WABA_URL}/${config.waba.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode },
          components,
        },
      },
      { headers: { Authorization: `Bearer ${config.waba.token}`, 'Content-Type': 'application/json' } }
    );
    return res.data;
  } catch (error) {
    logger.error('WABA send template error:', error.response?.data || error.message);
    throw error;
  }
}

async function downloadMedia(mediaId) {
  try {
    // Step 1: Get media URL
    const urlRes = await axios.get(`${WABA_URL}/${mediaId}`, {
      headers: { Authorization: `Bearer ${config.waba.token}` },
    });
    const mediaUrl = urlRes.data.url;

    // Step 2: Download file
    const fileRes = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      headers: { Authorization: `Bearer ${config.waba.token}` },
    });
    return { data: fileRes.data, mimeType: urlRes.data.mime_type };
  } catch (error) {
    logger.error('WABA download media error:', error.response?.data || error.message);
    throw error;
  }
}

async function markAsRead(messageId) {
  try {
    await axios.post(
      `${WABA_URL}/${config.waba.phoneNumberId}/messages`,
      { messaging_product: 'whatsapp', status: 'read', message_id: messageId },
      { headers: { Authorization: `Bearer ${config.waba.token}`, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    logger.warn('Mark as read error:', error.message);
  }
}

module.exports = { sendText, sendTemplate, downloadMedia, markAsRead };
