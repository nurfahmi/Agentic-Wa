const router = require('express').Router();
const { authenticateApi, authorizeApi } = require('../middlewares/auth');
const { apiLimiter } = require('../middlewares/rateLimiter');
const userController = require('../controllers/userController');
const chatController = require('../controllers/chatController');
const knowledgeController = require('../controllers/knowledgeController');
const dashboardController = require('../controllers/dashboardController');

router.use(apiLimiter);
router.use(authenticateApi);

// Users API
router.post('/users', authorizeApi('SUPERADMIN', 'ADMIN'), userController.createUser);
router.put('/users/:id', authorizeApi('SUPERADMIN', 'ADMIN'), userController.updateUser);
router.patch('/users/:id/toggle', authorizeApi('SUPERADMIN', 'ADMIN'), userController.toggleUserStatus);

// Chat API
router.get('/conversations/:id/messages', chatController.getMessages);
router.post('/conversations/:id/reply', chatController.sendReply);
router.post('/conversations/:id/assign', authorizeApi('SUPERADMIN', 'ADMIN', 'MASTER_AGENT'), chatController.assignAgent);
router.post('/conversations/:id/escalate', chatController.escalateConversation);

// Knowledge Base API
router.post('/knowledge', authorizeApi('SUPERADMIN', 'ADMIN'), knowledgeController.createEntry);
router.put('/knowledge/:id', authorizeApi('SUPERADMIN', 'ADMIN'), knowledgeController.updateEntry);
router.delete('/knowledge/:id', authorizeApi('SUPERADMIN', 'ADMIN'), knowledgeController.deleteEntry);
router.patch('/knowledge/:id/toggle', authorizeApi('SUPERADMIN', 'ADMIN'), knowledgeController.toggleEntry);
router.post('/knowledge/upload', authorizeApi('SUPERADMIN', 'ADMIN'), knowledgeController.uploadMiddleware, knowledgeController.uploadFile);
router.post('/knowledge/import-whatsapp', authorizeApi('SUPERADMIN', 'ADMIN'), knowledgeController.waUploadMiddleware, knowledgeController.importWhatsApp);

// Government Employers API
router.post('/employers', authorizeApi('SUPERADMIN', 'ADMIN'), dashboardController.createEmployer);
router.delete('/employers/:id', authorizeApi('SUPERADMIN', 'ADMIN'), dashboardController.deleteEmployer);
router.patch('/employers/:id/toggle', authorizeApi('SUPERADMIN', 'ADMIN'), dashboardController.toggleEmployer);

// Koperasi Rules API
router.post('/rules', authorizeApi('SUPERADMIN', 'ADMIN'), dashboardController.createRule);
router.put('/rules/:id', authorizeApi('SUPERADMIN', 'ADMIN'), dashboardController.updateRule);

// AI Demo API
const demoController = require('../controllers/demoController');
router.post('/demo/start', demoController.startSession);
router.post('/demo/send', demoController.sendMessage);
router.post('/demo/upload', demoController.uploadMiddleware, demoController.uploadFile);
router.get('/demo/:conversationId/history', demoController.getHistory);

module.exports = router;
