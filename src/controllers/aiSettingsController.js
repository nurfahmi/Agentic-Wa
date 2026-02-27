const prisma = require('../config/database');
const { DEFAULTS } = require('../utils/getAiSettings');

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
      'ai_eligible_message', 'ai_not_eligible_message', 'ai_escalation_message',
      'ai_slip_received_message', 'ai_product_info', 'ai_custom_instructions',
      'ai_escalation_triggers', 'ai_bad_words', 'ai_manual_keywords',
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
    const { clearCache } = require('../utils/getAiSettings');
    clearCache();
    res.json({ success: true });
  } catch (error) {
    console.error('Update AI settings error:', error);
    res.status(500).json({ error: 'Failed to update AI settings' });
  }
};
