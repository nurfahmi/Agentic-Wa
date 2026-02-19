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
      // Run through AI orchestrator
      const aiResult = await orchestrator.processMessage(conversationId, messageContent);

      // Check auto-escalation
      const escalated = await escalationService.checkAutoEscalation(conversationId, messageContent, aiResult);

      // Send reply via WhatsApp
      if (aiResult.reply_text) {
        const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
        if (conversation) {
          await whatsappService.sendText(conversation.customerPhone, aiResult.reply_text);

          // Store outbound message
          await prisma.message.create({
            data: {
              conversationId,
              direction: 'OUTBOUND',
              type: 'TEXT',
              content: aiResult.reply_text,
              isAiGenerated: true,
            },
          });
        }
      }

      // Update conversation eligibility if changed
      if (aiResult.eligibility_status && aiResult.eligibility_status !== 'PENDING') {
        await prisma.conversation.update({
          where: { id: conversationId },
          data: {
            eligibility: aiResult.eligibility_status,
            aiConfidence: aiResult.confidence,
            status: escalated ? 'ESCALATED' : 'AI_HANDLING',
          },
        });
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
