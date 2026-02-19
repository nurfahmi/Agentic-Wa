const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/database');
const config = require('../config');
const { auditLog } = require('../middlewares/auditLog');

exports.loginPage = (req, res) => {
  const token = req.cookies.token;
  if (token) {
    try {
      jwt.verify(token, config.jwtSecret);
      return res.redirect('/dashboard');
    } catch (e) { /* invalid token, show login */ }
  }
  res.render('auth/login', { layout: false, error: null });
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.render('auth/login', { layout: false, error: 'Invalid credentials' });
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.render('auth/login', { layout: false, error: 'Invalid credentials' });
    }
    if (user.status !== 'ACTIVE') {
      return res.render('auth/login', { layout: false, error: 'Account is inactive' });
    }
    const token = jwt.sign({ id: user.id, role: user.role }, config.jwtSecret, { expiresIn: '7d' });
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await auditLog(user.id, 'LOGIN', 'user', user.id, null, req.ip);
    res.cookie('token', token, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
    });
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Login error:', error);
    res.render('auth/login', { layout: false, error: 'Something went wrong' });
  }
};

exports.logout = (req, res) => {
  res.clearCookie('token');
  res.redirect('/auth/login');
};
