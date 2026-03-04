const prisma = require('../../config/database');
const logger = require('../../utils/logger');

/**
 * Normalize a phone number for comparison.
 * Strips +, spaces, dashes, and leading 0 for Malaysian numbers.
 */
function normalizePhone(phone) {
  if (!phone) return '';
  let n = phone.replace(/[\s\-\+\(\)]/g, '');
  // Convert 01x... to 601x...
  if (n.startsWith('0')) n = '6' + n;
  return n;
}

async function verify({ phone, name }) {
  try {
    if (!phone && !name) {
      return { found: false, reason: 'Tiada nombor atau nama diberikan' };
    }

    const results = [];

    // Search DutyAgent table
    const agents = await prisma.dutyAgent.findMany({ where: { active: true } });
    for (const agent of agents) {
      if (phone) {
        const normalizedInput = normalizePhone(phone);
        const normalizedAgent = normalizePhone(agent.phone);
        if (normalizedInput && normalizedAgent && normalizedInput === normalizedAgent) {
          results.push({ name: agent.name, source: 'duty_agent' });
        }
      }
      if (name) {
        if (agent.name.toLowerCase().includes(name.toLowerCase())) {
          // Avoid duplicates
          if (!results.some(r => r.name === agent.name)) {
            results.push({ name: agent.name, source: 'duty_agent' });
          }
        }
      }
    }

    // Search User table (admin staff)
    const users = await prisma.user.findMany({
      where: { status: 'ACTIVE' },
      select: { name: true, phone: true, role: true },
    });
    for (const user of users) {
      if (phone && user.phone) {
        const normalizedInput = normalizePhone(phone);
        const normalizedUser = normalizePhone(user.phone);
        if (normalizedInput && normalizedUser && normalizedInput === normalizedUser) {
          if (!results.some(r => r.name === user.name)) {
            results.push({ name: user.name, source: 'staff' });
          }
        }
      }
      if (name) {
        if (user.name.toLowerCase().includes(name.toLowerCase())) {
          if (!results.some(r => r.name === user.name)) {
            results.push({ name: user.name, source: 'staff' });
          }
        }
      }
    }

    if (results.length > 0) {
      return {
        found: true,
        staff_name: results.map(r => r.name).join(', '),
        reason: `Ya, ${results[0].name} adalah pegawai kami yang berdaftar.`,
      };
    }

    return {
      found: false,
      reason: 'Nombor atau nama ini BUKAN pegawai kami. Sila berhati-hati dengan penipuan.',
    };
  } catch (error) {
    logger.error('Staff verifier error:', error);
    return { found: false, reason: 'Verification system error' };
  }
}

module.exports = { verify };
