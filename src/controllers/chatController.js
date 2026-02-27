const prisma = require('../config/database');

exports.chatPage = async (req, res) => {
  try {
    // Manual handling chats first (newest on top), then the rest
    const [manualChats, otherChats, agents] = await Promise.all([
      prisma.conversation.findMany({
        where: { status: 'AGENT_HANDLING' },
        orderBy: { lastMessageAt: 'desc' },
        include: {
          assignedAgent: { select: { id: true, name: true } },
          messages: { orderBy: { timestamp: 'desc' }, take: 1 },
        },
      }),
      prisma.conversation.findMany({
        where: { status: { not: 'AGENT_HANDLING' } },
        orderBy: { lastMessageAt: 'desc' },
        take: 50,
        include: {
          assignedAgent: { select: { id: true, name: true } },
          messages: { orderBy: { timestamp: 'desc' }, take: 1 },
        },
      }),
      prisma.user.findMany({
        where: { role: { in: ['AGENT', 'MASTER_AGENT'] }, status: 'ACTIVE' },
        select: { id: true, name: true },
      }),
    ]);
    const conversations = [...manualChats, ...otherChats];
    res.render('dashboard/chat', { conversations, agents });
  } catch (error) {
    console.error('Chat page error:', error);
    res.render('dashboard/chat', { conversations: [], agents: [] });
  }
};

exports.getMessages = async (req, res) => {
  try {
    const { id } = req.params;
    const conversation = await prisma.conversation.findUnique({
      where: { id: parseInt(id) },
      include: {
        messages: { orderBy: { timestamp: 'asc' } },
        documents: true,
        eligibilityResults: { orderBy: { createdAt: 'desc' }, take: 1 },
        assignedAgent: { select: { id: true, name: true } },
      },
    });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    res.json(conversation);
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to load messages' });
  }
};

exports.sendReply = async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const conversation = await prisma.conversation.findUnique({ where: { id: parseInt(id) } });
    if (!conversation) return res.status(404).json({ error: 'Not found' });

    // Send via WhatsApp
    const whatsappService = require('../services/waAdapter');
    await whatsappService.sendText(conversation.customerPhone, content);

    const message = await prisma.message.create({
      data: {
        conversationId: parseInt(id),
        direction: 'OUTBOUND',
        type: 'TEXT',
        content,
        sentByAgentId: req.user.id,
        isAiGenerated: false,
      },
    });

    // Update status and clear manual reply flag
    await prisma.conversation.update({
      where: { id: parseInt(id) },
      data: { lastMessageAt: new Date(), status: 'AGENT_HANDLING', metadata: {} },
    });

    res.json({ success: true, message });
  } catch (error) {
    console.error('Send reply error:', error);
    res.status(500).json({ error: 'Failed to send reply' });
  }
};

exports.assignAgent = async (req, res) => {
  try {
    const { id } = req.params;
    const { agentId } = req.body;
    await prisma.conversation.update({
      where: { id: parseInt(id) },
      data: { assignedAgentId: parseInt(agentId), status: 'AGENT_HANDLING' },
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Assign agent error:', error);
    res.status(500).json({ error: 'Failed to assign agent' });
  }
};

exports.escalateConversation = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    await prisma.conversation.update({
      where: { id: parseInt(id) },
      data: { status: 'ESCALATED' },
    });
    await prisma.escalation.create({
      data: {
        conversationId: parseInt(id),
        reason: reason || 'MANUAL',
        escalatedById: req.user.id,
        status: 'OPEN',
      },
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Escalate error:', error);
    res.status(500).json({ error: 'Failed to escalate' });
  }
};

/**
 * Return conversation back to AI handling
 */
exports.handbackToAi = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.conversation.update({
      where: { id: parseInt(id) },
      data: { status: 'AI_HANDLING', metadata: {} },
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Handback error:', error);
    res.status(500).json({ error: 'Failed to handback' });
  }
};

/**
 * Get notification counts for the dashboard badge
 */
exports.getNotifications = async (req, res) => {
  try {
    const [manualResult, escalatedCount] = await Promise.all([
      // Only AGENT_HANDLING with needsManualReply = true in JSON metadata
      prisma.$queryRaw`SELECT COUNT(*) as cnt FROM conversations WHERE status = 'AGENT_HANDLING' AND JSON_EXTRACT(metadata, '$.needsManualReply') = true`,
      // Open escalations
      prisma.escalation.count({
        where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
      }),
    ]);

    const manualCount = Number(manualResult[0]?.cnt || 0);
    res.json({
      manual: manualCount,
      escalated: escalatedCount,
      total: manualCount + escalatedCount,
    });
  } catch (error) {
    console.error('Notification count error:', error);
    res.json({ manual: 0, escalated: 0, total: 0 });
  }
};

/**
 * Mark conversation as read — clear needsManualReply, keep status
 */
exports.markRead = async (req, res) => {
  try {
    const { id } = req.params;
    const conv = await prisma.conversation.findUnique({ where: { id: parseInt(id) } });
    if (!conv) return res.status(404).json({ error: 'Not found' });

    // Clear the needsManualReply flag from metadata
    const metadata = (conv.metadata && typeof conv.metadata === 'object') ? { ...conv.metadata } : {};
    delete metadata.needsManualReply;
    await prisma.conversation.update({
      where: { id: parseInt(id) },
      data: { metadata },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Failed' });
  }
};
