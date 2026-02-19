const router = require('express').Router();
const authController = require('../controllers/authController');
const { authLimiter } = require('../middlewares/rateLimiter');

router.get('/login', authController.loginPage);
router.post('/login', authLimiter, authController.login);
router.get('/logout', authController.logout);
router.get('/setup/:token', authController.setupPage);
router.post('/setup/:token', authController.setup);

module.exports = router;
