const { execSync } = require('child_process');
const crypto = require('crypto');
const app = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const prisma = require('./config/database');

async function start() {
  try {
    // Auto-create / sync database tables
    logger.info('Syncing database schema...');
    execSync('npx prisma db push --skip-generate', { stdio: 'inherit' });
    logger.info('Database schema synced');

    await prisma.$connect();
    logger.info('Database connected');

    // Start BullMQ message worker for AI processing
    try {
      require('./queues/workers/messageWorker');
      logger.info('Message worker started');
    } catch (err) {
      logger.warn('Message worker failed to start (Redis may be unavailable):', err.message);
    }

    // Check if any users exist — if not, generate one-time setup URL
    const userCount = await prisma.user.count();
    if (userCount === 0) {
      const setupToken = crypto.randomBytes(32).toString('hex');
      app.locals.setupToken = setupToken;
      logger.info('==============================================');
      logger.info('  NO USERS FOUND — First-time setup required');
      logger.info(`  Setup URL: http://localhost:${config.port}/auth/setup/${setupToken}`);
      logger.info('==============================================');
    }

    app.listen(config.port, () => {
      logger.info(`Server running on http://localhost:${config.port}`);
      logger.info(`Environment: ${config.nodeEnv}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown for both SIGTERM (production) and SIGINT (Ctrl+C dev)
async function shutdown() {
  logger.info('Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
