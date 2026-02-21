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
    const fields = ['site_name', 'waba_token', 'waba_phone_number_id', 'waba_verify_token', 'webhook_url', 'default_theme', 'openai_api_key'];
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
    // Clear OpenAI config cache so new key takes effect immediately
    const { clearCache } = require('../utils/getOpenAIConfig');
    clearCache();
    res.json({ success: true });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
};
