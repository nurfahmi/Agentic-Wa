const prisma = require('../config/database');

exports.home = async (req, res) => {
  try {
    const [totalLeads, escalated, eligible, recentConversations] = await Promise.all([
      prisma.conversation.count(),
      prisma.conversation.count({ where: { status: 'ESCALATED' } }),
      prisma.conversation.count({ where: { eligibility: 'PRE_ELIGIBLE' } }),
      prisma.conversation.findMany({
        orderBy: { lastMessageAt: 'desc' },
        take: 5,
        include: { assignedAgent: { select: { name: true } } },
      }),
    ]);

    const totalClosed = await prisma.conversation.count({ where: { status: 'CLOSED' } });
    const totalEmployers = await prisma.governmentEmployer.count({ where: { isApproved: true } });
    const totalKb = await prisma.knowledgeBase.count({ where: { isActive: true } });

    res.render('dashboard/home', {
      stats: { totalLeads, escalated, eligible, closedCount: totalClosed, totalEmployers, totalKb },
      recentConversations,
    });
  } catch (error) {
    console.error('Dashboard home error:', error);
    res.render('dashboard/home', {
      stats: { totalLeads: 0, escalated: 0, eligible: 0, closedCount: 0, totalEmployers: 0, totalKb: 0 },
      recentConversations: [],
    });
  }
};

exports.analytics = async (req, res) => {
  try {
    const [totalLeads, aiHandled, escalated, eligible, agents] = await Promise.all([
      prisma.conversation.count(),
      prisma.conversation.count({ where: { status: 'AI_HANDLING' } }),
      prisma.conversation.count({ where: { status: 'ESCALATED' } }),
      prisma.conversation.count({ where: { eligibility: 'PRE_ELIGIBLE' } }),
      prisma.user.findMany({
        where: { role: { in: ['AGENT', 'MASTER_AGENT'] } },
        include: {
          _count: { select: { conversations: true } },
          conversations: {
            select: { status: true, eligibility: true, aiConfidence: true },
          },
        },
      }),
    ]);

    const totalClosed = await prisma.conversation.count({ where: { status: 'CLOSED' } });
    const total = totalLeads || 1;

    // Build agent performance data
    const agentPerformance = agents.map((agent) => {
      const convos = agent.conversations || [];
      const closed = convos.filter((c) => c.status === 'CLOSED').length;
      const escalatedCount = convos.filter((c) => c.status === 'ESCALATED').length;
      const eligibleCount = convos.filter((c) => c.eligibility === 'PRE_ELIGIBLE').length;
      const avgConfidence = convos.length > 0
        ? convos.reduce((sum, c) => sum + (c.aiConfidence || 0), 0) / convos.length
        : 0;
      return {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        status: agent.status,
        totalConversations: agent._count.conversations,
        closed,
        escalated: escalatedCount,
        eligible: eligibleCount,
        avgConfidence: (avgConfidence * 100).toFixed(0),
        closedPct: convos.length > 0 ? ((closed / convos.length) * 100).toFixed(0) : 0,
      };
    });

    // Recent escalations
    const recentEscalations = await prisma.escalation.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        conversation: { select: { customerName: true, customerPhone: true } },
        assignedTo: { select: { name: true } },
      },
    });

    res.render('dashboard/analytics', {
      stats: {
        totalLeads,
        aiHandledPct: ((aiHandled / total) * 100).toFixed(1),
        escalatedPct: ((escalated / total) * 100).toFixed(1),
        eligiblePct: ((eligible / total) * 100).toFixed(1),
        closedCount: totalClosed,
      },
      agentPerformance,
      recentEscalations,
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.render('dashboard/analytics', {
      stats: { totalLeads: 0, aiHandledPct: 0, escalatedPct: 0, eligiblePct: 0, closedCount: 0 },
      agentPerformance: [],
      recentEscalations: [],
    });
  }
};

// Government Employers management
exports.employersPage = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const skip = (page - 1) * limit;
    const [employers, total] = await Promise.all([
      prisma.governmentEmployer.findMany({ skip, take: limit, orderBy: { name: 'asc' } }),
      prisma.governmentEmployer.count(),
    ]);
    res.render('dashboard/employers', { employers, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Employers page error:', error);
    res.render('dashboard/employers', { employers: [], page: 1, totalPages: 1 });
  }
};

exports.createEmployer = async (req, res) => {
  try {
    const { name, code, ministry, category } = req.body;
    const employer = await prisma.governmentEmployer.create({
      data: { name, code: code || null, ministry: ministry || null, category: category || null, isApproved: true },
    });
    res.json({ success: true, employer });
  } catch (error) {
    if (error.code === 'P2002') return res.status(400).json({ error: 'Code already exists' });
    console.error('Create employer error:', error);
    res.status(500).json({ error: 'Failed to create employer' });
  }
};

exports.deleteEmployer = async (req, res) => {
  try {
    await prisma.governmentEmployer.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete employer error:', error);
    res.status(500).json({ error: 'Failed to delete' });
  }
};

exports.toggleEmployer = async (req, res) => {
  try {
    const emp = await prisma.governmentEmployer.findUnique({ where: { id: parseInt(req.params.id) } });
    await prisma.governmentEmployer.update({
      where: { id: parseInt(req.params.id) },
      data: { isApproved: !emp.isApproved },
    });
    res.json({ success: true, isApproved: !emp.isApproved });
  } catch (error) {
    console.error('Toggle employer error:', error);
    res.status(500).json({ error: 'Failed to toggle' });
  }
};

// Koperasi Rules management
exports.rulesPage = async (req, res) => {
  try {
    const rules = await prisma.koperasiRule.findMany({ orderBy: { ruleKey: 'asc' } });
    res.render('dashboard/rules', { rules });
  } catch (error) {
    console.error('Rules page error:', error);
    res.render('dashboard/rules', { rules: [] });
  }
};

exports.updateRule = async (req, res) => {
  try {
    const { id } = req.params;
    const { ruleValue, isActive } = req.body;
    await prisma.koperasiRule.update({
      where: { id: parseInt(id) },
      data: { ruleValue, isActive: isActive !== undefined ? isActive : undefined },
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Update rule error:', error);
    res.status(500).json({ error: 'Failed to update rule' });
  }
};

exports.createRule = async (req, res) => {
  try {
    const { ruleKey, ruleValue, label } = req.body;
    const rule = await prisma.koperasiRule.create({
      data: { ruleKey, ruleValue, label, isActive: true },
    });
    res.json({ success: true, rule });
  } catch (error) {
    if (error.code === 'P2002') return res.status(400).json({ error: 'Rule key already exists' });
    console.error('Create rule error:', error);
    res.status(500).json({ error: 'Failed to create rule' });
  }
};
