const router = require('express').Router();
const { authenticate, authorize } = require('../middlewares/auth');
const dashboardController = require('../controllers/dashboardController');
const userController = require('../controllers/userController');
const settingsController = require('../controllers/settingsController');
const chatController = require('../controllers/chatController');
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
router.post('/change-password', authorize('SUPERADMIN'), require('../controllers/authController').changePassword);

// AI Settings - Admin+ only
const aiSettingsController = require('../controllers/aiSettingsController');
router.get('/ai-settings', authorize('SUPERADMIN', 'ADMIN'), aiSettingsController.aiSettingsPage);
router.post('/ai-settings', authorize('SUPERADMIN', 'ADMIN'), aiSettingsController.updateAiSettings);

// Duty Agents - Admin+ only
const dutyAgentController = require('../controllers/dutyAgentController');
router.get('/duty-agents', authorize('SUPERADMIN', 'ADMIN'), dutyAgentController.listAgents);
router.post('/duty-agents', authorize('SUPERADMIN', 'ADMIN'), dutyAgentController.createAgent);
router.put('/duty-agents/:id', authorize('SUPERADMIN', 'ADMIN'), dutyAgentController.updateAgent);
router.post('/duty-agents/:id/toggle', authorize('SUPERADMIN', 'ADMIN'), dutyAgentController.toggleAgent);
router.delete('/duty-agents/:id', authorize('SUPERADMIN', 'ADMIN'), dutyAgentController.deleteAgent);
router.post('/duty-agents/reset', authorize('SUPERADMIN', 'ADMIN'), dutyAgentController.resetCounts);

// Agent Tiers - Admin+ only
router.post('/duty-agents/tiers', authorize('SUPERADMIN', 'ADMIN'), dutyAgentController.createTier);
router.put('/duty-agents/tiers/:id', authorize('SUPERADMIN', 'ADMIN'), dutyAgentController.updateTier);
router.delete('/duty-agents/tiers/:id', authorize('SUPERADMIN', 'ADMIN'), dutyAgentController.deleteTier);

// Chat Examples - Admin+ only
const chatExampleController = require('../controllers/chatExampleController');
router.get('/chat-examples', authorize('SUPERADMIN', 'ADMIN'), chatExampleController.listExamples);
router.post('/chat-examples', authorize('SUPERADMIN', 'ADMIN'), chatExampleController.addExample);
router.post('/chat-examples/upload', authorize('SUPERADMIN', 'ADMIN'), chatExampleController.uploadMiddleware, chatExampleController.uploadChat);
router.post('/chat-examples/clean', authorize('SUPERADMIN', 'ADMIN'), chatExampleController.cleanAll);
router.delete('/chat-examples/all', authorize('SUPERADMIN', 'ADMIN'), chatExampleController.deleteAll);
router.post('/chat-examples/:id/toggle', authorize('SUPERADMIN', 'ADMIN'), chatExampleController.toggleExample);
router.delete('/chat-examples/:id', authorize('SUPERADMIN', 'ADMIN'), chatExampleController.deleteExample);

module.exports = router;
