const prisma = require('../config/database');
const logger = require('../utils/logger');
const orchestrator = require('../services/ai/orchestrator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const Tesseract = require('tesseract.js');

const MAX_FILE_SIZE = 150 * 1024; // 150KB

async function compressImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return filePath;

  const info = fs.statSync(filePath);
  if (info.size <= MAX_FILE_SIZE) return filePath;

  let quality = 80;
  let buf;
  while (quality >= 20) {
    buf = await sharp(filePath)
      .resize({ width: 1200, withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer();
    if (buf.length <= MAX_FILE_SIZE) break;
    quality -= 10;
  }

  const compressedPath = filePath.replace(/\.[^.]+$/, '.jpg');
  fs.writeFileSync(compressedPath, buf);
  if (compressedPath !== filePath) fs.unlinkSync(filePath);
  return compressedPath;
}

// Multer config for demo uploads
const demoUploadDir = path.join(__dirname, '../../uploads/demo');
if (!fs.existsSync(demoUploadDir)) fs.mkdirSync(demoUploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, demoUploadDir),
  filename: (req, file, cb) => cb(null, `demo-${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });
exports.uploadMiddleware = upload.single('file');

// Render demo page
exports.demoPage = async (req, res) => {
  try {
    res.render('dashboard/demo', { conversation: null });
  } catch (error) {
    logger.error('Demo page error:', error);
    res.render('dashboard/demo', { conversation: null });
  }
};

// Start new demo session
exports.startSession = async (req, res) => {
  try {
    // Close any existing demo conversation for this user
    await prisma.conversation.updateMany({
      where: { customerPhone: `demo-${req.user.id}`, status: { not: 'CLOSED' } },
      data: { status: 'CLOSED' },
    });

    // Generate unique dummy Malaysian phone number
    const prefix = ['11', '12', '13', '14', '15', '16', '17', '18', '19'][Math.floor(Math.random() * 9)];
    const num = String(Math.floor(Math.random() * 90000000) + 10000000);
    const dummyPhone = `60${prefix}${num}`;

    const conversation = await prisma.conversation.create({
      data: {
        waId: `demo-${req.user.id}-${Date.now()}`,
        customerPhone: dummyPhone,
        customerName: `Demo - ${req.user.name}`,
        status: 'AI_HANDLING',
        eligibility: 'PENDING',
        lastMessageAt: new Date(),
        metadata: { isDemo: true },
      },
    });

    res.json({ success: true, conversationId: conversation.id });
  } catch (error) {
    logger.error('Start demo session error:', error);
    res.status(500).json({ error: 'Failed to start demo session' });
  }
};

// Send message through live AI orchestrator
exports.sendMessage = async (req, res) => {
  try {
    const { conversationId, message } = req.body;
    if (!conversationId || !message) {
      return res.status(400).json({ error: 'conversationId and message required' });
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: parseInt(conversationId) },
      include: { escalations: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    // Store user message
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'INBOUND',
        type: 'TEXT',
        content: message,
        isAiGenerated: false,
      },
    });

    // Load AI settings once (same as messageWorker)
    const { getAiSettings } = require('../utils/getAiSettings');
    const aiSettings = await getAiSettings();

    // 1. If escalated within silence window, AI stays silent
    if (conversation.status === 'ESCALATED' && conversation.escalations.length > 0) {
      const silenceHours = parseInt(aiSettings.ai_silence_hours) || 24;
      const escalatedAt = conversation.escalations[0].createdAt;
      const hoursSince = (Date.now() - new Date(escalatedAt).getTime()) / (1000 * 60 * 60);
      if (hoursSince < silenceHours) {
        return res.json({
          success: true,
          reply: null,
          silent: true,
          debug: { reason: `Telah dieskalasi ${Math.round(hoursSince)}j lalu. AI diam sehingga ${silenceHours}j.` },
        });
      }
      // After silence window, resume AI handling
      await prisma.conversation.update({ where: { id: conversation.id }, data: { status: 'AI_HANDLING' } });
    }

    // 2. Check if conversation is already being handled by agent
    if (conversation.status === 'AGENT_HANDLING') {
      return res.json({
        success: true,
        reply: null,
        silent: true,
        debug: { reason: 'Perbualan sedang dikendalikan oleh pegawai. AI diam.' },
      });
    }

    // 3. Check manual keywords — if matched, flag for manual handling and skip AI
    const manualKws = (aiSettings.ai_manual_keywords || '').split(/[\n,]/).map(k => k.trim().toLowerCase()).filter(Boolean);
    if (manualKws.length > 0 && manualKws.some(kw => message.toLowerCase().includes(kw))) {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date(), status: 'AGENT_HANDLING', metadata: { isDemo: true, needsManualReply: true, manualTriggeredAt: new Date().toISOString(), triggerMessage: message } },
      });
      return res.json({
        success: true,
        reply: null,
        silent: true,
        manualHandling: true,
        debug: { reason: 'Kata kunci manual dikesan. AI diam — menunggu balasan pegawai.' },
      });
    }

    // 4. Run through the full AI orchestrator pipeline
    const aiResult = await orchestrator.processMessage(conversation.id, message);

    // Check escalation and get duty agent
    const escalationService = require('../services/escalationService');
    const escalated = await escalationService.checkAutoEscalation(conversation.id, message, aiResult);

    let replyText = aiResult.reply_text;
    let replyImage = null;

    if (escalated && escalated.dutyAgent) {
      const phone = escalated.dutyAgent.phone.replace(/[\s\-\(\)]/g, '');
      const waPhone = phone.startsWith('0') ? '6' + phone : phone.startsWith('+') ? phone.slice(1) : phone;
      replyText = (aiSettings.ai_escalation_message || replyText)
        .replace(/{agent_name}/g, escalated.dutyAgent.name)
        .replace(/{agent_phone}/g, escalated.dutyAgent.phone)
        .replace(/{agent_wa_url}/g, `https://wa.me/${waPhone}`);
    }

    // Scam defense: attach image
    if (aiResult.intent === 'scam_defense' && aiSettings.ai_scam_defense_image) {
      replyImage = aiSettings.ai_scam_defense_image;
      if (aiSettings.ai_scam_defense_mode === 'exact') {
        replyText = aiSettings.ai_scam_defense_caption || replyText;
      }
    }

    // Store AI response
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        type: replyImage ? 'IMAGE' : 'TEXT',
        content: replyText,
        mediaUrl: replyImage || null,
        isAiGenerated: true,
      },
    });

    // Update conversation
    const updateData = { lastMessageAt: new Date() };
    if (aiResult.eligibility_status && aiResult.eligibility_status !== 'PENDING') {
      updateData.eligibility = aiResult.eligibility_status;
    }
    if (aiResult.confidence) updateData.aiConfidence = aiResult.confidence;
    if (escalated && escalated.escalated) updateData.status = 'ESCALATED';
    else if (aiResult.escalate) updateData.status = 'ESCALATED';

    await prisma.conversation.update({ where: { id: conversation.id }, data: updateData });

    res.json({
      success: true,
      reply: replyText,
      image: replyImage,
      debug: {
        intent: aiResult.intent,
        confidence: aiResult.confidence,
        required_action: aiResult.required_action,
        eligibility_status: aiResult.eligibility_status,
        escalate: aiResult.escalate,
        reason: aiResult.reason,
        dutyAgent: escalated?.dutyAgent?.name || null,
      },
    });
  } catch (error) {
    logger.error('Demo send message error:', error);
    res.status(500).json({ error: 'AI processing failed', detail: error.message });
  }
};

// Upload file → compress → OCR only
exports.uploadFile = async (req, res) => {
  try {
    const { conversationId } = req.body;
    if (!req.file || !conversationId) {
      return res.status(400).json({ error: 'File and conversationId required' });
    }

    const conversation = await prisma.conversation.findUnique({ where: { id: parseInt(conversationId) } });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    // Compress image (skip for non-image files like PDF)
    let compressedPath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
      compressedPath = await compressImage(req.file.path);
    }

    // Store document record
    const doc = await prisma.document.create({
      data: {
        conversationId: conversation.id,
        type: 'SALARY_SLIP',
        fileName: req.file.originalname,
        filePath: compressedPath,
        mimeType: req.file.mimetype,
        ocrStatus: 'PROCESSING',
      },
    });

    // Store user message about the upload
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'INBOUND',
        type: 'DOCUMENT',
        content: `[Dokumen dimuat naik: ${req.file.originalname}]`,
        isAiGenerated: false,
      },
    });

    // Run OCR / text extraction
    let ocrText = '';
    let ocrResult = {};
    try {
      if (ext === '.pdf') {
        // PDF: extract text using pdf-parse
        const pdfParse = require('pdf-parse');
        const pdfBuffer = fs.readFileSync(compressedPath);
        const pdfData = await pdfParse(pdfBuffer);
        ocrText = pdfData.text || '';
      } else {
        // Image: OCR with Tesseract
        const ocrPromise = Tesseract.recognize(compressedPath, 'eng+msa');
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('OCR timeout')), 20000));
        const { data: { text } } = await Promise.race([ocrPromise, timeoutPromise]);
        ocrText = text;
      }
      ocrResult = parseOcrText(ocrText);
      await prisma.document.update({
        where: { id: doc.id },
        data: { ocrResult, ocrStatus: 'COMPLETED' },
      });
    } catch (ocrErr) {
      logger.error('OCR error:', ocrErr.message);
      await prisma.document.update({ where: { id: doc.id }, data: { ocrStatus: 'FAILED' } });
      ocrResult = { error: 'OCR failed', document_valid: false };
    }

    // Send OCR result to AI
    const ocrMessage = ocrResult.document_valid
      ? `Pelanggan telah memuat naik slip gaji. Hasil OCR:\nNama: ${ocrResult.name}\nMajikan: ${ocrResult.employer}\nGaji: RM${ocrResult.monthly_salary}\nJenis: ${ocrResult.employment_type}\n\nSila semak dan proses kelayakan.`
      : `Pelanggan telah memuat naik dokumen (${req.file.originalname}). Teks yang dikesan:\n${ocrText.substring(0, 500)}\n\nSila analisa dokumen ini.`;

    const aiResult = await orchestrator.processMessage(conversation.id, ocrMessage);
    const { getAiSettings } = require('../utils/getAiSettings');
    const aiSettings = await getAiSettings();

    // Check escalation and get duty agent
    const escalationService = require('../services/escalationService');
    const escalated = await escalationService.checkAutoEscalation(conversation.id, ocrMessage, aiResult);

    let replyText = aiResult.reply_text;
    let replyImage = null;

    if (escalated && escalated.dutyAgent) {
      const phone = escalated.dutyAgent.phone.replace(/[\s\-\(\)]/g, '');
      const waPhone = phone.startsWith('0') ? '6' + phone : phone.startsWith('+') ? phone.slice(1) : phone;
      replyText = (aiSettings.ai_escalation_message || replyText)
        .replace(/{agent_name}/g, escalated.dutyAgent.name)
        .replace(/{agent_phone}/g, escalated.dutyAgent.phone)
        .replace(/{agent_wa_url}/g, `https://wa.me/${waPhone}`);
    }

    // Scam defense: attach image
    if (aiResult.intent === 'scam_defense' && aiSettings.ai_scam_defense_image) {
      replyImage = aiSettings.ai_scam_defense_image;
      if (aiSettings.ai_scam_defense_mode === 'exact') {
        replyText = aiSettings.ai_scam_defense_caption || replyText;
      }
    }

    // Store AI response
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        type: replyImage ? 'IMAGE' : 'TEXT',
        content: replyText,
        mediaUrl: replyImage || null,
        isAiGenerated: true,
      },
    });

    const updateData = { lastMessageAt: new Date() };
    if (aiResult.eligibility_status && aiResult.eligibility_status !== 'PENDING') {
      updateData.eligibility = aiResult.eligibility_status;
    }
    if (aiResult.confidence) updateData.aiConfidence = aiResult.confidence;
    if (escalated && escalated.escalated) updateData.status = 'ESCALATED';
    else if (aiResult.escalate) updateData.status = 'ESCALATED';
    await prisma.conversation.update({ where: { id: conversation.id }, data: updateData });

    res.json({
      success: true,
      reply: replyText,
      image: replyImage,
      ocr: ocrResult,
      debug: {
        intent: aiResult.intent,
        confidence: aiResult.confidence,
        required_action: aiResult.required_action,
        eligibility_status: aiResult.eligibility_status,
        escalate: aiResult.escalate,
        reason: aiResult.reason,
      },
    });
  } catch (error) {
    logger.error('Demo upload error:', error);
    res.status(500).json({ error: 'Upload processing failed', detail: error.message });
  }
};

// Get message history
exports.getHistory = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const conversation = await prisma.conversation.findUnique({
      where: { id: parseInt(conversationId) },
      include: {
        messages: { orderBy: { timestamp: 'asc' } },
        aiLogs: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });
    if (!conversation) return res.status(404).json({ error: 'Not found' });

    res.json({
      success: true,
      messages: conversation.messages,
      aiLogs: conversation.aiLogs,
      eligibility: conversation.eligibility,
      confidence: conversation.aiConfidence,
      status: conversation.status,
    });
  } catch (error) {
    logger.error('Demo get history error:', error);
    res.status(500).json({ error: 'Failed to get history' });
  }
};

// AI-based payslip data extraction — handles any format
async function parseOcrText(text) {
  const fallback = { name: '', employer: '', employment_type: '', monthly_salary: 0, document_valid: false };
  if (!text || text.trim().length < 10) return fallback;

  try {
    const OpenAI = require('openai');
    const { getOpenAIConfig } = require('../utils/getOpenAIConfig');
    const { apiKey, model } = await getOpenAIConfig();
    const openai = new OpenAI({ apiKey });

    const response = await openai.chat.completions.create({
      model: model || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Anda adalah parser slip gaji. Extract maklumat dari teks OCR slip gaji.

Output JSON sahaja:
{
  "name": "nama pekerja",
  "employer": "nama majikan/kementerian/jabatan",
  "employment_type": "TETAP atau KONTRAK",
  "monthly_salary": 0
}

PERATURAN:
- monthly_salary = gaji pokok/basic salary (bukan gaji bersih/net pay)
- Jika ada "GAJI POKOK" atau "BASIC SALARY", guna nilai itu
- Jika tidak pasti, guna jumlah pendapatan terbesar
- Jika tidak dapat kenal pasti field, letak string kosong atau 0
- employer: cari nama kementerian, jabatan, atau organisasi
- name: cari nama pekerja/pegawai`
        },
        { role: 'user', content: text.substring(0, 3000) }
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    return {
      name: parsed.name || '',
      employer: parsed.employer || '',
      employment_type: parsed.employment_type || '',
      monthly_salary: parseFloat(parsed.monthly_salary) || 0,
      document_valid: !!(parsed.name && parseFloat(parsed.monthly_salary) > 0),
    };
  } catch (err) {
    logger.error('AI payslip parse error:', err.message);
    return fallback;
  }
}

