const crypto = require('crypto');
const config = require('../config');
const prisma = require('../config/database');
const logger = require('../utils/logger');
const { messageQueue } = require('../queues/messageQueue');
const { getWabaConfig } = require('../utils/getWabaConfig');

// GET /webhook - Verification
exports.verify = async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const waba = await getWabaConfig();
  if (mode === 'subscribe' && token === waba.verifyToken) {
    logger.info('Webhook verified');
    return res.status(200).send(challenge);
  }
  logger.warn('Webhook verification failed');
  return res.sendStatus(403);
};

// Verify webhook signature from Meta
exports.verifySignature = (req, res, buf) => {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature || !config.waba.appSecret) return; // skip if not configured at env level

  const expected = 'sha256=' + crypto.createHmac('sha256', config.waba.appSecret).update(buf).digest('hex');
  if (signature !== expected) {
    logger.warn('Webhook signature mismatch — possible spoofed request');
    throw new Error('Invalid webhook signature');
  }
};

// POST /webhook - Receive messages (auto-detects Official WABA vs Unofficial WA Gateway)
exports.receive = async (req, res) => {
  try {
    res.sendStatus(200); // Acknowledge immediately

    const body = req.body;

    // Detect payload format: Official WABA vs Unofficial WA Gateway
    if (body.object === 'whatsapp_business_account') {
      // === Official WABA (Meta) ===
      const entries = body.entry || [];
      for (const entry of entries) {
        const changes = entry.changes || [];
        for (const change of changes) {
          if (change.field !== 'messages') continue;
          const value = change.value;
          const messages = value.messages || [];
          const contacts = value.contacts || [];

          for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            const contact = contacts[i] || {};
            await processIncomingMessage(msg, contact);
          }
        }
      }
    } else if (body.event && ['message', 'messages.upsert'].includes(body.event)) {
      // === Unofficial WA Gateway ===
      await processUnofficialMessage(body);
    } else {
      logger.debug('Webhook received unknown payload format');
    }
  } catch (error) {
    logger.error('Webhook receive error:', error);
  }
};

// ──────────────────────────────────────────────
// Shared: process after normalize + store
// ──────────────────────────────────────────────

async function handleAfterStore(conversation, normalized) {
  // If customer sends salary slip (image/document) → check if auto-escalation enabled
  if (conversation.status === 'AI_HANDLING' && (normalized.type === 'IMAGE' || normalized.type === 'DOCUMENT')) {
    const { getAiSettings } = require('../utils/getAiSettings');
    const aiSettings = await getAiSettings();
    const triggers = (aiSettings.ai_escalation_triggers || '').split(',');

    if (triggers.includes('slip_received')) {
      const whatsappService = require('../services/waAdapter');
      const escalationService = require('../services/escalationService');

      // Escalate and get assigned duty agent
      const dutyAgent = await escalationService.escalate(conversation.id, 'MANUAL', 'Pelanggan hantar slip gaji — perlu semakan manual');

      // Build reply with agent info
      let replyText = aiSettings.ai_slip_received_message || 'Terima kasih, slip gaji telah diterima. Pegawai kami akan hubungi tuan/puan untuk semakan kelayakan. Terima kasih 🧕';
      if (dutyAgent) {
        replyText += `\n\nPegawai bertugas: ${dutyAgent.name}\nNo. telefon: ${dutyAgent.phone}`;
      }

      await whatsappService.sendText(conversation.customerPhone, replyText);

      // Store outbound reply
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          direction: 'OUTBOUND',
          type: 'TEXT',
          content: replyText,
          isAiGenerated: true,
        },
      });

      logger.info(`Conversation ${conversation.id} escalated: salary slip received → ${dutyAgent?.name || 'no agent available'}`);
      return; // don't queue for AI
    }
  }

  // Text messages → AI processing
  if (conversation.status === 'AI_HANDLING' && normalized.content) {
    await messageQueue.add('process', {
      conversationId: conversation.id,
      messageContent: normalized.content,
      messageType: normalized.type,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
    logger.info(`Queued AI processing for conversation ${conversation.id}`);
  }
}

// ──────────────────────────────────────────────
// Official WABA message processing
// ──────────────────────────────────────────────

async function processIncomingMessage(msg, contact) {
  try {
    const waId = msg.from;
    const customerName = contact.profile?.name || null;

    // Deduplicate
    if (msg.id) {
      const existing = await prisma.message.findUnique({ where: { waMessageId: msg.id } });
      if (existing) {
        logger.debug(`Duplicate webhook message ${msg.id}, skipping`);
        return;
      }
    }

    // Find or create conversation
    let conversation = await prisma.conversation.findUnique({ where: { waId } });
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: { waId, customerPhone: waId, customerName, status: 'AI_HANDLING' },
      });
    }

    const normalized = normalizeMessage(msg);

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        waMessageId: msg.id,
        direction: 'INBOUND',
        type: normalized.type,
        content: normalized.content,
        mediaUrl: normalized.mediaUrl,
        mediaType: normalized.mediaType,
        timestamp: new Date(parseInt(msg.timestamp) * 1000),
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date(), customerName: customerName || conversation.customerName },
    });

    await handleAfterStore(conversation, normalized);
    logger.info(`Message received from ${waId}: ${normalized.type}`);
  } catch (error) {
    logger.error('Process message error:', error);
  }
}

// ──────────────────────────────────────────────
// Unofficial WA Gateway message processing
// ──────────────────────────────────────────────

async function processUnofficialMessage(body) {
  try {
    let data = body.data;
    if (Array.isArray(data)) data = data[0];
    if (!data || !data.key) {
      logger.debug('Unofficial webhook: no data or key found');
      return;
    }

    // Skip outgoing messages
    if (data.key.fromMe) return;

    const remoteJid = data.key.remoteJid || '';
    const waId = remoteJid.replace('@s.whatsapp.net', '').replace('@g.us', '');
    if (!waId) return;

    const customerName = body.senderInfo?.contactName || data.pushName || null;
    const messageId = data.key.id || `unofficial-${Date.now()}`;

    // Deduplicate
    const existing = await prisma.message.findUnique({ where: { waMessageId: messageId } });
    if (existing) {
      logger.debug(`Duplicate unofficial message ${messageId}, skipping`);
      return;
    }

    // Find or create conversation
    let conversation = await prisma.conversation.findUnique({ where: { waId } });
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: { waId, customerPhone: waId, customerName, status: 'AI_HANDLING' },
      });
    }

    // Normalize unofficial message format
    const msg = data.message || {};
    const normalized = normalizeUnofficialMessage(msg);

    const timestamp = data.messageTimestamp
      ? new Date(parseInt(data.messageTimestamp) * 1000)
      : new Date();

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        waMessageId: messageId,
        direction: 'INBOUND',
        type: normalized.type,
        content: normalized.content,
        mediaUrl: normalized.mediaUrl,
        mediaType: normalized.mediaType,
        timestamp,
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date(), customerName: customerName || conversation.customerName },
    });

    await handleAfterStore(conversation, normalized);
    logger.info(`Unofficial message from ${waId}: ${normalized.content?.substring(0, 50)}`);
  } catch (error) {
    logger.error('Unofficial webhook error:', error);
  }
}

// ──────────────────────────────────────────────
// Message normalizers
// ──────────────────────────────────────────────

function normalizeMessage(msg) {
  const result = { type: 'TEXT', content: '', mediaUrl: null, mediaType: null };

  switch (msg.type) {
    case 'text':
      result.type = 'TEXT';
      result.content = msg.text?.body || '';
      break;
    case 'image':
      result.type = 'IMAGE';
      result.content = msg.image?.caption || '[Image]';
      result.mediaUrl = msg.image?.id;
      result.mediaType = msg.image?.mime_type;
      break;
    case 'document':
      result.type = 'DOCUMENT';
      result.content = msg.document?.filename || '[Document]';
      result.mediaUrl = msg.document?.id;
      result.mediaType = msg.document?.mime_type;
      break;
    case 'audio':
      result.type = 'AUDIO';
      result.content = '[Audio]';
      result.mediaUrl = msg.audio?.id;
      result.mediaType = msg.audio?.mime_type;
      break;
    default:
      result.content = `[${msg.type || 'Unknown'}]`;
  }

  return result;
}

function normalizeUnofficialMessage(msg) {
  const result = { type: 'TEXT', content: '', mediaUrl: null, mediaType: null };

  if (msg.imageMessage) {
    result.type = 'IMAGE';
    result.content = msg.imageMessage.caption || '[Gambar]';
    result.mediaUrl = msg.imageMessage.url || null;
    result.mediaType = msg.imageMessage.mimetype || 'image/jpeg';
  } else if (msg.documentMessage) {
    result.type = 'DOCUMENT';
    result.content = msg.documentMessage.fileName || '[Dokumen]';
    result.mediaUrl = msg.documentMessage.url || null;
    result.mediaType = msg.documentMessage.mimetype || 'application/octet-stream';
  } else if (msg.videoMessage) {
    result.type = 'VIDEO';
    result.content = msg.videoMessage.caption || '[Video]';
    result.mediaUrl = msg.videoMessage.url || null;
    result.mediaType = msg.videoMessage.mimetype || 'video/mp4';
  } else if (msg.audioMessage) {
    result.type = 'AUDIO';
    result.content = '[Audio]';
    result.mediaUrl = msg.audioMessage.url || null;
    result.mediaType = msg.audioMessage.mimetype || 'audio/ogg';
  } else if (msg.locationMessage) {
    result.type = 'LOCATION';
    result.content = `📍 ${msg.locationMessage.degreesLatitude}, ${msg.locationMessage.degreesLongitude}`;
  } else {
    result.content = msg.conversation || msg.extendedTextMessage?.text || '';
  }

  return result;
}
