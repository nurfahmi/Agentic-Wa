const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts, please try again later.' },
});

const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 200,
  message: { error: 'Rate limit exceeded.' },
});

module.exports = { apiLimiter, authLimiter, webhookLimiter };
