const { Queue } = require('bullmq');
const config = require('../config');

const connection = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
};

let messageQueue;
try {
  messageQueue = new Queue('messages', { connection });
} catch (err) {
  console.warn('BullMQ queue creation failed (Redis may be unavailable):', err.message);
  // Fallback: create a mock queue
  messageQueue = {
    add: async (name, data) => {
      console.log(`[MockQueue] Would queue: ${name}`, data);
      return { id: 'mock-' + Date.now() };
    },
  };
}

module.exports = { messageQueue };
