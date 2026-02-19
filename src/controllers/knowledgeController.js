const prisma = require('../config/database');
const logger = require('../utils/logger');
const ragService = require('../services/rag/ragService');
const config = require('../config');
const OpenAI = require('openai');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// File upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../../uploads/knowledge')),
  filename: (req, file, cb) => cb(null, `kb-${Date.now()}-${file.originalname}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.doc', '.docx', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only PDF, Word, and TXT files allowed'));
  },
});
exports.uploadMiddleware = upload.single('file');

// Categories definition
const KB_CATEGORIES = [
  { value: 'FAQ', label: 'Soalan Lazim (FAQ)', desc: 'Soalan umum pelanggan' },
  { value: 'RULES', label: 'Peraturan Pembiayaan', desc: 'Syarat, kadar, had DSR' },
  { value: 'DOCUMENTS', label: 'Dokumen Diperlukan', desc: 'Senarai dokumen wajib' },
  { value: 'SOP', label: 'SOP & Prosedur', desc: 'Aliran kerja eskalasi' },
  { value: 'MINISTRY', label: 'Kementerian & Jabatan', desc: 'Senarai majikan kerajaan' },
  { value: 'PRODUCT', label: 'Produk & Perkhidmatan', desc: 'Info pakej pembiayaan' },
  { value: 'COMPLIANCE', label: 'Pematuhan & Undang-undang', desc: 'Akta, peraturan, garis panduan' },
  { value: 'GENERAL', label: 'Maklumat Am', desc: 'Lain-lain maklumat berguna' },
];

// Knowledge Base page
exports.knowledgePage = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const category = req.query.category || '';
    const limit = 20;
    const skip = (page - 1) * limit;

    const where = category ? { category } : {};
    const [items, total, catCounts] = await Promise.all([
      prisma.knowledgeBase.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      prisma.knowledgeBase.count({ where }),
      prisma.knowledgeBase.groupBy({ by: ['category'], _count: true }),
    ]);

    res.render('dashboard/knowledge', {
      items,
      page,
      totalPages: Math.ceil(total / limit),
      categories: KB_CATEGORIES,
      catCounts,
      selectedCategory: category,
    });
  } catch (error) {
    logger.error('Knowledge page error:', error);
    res.render('dashboard/knowledge', {
      items: [], page: 1, totalPages: 1,
      categories: KB_CATEGORIES, catCounts: [], selectedCategory: '',
    });
  }
};

// Guide page
exports.guidePage = async (req, res) => {
  res.render('dashboard/knowledge-guide', { categories: KB_CATEGORIES });
};

// Create entry (text)
exports.createEntry = async (req, res) => {
  try {
    const { category, title, content } = req.body;
    if (!category || !title || !content) {
      return res.status(400).json({ error: 'Category, title, and content are required' });
    }

    const entry = await prisma.knowledgeBase.create({ data: { category, title, content } });

    // Generate embeddings for RAG
    try {
      await ragService.indexKnowledgeBase(entry.id);
    } catch (e) {
      logger.warn('Embedding generation skipped:', e.message);
    }

    res.json({ success: true, entry });
  } catch (error) {
    logger.error('Create KB error:', error);
    res.status(500).json({ error: 'Failed to create entry' });
  }
};

// Update entry
exports.updateEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const { category, title, content, isActive } = req.body;

    const data = {};
    if (category) data.category = category;
    if (title) data.title = title;
    if (content) data.content = content;
    if (isActive !== undefined) data.isActive = isActive;

    const entry = await prisma.knowledgeBase.update({ where: { id: parseInt(id) }, data });

    // Re-generate embeddings if content changed
    if (content) {
      try {
        await ragService.indexKnowledgeBase(entry.id);
      } catch (e) {
        logger.warn('Embedding re-generation skipped:', e.message);
      }
    }

    res.json({ success: true, entry });
  } catch (error) {
    logger.error('Update KB error:', error);
    res.status(500).json({ error: 'Failed to update entry' });
  }
};

// Delete entry
exports.deleteEntry = async (req, res) => {
  try {
    const { id } = req.params;
    // Embeddings cascade-delete via Prisma relation
    await prisma.knowledgeBase.delete({ where: { id: parseInt(id) } });
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete KB error:', error);
    res.status(500).json({ error: 'Failed to delete entry' });
  }
};

// Toggle active status
exports.toggleEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const entry = await prisma.knowledgeBase.findUnique({ where: { id: parseInt(id) } });
    if (!entry) return res.status(404).json({ error: 'Not found' });

    const updated = await prisma.knowledgeBase.update({
      where: { id: parseInt(id) },
      data: { isActive: !entry.isActive },
    });
    res.json({ success: true, entry: updated });
  } catch (error) {
    logger.error('Toggle KB error:', error);
    res.status(500).json({ error: 'Failed to toggle entry' });
  }
};

// Upload file → extract text → create KB entry
exports.uploadFile = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { category, title } = req.body;
    if (!category) return res.status(400).json({ error: 'Category is required' });

    const ext = path.extname(req.file.originalname).toLowerCase();
    let text = '';

    if (ext === '.txt') {
      text = fs.readFileSync(req.file.path, 'utf-8');
    } else if (ext === '.pdf') {
      const pdfParse = require('pdf-parse');
      const buffer = fs.readFileSync(req.file.path);
      const data = await pdfParse(buffer);
      text = data.text;
    } else if (ext === '.doc' || ext === '.docx') {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: req.file.path });
      text = result.value;
    }

    if (!text.trim()) {
      return res.status(400).json({ error: 'Could not extract text from file' });
    }

    const entryTitle = title || req.file.originalname.replace(/\.[^.]+$/, '');
    const entry = await prisma.knowledgeBase.create({
      data: { category, title: entryTitle, content: text.trim() },
    });

    // Generate embeddings
    try {
      await ragService.indexKnowledgeBase(entry.id);
    } catch (e) {
      logger.warn('Embedding generation skipped:', e.message);
    }

    res.json({ success: true, entry, textLength: text.length });
  } catch (error) {
    logger.error('Upload KB error:', error);
    res.status(500).json({ error: 'Failed to process file' });
  }
};

// ========== WhatsApp Chat Import ==========

// Multer for bulk .txt upload
const waStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../../uploads/knowledge')),
  filename: (req, file, cb) => cb(null, `wa-${Date.now()}-${file.originalname}`),
});
const waUpload = multer({
  storage: waStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === '.txt') cb(null, true);
    else cb(new Error('Only .txt WhatsApp export files allowed'));
  },
});
exports.waUploadMiddleware = waUpload.array('files', 20);

// Parse WhatsApp chat export .txt
function parseWhatsAppChat(text) {
  const lines = text.split('\n');
  const messages = [];
  // Common WA export formats:
  // [15/01/2026, 10:30:42] Name: message
  // 15/01/2026, 10:30 - Name: message
  // 1/15/26, 10:30 AM - Name: message
  const patterns = [
    /^\[?(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}[:.]\d{2}(?:[:.]\d{2})?(?:\s*[APap][Mm])?)\]?\s*[-–]\s*([^:]+):\s*(.+)/,
    /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}[:.]\d{2}(?:[:.]\d{2})?(?:\s*[APap][Mm])?)\s*[-–]\s*([^:]+):\s*(.+)/,
  ];

  let currentMsg = null;

  for (const line of lines) {
    let matched = false;
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        if (currentMsg) messages.push(currentMsg);
        currentMsg = {
          date: match[1],
          time: match[2],
          sender: match[3].trim(),
          text: match[4].trim(),
        };
        matched = true;
        break;
      }
    }
    // Continuation of previous message
    if (!matched && currentMsg && line.trim()) {
      currentMsg.text += '\n' + line.trim();
    }
  }
  if (currentMsg) messages.push(currentMsg);

  return messages;
}

// Identify unique senders and guess who's customer vs agent
function analyzeSenders(messages) {
  const senderCounts = {};
  messages.forEach(m => {
    senderCounts[m.sender] = (senderCounts[m.sender] || 0) + 1;
  });
  return senderCounts;
}

// WhatsApp bulk import endpoint
exports.importWhatsApp = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    if (!config.openai.apiKey) {
      return res.status(400).json({ error: 'OpenAI API key required for chat analysis' });
    }

    const openai = new OpenAI({ apiKey: config.openai.apiKey });
    const results = [];

    for (const file of req.files) {
      try {
        const raw = fs.readFileSync(file.path, 'utf-8');
        const messages = parseWhatsAppChat(raw);

        if (messages.length < 5) {
          results.push({ file: file.originalname, status: 'skipped', reason: 'Too few messages' });
          continue;
        }

        const senders = analyzeSenders(messages);

        // Build a conversation sample (limit to keep within token limits)
        const sample = messages.slice(0, 200).map(m => `${m.sender}: ${m.text}`).join('\n');

        // Use AI to extract patterns
        const completion = await openai.chat.completions.create({
          model: config.openai.model,
          messages: [
            {
              role: 'system',
              content: `Anda adalah penganalisis perbualan koperasi pembiayaan. Analisis perbualan WhatsApp ini dan ekstrak maklumat berguna.

Output dalam JSON format sahaja:
{
  "faqs": [
    { "question": "soalan pelanggan", "answer": "jawapan terbaik", "frequency": "HIGH/MEDIUM/LOW" }
  ],
  "patterns": [
    { "title": "pola tajuk", "description": "penerangan pola customer behavior" }
  ],
  "common_phrases": ["frasa lazim pelanggan"],
  "pain_points": ["masalah yang sering dibangkitkan"],
  "summary": "ringkasan keseluruhan perbualan"
}`
            },
            {
              role: 'user',
              content: `Peserta perbualan: ${Object.entries(senders).map(([k, v]) => `${k} (${v} mesej)`).join(', ')}

Perbualan:
${sample}`
            }
          ],
          temperature: 0.3,
          response_format: { type: 'json_object' },
        });

        let analysis;
        try {
          analysis = JSON.parse(completion.choices[0].message.content);
        } catch (e) {
          results.push({ file: file.originalname, status: 'error', reason: 'AI response parse error' });
          continue;
        }

        const entriesCreated = [];

        // Create FAQ entries
        if (analysis.faqs && analysis.faqs.length > 0) {
          for (const faq of analysis.faqs) {
            const entry = await prisma.knowledgeBase.create({
              data: {
                category: 'FAQ',
                title: faq.question,
                content: `Soalan: ${faq.question}\nJawapan: ${faq.answer}\n\n(Diekstrak dari perbualan WhatsApp sebenar. Kekerapan: ${faq.frequency || 'N/A'})`,
              },
            });
            try { await ragService.indexKnowledgeBase(entry.id); } catch (e) {}
            entriesCreated.push(entry.id);
          }
        }

        // Create pattern entries
        if (analysis.patterns && analysis.patterns.length > 0) {
          const patternContent = analysis.patterns.map(p => `• ${p.title}: ${p.description}`).join('\n\n');
          const entry = await prisma.knowledgeBase.create({
            data: {
              category: 'GENERAL',
              title: `Pola Pelanggan - ${file.originalname}`,
              content: `Pola tingkah laku pelanggan yang dikenal pasti dari analisis WhatsApp:\n\n${patternContent}\n\nFrasa lazim: ${(analysis.common_phrases || []).join(', ')}\n\nMasalah utama: ${(analysis.pain_points || []).join(', ')}`,
            },
          });
          try { await ragService.indexKnowledgeBase(entry.id); } catch (e) {}
          entriesCreated.push(entry.id);
        }

        // Create summary entry
        if (analysis.summary) {
          const entry = await prisma.knowledgeBase.create({
            data: {
              category: 'GENERAL',
              title: `Ringkasan Perbualan - ${file.originalname}`,
              content: analysis.summary,
            },
          });
          try { await ragService.indexKnowledgeBase(entry.id); } catch (e) {}
          entriesCreated.push(entry.id);
        }

        results.push({
          file: file.originalname,
          status: 'success',
          messagesFound: messages.length,
          senders: Object.keys(senders).length,
          entriesCreated: entriesCreated.length,
          faqs: (analysis.faqs || []).length,
        });

      } catch (fileErr) {
        logger.error(`WA import error for ${file.originalname}:`, fileErr);
        results.push({ file: file.originalname, status: 'error', reason: fileErr.message });
      }
    }

    res.json({ success: true, results });
  } catch (error) {
    logger.error('WA import error:', error);
    res.status(500).json({ error: 'Import failed', detail: error.message });
  }
};
