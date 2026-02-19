const prisma = require('../config/database');
const logger = require('../utils/logger');

const ANGRY_KEYWORDS = ['marah', 'bodoh', 'stupid', 'useless', 'scam', 'tipu', 'tidak berguna', 'complaint', 'aduan', 'saman'];

async function checkAutoEscalation(conversationId, message, aiResult) {
  const reasons = [];

  // Low confidence
  if (aiResult.confidence < 0.75) {
    reasons.push('LOW_CONFIDENCE');
  }

  // Angry keywords
  const lowerMsg = message.toLowerCase();
  if (ANGRY_KEYWORDS.some((kw) => lowerMsg.includes(kw))) {
    reasons.push('ANGRY_KEYWORDS');
  }

  // OCR failure
  if (aiResult.required_action === 'ocr_failed') {
    reasons.push('OCR_FAILURE');
  }

  // Borderline eligibility
  if (aiResult.eligibility_status === 'REQUIRES_REVIEW') {
    reasons.push('BORDERLINE_ELIGIBILITY');
  }

  // User explicitly requests human
  const humanKeywords = ['agent', 'pegawai', 'manusia', 'human', 'orang', 'cakap dengan orang'];
  if (humanKeywords.some((kw) => lowerMsg.includes(kw))) {
    reasons.push('USER_REQUEST');
  }

  if (reasons.length > 0) {
    await escalate(conversationId, reasons[0], reasons.join(', '));
    return true;
  }

  return false;
}

async function escalate(conversationId, reason, description) {
  try {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'ESCALATED' },
    });

    await prisma.escalation.create({
      data: {
        conversationId,
        reason,
        description,
        status: 'OPEN',
      },
    });

    logger.info(`Conversation ${conversationId} escalated: ${reason}`);
  } catch (error) {
    logger.error('Escalation error:', error);
  }
}

async function assignToAgent(conversationId, agentId, escalatedById) {
  try {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { assignedAgentId: agentId, status: 'AGENT_HANDLING' },
    });

    const escalation = await prisma.escalation.findFirst({
      where: { conversationId, status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
    });

    if (escalation) {
      await prisma.escalation.update({
        where: { id: escalation.id },
        data: { assignedToId: agentId, escalatedById, status: 'IN_PROGRESS' },
      });
    }
  } catch (error) {
    logger.error('Agent assignment error:', error);
  }
}

module.exports = { checkAutoEscalation, escalate, assignToAgent };
