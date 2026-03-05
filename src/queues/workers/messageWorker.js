const { Worker } = require('bullmq');
const config = require('../../config');
const orchestrator = require('../../services/ai/orchestrator');
const whatsappService = require('../../services/waAdapter');
const escalationService = require('../../services/escalationService');
const prisma = require('../../config/database');
const logger = require('../../utils/logger');

const connection = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
};

/**
 * Check if message matches any manual handling keywords.
 * Supports both newline-separated and comma-separated formats.
 */
function matchesManualKeywords(message, keywords) {
  if (!keywords) return false;
  const keywordList = keywords.split(/[\n,]/).map(k => k.trim().toLowerCase()).filter(Boolean);
  if (keywordList.length === 0) return false;
  const lowerMsg = message.toLowerCase();
  return keywordList.some(kw => lowerMsg.includes(kw));
}

let worker;
try {
  worker = new Worker('messages', async (job) => {
    const { conversationId, messageContent } = job.data;
    logger.info(`Processing message for conversation ${conversationId}`);

    try {
      const { getAiSettings } = require('../../utils/getAiSettings');
      const aiSettings = await getAiSettings();

      // Check if conversation is already escalated within silence window
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { escalations: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });

      if (conv && conv.status === 'ESCALATED' && conv.escalations.length > 0) {
        const silenceHours = parseInt(aiSettings.ai_silence_hours) || 24;
        const hoursSince = (Date.now() - new Date(conv.escalations[0].createdAt).getTime()) / (1000 * 60 * 60);
        if (hoursSince < silenceHours) {
          logger.info(`Conversation ${conversationId} escalated ${Math.round(hoursSince)}h ago, AI silent (${silenceHours}h window)`);
          return;
        }
        // After silence window, resume AI
        await prisma.conversation.update({ where: { id: conversationId }, data: { status: 'AI_HANDLING' } });
      }

      // Check if conversation is in AGENT_HANDLING — AI stays silent
      if (conv && conv.status === 'AGENT_HANDLING') {
        logger.info(`Conversation ${conversationId} is agent-handled, AI silent`);
        return;
      }

      // Check manual keywords — if matched, flag for manual handling and skip AI
      if (matchesManualKeywords(messageContent, aiSettings.ai_manual_keywords)) {
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { lastMessageAt: new Date(), status: 'AGENT_HANDLING', metadata: { needsManualReply: true, manualTriggeredAt: new Date().toISOString(), triggerMessage: messageContent } },
        });
        logger.info(`Conversation ${conversationId} flagged for MANUAL handling (keyword match). AI silent.`);
        return;
      }

      // Send typing indicator before AI processing
      if (conv) {
        await whatsappService.sendPresence(conv.customerPhone, true);
      }

      // Run through AI orchestrator
      const aiResult = await orchestrator.processMessage(conversationId, messageContent);

      // Check auto-escalation
      const escalated = await escalationService.checkAutoEscalation(conversationId, messageContent, aiResult);

      // Send reply via WhatsApp
      if (aiResult.reply_text) {
        const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
        if (conversation) {
          let replyText = aiResult.reply_text;

          // If escalated, use escalation message template with agent info
          if (escalated && escalated.dutyAgent) {
            const phone = escalated.dutyAgent.phone.replace(/[\s\-\(\)]/g, '');
            const waPhone = phone.startsWith('0') ? '6' + phone : phone.startsWith('+') ? phone.slice(1) : phone;
            replyText = (aiSettings.ai_escalation_message || replyText)
              .replace(/{agent_name}/g, escalated.dutyAgent.name)
              .replace(/{agent_phone}/g, escalated.dutyAgent.phone)
              .replace(/{agent_wa_url}/g, `https://wa.me/${waPhone}`);
          }

          // If scam defense intent and image is configured, send image with caption
          if (aiResult.intent === 'scam_defense' && aiSettings.ai_scam_defense_image) {
            const caption = aiSettings.ai_scam_defense_caption || replyText;
            const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3003}`;
            const imageUrl = `${baseUrl}${aiSettings.ai_scam_defense_image}`;
            await whatsappService.sendImage(conversation.customerPhone, imageUrl, caption);
            replyText = `[Gambar] ${caption}`;
          } else {
            await whatsappService.sendText(conversation.customerPhone, replyText);
          }

          // Store outbound message
          await prisma.message.create({
            data: {
              conversationId,
              direction: 'OUTBOUND',
              type: 'TEXT',
              content: replyText,
              isAiGenerated: true,
            },
          });
        }
      }

      // Update conversation status based on result
      if (aiResult.eligibility_status && aiResult.eligibility_status !== 'PENDING') {
        let newStatus = 'AI_HANDLING';
        if (escalated && escalated.escalated) newStatus = 'ESCALATED';
        else if (aiResult.eligibility_status === 'NOT_ELIGIBLE') newStatus = 'CLOSED';

        await prisma.conversation.update({
          where: { id: conversationId },
          data: {
            eligibility: aiResult.eligibility_status,
            aiConfidence: aiResult.confidence,
            status: newStatus,
          },
        });

        if (newStatus === 'CLOSED') {
          logger.info(`Conversation ${conversationId} closed: NOT_ELIGIBLE`);
        }
      }
    } catch (error) {
      logger.error(`Worker error for conversation ${conversationId}:`, error);
    }
  }, { connection, concurrency: 5 });

  worker.on('failed', (job, err) => {
    logger.error(`Job ${job.id} failed:`, err);
  });
} catch (err) {
  console.warn('BullMQ worker creation failed:', err.message);
}

module.exports = worker;
