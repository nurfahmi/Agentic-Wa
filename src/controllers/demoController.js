const prisma = require('../config/database');
const logger = require('../utils/logger');
const orchestrator = require('../services/ai/orchestrator');
const multer = require('multer');
const path = require('path');
const Tesseract = require('tesseract.js');

// Multer config for demo uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../../uploads/demo')),
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

    const conversation = await prisma.conversation.create({
      data: {
        waId: `demo-${req.user.id}-${Date.now()}`,
        customerPhone: `demo-${req.user.id}`,
        customerName: `Demo - ${req.user.name}`,
        status: 'AI_HANDLING',
        eligibility: 'PENDING',
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

    const conversation = await prisma.conversation.findUnique({ where: { id: parseInt(conversationId) } });
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

    // Run through the full AI orchestrator pipeline
    const aiResult = await orchestrator.processMessage(conversation.id, message);

    // Store AI response
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        type: 'TEXT',
        content: aiResult.reply_text,
        isAiGenerated: true,
      },
    });

    // Update conversation
    const updateData = { lastMessageAt: new Date() };
    if (aiResult.eligibility_status && aiResult.eligibility_status !== 'PENDING') {
      updateData.eligibility = aiResult.eligibility_status;
    }
    if (aiResult.confidence) updateData.aiConfidence = aiResult.confidence;
    if (aiResult.escalate) updateData.status = 'ESCALATED';

    await prisma.conversation.update({ where: { id: conversation.id }, data: updateData });

    res.json({
      success: true,
      reply: aiResult.reply_text,
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
    logger.error('Demo send message error:', error);
    res.status(500).json({ error: 'AI processing failed', detail: error.message });
  }
};

// Upload file → OCR → send extracted text to AI
exports.uploadFile = async (req, res) => {
  try {
    const { conversationId } = req.body;
    if (!req.file || !conversationId) {
      return res.status(400).json({ error: 'File and conversationId required' });
    }

    const conversation = await prisma.conversation.findUnique({ where: { id: parseInt(conversationId) } });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    // Store document record
    const doc = await prisma.document.create({
      data: {
        conversationId: conversation.id,
        type: 'SALARY_SLIP',
        fileName: req.file.originalname,
        filePath: req.file.path,
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

    // Run OCR  
    let ocrText = '';
    let ocrResult = {};
    try {
      const { data: { text } } = await Tesseract.recognize(req.file.path, 'eng+msa');
      ocrText = text;
      ocrResult = parseOcrText(text);
      await prisma.document.update({
        where: { id: doc.id },
        data: { ocrResult, ocrStatus: 'COMPLETED' },
      });
    } catch (ocrErr) {
      logger.error('OCR error:', ocrErr);
      await prisma.document.update({ where: { id: doc.id }, data: { ocrStatus: 'FAILED' } });
      ocrResult = { error: 'OCR failed', document_valid: false };
    }

    // Send OCR result to AI as context
    const ocrMessage = ocrResult.document_valid
      ? `Pelanggan telah memuat naik slip gaji. Hasil OCR:\nNama: ${ocrResult.name}\nMajikan: ${ocrResult.employer}\nGaji: RM${ocrResult.monthly_salary}\nJenis: ${ocrResult.employment_type}\n\nSila semak dan proses kelayakan.`
      : `Pelanggan telah memuat naik dokumen (${req.file.originalname}). Teks yang dikesan:\n${ocrText.substring(0, 500)}\n\nSila analisa dokumen ini.`;

    const aiResult = await orchestrator.processMessage(conversation.id, ocrMessage);

    // Store AI response
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        type: 'TEXT',
        content: aiResult.reply_text,
        isAiGenerated: true,
      },
    });

    const updateData = { lastMessageAt: new Date() };
    if (aiResult.eligibility_status && aiResult.eligibility_status !== 'PENDING') {
      updateData.eligibility = aiResult.eligibility_status;
    }
    if (aiResult.confidence) updateData.aiConfidence = aiResult.confidence;
    if (aiResult.escalate) updateData.status = 'ESCALATED';
    await prisma.conversation.update({ where: { id: conversation.id }, data: updateData });

    res.json({
      success: true,
      reply: aiResult.reply_text,
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

// Helper
function parseOcrText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const result = { name: '', employer: '', employment_type: '', monthly_salary: 0, document_valid: false };

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes('nama') || lower.includes('name')) {
      const m = line.match(/(?:nama|name)\s*[:\-]\s*(.+)/i);
      if (m) result.name = m[1].trim();
    }
    if (lower.includes('majikan') || lower.includes('employer') || lower.includes('jabatan') || lower.includes('kementerian')) {
      const m = line.match(/(?:majikan|employer|jabatan|kementerian)\s*[:\-]\s*(.+)/i);
      if (m) result.employer = m[1].trim();
    }
    if (lower.includes('gaji') || lower.includes('salary') || lower.includes('pendapatan')) {
      const m = line.match(/(?:rm|myr)?\s*([\d,]+\.?\d*)/i);
      if (m) result.monthly_salary = parseFloat(m[1].replace(/,/g, ''));
    }
    if (lower.includes('tetap') || lower.includes('permanent')) result.employment_type = 'TETAP';
    else if (lower.includes('kontrak') || lower.includes('contract')) result.employment_type = 'KONTRAK';
  }

  result.document_valid = !!(result.name && result.monthly_salary > 0);
  return result;
}
