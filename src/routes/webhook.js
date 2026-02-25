const express = require('express');
const router = require('express').Router();
const { webhookLimiter } = require('../middlewares/rateLimiter');
const webhookController = require('../controllers/webhookController');

// Use raw body parser with signature verification for POST webhook
router.post('/',
  express.json({ verify: webhookController.verifySignature }),
  webhookLimiter,
  webhookController.receive
);

router.get('/', webhookController.verify);

module.exports = router;
