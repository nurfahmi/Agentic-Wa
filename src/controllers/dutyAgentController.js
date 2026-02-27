const prisma = require('../config/database');

// ─── DUTY AGENTS ───

exports.listAgents = async (req, res) => {
  try {
    const [agents, tiers] = await Promise.all([
      prisma.dutyAgent.findMany({
        orderBy: { createdAt: 'desc' },
        include: { tier: true },
      }),
      prisma.agentTier.findMany({
        orderBy: { weight: 'asc' },
        include: { _count: { select: { agents: true } } },
      }),
    ]);
    res.render('dashboard/duty-agents', { agents, tiers });
  } catch (error) {
    console.error('List duty agents error:', error);
    res.render('dashboard/duty-agents', { agents: [], tiers: [] });
  }
};

exports.createAgent = async (req, res) => {
  try {
    const { name, phone, shiftStart, shiftEnd, tierId } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'Nama dan telefon diperlukan' });

    await prisma.dutyAgent.create({
      data: {
        name,
        phone,
        shiftStart: shiftStart || null,
        shiftEnd: shiftEnd || null,
        tierId: tierId ? parseInt(tierId) : null,
      },
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Create duty agent error:', error);
    res.status(500).json({ error: 'Gagal menambah pegawai' });
  }
};

exports.updateAgent = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, shiftStart, shiftEnd, tierId } = req.body;
    await prisma.dutyAgent.update({
      where: { id: parseInt(id) },
      data: {
        name,
        phone,
        shiftStart: shiftStart || null,
        shiftEnd: shiftEnd || null,
        tierId: tierId ? parseInt(tierId) : null,
      },
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Update duty agent error:', error);
    res.status(500).json({ error: 'Gagal kemaskini pegawai' });
  }
};

exports.toggleAgent = async (req, res) => {
  try {
    const { id } = req.params;
    const agent = await prisma.dutyAgent.findUnique({ where: { id: parseInt(id) } });
    if (!agent) return res.status(404).json({ error: 'Pegawai tidak ditemui' });

    await prisma.dutyAgent.update({
      where: { id: parseInt(id) },
      data: { active: !agent.active },
    });
    res.json({ success: true, active: !agent.active });
  } catch (error) {
    console.error('Toggle duty agent error:', error);
    res.status(500).json({ error: 'Gagal menukar status' });
  }
};

exports.deleteAgent = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.dutyAgent.delete({ where: { id: parseInt(id) } });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete duty agent error:', error);
    res.status(500).json({ error: 'Gagal padam pegawai' });
  }
};

exports.resetCounts = async (req, res) => {
  try {
    await prisma.dutyAgent.updateMany({ data: { assignmentCount: 0, todayCount: 0 } });
    res.json({ success: true });
  } catch (error) {
    console.error('Reset counts error:', error);
    res.status(500).json({ error: 'Gagal reset kiraan' });
  }
};

// ─── TIERS ───

exports.listTiers = async (req, res) => {
  try {
    const tiers = await prisma.agentTier.findMany({
      orderBy: { weight: 'asc' },
      include: { _count: { select: { agents: true } } },
    });
    res.json({ success: true, tiers });
  } catch (error) {
    console.error('List tiers error:', error);
    res.status(500).json({ error: 'Gagal memuat tier' });
  }
};

exports.createTier = async (req, res) => {
  try {
    const { name, weight } = req.body;
    if (!name || !weight) return res.status(400).json({ error: 'Nama dan berat diperlukan' });

    const tier = await prisma.agentTier.create({
      data: { name, weight: parseInt(weight) },
    });
    res.json({ success: true, tier });
  } catch (error) {
    if (error.code === 'P2002') return res.status(400).json({ error: 'Nama tier sudah wujud' });
    console.error('Create tier error:', error);
    res.status(500).json({ error: 'Gagal menambah tier' });
  }
};

exports.updateTier = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, weight } = req.body;
    await prisma.agentTier.update({
      where: { id: parseInt(id) },
      data: { name, weight: parseInt(weight) },
    });
    res.json({ success: true });
  } catch (error) {
    if (error.code === 'P2002') return res.status(400).json({ error: 'Nama tier sudah wujud' });
    console.error('Update tier error:', error);
    res.status(500).json({ error: 'Gagal kemaskini tier' });
  }
};

exports.deleteTier = async (req, res) => {
  try {
    const { id } = req.params;
    // Check if any agents are using this tier
    const count = await prisma.dutyAgent.count({ where: { tierId: parseInt(id) } });
    if (count > 0) {
      return res.status(400).json({ error: `Tier ini masih digunakan oleh ${count} pegawai. Tukar tier mereka dahulu.` });
    }
    await prisma.agentTier.delete({ where: { id: parseInt(id) } });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete tier error:', error);
    res.status(500).json({ error: 'Gagal padam tier' });
  }
};
