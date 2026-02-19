const jwt = require('jsonwebtoken');
const config = require('../config');
const prisma = require('../config/database');

// Verify JWT from cookie
async function authenticate(req, res, next) {
  try {
    const token = req.cookies.token;
    if (!token) {
      return res.redirect('/auth/login');
    }
    const decoded = jwt.verify(token, config.jwtSecret);
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user || user.status !== 'ACTIVE') {
      res.clearCookie('token');
      return res.redirect('/auth/login');
    }
    req.user = user;
    res.locals.user = user;
    next();
  } catch (err) {
    res.clearCookie('token');
    return res.redirect('/auth/login');
  }
}

// Verify JWT from Authorization header (API) — falls back to cookie
async function authenticateApi(req, res, next) {
  try {
    let token;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const decoded = jwt.verify(token, config.jwtSecret);
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user || user.status !== 'ACTIVE') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Role-based access control
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.redirect('/auth/login');
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).render('errors/403', { layout: false });
    }
    next();
  };
}

function authorizeApi(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

module.exports = { authenticate, authenticateApi, authorize, authorizeApi };
