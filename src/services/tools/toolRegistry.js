const ocrTool = require('./ocrTool');
const governmentValidator = require('./governmentValidator');
const eligibilityCalculator = require('./eligibilityCalculator');
const staffVerifier = require('./staffVerifier');

// Tool definitions for OpenAI function calling
const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'ocr_extract',
      description: 'Extract information from uploaded salary slip or employment letter document using OCR',
      parameters: {
        type: 'object',
        properties: {
          document_id: { type: 'integer', description: 'The document ID to process' },
        },
        required: ['document_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'validate_government_staff',
      description: 'Validate if an employer is in the approved Penjawat Awam (government staff) list. Supports full names, acronyms (KPM, PDRM, JPA), and partial names. Returns eligible/not_eligible/ambiguous/not_found status.',
      parameters: {
        type: 'object',
        properties: {
          employer_name: { type: 'string', description: 'Name, acronym, or alias of the employer/ministry/agency to validate' },
        },
        required: ['employer_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculate_eligibility',
      description: 'Calculate financing eligibility based on applicant data. Only returns Pre-Eligible status, never final approval.',
      parameters: {
        type: 'object',
        properties: {
          is_penjawat_awam: { type: 'boolean', description: 'Whether the applicant is verified Penjawat Awam' },
          monthly_salary: { type: 'number', description: 'Monthly gross salary in RM' },
          age: { type: 'integer', description: 'Applicant age' },
          employer: { type: 'string', description: 'Employer name' },
        },
        required: ['is_penjawat_awam', 'monthly_salary', 'age'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'verify_staff',
      description: 'Verify if a phone number or name belongs to our registered staff/duty agent. Use when customer asks if someone is a real staff member.',
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string', description: 'Phone number to verify (any format)' },
          name: { type: 'string', description: 'Name to verify' },
        },
      },
    },
  },
];

// Tool executor map
const toolExecutors = {
  ocr_extract: ocrTool.extract,
  validate_government_staff: governmentValidator.validate,
  calculate_eligibility: eligibilityCalculator.calculate,
  verify_staff: staffVerifier.verify,
};

async function executeTool(toolName, args) {
  const executor = toolExecutors[toolName];
  if (!executor) throw new Error(`Unknown tool: ${toolName}`);
  return await executor(args);
}

module.exports = { toolDefinitions, executeTool };
