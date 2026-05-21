// MVC/controllers/userImportController.js
const createImportController = require('./importControllerFactory');
const dataService = require('../services/dataService');

// Import constants
const { FREE_ORG_ID } = require('../../config/constants'); 

// Helper for consistent boolean parsing
function parseBool(v) {
  if (typeof v === 'boolean') return v;
  return String(v || '').toLowerCase().trim() === 'true' || String(v) === '1';
}

// Build a consistent user object from a CSV row
async function processUserRecord(record, context) {
  const { userId, requestingUser } = context || {};
  const now = new Date().toISOString();

  const email = (record.email || '').trim();
  const personId = record.personId ? String(record.personId).trim() : null;

  const status = (record.status || 'pending').trim();
  const registrationSource = (record.registrationSource || 'org_invite').trim();
  const accessLevel = parseInt(record.accessLevel || '1', 10);

  // Determine Primary Org (Context)
  // If CSV has primaryOrgId, use it. Otherwise, default to Free/Null.
  const primaryOrgId = record.primaryOrgId 
    ? Number(record.primaryOrgId) 
    : FREE_ORG_ID;

  const userItem = {
    active: parseBool(record.active),
    email,
    username: (record.username || '').trim() || null,
    passwordHash: (record.passwordHash || '').trim() || null,

    status,
    registrationSource,
    personId,
    accessLevel,
    primaryOrgId: primaryOrgId,
    isEmailVerified: parseBool(record.isEmailVerified),
    lastLoginAt: record.lastLoginAt ? String(record.lastLoginAt).trim() : null,

    audit: {
      createUser: userId || null,
      createDateTime: now,
      lastUpdateUser: userId || null,
      lastUpdateDateTime: now
    }
  };

  // Save via model
  // Note: Model validates data (checks email, personId, etc.)
  await dataService.addData('users', userItem, requestingUser || null);

  return userItem;
}

// job-level context (current user)
function buildContext(req) {
  return {
    userId: req.user ? req.user.id : null,
    requestingUser: req.user || null
  };
}

const usersImportController = createImportController({
  downloadRouteBase: '/users/import/report',
  processRecord: processUserRecord,
  buildContext
});

module.exports = usersImportController;
