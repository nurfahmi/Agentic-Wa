const { Worker } = require('bullmq');
const config = require('../../config');
const orchestrator = require('../../services/ai/orchestrator');
const whatsappService = require('../../services/whatsappService');
const escalationService = require('../../services/escalationService');
const prisma = require('../../config/database');
const logger = require('../../utils/logger');

const connection = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
};

let worker;
try {
  worker = new Worker('messages', async (job) => {
    const { conversationId, messageContent } = job.data;
    logger.info(`Processing message for conversation ${conversationId}`);

    try {
      // Check if escalated within silence window — AI stays silent
      const { getAiSettings } = require('../../utils/getAiSettings');
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { escalations: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });
      if (conv && conv.status === 'ESCALATED' && conv.escalations.length > 0) {
        const aiSettings = await getAiSettings();
        const silenceHours = parseInt(aiSettings.ai_silence_hours) || 24;
        const hoursSince = (Date.now() - new Date(conv.escalations[0].createdAt).getTime()) / (1000 * 60 * 60);
        if (hoursSince < silenceHours) {
          logger.info(`Conversation ${conversationId} escalated ${Math.round(hoursSince)}h ago, AI silent (${silenceHours}h window)`);
          return;
        }
        // After 24h, resume AI
        await prisma.conversation.update({ where: { id: conversationId }, data: { status: 'AI_HANDLING' } });
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

          // If escalated, append duty agent info
          if (escalated && escalated.dutyAgent) {
            replyText += `\n\nPegawai bertugas: ${escalated.dutyAgent.name}\nNo. telefon: ${escalated.dutyAgent.phone}`;
          }

          await whatsappService.sendText(conversation.customerPhone, replyText);

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
