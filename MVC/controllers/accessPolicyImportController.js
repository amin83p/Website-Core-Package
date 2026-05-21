// MVC/controllers/accessPolicyImportController.js
const createImportController = require('./importControllerFactory');
const dataService = require('../services/dataService'); // ✅ Use Data Service

// Helper for boolean parsing
function parseBool(v) {
  return String(v || '').toLowerCase().trim() === 'true' || v === '1';
}

// Helper to safely parse JSON columns
function parseJsonColumn(jsonString, fieldName) {
  if (!jsonString || String(jsonString).trim() === '') return {}; 
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    console.warn(`Import Warning: Failed to parse JSON for field '${fieldName}'. Using empty object.`);
    return {};
  }
}

function parseJsonArray(jsonString, fieldName) {
  if (!jsonString || String(jsonString).trim() === '') return [];
  try {
    const arr = JSON.parse(jsonString);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn(`Import Warning: Failed to parse JSON Array for field '${fieldName}'. Using empty array.`);
    return [];
  }
}

// Build a consistent Policy object from a CSV row
async function processPolicyRecord(record, context) {
  const { userId } = context || {}; // The admin performing the import
  const now = new Date().toISOString();

  const targetUserId = (record.userId || '').trim();
  
  // Optional: Verify user existence via DataService
  // const userExists = await dataService.getDataById('users', targetUserId);
  // if (!userExists) throw new Error(`User ID ${targetUserId} not found.`);

  // 1. Parse Nested JSON Blocks from CSV Columns
  const network = parseJsonColumn(record.network, 'network');
  const security = parseJsonColumn(record.security, 'security');
  const sessionControl = parseJsonColumn(record.sessionControl, 'sessionControl');
  const globalSchedule = parseJsonColumn(record.globalSchedule, 'globalSchedule');
  
  // Sections is an array of objects
  const sections = parseJsonArray(record.sections, 'sections');

  // 2. Construct Policy Object
  const policy = {
    userId: targetUserId,
    policyName: (record.policyName || '').trim(),
    active: parseBool(record.active),

    validityPeriod: {
      startDate: record.validStartDate ? String(record.validStartDate).trim() : null,
      endDate: record.validEndDate ? String(record.validEndDate).trim() : null
    },

    network,        // { ipWhitelist: [], ipBlacklist: [] }
    security,       // { mfaRequired: true, ... }
    sessionControl, // { maxSessionDurationMinutes: 60, ... }
    globalSchedule, // { weekdays: { Monday: [...] } }
    sections,       // [ { sectionId: "SEC_1", timeLimits: {...} } ]

    audit: {
      createUser: userId || null,
      createDateTime: now,
      lastUpdateUser: userId || null,
      lastUpdateDateTime: now
    }
  };

  // 3. Save via Data Service
  // We pass { id: userId } as the requestingUser context for audit logging
  await dataService.addData('accessPolicies', policy, { id: userId });

  return policy;
}

// Job-level context
function buildContext(req) {
  return { userId: req.user ? req.user.id : "1" };
}

const accessPolicyImportController = createImportController({
  downloadRouteBase: '/accessPolicies/import/report',
  processRecord: processPolicyRecord,
  buildContext
});

module.exports = accessPolicyImportController;