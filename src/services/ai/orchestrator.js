const OpenAI = require('openai');
const config = require('../../config');
const prisma = require('../../config/database');
const logger = require('../../utils/logger');
const { toolDefinitions, executeTool } = require('../tools/toolRegistry');
const promptBuilder = require('./promptBuilder');
const schemaValidator = require('./schemaValidator');
const ragService = require('../rag/ragService');
const { getRedis } = require('../../config/redis');
const { getOpenAIConfig } = require('../../utils/getOpenAIConfig');

const MAX_RETRIES = 2;

async function processMessage(conversationId, userMessage) {
  const startTime = Date.now();
  let retryCount = 0;

  try {
    // Get dynamic OpenAI config (DB settings → .env fallback)
    const aiConfig = await getOpenAIConfig();
    const openai = new OpenAI({ apiKey: aiConfig.apiKey });
    const aiModel = aiConfig.model;

    // 1. Get conversation context
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: { orderBy: { timestamp: 'desc' }, take: 10 },
        documents: true,
        eligibilityResults: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    if (!conversation) throw new Error('Conversation not found');

    // 2. Get RAG context
    const ragContext = await ragService.search(userMessage);

    // 3. Get conversation state from Redis
    const state = await getConversationState(conversationId);

    // 4. Build system prompt
    const systemPrompt = promptBuilder.build(conversation, ragContext, state);

    // 5. Build messages array
    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversation.messages
        .reverse()
        .slice(-8)
        .map((m) => ({
          role: m.direction === 'INBOUND' ? 'user' : 'assistant',
          content: m.content,
        })),
      { role: 'user', content: userMessage },
    ];

    // 6. Call AI with tool calling
    let aiResult = null;
    while (retryCount <= MAX_RETRIES) {
      const completion = await openai.chat.completions.create({
        model: aiModel,
        messages,
        tools: toolDefinitions,
        tool_choice: 'auto',
        temperature: 0.3,
        response_format: { type: 'json_object' },
      });

      const choice = completion.choices[0];

      // Handle tool calls
      if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
        messages.push(choice.message);

        for (const toolCall of choice.message.tool_calls) {
          const args = JSON.parse(toolCall.function.arguments);
          const toolResult = await executeTool(toolCall.function.name, args);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult),
          });
        }

        // Get final response after tool execution
        const finalCompletion = await openai.chat.completions.create({
          model: aiModel,
          messages,
          temperature: 0.3,
          response_format: { type: 'json_object' },
        });
        aiResult = finalCompletion.choices[0].message.content;
      } else {
        aiResult = choice.message.content;
      }

      // 7. Validate output schema
      const parsed = schemaValidator.validate(aiResult);
      if (parsed.valid) {
        aiResult = parsed.data;
        break;
      }

      retryCount++;
      logger.warn(`AI output validation failed (attempt ${retryCount}), retrying...`);
      messages.push({
        role: 'user',
        content: 'Your previous response was not valid JSON. Please respond with the required JSON schema: { intent, confidence, required_action, eligibility_status, reason, escalate, reply_text }',
      });
    }

    if (!aiResult || typeof aiResult === 'string') {
      // Fallback: escalate
      aiResult = {
        intent: 'unknown',
        confidence: 0,
        required_action: 'escalate',
        eligibility_status: 'PENDING',
        reason: 'AI failed to produce valid response',
        escalate: true,
        reply_text: 'Saya akan sambungkan anda kepada pegawai kami.',
      };
    }

    // 8. Check confidence and decide action
    if (aiResult.confidence < 0.75 || aiResult.escalate) {
      aiResult.escalate = true;
      aiResult.required_action = 'escalate';
      if (!aiResult.reply_text) {
        aiResult.reply_text = 'Saya akan sambungkan anda kepada pegawai kami untuk bantuan lanjut.';
      }
    }

    // 9. Log AI decision
    await prisma.aiLog.create({
      data: {
        conversationId,
        intent: aiResult.intent,
        confidence: aiResult.confidence,
        requiredAction: aiResult.required_action,
        toolsCalled: aiResult.tools_used || null,
        ragContext: ragContext.length > 0 ? ragContext : null,
        rawInput: userMessage,
        rawOutput: JSON.stringify(aiResult),
        outputValid: true,
        retryCount,
        processingMs: Date.now() - startTime,
      },
    });

    // 10. Update conversation state
    await updateConversationState(conversationId, {
      lastIntent: aiResult.intent,
      lastConfidence: aiResult.confidence,
      stage: aiResult.required_action,
    });

    return aiResult;
  } catch (error) {
    logger.error('Orchestrator error:', error);
    await prisma.aiLog.create({
      data: {
        conversationId,
        rawInput: userMessage,
        rawOutput: error.message,
        outputValid: false,
        retryCount,
        processingMs: Date.now() - startTime,
      },
    });
    return {
      intent: 'error',
      confidence: 0,
      required_action: 'escalate',
      eligibility_status: 'PENDING',
      reason: 'System error',
      escalate: true,
      reply_text: 'Maaf, sistem sedang mengalami masalah. Pegawai kami akan menghubungi anda.',
    };
  }
}

async function getConversationState(conversationId) {
  const redis = getRedis();
  if (!redis) return {};
  try {
    const state = await redis.get(`conv:${conversationId}:state`);
    return state ? JSON.parse(state) : {};
  } catch {
    return {};
  }
}

async function updateConversationState(conversationId, data) {
  const redis = getRedis();
  if (!redis) return;
  try {
    const current = await getConversationState(conversationId);
    const updated = { ...current, ...data, updatedAt: new Date().toISOString() };
    await redis.set(`conv:${conversationId}:state`, JSON.stringify(updated), 'EX', 86400);
  } catch (err) {
    logger.warn('Redis state update error:', err.message);
  }
}

module.exports = { processMessage };
