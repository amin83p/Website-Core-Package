// MVC/controllers/personImportController.js
const createImportController = require('./importControllerFactory');
const dataService = require('../services/dataService'); // ✅ Use Data Service

// Helper
function parseBool(v) {
  return String(v || '').toLowerCase().trim() === 'true' || v === '1';
}

function buildInitialOrganizations(reqUser) {
  const now = new Date().toISOString();
  const activeOrgId = String(reqUser?.activeOrgId || '').trim();
  if (!activeOrgId) return [];

  const allowedOrgs = Array.isArray(reqUser?.allowedOrgs) ? reqUser.allowedOrgs : [];
  const orgMeta = allowedOrgs.find((o) => String(o?.orgId || '') === activeOrgId) || null;
  const rawRoles = Array.isArray(orgMeta?.roles)
    ? orgMeta.roles
    : (orgMeta?.role ? [orgMeta.role] : ['member']);
  const roles = rawRoles
    .map((r) => String(r || '').trim().toLowerCase())
    .filter(Boolean)
    .filter((r, idx, arr) => arr.indexOf(r) === idx);
  if (!roles.length) roles.push('member');

  return [{
    orgId: Number.isFinite(Number(activeOrgId)) ? Number(activeOrgId) : activeOrgId,
    name: String(orgMeta?.name || orgMeta?.orgName || '').trim(),
    roles,
    role: roles[0],
    memberStatus: 'active',
    joinedAt: now
  }];
}

// Build a consistent person object from a CSV row
async function processPersonRecord(record, context) {
  const { userId, reqUser } = context || {};
  const now = new Date().toISOString();

  // 1. Map Flat CSV fields to Nested Model Structure
  
  // Name Object
  const name = {
    first: (record.firstName || '').trim(),
    middle: (record.middleName || '').trim(),
    last: (record.lastName || '').trim(),
    preferred: (record.preferredName || '').trim()
  };

  // Demographics Object
  const demographics = {
    gender: (record.gender || '').trim(),
    dateOfBirth: record.dateOfBirth ? String(record.dateOfBirth).trim() : null
  };

  // Contact Arrays
  const emailVal = (record.email || '').trim();
  const emails = [];
  if (emailVal) {
    emails.push({ type: 'primary', email: emailVal, isPrimary: true });
  }

  const phoneVal = (record.phone || '').trim();
  const phoneAltVal = (record.phoneAlt || '').trim();
  const phones = [];
  if (phoneVal) phones.push({ type: 'mobile', number: phoneVal, isPrimary: true });
  if (phoneAltVal) phones.push({ type: 'home', number: phoneAltVal, isPrimary: false });

  // Address Array
  const addressLine1 = (record.addressLine1 || '').trim();
  const addresses = [];
  if (addressLine1) {
    addresses.push({
      line1: addressLine1,
      line2: (record.addressLine2 || '').trim(),
      city: (record.city || '').trim(),
      provinceState: (record.provinceState || '').trim(),
      postalCode: (record.postalCode || '').trim(),
      country: (record.country || '').trim(),
      type: 'primary',
      isPrimary: true
    });
  }

  // Tags
  const tags = record.tags
    ? String(record.tags).split(',').map(t => t.trim()).filter(Boolean)
    : [];

  // 2. Construct Person Object
  const person = {
    active: parseBool(record.active),
    name,
    demographics,
    contact: {
      emails,
      phones,
      email: emailVal // Legacy/Helper field
    },
    addresses,
    address: addresses[0] || {}, // Legacy/Helper field
    
    notes: (record.notes || '').trim(),
    tags,
    avatarUrl: (record.avatarUrl || '').trim(),
    
    organizations: buildInitialOrganizations(reqUser),

    audit: {
      createUser: userId || null,
      createDateTime: now,
      lastUpdateUser: userId || null,
      lastUpdateDateTime: now
    }
  };

  // 3. Save via Data Service
  // We pass { id: userId } as the requestingUser context for audit logging
  await dataService.addData('persons', person, { id: userId });

  return person;
}

// job-level context (current user)
function buildContext(req) {
  return { userId: req.user ? req.user.id : "1", reqUser: req.user || null };
}

const personsImportController = createImportController({
  downloadRouteBase: '/persons/import/report',
  processRecord: processPersonRecord,
  buildContext
});

module.exports = personsImportController;
