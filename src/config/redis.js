const Redis = require('ioredis');
const config = require('./index');

let redis = null;
let failed = false;

function getRedis() {
  if (failed) return null;
  if (!redis) {
    try {
      redis = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        maxRetriesPerRequest: null,
        retryStrategy(times) {
          if (times > 3) {
            failed = true;
            redis = null;
            return null;
          }
          return Math.min(times * 200, 2000);
        },
      });
      redis.on('error', (err) => {
        if (!failed) {
          console.warn('Redis unavailable:', err.message);
          failed = true;
          redis = null;
        }
      });
    } catch (err) {
      console.warn('Redis unavailable, running without cache');
      failed = true;
      redis = null;
    }
  }
  return redis;
}

module.exports = { getRedis };
