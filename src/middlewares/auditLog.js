const prisma = require('../config/database');

async function auditLog(userId, action, entity, entityId, details, ipAddress) {
  try {
    await prisma.auditLog.create({
      data: { userId, action, entity, entityId, details, ipAddress },
    });
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

function auditMiddleware(action) {
  return async (req, res, next) => {
    res.on('finish', async () => {
      if (res.statusCode < 400) {
        await auditLog(
          req.user?.id || null,
          action,
          null,
          null,
          { method: req.method, path: req.path },
          req.ip
        );
      }
    });
    next();
  };
}

module.exports = { auditLog, auditMiddleware };
