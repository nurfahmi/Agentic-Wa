const Tesseract = require('tesseract.js');
const prisma = require('../../config/database');
const logger = require('../../utils/logger');
const path = require('path');
const fs = require('fs');

async function extract({ document_id }) {
  try {
    const doc = await prisma.document.findUnique({ where: { id: document_id } });
    if (!doc) return { error: 'Document not found', document_valid: false };

    await prisma.document.update({ where: { id: document_id }, data: { ocrStatus: 'PROCESSING' } });

    let text = '';
    const ext = path.extname(doc.filePath || doc.fileName || '').toLowerCase();

    if (ext === '.pdf') {
      // PDF: use pdf-parse for text extraction
      const pdfParse = require('pdf-parse');
      const pdfBuffer = fs.readFileSync(doc.filePath);
      const pdfData = await pdfParse(pdfBuffer);
      text = pdfData.text || '';
    } else {
      // Image: use Tesseract OCR
      const { data: { text: ocrText } } = await Tesseract.recognize(doc.filePath, 'eng+msa', {
        logger: (m) => { if (m.status === 'recognizing text') logger.debug(`OCR progress: ${(m.progress * 100).toFixed(0)}%`); },
      });
      text = ocrText;
    }

    const result = parseOcrText(text);

    await prisma.document.update({
      where: { id: document_id },
      data: { ocrResult: result, ocrStatus: 'COMPLETED' },
    });

    return result;
  } catch (error) {
    logger.error('OCR extraction error:', error);
    await prisma.document.update({ where: { id: document_id }, data: { ocrStatus: 'FAILED' } }).catch(() => {});
    return { error: error.message, document_valid: false };
  }
}

function parseOcrText(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const result = {
    name: '',
    employer: '',
    employment_type: '',
    monthly_salary: 0,
    document_valid: false,
  };

  for (const line of lines) {
    const lowerLine = line.toLowerCase();

    // Name
    if (!result.name && (lowerLine.includes('nama') || lowerLine.includes('name'))) {
      const match = line.match(/(?:nama|name)\s*[:\-]\s*(.+)/i);
      if (match) result.name = match[1].trim();
    }

    // Employer: with separator
    if (!result.employer && (lowerLine.includes('majikan') || lowerLine.includes('employer'))) {
      const match = line.match(/(?:majikan|employer)\s*[:\-]\s*(.+)/i);
      if (match) result.employer = match[1].trim();
    }

    // Employer: standalone "KEMENTERIAN ..." or "JABATAN ..."
    if (!result.employer) {
      if (/^kementerian\s+/i.test(line)) result.employer = line.trim();
      else if (/^jabatan\s+/i.test(line) && !lowerLine.includes('jawatan')) result.employer = line.trim();
    }

    // Salary
    if (!result.monthly_salary && (lowerLine.includes('gaji') || lowerLine.includes('salary') || lowerLine.includes('pendapatan'))) {
      const match = line.match(/(?:rm|myr)?\s*([\d,]+\.?\d*)/i);
      if (match) {
        const val = parseFloat(match[1].replace(/,/g, ''));
        if (val > 100) result.monthly_salary = val;
      }
    }

    // Employment type
    if (lowerLine.includes('tetap') || lowerLine.includes('permanent')) result.employment_type = 'TETAP';
    else if (lowerLine.includes('kontrak') || lowerLine.includes('contract')) result.employment_type = 'KONTRAK';
  }

  result.document_valid = !!(result.name && result.monthly_salary > 0);
  return result;
}

module.exports = { extract };
