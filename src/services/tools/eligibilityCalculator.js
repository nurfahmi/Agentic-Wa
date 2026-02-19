const prisma = require('../../config/database');
const logger = require('../../utils/logger');

async function loadRules() {
  try {
    const rules = await prisma.koperasiRule.findMany({ where: { isActive: true } });
    const map = {};
    rules.forEach((r) => { map[r.ruleKey] = r.ruleValue; });
    return map;
  } catch (error) {
    logger.warn('Could not load rules from DB, using defaults');
    return {
      min_salary: '1800',
      max_age: '58',
      must_be_penjawat_awam: 'true',
      max_financing_amount: '200000',
      min_service_years: '1',
    };
  }
}

async function calculate({ is_penjawat_awam, monthly_salary, age, employer }) {
  try {
    const rules = await loadRules();
    const minSalary = parseFloat(rules.min_salary || '1800');
    const maxAge = parseInt(rules.max_age || '58');
    const mustBePenjawatAwam = rules.must_be_penjawat_awam !== 'false';

    let score = 0;
    const reasons = [];

    // Rule 1: Must be Penjawat Awam
    if (mustBePenjawatAwam) {
      if (is_penjawat_awam) {
        score += 30;
      } else {
        reasons.push('Bukan Penjawat Awam');
        return { eligible: false, score: 0, reason: reasons.join('; '), status: 'NOT_ELIGIBLE' };
      }
    }

    // Rule 2: Salary check (from DB rules)
    if (monthly_salary > minSalary) {
      score += 25;
      if (monthly_salary > 3000) score += 10;
      if (monthly_salary > 5000) score += 5;
    } else {
      reasons.push(`Gaji RM${monthly_salary} di bawah minimum RM${minSalary}`);
    }

    // Rule 3: Age check (from DB rules)
    if (age < maxAge) {
      score += 20;
      if (age < 50) score += 5;
    } else {
      reasons.push(`Umur ${age} melebihi had ${maxAge} tahun`);
    }

    // Rule 4: Not blacklisted
    const isBlacklisted = false; // TODO: Check blacklist table
    if (!isBlacklisted) {
      score += 10;
    } else {
      reasons.push('Disenarai hitam');
    }

    const eligible = score >= 65 && reasons.length === 0;

    return {
      eligible,
      score: Math.min(score, 100),
      reason: eligible ? 'Pra-Layak untuk pembiayaan' : reasons.join('; '),
      status: eligible ? 'PRE_ELIGIBLE' : 'NOT_ELIGIBLE',
    };
  } catch (error) {
    logger.error('Eligibility calculator error:', error);
    return { eligible: false, score: 0, reason: 'System error during calculation' };
  }
}

module.exports = { calculate };
