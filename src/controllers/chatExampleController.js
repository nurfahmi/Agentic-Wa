const prisma = require('../config/database');
const multer = require('multer');
const OpenAI = require('openai');
const { getOpenAIConfig } = require('../utils/getOpenAIConfig');

const CATEGORY_TO_STAGE = {
  'greeting': 'greeting',
  'scam_defense': 'scam_defense',
  'eligibility_ask': 'employer_verify',
  'employer_check': 'employer_verify',
  'eligible': 'eligibility',
  'not_eligible': 'eligibility',
  'product_info': 'product_info',
  'escalation': 'escalation',
  'follow_up': 'follow_up',
  'staff_verify': 'staff_verify',
  'general': 'general',
};

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 20 } });
exports.uploadMiddleware = upload.array('chatFile', 20);

// List all examples with optional category filter + pagination
exports.listExamples = async (req, res) => {
  try {
    const where = {};
    if (req.query.category) where.category = req.query.category;

    const page = parseInt(req.query.page) || 1;
    const perPage = 20;

    const [examples, total] = await Promise.all([
      prisma.chatExample.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.chatExample.count({ where }),
    ]);

    const totalPages = Math.ceil(total / perPage);

    const categories = await prisma.$queryRaw`SELECT DISTINCT category FROM chat_examples ORDER BY category`;
    const cats = categories.map(c => c.category);

    // Get total active count for stats
    const totalAll = await prisma.chatExample.count();
    const totalActive = await prisma.chatExample.count({ where: { active: true } });

    if (req.query.json) return res.json({ examples, categories: cats, page, totalPages, total });
    res.render('dashboard/chat-examples', {
      examples, categories: cats, activeCategory: req.query.category || '',
      page, totalPages, total, totalAll, totalActive,
    });
  } catch (error) {
    console.error('List examples error:', error);
    res.render('dashboard/chat-examples', {
      examples: [], categories: [], activeCategory: '',
      page: 1, totalPages: 1, total: 0, totalAll: 0, totalActive: 0,
    });
  }
};

// Parse a single chat text via AI
async function parseChatText(text, openai, model) {
  const response = await openai.chat.completions.create({
    model: model || 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `Anda adalah parser chat WhatsApp. Tugas anda:
1. Baca chat export di bawah
2. Extract pasangan soalan-jawapan (customer → admin)
3. Kategorikan setiap pasangan

Kategori yang boleh digunakan:
- greeting (salam, pm, hi, berminat)
- scam_defense (tuduhan scam, tipu, penipuan)
- eligibility_ask (tanya kelayakan, syarat)
- employer_check (tanya kementerian, nama majikan)
- eligible (pelanggan layak, minta slip)
- not_eligible (pelanggan tidak layak)
- product_info (tanya kadar, jumlah, tempoh)
- escalation (hantar ke pegawai)
- follow_up (nak teruskan, berminat)
- general (lain-lain)

Output JSON dengan key "pairs":
{"pairs":[{"category":"greeting","customer":"pm","admin":"Salam tuan/puan, kerja di bawah kementerian mana?"}]}

PERATURAN:
- Skip mesej sistem (joined, left, created group, deleted)
- Skip mesej yang tiada balasan admin
- Customer = orang yang bertanya / memulakan perbualan
- Admin = orang yang menjawab / memberikan maklumat
- Gabungkan mesej berturut dari orang sama jadi satu
- Maksimum 50 pasangan paling berguna
- Jika tidak pasti siapa admin/customer, anggap yang menjawab soalan sebagai admin`
      },
      { role: 'user', content: text.substring(0, 15000) }
    ],
    temperature: 0.3,
    response_format: { type: 'json_object' },
  });

  const raw = response.choices[0].message.content;
  const content = JSON.parse(raw);
  return Array.isArray(content) ? content : (Object.values(content).find(v => Array.isArray(v)) || []);
}

// Upload and parse WhatsApp chat export (single or bulk)
exports.uploadChat = async (req, res) => {
  try {
    const files = req.files;
    if (!files || files.length === 0) return res.status(400).json({ error: 'Tiada fail dimuat naik' });

    const { apiKey, model } = await getOpenAIConfig();
    if (!apiKey) return res.status(400).json({ error: 'OpenAI API key belum dikonfigurasi. Sila tetapkan di Settings.' });

    const openai = new OpenAI({ apiKey });
    let totalCount = 0;
    const errors = [];

    for (const file of files) {
      try {
        const text = file.buffer.toString('utf-8');
        const pairs = await parseChatText(text, openai, model);
        if (!pairs.length) { errors.push(`${file.originalname}: tiada pasangan ditemui`); continue; }

        // Sanitize and filter
        const sanitizeReply = (text) => text
          .replace(/\*[^*]*\d{3}[^*]*\*/g, '*[pegawai bertugas]*')
          .replace(/\b0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, '[nombor pegawai]')
          .replace(/\b6\d{9,11}\b/g, '[nombor pegawai]');

        const validPairs = pairs
          .map(p => ({
            category: p.category || 'general',
            customerMessage: p.customer || p.customerMessage || '',
            adminReply: sanitizeReply(p.admin || p.adminReply || ''),
          }))
          .filter(p => p.customerMessage && p.adminReply);

        let added = 0;
        let skipped = 0;
        for (const pair of validPairs) {
          const exists = await prisma.chatExample.findFirst({
            where: { customerMessage: pair.customerMessage, adminReply: pair.adminReply },
          });
          if (exists) { skipped++; continue; }
          await prisma.chatExample.create({ data: { ...pair, stage: CATEGORY_TO_STAGE[pair.category] || 'general' } });
          added++;
        }

        totalCount += added;
        if (skipped > 0) errors.push(`${file.originalname}: ${skipped} duplikasi dilangkau`);
        console.log(`Parsed ${file.originalname}: ${added} added, ${skipped} skipped`);
      } catch (e) {
        console.error(`Error parsing ${file.originalname}:`, e.message);
        errors.push(`${file.originalname}: ${e.message}`);
      }
    }

    res.json({ success: true, count: totalCount, files: files.length, errors });
  } catch (error) {
    console.error('Upload chat error:', error);
    res.status(500).json({ error: 'Gagal memproses chat: ' + error.message });
  }
};

// Add single example manually
exports.addExample = async (req, res) => {
  try {
    const { category, customerMessage, adminReply, priority, isNegative } = req.body;
    if (!category || !customerMessage || !adminReply) {
      return res.status(400).json({ error: 'Semua medan diperlukan' });
    }
    await prisma.chatExample.create({
      data: {
        category,
        customerMessage,
        adminReply,
        stage: CATEGORY_TO_STAGE[category] || 'general',
        priority: parseInt(priority) || 5,
        isNegative: isNegative === 'true' || isNegative === true,
      },
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Add example error:', error);
    res.status(500).json({ error: 'Gagal menambah contoh' });
  }
};

// Toggle active
exports.toggleExample = async (req, res) => {
  try {
    const { id } = req.params;
    const ex = await prisma.chatExample.findUnique({ where: { id: parseInt(id) } });
    if (!ex) return res.status(404).json({ error: 'Tidak ditemui' });
    await prisma.chatExample.update({ where: { id: parseInt(id) }, data: { active: !ex.active } });
    res.json({ success: true, active: !ex.active });
  } catch (error) {
    res.status(500).json({ error: 'Gagal' });
  }
};

// Delete
exports.deleteExample = async (req, res) => {
  try {
    await prisma.chatExample.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Gagal padam' });
  }
};

// Delete all
exports.deleteAll = async (req, res) => {
  try {
    await prisma.chatExample.deleteMany({});
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Gagal padam semua' });
  }
};

// Clean all existing examples (sanitize phone numbers and agent names)
exports.cleanAll = async (req, res) => {
  try {
    const all = await prisma.chatExample.findMany();
    let cleaned = 0;
    for (const ex of all) {
      const sanitized = ex.adminReply
        .replace(/\*[^*]*\d{3}[^*]*\*/g, '*[pegawai bertugas]*')
        .replace(/\b0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, '[nombor pegawai]')
        .replace(/\b6\d{9,11}\b/g, '[nombor pegawai]');
      if (sanitized !== ex.adminReply) {
        await prisma.chatExample.update({ where: { id: ex.id }, data: { adminReply: sanitized } });
        cleaned++;
      }
    }
    res.json({ success: true, cleaned });
  } catch (error) {
    res.status(500).json({ error: 'Gagal membersihkan data' });
  }
};
