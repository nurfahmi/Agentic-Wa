const Redis = require('ioredis');
const config = require('./index');

let redis = null;

function getRedis() {
  if (!redis) {
    try {
      redis = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        maxRetriesPerRequest: null,
        retryStrategy(times) {
          if (times > 3) return null;
          return Math.min(times * 200, 2000);
        },
      });
      redis.on('error', (err) => {
        console.warn('Redis connection error (non-fatal):', err.message);
      });
    } catch (err) {
      console.warn('Redis unavailable, using in-memory fallback');
      redis = null;
    }
  }
  return redis;
}

module.exports = { getRedis };
