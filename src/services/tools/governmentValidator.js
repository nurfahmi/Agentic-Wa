const prisma = require('../../config/database');
const logger = require('../../utils/logger');

async function validate({ employer_name }) {
  try {
    if (!employer_name) return { status: 'not_found', reason: 'No employer name provided' };

    const searchTerm = employer_name.trim();
    const searchLower = searchTerm.toLowerCase();

    // Load all employers (cached by Prisma connection pooling, small table)
    const allEmployers = await prisma.governmentEmployer.findMany();

    // Tier 1: Exact / contains match on name, ministry, or code
    let matches = allEmployers.filter(e =>
      e.name.toLowerCase().includes(searchLower) ||
      (e.ministry && e.ministry.toLowerCase().includes(searchLower)) ||
      (e.code && e.code.toLowerCase() === searchLower)
    );

    // Tier 2: Alias lookup — check comma-separated aliases field
    if (matches.length === 0) {
      matches = allEmployers.filter(e => {
        if (!e.aliases) return false;
        const aliasList = e.aliases.split(',').map(a => a.trim().toLowerCase());
        return aliasList.some(alias => alias === searchLower || alias.includes(searchLower) || searchLower.includes(alias));
      });
    }

    // Tier 3: Fuzzy word-by-word match
    if (matches.length === 0) {
      const words = searchTerm.split(/\s+/).filter(w => w.length >= 3);
      if (words.length > 0) {
        matches = allEmployers.filter(e => {
          const haystack = `${e.name} ${e.ministry || ''} ${e.aliases || ''}`.toLowerCase();
          return words.every(w => haystack.includes(w.toLowerCase()));
        });
      }
    }

    // No matches at all
    if (matches.length === 0) {
      return {
        status: 'not_found',
        reason: `Majikan "${employer_name}" tidak ditemui dalam senarai Penjawat Awam`,
      };
    }

    // Prioritize exact name match when multiple results found
    if (matches.length > 1) {
      const exact = matches.find(e =>
        e.name.toLowerCase() === searchLower ||
        (e.code && e.code.toLowerCase() === searchLower)
      );
      if (exact) matches = [exact];
    }

    // Single match
    if (matches.length === 1) {
      const m = matches[0];
      if (!m.isApproved) {
        return {
          status: 'not_eligible',
          employer: m.name,
          code: m.code,
          sector: m.sector,
          category: m.category,
          notes: m.notes || null,
          reason: `Majikan "${m.name}" ditemui tetapi TIDAK LAYAK`,
        };
      }
      return {
        status: 'eligible',
        employer: m.name,
        code: m.code,
        sector: m.sector,
        category: m.category,
        notes: m.notes || null,
        reason: `Majikan layak: ${m.name} (${m.sector || 'N/A'})`,
      };
    }

    // Multiple matches — check if all point to same eligibility
    const approved = matches.filter(m => m.isApproved);
    const notApproved = matches.filter(m => !m.isApproved);

    // If all approved or all not approved, and same ministry — treat as single
    if (notApproved.length === 0 && matches.every(m => m.ministry === matches[0].ministry)) {
      const m = matches[0];
      return {
        status: 'eligible',
        employer: m.name,
        code: m.code,
        sector: m.sector,
        category: m.category,
        notes: m.notes || null,
        reason: `Majikan layak: ${m.name} (${m.sector || 'N/A'})`,
      };
    }

    // Mixed results — ambiguous, need follow-up
    return {
      status: 'ambiguous',
      matches: matches.map(m => ({
        name: m.name,
        code: m.code,
        sector: m.sector,
        category: m.category,
        isApproved: m.isApproved,
        notes: m.notes || null,
      })),
      disambiguation_hint: matches.map(m => {
        const status = m.isApproved ? 'LAYAK' : 'TIDAK LAYAK';
        const note = m.notes ? ` (${m.notes})` : '';
        return `- ${m.name}: ${status}${note}`;
      }).join('\n'),
    };
  } catch (error) {
    logger.error('Government validator error:', error);
    return { status: 'not_found', reason: 'Validation system error' };
  }
}

module.exports = { validate };
