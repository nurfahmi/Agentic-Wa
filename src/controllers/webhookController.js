const crypto = require('crypto');
const config = require('../config');
const prisma = require('../config/database');
const logger = require('../utils/logger');
const { messageQueue } = require('../queues/messageQueue');
const { getWabaConfig } = require('../utils/getWabaConfig');

// GET /webhook - Verification
exports.verify = async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const waba = await getWabaConfig();
  if (mode === 'subscribe' && token === waba.verifyToken) {
    logger.info('Webhook verified');
    return res.status(200).send(challenge);
  }
  logger.warn('Webhook verification failed');
  return res.sendStatus(403);
};

// Verify webhook signature from Meta
exports.verifySignature = (req, res, buf) => {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature || !config.waba.appSecret) return; // skip if not configured at env level

  const expected = 'sha256=' + crypto.createHmac('sha256', config.waba.appSecret).update(buf).digest('hex');
  if (signature !== expected) {
    logger.warn('Webhook signature mismatch — possible spoofed request');
    throw new Error('Invalid webhook signature');
  }
};

// POST /webhook - Receive messages (auto-detects Official WABA vs Unofficial WA Gateway)
exports.receive = async (req, res) => {
  try {
    res.sendStatus(200); // Acknowledge immediately

    const body = req.body;

    // Detect payload format: Official WABA vs Unofficial WA Gateway
    if (body.object === 'whatsapp_business_account') {
      // === Official WABA (Meta) ===
      const entries = body.entry || [];
      for (const entry of entries) {
        const changes = entry.changes || [];
        for (const change of changes) {
          if (change.field !== 'messages') continue;
          const value = change.value;
          const messages = value.messages || [];
          const contacts = value.contacts || [];

          for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            const contact = contacts[i] || {};
            await processIncomingMessage(msg, contact);
          }
        }
      }
    } else if (body.event && ['message', 'messages.upsert'].includes(body.event)) {
      // === Unofficial WA Gateway — new messages ===
      await processUnofficialMessage(body);
    } else if (body.event) {
      // Known WA Gateway events we don't need to process (delivery receipts, presence, etc.)
      // Silently ignore
    } else if (body.object || body.entry) {
      // Known Meta events we don't process
    } else {
      logger.debug(`Webhook received unrecognized payload: ${JSON.stringify(body).substring(0, 200)}`);
    }
  } catch (error) {
    logger.error('Webhook receive error:', error);
  }
};

// ──────────────────────────────────────────────
// Shared: process after normalize + store
// ──────────────────────────────────────────────

async function handleAfterStore(conversation, normalized) {
  // Documents/images handling
  if (conversation.status === 'AI_HANDLING' && (normalized.type === 'IMAGE' || normalized.type === 'DOCUMENT')) {
    const { getAiSettings } = require('../utils/getAiSettings');
    const aiSettings = await getAiSettings();
    const slipMode = aiSettings.ai_slip_mode || 'smart_ocr';

    // Option 1: Auto escalate (no OCR, immediate escalation)
    if (slipMode === 'auto_escalate') {
      try {
        const whatsappService = require('../services/waAdapter');
        const escalationService = require('../services/escalationService');
        const dutyAgent = await escalationService.escalate(conversation.id, 'MANUAL', 'Pelanggan hantar dokumen — auto escalate');

        let replyText = aiSettings.ai_escalation_message || 'Terima kasih, dokumen telah diterima. Pegawai kami akan hubungi tuan/puan.';
        if (dutyAgent) {
          const phone = dutyAgent.phone.replace(/[\s\-\(\)]/g, '');
          const waPhone = phone.startsWith('0') ? '6' + phone : phone.startsWith('+') ? phone.slice(1) : phone;
          replyText = replyText
            .replace(/{agent_name}/g, dutyAgent.name)
            .replace(/{agent_phone}/g, dutyAgent.phone)
            .replace(/{agent_wa_url}/g, `https://wa.me/${waPhone}`);
        }

        await whatsappService.sendText(conversation.customerPhone, replyText);
        await prisma.message.create({
          data: { conversationId: conversation.id, direction: 'OUTBOUND', type: 'TEXT', content: replyText, isAiGenerated: true },
        });
        logger.info(`Conversation ${conversation.id} auto-escalated: document received → ${dutyAgent?.name || 'no agent'}`);
      } catch (err) {
        logger.error('Auto escalate error:', err);
      }
      return;
    }

    // Option 2: Smart OCR (download → extract text → AI processes)
    try {
      const whatsappService = require('../services/waAdapter');
      const path = require('path');
      const fs = require('fs');

      const uploadDir = path.join(__dirname, '../../uploads/wa');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

      let filePath = null;
      try {
        filePath = await whatsappService.downloadMedia(normalized.mediaUrl, uploadDir, normalized.mediaType);
      } catch (dlErr) {
        logger.error('Media download failed:', dlErr.message);
      }

      let ocrText = '';
      if (filePath) {
        const ext = path.extname(filePath).toLowerCase();
        try {
          if (ext === '.pdf') {
            const pdfParse = require('pdf-parse');
            const buf = fs.readFileSync(filePath);
            const pdfData = await pdfParse(buf);
            ocrText = pdfData.text || '';
          } else if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
            const Tesseract = require('tesseract.js');
            const { data: { text } } = await Tesseract.recognize(filePath, 'eng+msa');
            ocrText = text;
          }
        } catch (ocrErr) {
          logger.error('OCR/PDF extraction failed:', ocrErr.message);
        }
      }

      const parsed = await parsePayslipText(ocrText);
      const ocrMessage = parsed.document_valid
        ? `Pelanggan telah memuat naik slip gaji. Hasil OCR:\nNama: ${parsed.name}\nMajikan: ${parsed.employer}\nGaji: RM${parsed.monthly_salary}\nJenis: ${parsed.employment_type}\n\nSila semak dan proses kelayakan.`
        : ocrText
          ? `Pelanggan telah memuat naik dokumen (${normalized.content}). Teks yang dikesan:\n${ocrText.substring(0, 500)}\n\nSila analisa dokumen ini.`
          : `Pelanggan telah memuat naik dokumen (${normalized.content}). Tidak dapat membaca teks dari dokumen ini.`;

      await messageQueue.add('process', {
        conversationId: conversation.id,
        messageContent: ocrMessage,
        messageType: normalized.type,
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      });
      logger.info(`Queued AI processing for document in conversation ${conversation.id}`);
    } catch (error) {
      logger.error('Document processing error:', error);
    }
    return;
  }

  // Text messages → AI processing
  if (conversation.status === 'AI_HANDLING' && normalized.content) {
    await messageQueue.add('process', {
      conversationId: conversation.id,
      messageContent: normalized.content,
      messageType: normalized.type,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
    logger.info(`Queued AI processing for conversation ${conversation.id}`);
  }
}

// AI-based payslip data extraction — handles any format
async function parsePayslipText(text) {
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

// ──────────────────────────────────────────────
// Official WABA message processing
// ──────────────────────────────────────────────

async function processIncomingMessage(msg, contact) {
  try {
    const waId = msg.from;
    const customerName = contact.profile?.name || null;

    // Deduplicate
    if (msg.id) {
      const existing = await prisma.message.findUnique({ where: { waMessageId: msg.id } });
      if (existing) {
        logger.debug(`Duplicate webhook message ${msg.id}, skipping`);
        return;
      }
    }

    // Find or create conversation
    let conversation = await prisma.conversation.findUnique({ where: { waId } });
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: { waId, customerPhone: waId, customerName, status: 'AI_HANDLING' },
      });
    }

    const normalized = normalizeMessage(msg);

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        waMessageId: msg.id,
        direction: 'INBOUND',
        type: normalized.type,
        content: normalized.content,
        mediaUrl: normalized.mediaUrl,
        mediaType: normalized.mediaType,
        timestamp: new Date(parseInt(msg.timestamp) * 1000),
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date(), customerName: customerName || conversation.customerName },
    });

    await handleAfterStore(conversation, normalized);
    logger.info(`Message received from ${waId}: ${normalized.type}`);
  } catch (error) {
    logger.error('Process message error:', error);
  }
}

// ──────────────────────────────────────────────
// Unofficial WA Gateway message processing
// ──────────────────────────────────────────────

async function processUnofficialMessage(body) {
  try {
    let data = body.data;
    if (Array.isArray(data)) data = data[0];
    if (!data || !data.key) {
      logger.debug('Unofficial webhook: no data or key found');
      return;
    }

    // Skip outgoing messages
    if (data.key.fromMe) return;

    const remoteJid = data.key.remoteJid || '';
    // Skip status broadcasts and group messages
    if (remoteJid === 'status@broadcast' || remoteJid.endsWith('@g.us')) return;

    const waId = remoteJid.replace('@s.whatsapp.net', '');
    if (!waId) return;

    const customerName = body.senderInfo?.contactName || data.pushName || null;
    const messageId = data.key.id || `unofficial-${Date.now()}`;

    // Deduplicate
    const existing = await prisma.message.findUnique({ where: { waMessageId: messageId } });
    if (existing) {
      logger.debug(`Duplicate unofficial message ${messageId}, skipping`);
      return;
    }

    // Find or create conversation
    let conversation = await prisma.conversation.findUnique({ where: { waId } });
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: { waId, customerPhone: waId, customerName, status: 'AI_HANDLING' },
      });
    }

    // Normalize unofficial message format
    const msg = data.message || {};
    const normalized = normalizeUnofficialMessage(msg);

    const timestamp = data.messageTimestamp
      ? new Date(parseInt(data.messageTimestamp) * 1000)
      : new Date();

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        waMessageId: messageId,
        direction: 'INBOUND',
        type: normalized.type,
        content: normalized.content,
        mediaUrl: normalized.mediaUrl,
        mediaType: normalized.mediaType,
        timestamp,
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date(), customerName: customerName || conversation.customerName },
    });

    await handleAfterStore(conversation, normalized);
    logger.info(`Unofficial message from ${waId}: ${normalized.content?.substring(0, 50)}`);
  } catch (error) {
    logger.error('Unofficial webhook error:', error);
  }
}

// ──────────────────────────────────────────────
// Message normalizers
// ──────────────────────────────────────────────

function normalizeMessage(msg) {
  const result = { type: 'TEXT', content: '', mediaUrl: null, mediaType: null };

  switch (msg.type) {
    case 'text':
      result.type = 'TEXT';
      result.content = msg.text?.body || '';
      break;
    case 'image':
      result.type = 'IMAGE';
      result.content = msg.image?.caption || '[Image]';
      result.mediaUrl = msg.image?.id;
      result.mediaType = msg.image?.mime_type;
      break;
    case 'document':
      result.type = 'DOCUMENT';
      result.content = msg.document?.filename || '[Document]';
      result.mediaUrl = msg.document?.id;
      result.mediaType = msg.document?.mime_type;
      break;
    case 'audio':
      result.type = 'AUDIO';
      result.content = '[Audio]';
      result.mediaUrl = msg.audio?.id;
      result.mediaType = msg.audio?.mime_type;
      break;
    default:
      result.content = `[${msg.type || 'Unknown'}]`;
  }

  return result;
}

function normalizeUnofficialMessage(msg) {
  const result = { type: 'TEXT', content: '', mediaUrl: null, mediaType: null };

  if (msg.imageMessage) {
    result.type = 'IMAGE';
    result.content = msg.imageMessage.caption || '[Gambar]';
    result.mediaUrl = msg.imageMessage.url || null;
    result.mediaType = msg.imageMessage.mimetype || 'image/jpeg';
  } else if (msg.documentMessage) {
    result.type = 'DOCUMENT';
    result.content = msg.documentMessage.fileName || '[Dokumen]';
    result.mediaUrl = msg.documentMessage.url || null;
    result.mediaType = msg.documentMessage.mimetype || 'application/octet-stream';
  } else if (msg.videoMessage) {
    result.type = 'VIDEO';
    result.content = msg.videoMessage.caption || '[Video]';
    result.mediaUrl = msg.videoMessage.url || null;
    result.mediaType = msg.videoMessage.mimetype || 'video/mp4';
  } else if (msg.audioMessage) {
    result.type = 'AUDIO';
    result.content = '[Audio]';
    result.mediaUrl = msg.audioMessage.url || null;
    result.mediaType = msg.audioMessage.mimetype || 'audio/ogg';
  } else if (msg.locationMessage) {
    result.type = 'LOCATION';
    result.content = `📍 ${msg.locationMessage.degreesLatitude}, ${msg.locationMessage.degreesLongitude}`;
  } else {
    result.content = msg.conversation || msg.extendedTextMessage?.text || '';
  }

  return result;
}
