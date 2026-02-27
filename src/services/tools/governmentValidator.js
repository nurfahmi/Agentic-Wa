const prisma = require('../../config/database');
const logger = require('../../utils/logger');

async function validate({ employer_name }) {
  try {
    if (!employer_name) return { is_valid: false, reason: 'No employer name provided' };

    const searchTerm = employer_name.trim();

    // 1. Try direct contains match
    let employers = await prisma.governmentEmployer.findMany({
      where: {
        OR: [
          { name: { contains: searchTerm } },
          { ministry: { contains: searchTerm } },
          { code: { equals: searchTerm } },
        ],
      },
    });

    // 2. If no match, try word-by-word search
    if (employers.length === 0) {
      const words = searchTerm.split(/\s+/).filter(w => w.length >= 3);
      if (words.length > 0) {
        employers = await prisma.governmentEmployer.findMany({
          where: {
            AND: words.map(word => ({
              OR: [
                { name: { contains: word } },
                { ministry: { contains: word } },
              ],
            })),
          },
        });
      }
    }

    if (employers.length > 0) {
      const matched = employers[0];
      
      if (!matched.isApproved) {
        return {
          is_valid: false,
          employer: matched.name,
          code: matched.code,
          sector: matched.sector,
          category: matched.category,
          reason: `Employer "${matched.name}" ditemui tetapi TIDAK LAYAK (Not Eligible)`,
        };
      }

      return {
        is_valid: true,
        employer: matched.name,
        code: matched.code,
        sector: matched.sector,
        category: matched.category,
        reason: `Majikan layak: ${matched.name} (${matched.sector || 'N/A'})`,
      };
    }

    return {
      is_valid: false,
      reason: `Majikan "${employer_name}" tidak ditemui dalam senarai Penjawat Awam`,
    };
  } catch (error) {
    logger.error('Government validator error:', error);
    return { is_valid: false, reason: 'Validation system error' };
  }
}

module.exports = { validate };
