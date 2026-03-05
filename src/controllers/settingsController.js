const prisma = require('../config/database');
const multer = require('multer');
const path = require('path');

const upload = multer({
  storage: multer.diskStorage({
    destination: './uploads/settings',
    filename: (req, file, cb) => {
      cb(null, `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`);
    },
  }),
});

exports.uploadMiddleware = upload.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'favicon', maxCount: 1 },
]);

exports.settingsPage = async (req, res) => {
  try {
    const settings = await prisma.siteSetting.findMany();
    const settingsMap = {};
    settings.forEach((s) => (settingsMap[s.key] = s.value));
    res.render('dashboard/settings', { settings: settingsMap });
  } catch (error) {
    console.error('Settings error:', error);
    res.render('dashboard/settings', { settings: {} });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const fields = [
      'site_name', 'default_theme', 'webhook_url', 'escalation_webhook_url',
      'wa_type', // 'official' or 'unofficial'
      'waba_token', 'waba_phone_number_id', 'waba_verify_token', 'waba_app_secret', 'waba_api_version',
      'wa_unofficial_base_url', 'wa_unofficial_session_id', 'wa_unofficial_api_key',
      'openai_api_key', 'openai_model',
      'ai_agent_name', 'ai_koperasi_name', 'ai_greeting_message',
      'ai_eligible_message', 'ai_not_eligible_message', 'ai_escalation_message',
      'ai_product_info', 'ai_custom_instructions',
      'ai_escalation_triggers', 'ai_silence_hours',
      'ai_competitor_keywords',
      'ai_greeting_mode', 'ai_eligible_mode', 'ai_not_eligible_mode', 'ai_escalation_mode',
      'ai_slip_mode',
    ];
    for (const key of fields) {
      if (req.body[key] !== undefined) {
        await prisma.siteSetting.upsert({
          where: { key },
          update: { value: req.body[key] },
          create: { key, value: req.body[key] },
        });
      }
    }
    // Handle file uploads
    if (req.files?.logo?.[0]) {
      await prisma.siteSetting.upsert({
        where: { key: 'logo' },
        update: { value: `/uploads/settings/${req.files.logo[0].filename}` },
        create: { key: 'logo', value: `/uploads/settings/${req.files.logo[0].filename}` },
      });
    }
    if (req.files?.favicon?.[0]) {
      await prisma.siteSetting.upsert({
        where: { key: 'favicon' },
        update: { value: `/uploads/settings/${req.files.favicon[0].filename}` },
        create: { key: 'favicon', value: `/uploads/settings/${req.files.favicon[0].filename}` },
      });
    }
    // Clear all caches so new values take effect immediately
    const { clearCache: clearOpenAI } = require('../utils/getOpenAIConfig');
    const { clearCache: clearWaba } = require('../utils/getWabaConfig');
    const { clearCache: clearAi } = require('../utils/getAiSettings');
    clearOpenAI();
    clearWaba();
    clearAi();
    const { clearCache: clearWaAdapter } = require('../services/waAdapter');
    const { clearCache: clearWaUnofficial } = require('../services/waUnofficialService');
    clearWaAdapter();
    clearWaUnofficial();
    res.json({ success: true });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
};
