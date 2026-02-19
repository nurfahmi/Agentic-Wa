const config = require('../config');
const prisma = require('../config/database');
const logger = require('../utils/logger');

// GET /webhook - Verification
exports.verify = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.waba.verifyToken) {
    logger.info('Webhook verified');
    return res.status(200).send(challenge);
  }
  logger.warn('Webhook verification failed');
  return res.sendStatus(403);
};

// POST /webhook - Receive messages
exports.receive = async (req, res) => {
  try {
    res.sendStatus(200); // Acknowledge immediately

    const body = req.body;
    if (!body.object || body.object !== 'whatsapp_business_account') return;

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
  } catch (error) {
    logger.error('Webhook receive error:', error);
  }
};

async function processIncomingMessage(msg, contact) {
  try {
    const waId = msg.from;
    const customerName = contact.profile?.name || null;

    // Find or create conversation
    let conversation = await prisma.conversation.findUnique({ where: { waId } });
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          waId,
          customerPhone: waId,
          customerName,
          status: 'AI_HANDLING',
        },
      });
    }

    // Normalize message
    const normalized = normalizeMessage(msg);

    // Store message
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

    // Update conversation
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date(), customerName: customerName || conversation.customerName },
    });

    // TODO: Queue for AI processing
    // await messageQueue.add('process', { conversationId: conversation.id, messageId: msg.id });

    logger.info(`Message received from ${waId}: ${normalized.type}`);
  } catch (error) {
    logger.error('Process message error:', error);
  }
}

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
