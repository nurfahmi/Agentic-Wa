const prisma = require('../../config/database');
const logger = require('../../utils/logger');

async function validate({ employer_name }) {
  try {
    if (!employer_name) return { is_valid: false, reason: 'No employer name provided' };

    // Search in approved government employers list
    const employers = await prisma.governmentEmployer.findMany({
      where: {
        isApproved: true,
        OR: [
          { name: { contains: employer_name } },
          { ministry: { contains: employer_name } },
          { code: employer_name },
        ],
      },
    });

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
