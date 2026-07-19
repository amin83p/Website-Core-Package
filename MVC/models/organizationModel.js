// MVC/models/organizationModel.js
const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { applyGenericFilter } = require('../utils/queryEngine');
const { toIdArray, toPublicId, idsEqual } = require('../utils/idAdapter');
const { getEntityQueryExecutor } = require('./queryExecutionBridge');
const { isValidTimezoneToken } = require('../utils/timezoneUtils');

// ✅ Match your sectionModel style: data folder beside models
const dataPath = path.join(__dirname, '../../data/organizations.json');

async function getAllOrganizations() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    console.error('Error reading organizations.json:', error);
    throw new Error('Failed to retrieve organizations');
  }
}

function applyOrganizationScope(rows, scope = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (scope?.canViewAll !== false) return list;

  const allowedOrgIds = Array.isArray(scope?.orgIds)
    ? new Set(toIdArray(scope.orgIds))
    : null;

  if (allowedOrgIds && allowedOrgIds.size > 0) {
    return list.filter((row) => allowedOrgIds.has(toPublicId(row?.id)));
  }

  return [];
}

function buildOrganizationQueryPlan(options = {}) {
  const query = options?.query || {};
  const incomingScope = options?.scope || {};

  return {
    entity: 'organizations',
    query,
    scope: {
      canViewAll: incomingScope?.canViewAll !== false,
      orgIds: Array.isArray(incomingScope?.orgIds) ? toIdArray(incomingScope.orgIds) : []
    },
    projection: options?.projection || null,
    pagination: options?.pagination || null,
    sort: options?.sort || null,
    fallback: {
      defaultSearchFields: ['id', 'name', 'ownerId', 'status', 'address.city', 'address.country'],
      dateFields: ['startedAt', 'createdAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
    }
  };
}

async function queryOrganizations(options = {}) {
  const plan = buildOrganizationQueryPlan(options);
  const executor = getEntityQueryExecutor('organizations');

  // Future DB adapter path (Mongo/NoSQL): if registered, model delegates query execution.
  if (typeof executor === 'function') {
    const result = await executor(plan);
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.items)) return result.items;
  }

  // JSON fallback path: keep existing behavior while migration is in progress.
  const getAllOrganizationsFn = module.exports?.getAllOrganizations;
  const allOrganizations = await (typeof getAllOrganizationsFn === 'function'
    ? getAllOrganizationsFn()
    : getAllOrganizations());
  const scopedOrganizations = applyOrganizationScope(allOrganizations, plan.scope);
  return applyGenericFilter(scopedOrganizations, plan.query, plan.fallback);
}

async function getOrganizationById(id) {
  const orgs = await getAllOrganizations();
  return orgs.find((o) => idsEqual(o?.id, id));
}

function generateId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function validateEmail(email) {
  if (!email) return true;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).trim());
}

function validateData(org) {
  const errors = [];

  if (!org || typeof org !== 'object') {
    return { isValid: false, errors: ['Organization object is required.'] };
  }

  // Required identity
  if (!org.identity?.legalName || !String(org.identity.legalName).trim()) {
    errors.push('identity.legalName is required.');
  }

  if (!org.identity?.displayName || !String(org.identity.displayName).trim()) {
    errors.push('identity.displayName is required.');
  }

  // active boolean
  if (typeof org.active !== 'boolean') {
    errors.push('active must be true/false.');
  }

  // contact emails (optional but validated)
  if (org.contact?.email && !validateEmail(org.contact.email)) {
    errors.push('contact.email is invalid.');
  }
  if (org.billing?.billingEmail && !validateEmail(org.billing.billingEmail)) {
    errors.push('billing.billingEmail is invalid.');
  }

  const orgTimeZone = String(org.settings?.timeZone || org.settings?.timezone || '').trim();
  if (orgTimeZone && !isValidTimezoneToken(orgTimeZone)) {
    errors.push('settings.timeZone must be a valid IANA timezone.');
  }

  // contracts array
  if (org.contracts && !Array.isArray(org.contracts)) {
    errors.push('contracts must be an array.');
  }

  // audit (allow null for system/self-created orgs)
  const audit = org.audit || {};
  if (audit.createUser === null) {
    errors.push('Creator User must be provided.');
  }else if (typeof audit.createUser !== 'string') {
    errors.push('Creator User data type is not valid.');
  }

  if (audit.lastUpdateUser === null) {
    errors.push('Update User must be provided.');
  }else if (typeof audit.lastUpdateUser !== 'string') {
    errors.push('Update User data type is not valid.');
  }

  return errors.length
    ? { isValid: false, errors }
    : { isValid: true };
}

async function addOrganization(org) {
  await queueWrite(async () => {
    const orgs = await getAllOrganizations();

    org.id = generateId();

    // Unique displayName (case-insensitive)
    const dn = String(org.identity.displayName).toLowerCase();
    const dup = orgs.find(o =>
      String(o.identity?.displayName || '').toLowerCase() === dn
    );
    if (dup) throw new Error('Organization display name already exists.');

    const validity = validateData(org);
    if (!validity.isValid) throw new Error(validity.errors.join('\r\n'));

    orgs.push(org);
    await fs.writeFile(dataPath, JSON.stringify(orgs, null, 2));
    return org;
  });
}

async function updateOrganization(id, updates) {
  await queueWrite(async () => {
    const orgs = await getAllOrganizations();
    const index = orgs.findIndex((o) => idsEqual(o?.id, id));
    if (index === -1) throw new Error('Organization not found');

    const current = orgs[index];

    // Deep merge main nested blocks
    const merged = {
      ...current,
      ...updates,
      identity: { ...current.identity, ...(updates.identity || {}) },
      contact: {
        ...current.contact,
        ...(updates.contact || {}),
        address: {
          ...(current.contact?.address || {}),
          ...(updates.contact?.address || {})
        }
      },
      domain: { ...current.domain, ...(updates.domain || {}) },
      billing: { ...current.billing, ...(updates.billing || {}) },
      settings: { ...current.settings, ...(updates.settings || {}) },
      people: { ...current.people, ...(updates.people || {}) },
      audit: { ...current.audit, ...(updates.audit || {}) }
    };

    // Unique displayName check if changed
    if (updates.identity?.displayName) {
      const dn = String(updates.identity.displayName).toLowerCase();
      const dup = orgs.find((o) =>
        !idsEqual(o?.id, id) &&
        String(o.identity?.displayName || '').toLowerCase() === dn
      );
      if (dup) throw new Error('Organization display name already exists.');
    }
    //
    const validity = validateData(merged);
    if (!validity.isValid) throw new Error(validity.errors.join('\r\n'));

    orgs[index] = merged;
    await fs.writeFile(dataPath, JSON.stringify(orgs, null, 2));
  });
}

async function deleteOrganization(id) {
  await queueWrite(async () => {
    const orgs = await getAllOrganizations();
    const filtered = orgs.filter((o) => !idsEqual(o?.id, id));
    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
  });
}

function hasActiveContract(org) {
  // 1. Safety Checks: Ensure org and contracts array exist
  if (!org || !org.contracts || !Array.isArray(org.contracts)) {
    return false;
  }

  const now = new Date();
  
  // 2. Define what statuses count as "Active"
  // You can add 'signed' or 'live' depending on your business logic
  const validStatuses = ['active', 'signed', 'live']; 

  // 3. Check if AT LEAST ONE contract meets all criteria
  const hasValid = org.contracts.some(contract => {
    
    // A. Check Status
    if (!contract.status || !validStatuses.includes(contract.status.toLowerCase())) {
      return false; 
    }

    // B. Check Start Date
    // If startDate is empty string "" or null, it's not valid yet
    if (!contract.startDate) {
      return false;
    }
    const startDate = new Date(contract.startDate);
    // Check if date is valid AND if it has already started
    if (isNaN(startDate.getTime()) || startDate > now) {
      return false;
    }

    // C. Check End Date (Expiration)
    // If endDate is null, we assume it is "Perpetual" (never expires)
    if (contract.endDate) {
      const endDate = new Date(contract.endDate);
      // If date is invalid OR date is in the past, it's expired
      if (isNaN(endDate.getTime()) || endDate < now) {
        return false;
      }
    }

    // If we passed all checks, this contract is valid
    return true;
  });

  return hasValid;
}

module.exports = {
  getAllOrganizations,
  queryOrganizations,
  buildOrganizationQueryPlan,
  getOrganizationById,
  addOrganization,
  updateOrganization,
  deleteOrganization,
  hasActiveContract
};
