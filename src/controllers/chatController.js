const prisma = require('../config/database');

exports.chatPage = async (req, res) => {
  try {
    const conversations = await prisma.conversation.findMany({
      orderBy: { lastMessageAt: 'desc' },
      take: 50,
      include: {
        assignedAgent: { select: { id: true, name: true } },
        messages: { orderBy: { timestamp: 'desc' }, take: 1 },
      },
    });
    const agents = await prisma.user.findMany({
      where: { role: { in: ['AGENT', 'MASTER_AGENT'] }, status: 'ACTIVE' },
      select: { id: true, name: true },
    });
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

    // TODO: Send via WABA API
    // await whatsappService.sendText(conversation.customerPhone, content);

    await prisma.conversation.update({
      where: { id: parseInt(id) },
      data: { lastMessageAt: new Date(), status: 'AGENT_HANDLING' },
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
