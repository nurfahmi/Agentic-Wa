const prisma = require('../config/database');
const { DEFAULTS } = require('../utils/getAiSettings');
const multer = require('multer');
const path = require('path');

const upload = multer({
  storage: multer.diskStorage({
    destination: './uploads/settings',
    filename: (req, file, cb) => {
      cb(null, `scam-defense-${Date.now()}${path.extname(file.originalname)}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  },
});

exports.uploadMiddleware = upload.single('ai_scam_defense_image');

exports.aiSettingsPage = async (req, res) => {
  try {
    const settings = await prisma.siteSetting.findMany();
    const settingsMap = {};
    settings.forEach((s) => (settingsMap[s.key] = s.value));
    res.render('dashboard/ai-settings', { settings: settingsMap, defaults: DEFAULTS });
  } catch (error) {
    console.error('AI Settings error:', error);
    res.render('dashboard/ai-settings', { settings: {}, defaults: DEFAULTS });
  }
};

exports.updateAiSettings = async (req, res) => {
  try {
    const fields = [
      'ai_agent_name', 'ai_koperasi_name', 'ai_greeting_message',
      'ai_not_eligible_message', 'ai_escalation_message',
      'ai_product_info', 'ai_custom_instructions',
      'ai_escalation_triggers', 'ai_bad_words', 'ai_manual_keywords',
      'ai_competitor_keywords',
      'ai_greeting_mode', 'ai_not_eligible_mode', 'ai_escalation_mode',
      'ai_slip_mode', 'ai_scam_defense_caption', 'ai_scam_defense_mode',
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
    // Handle scam defense image upload
    if (req.file) {
      const imagePath = `/uploads/settings/${req.file.filename}`;
      await prisma.siteSetting.upsert({
        where: { key: 'ai_scam_defense_image' },
        update: { value: imagePath },
        create: { key: 'ai_scam_defense_image', value: imagePath },
      });
    }
    const { clearCache } = require('../utils/getAiSettings');
    clearCache();
    res.json({ success: true });
  } catch (error) {
    console.error('Update AI settings error:', error);
    res.status(500).json({ error: 'Failed to update AI settings' });
  }
};
