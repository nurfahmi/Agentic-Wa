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

// One-time setup — create first superadmin
exports.setupPage = async (req, res) => {
  const { token } = req.params;
  if (!req.app.locals.setupToken || token !== req.app.locals.setupToken) {
    return res.status(404).render('errors/404', { layout: false });
  }
  const userCount = await prisma.user.count();
  if (userCount > 0) {
    return res.redirect('/auth/login');
  }
  res.render('auth/setup', { layout: false, token, error: null, siteName: config.site.name });
};

exports.setup = async (req, res) => {
  const { token } = req.params;
  if (!req.app.locals.setupToken || token !== req.app.locals.setupToken) {
    return res.status(404).render('errors/404', { layout: false });
  }
  try {
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      return res.redirect('/auth/login');
    }
    const { name, email, password } = req.body;
    if (!name || !email || !password || password.length < 6) {
      return res.render('auth/setup', { layout: false, token, error: 'All fields required. Password min 6 chars.', siteName: config.site.name });
    }
    const hashed = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: { name, email, password: hashed, role: 'SUPERADMIN', status: 'ACTIVE' },
    });
    // Invalidate setup token
    delete req.app.locals.setupToken;
    res.redirect('/auth/login');
  } catch (error) {
    console.error('Setup error:', error);
    res.render('auth/setup', { layout: false, token, error: 'Something went wrong', siteName: config.site.name });
  }
};
