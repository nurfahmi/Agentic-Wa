const prisma = require('../../config/database');
const logger = require('../../utils/logger');

async function validate({ employer_name }) {
  try {
    if (!employer_name) return { is_valid: false, reason: 'No employer name provided' };

    const searchTerm = employer_name.trim();

    // 1. Try direct contains match (case-insensitive via mode)
    let employers = await prisma.governmentEmployer.findMany({
      where: {
        isApproved: true,
        OR: [
          { name: { contains: searchTerm, mode: 'insensitive' } },
          { ministry: { contains: searchTerm, mode: 'insensitive' } },
          { code: { equals: searchTerm, mode: 'insensitive' } },
        ],
      },
    });

    // 2. If no match, try word-by-word search (handles "kem pendidikan" → "Kementerian Pendidikan")
    if (employers.length === 0) {
      const words = searchTerm.split(/\s+/).filter(w => w.length >= 3);
      if (words.length > 0) {
        employers = await prisma.governmentEmployer.findMany({
          where: {
            isApproved: true,
            AND: words.map(word => ({
              OR: [
                { name: { contains: word, mode: 'insensitive' } },
                { ministry: { contains: word, mode: 'insensitive' } },
              ],
            })),
          },
        });
      }
    }

    if (employers.length > 0) {
      const matched = employers[0];
      return {
        is_valid: true,
        employer: matched.name,
        ministry: matched.ministry,
        category: matched.category,
        reason: `Matched approved employer: ${matched.name}`,
      };
    }

    return {
      is_valid: false,
      reason: `Employer "${employer_name}" not found in approved Penjawat Awam list`,
    };
  } catch (error) {
    logger.error('Government validator error:', error);
    return { is_valid: false, reason: 'Validation system error' };
  }
}

module.exports = { validate };
