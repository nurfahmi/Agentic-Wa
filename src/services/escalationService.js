const prisma = require('../config/database');
const logger = require('../utils/logger');
const { getAiSettings } = require('../utils/getAiSettings');
const axios = require('axios');

/**
 * Fire webhook to external service (Make.com / Zapier / n8n)
 */
async function fireWebhook(data) {
  try {
    // Read from DB first, fallback to .env
    const setting = await prisma.siteSetting.findUnique({ where: { key: 'escalation_webhook_url' } });
    const webhookUrl = setting?.value || process.env.ESCALATION_WEBHOOK_URL;
    if (!webhookUrl) return;

    await axios.post(webhookUrl, data, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    });
    logger.info(`Webhook fired: ${data.event} for ${data.customer_phone}`);
  } catch (error) {
    logger.warn(`Webhook failed: ${error.message}`);
  }
}

async function checkAutoEscalation(conversationId, message, aiResult) {
  // Skip if already escalated
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (conversation && conversation.status === 'ESCALATED') return false;

  let reason = null;

  // 1. AI decided to escalate (primary — trust the AI's analysis)
  if (aiResult.escalate) {
    reason = aiResult.intent || 'AI_ESCALATE';
  }

  // 2. Safety net: PRE_ELIGIBLE always escalates
  if (aiResult.eligibility_status === 'PRE_ELIGIBLE') {
    reason = 'PRE_ELIGIBLE';
  }

  // 3. Safety net: OCR failure
  if (aiResult.required_action === 'ocr_failed') {
    reason = 'OCR_FAILURE';
  }

  if (reason) {
    const dutyAgent = await escalate(conversationId, reason, aiResult.reason || reason);
    return { escalated: true, dutyAgent };
  }

  return false;
}

async function escalate(conversationId, reason, description) {
  try {
    const { getNextAgent } = require('./dutyAgentService');
    const dutyAgent = await getNextAgent();

    // Get conversation for customer info
    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        status: 'ESCALATED',
        metadata: {
          ...(conversation?.metadata && typeof conversation.metadata === 'object' ? conversation.metadata : {}),
          dutyAgentName: dutyAgent?.name || null,
          dutyAgentPhone: dutyAgent?.phone || null,
        },
      },
    });

    await prisma.escalation.create({
      data: {
        conversationId,
        reason,
        description,
        status: 'OPEN',
      },
    });

    logger.info(`Conversation ${conversationId} escalated: ${reason}${dutyAgent ? ` → ${dutyAgent.name}` : ''}`);

    // Build conversation summary (last 10 messages)
    let conversationSummary = '';
    try {
      const messages = await prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      conversationSummary = messages.reverse().map(m => {
        const sender = m.direction === 'INBOUND' ? 'Customer' : 'AI';
        return `${sender}: ${m.content}`;
      }).join('\n');
    } catch (e) {
      logger.warn('Could not fetch conversation summary:', e.message);
    }

    // Fire webhook (async, don't await to avoid blocking)
    fireWebhook({
      event: 'escalation',
      customer_phone: conversation?.customerPhone || '',
      staff_name: dutyAgent?.name || '',
      staff_phone: dutyAgent?.phone || '',
      conversation_id: conversationId,
      timestamp: new Date().toISOString(),
      conversation_summary: conversationSummary,
    });

    return dutyAgent; // { name, phone } or null
  } catch (error) {
    logger.error('Escalation error:', error);
    return null;
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
