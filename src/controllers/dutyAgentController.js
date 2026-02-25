const prisma = require('../config/database');

exports.listAgents = async (req, res) => {
  try {
    const agents = await prisma.dutyAgent.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.render('dashboard/duty-agents', { agents });
  } catch (error) {
    console.error('List duty agents error:', error);
    res.render('dashboard/duty-agents', { agents: [] });
  }
};

exports.createAgent = async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'Nama dan telefon diperlukan' });

    await prisma.dutyAgent.create({ data: { name, phone } });
    res.json({ success: true });
  } catch (error) {
    console.error('Create duty agent error:', error);
    res.status(500).json({ error: 'Gagal menambah pegawai' });
  }
};

exports.updateAgent = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone } = req.body;
    await prisma.dutyAgent.update({
      where: { id: parseInt(id) },
      data: { name, phone },
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
    await prisma.dutyAgent.updateMany({ data: { assignmentCount: 0 } });
    res.json({ success: true });
  } catch (error) {
    console.error('Reset counts error:', error);
    res.status(500).json({ error: 'Gagal reset kiraan' });
  }
};
