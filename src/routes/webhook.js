const express = require('express');
const router = require('express').Router();
const { webhookLimiter } = require('../middlewares/rateLimiter');
const webhookController = require('../controllers/webhookController');
const webhookUnofficialController = require('../controllers/webhookUnofficialController');

// Official WABA webhook
router.post('/',
  express.json({ verify: webhookController.verifySignature }),
  webhookLimiter,
  webhookController.receive
);
router.get('/', webhookController.verify);

// Unofficial WA Gateway webhook
router.post('/unofficial', webhookUnofficialController.receive);

module.exports = router;
