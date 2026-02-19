const router = require('express').Router();
const { webhookLimiter } = require('../middlewares/rateLimiter');
const webhookController = require('../controllers/webhookController');

router.get('/', webhookController.verify);
router.post('/', webhookLimiter, webhookController.receive);

module.exports = router;
