const Tesseract = require('tesseract.js');
const prisma = require('../../config/database');
const logger = require('../../utils/logger');
const path = require('path');

async function extract({ document_id }) {
  try {
    const doc = await prisma.document.findUnique({ where: { id: document_id } });
    if (!doc) return { error: 'Document not found', document_valid: false };

    await prisma.document.update({ where: { id: document_id }, data: { ocrStatus: 'PROCESSING' } });

    const { data: { text } } = await Tesseract.recognize(doc.filePath, 'eng+msa', {
      logger: (m) => { if (m.status === 'recognizing text') logger.debug(`OCR progress: ${(m.progress * 100).toFixed(0)}%`); },
    });

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

  // Simple pattern matching for salary slips
  for (const line of lines) {
    const lowerLine = line.toLowerCase();

    // Name patterns
    if (lowerLine.includes('nama') || lowerLine.includes('name')) {
      const match = line.match(/(?:nama|name)\s*[:\-]\s*(.+)/i);
      if (match) result.name = match[1].trim();
    }

    // Employer patterns
    if (lowerLine.includes('majikan') || lowerLine.includes('employer') || lowerLine.includes('jabatan') || lowerLine.includes('kementerian')) {
      const match = line.match(/(?:majikan|employer|jabatan|kementerian)\s*[:\-]\s*(.+)/i);
      if (match) result.employer = match[1].trim();
    }

    // Salary patterns
    if (lowerLine.includes('gaji') || lowerLine.includes('salary') || lowerLine.includes('pendapatan')) {
      const match = line.match(/(?:rm|myr)?\s*([\d,]+\.?\d*)/i);
      if (match) result.monthly_salary = parseFloat(match[1].replace(/,/g, ''));
    }

    // Employment type
    if (lowerLine.includes('tetap') || lowerLine.includes('permanent')) {
      result.employment_type = 'TETAP';
    } else if (lowerLine.includes('kontrak') || lowerLine.includes('contract')) {
      result.employment_type = 'KONTRAK';
    }
  }

  result.document_valid = !!(result.name && result.monthly_salary > 0);
  return result;
}

module.exports = { extract };
