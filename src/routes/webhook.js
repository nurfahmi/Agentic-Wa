const express = require('express');
const router = require('express').Router();
const { webhookLimiter } = require('../middlewares/rateLimiter');
const webhookController = require('../controllers/webhookController');

// POST /webhook - Receive messages (auto-detects Official WABA vs Unofficial WA Gateway)
router.post('/',
  express.json({ verify: webhookController.verifySignature }),
  webhookLimiter,
  webhookController.receive
);

// GET /webhook - Meta verification handshake
router.get('/', webhookController.verify);

module.exports = router;

