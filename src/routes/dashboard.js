const router = require('express').Router();
const { authenticate, authorize } = require('../middlewares/auth');
const dashboardController = require('../controllers/dashboardController');
const userController = require('../controllers/userController');
const settingsController = require('../controllers/settingsController');
const chatController = require('../controllers/chatController');
const knowledgeController = require('../controllers/knowledgeController');
const demoController = require('../controllers/demoController');

// All dashboard routes require authentication
router.use(authenticate);

// Dashboard home (overview)
router.get('/', dashboardController.home);

// Analytics (detailed reports + agent performance)
router.get('/analytics', dashboardController.analytics);

// AI Demo Sandbox
router.get('/demo', demoController.demoPage);

// Chat
router.get('/chat', chatController.chatPage);

// Users - Admin+ only
router.get('/users', authorize('SUPERADMIN', 'ADMIN'), userController.listUsers);

// Government Employers - Admin+ only
router.get('/employers', authorize('SUPERADMIN', 'ADMIN'), dashboardController.employersPage);

// Koperasi Rules - Admin+ only
router.get('/rules', authorize('SUPERADMIN', 'ADMIN'), dashboardController.rulesPage);

// Settings - Superadmin only
router.get('/settings', authorize('SUPERADMIN'), settingsController.settingsPage);
router.post('/settings', authorize('SUPERADMIN'), settingsController.uploadMiddleware, settingsController.updateSettings);

// Knowledge Base - Admin+ only
router.get('/knowledge', authorize('SUPERADMIN', 'ADMIN'), knowledgeController.knowledgePage);
router.get('/knowledge/guide', authorize('SUPERADMIN', 'ADMIN'), knowledgeController.guidePage);

module.exports = router;
