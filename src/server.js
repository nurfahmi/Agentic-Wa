const app = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const prisma = require('./config/database');

async function start() {
  try {
    await prisma.$connect();
    logger.info('Database connected');

    app.listen(config.port, () => {
      logger.info(`Server running on http://localhost:${config.port}`);
      logger.info(`Environment: ${config.nodeEnv}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

start();
