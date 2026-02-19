const bcrypt = require('bcryptjs');
const prisma = require('../config/database');
const { auditLog } = require('../middlewares/auditLog');

exports.listUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
      prisma.user.findMany({ skip, take: limit, orderBy: { createdAt: 'desc' } }),
      prisma.user.count(),
    ]);
    res.render('dashboard/users', { users, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('List users error:', error);
    res.render('dashboard/users', { users: [], page: 1, totalPages: 1 });
  }
};

exports.createUser = async (req, res) => {
  try {
    const { name, email, password, role, phone } = req.body;
    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { name, email, password: hashed, role, phone },
    });
    await auditLog(req.user.id, 'CREATE_USER', 'user', user.id, { name, email, role }, req.ip);
    res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'Email already exists' });
    }
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, role, phone, status } = req.body;
    const data = { name, email, role, phone, status };
    if (req.body.password) {
      data.password = await bcrypt.hash(req.body.password, 12);
    }
    const user = await prisma.user.update({ where: { id: parseInt(id) }, data });
    await auditLog(req.user.id, 'UPDATE_USER', 'user', user.id, data, req.ip);
    res.json({ success: true });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
};

exports.toggleUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({ where: { id: parseInt(id) } });
    const newStatus = user.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    await prisma.user.update({ where: { id: parseInt(id) }, data: { status: newStatus } });
    await auditLog(req.user.id, 'TOGGLE_USER_STATUS', 'user', parseInt(id), { newStatus }, req.ip);
    res.json({ success: true, status: newStatus });
  } catch (error) {
    console.error('Toggle user error:', error);
    res.status(500).json({ error: 'Failed to toggle status' });
  }
};
