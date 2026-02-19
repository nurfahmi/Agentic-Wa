const REQUIRED_FIELDS = ['intent', 'confidence', 'required_action', 'eligibility_status', 'reason', 'escalate', 'reply_text'];

function validate(output) {
  try {
    const data = typeof output === 'string' ? JSON.parse(output) : output;

    // Check all required fields exist
    for (const field of REQUIRED_FIELDS) {
      if (data[field] === undefined) {
        return { valid: false, error: `Missing field: ${field}` };
      }
    }

    // Type validations
    if (typeof data.confidence !== 'number' || data.confidence < 0 || data.confidence > 1) {
      return { valid: false, error: 'confidence must be a number between 0 and 1' };
    }
    if (typeof data.escalate !== 'boolean') {
      return { valid: false, error: 'escalate must be a boolean' };
    }
    if (typeof data.reply_text !== 'string' || data.reply_text.length === 0) {
      return { valid: false, error: 'reply_text must be a non-empty string' };
    }

    const validStatuses = ['PENDING', 'PRE_ELIGIBLE', 'NOT_ELIGIBLE', 'REQUIRES_REVIEW'];
    if (!validStatuses.includes(data.eligibility_status)) {
      return { valid: false, error: `eligibility_status must be one of: ${validStatuses.join(', ')}` };
    }

    // GUARDRAIL: Never allow "APPROVED" or "ELIGIBLE" - only PRE_ELIGIBLE
    if (data.eligibility_status === 'APPROVED' || data.eligibility_status === 'ELIGIBLE') {
      data.eligibility_status = 'PRE_ELIGIBLE';
    }

    return { valid: true, data };
  } catch (error) {
    return { valid: false, error: `Invalid JSON: ${error.message}` };
  }
}

module.exports = { validate };
