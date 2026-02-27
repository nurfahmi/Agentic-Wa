/**
 * Webhook handler for Unofficial WA Gateway
 * Receives incoming messages in WA Gateway format and normalizes them
 * to the same internal format as the Official WABA webhook.
 */
const prisma = require('../config/database');
const logger = require('../utils/logger');
const { messageQueue } = require('../queues/messageQueue');

// POST /webhook/unofficial - Receive messages from WA Gateway
exports.receive = async (req, res) => {
  try {
    res.sendStatus(200); // Acknowledge immediately

    const body = req.body;
    logger.info('Unofficial webhook received:', JSON.stringify(body).substring(0, 500));
    
    if (!body || !['message', 'messages.upsert'].includes(body.event)) {
      logger.info(`Unofficial webhook skipped: event=${body?.event}, has body=${!!body}`);
      return;
    }

    let data = body.data;
    // messages.upsert may send array of messages
    if (Array.isArray(data)) {
      data = data[0];
    }
    if (!data || !data.key) {
      logger.info('Unofficial webhook: no data or key found', JSON.stringify(data).substring(0, 300));
      return;
    }

    // Skip outgoing messages
    if (data.key.fromMe) return;

    const remoteJid = data.key.remoteJid || '';
    // Extract phone number from JID: 6281234567890@s.whatsapp.net → 6281234567890
    const waId = remoteJid.replace('@s.whatsapp.net', '').replace('@g.us', '');
    if (!waId) return;

    const customerName = data.pushName || null;
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
        data: {
          waId,
          customerPhone: waId,
          customerName,
          status: 'AI_HANDLING',
        },
      });
    }

    // Normalize message content
    const msg = data.message || {};
    let content = msg.conversation || msg.extendedTextMessage?.text || '';
    let type = 'TEXT';
    let mediaUrl = null;
    let mediaType = null;

    if (msg.imageMessage) {
      type = 'IMAGE';
      content = msg.imageMessage.caption || '[Gambar]';
      mediaType = msg.imageMessage.mimetype || 'image/jpeg';
    } else if (msg.documentMessage) {
      type = 'DOCUMENT';
      content = msg.documentMessage.fileName || '[Dokumen]';
      mediaType = msg.documentMessage.mimetype || 'application/octet-stream';
    } else if (msg.videoMessage) {
      type = 'VIDEO';
      content = msg.videoMessage.caption || '[Video]';
      mediaType = msg.videoMessage.mimetype || 'video/mp4';
    } else if (msg.audioMessage) {
      type = 'AUDIO';
      content = '[Audio]';
      mediaType = msg.audioMessage.mimetype || 'audio/ogg';
    } else if (msg.locationMessage) {
      type = 'LOCATION';
      content = `📍 ${msg.locationMessage.degreesLatitude}, ${msg.locationMessage.degreesLongitude}`;
    }

    // Store message
    const timestamp = data.messageTimestamp
      ? new Date(parseInt(data.messageTimestamp) * 1000)
      : new Date();

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        waMessageId: messageId,
        direction: 'INBOUND',
        type,
        content,
        mediaUrl,
        mediaType,
        timestamp,
      },
    });

    // Update conversation
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: new Date(),
        customerName: customerName || conversation.customerName,
      },
    });

    // Queue for AI processing (same as official webhook)
    if (conversation.status === 'AI_HANDLING') {
      await messageQueue.add('process-message', {
        conversationId: conversation.id,
        messageContent: content,
        messageType: type,
      }, {
        removeOnComplete: 100,
        removeOnFail: 50,
      });
    }

    logger.info(`Unofficial WA message from ${waId}: ${content.substring(0, 50)}`);
  } catch (error) {
    logger.error('Unofficial webhook error:', error);
  }
};
