const prisma = require('../config/database');
const logger = require('../utils/logger');
const { getAiSettings } = require('../utils/getAiSettings');
const axios = require('axios');

const ANGRY_KEYWORDS = ['marah', 'bodoh', 'stupid', 'useless', 'scam', 'tipu', 'tidak berguna', 'complaint', 'aduan', 'saman', 'babi', 'sial'];
const HUMAN_KEYWORDS = ['agent', 'pegawai', 'manusia', 'human', 'orang', 'cakap dengan orang'];
const FOLLOWUP_KEYWORDS = ['follow up', 'nak teruskan', 'berminat', 'nak apply', 'nak mohon', 'bagaimana nak mohon', 'saya setuju', 'proceed', 'seterusnya', 'langkah seterusnya', 'nak buat pinjaman', 'nak pinjam', 'boleh teruskan'];

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

  const aiSettings = await getAiSettings();
  const enabledTriggers = (aiSettings.ai_escalation_triggers || '').split(',');
  const reasons = [];
  const lowerMsg = message.toLowerCase();

  // Customer is pre-eligible
  if (enabledTriggers.includes('pre_eligible') && aiResult.eligibility_status === 'PRE_ELIGIBLE') {
    reasons.push('PRE_ELIGIBLE');
  }

  // Customer wants to follow up / proceed
  if (enabledTriggers.includes('follow_up') && FOLLOWUP_KEYWORDS.some((kw) => lowerMsg.includes(kw))) {
    reasons.push('USER_REQUEST');
  }

  // Low confidence
  if (enabledTriggers.includes('low_confidence') && aiResult.confidence < 0.75) {
    reasons.push('LOW_CONFIDENCE');
  }

  // Angry keywords
  if (enabledTriggers.includes('angry_keywords') && ANGRY_KEYWORDS.some((kw) => lowerMsg.includes(kw))) {
    reasons.push('ANGRY_KEYWORDS');
  }

  // OCR failure
  if (aiResult.required_action === 'ocr_failed') {
    reasons.push('OCR_FAILURE');
  }

  // Borderline eligibility
  if (enabledTriggers.includes('borderline') && aiResult.eligibility_status === 'REQUIRES_REVIEW') {
    reasons.push('BORDERLINE_ELIGIBILITY');
  }

  // User explicitly requests human
  if (enabledTriggers.includes('user_request_human') && HUMAN_KEYWORDS.some((kw) => lowerMsg.includes(kw))) {
    reasons.push('USER_REQUEST');
  }

  // AI itself decided to escalate
  if (aiResult.escalate && reasons.length === 0) {
    reasons.push('MANUAL');
  }

  // Deduplicate
  const uniqueReasons = [...new Set(reasons)];

  if (uniqueReasons.length > 0) {
    const dutyAgent = await escalate(conversationId, uniqueReasons[0], uniqueReasons.join(', '));
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

    // Fire webhook (async, don't await to avoid blocking)
    fireWebhook({
      event: 'escalation',
      customer_phone: conversation?.customerPhone || '',
      staff_name: dutyAgent?.name || '',
      staff_phone: dutyAgent?.phone || '',
      conversation_id: conversationId,
      timestamp: new Date().toISOString(),
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
