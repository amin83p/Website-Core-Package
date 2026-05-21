// MVC/models/newsletterSubscriptionModel.js
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { queueWrite } = require('./fileQueue');
const { applyGenericFilter } = require('../utils/queryEngine');
const { idsEqual } = require('../utils/idAdapter');
const { getEntityQueryExecutor } = require('./queryExecutionBridge');

const dataPath = path.join(__dirname, '../../data/newsletterSubscriptions.json');

async function getAllSubscriptions() {
  try {
    const raw = await fs.readFile(dataPath, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function applyNewsletterScope(rows, scope = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (scope?.canViewAll !== false) return list;
  return scope?.isAuthenticated ? list : [];
}

function buildNewsletterSubscriptionQueryPlan(options = {}) {
  const query = options?.query || {};
  const incomingScope = options?.scope || {};

  return {
    entity: 'newslettersubscriptions',
    query,
    scope: {
      canViewAll: incomingScope?.canViewAll !== false,
      isAuthenticated: incomingScope?.isAuthenticated === true
    },
    projection: options?.projection || null,
    pagination: options?.pagination || null,
    sort: options?.sort || null,
    fallback: {
      defaultSearchFields: ['id', 'email', 'status', 'groupId'],
      dateFields: ['createdAt', 'updatedAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
    }
  };
}

async function querySubscriptions(options = {}) {
  const plan = buildNewsletterSubscriptionQueryPlan(options);
  const executor = getEntityQueryExecutor('newslettersubscriptions');

  if (typeof executor === 'function') {
    const result = await executor(plan);
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.items)) return result.items;
  }

  const allSubscriptions = await getAllSubscriptions();
  const scopedSubscriptions = applyNewsletterScope(allSubscriptions, plan.scope);
  return applyGenericFilter(scopedSubscriptions, plan.query, plan.fallback);
}

async function getSubscriptionById(id) {
  const all = await getAllSubscriptions();
  return all.find((x) => idsEqual(x?.id, id));
}

async function getSubscriptionByEmail(email) {
  if (!email) return null;
  const norm = String(email).trim().toLowerCase();
  const all = await getAllSubscriptions();
  return all.find(x => String(x.email || '').trim().toLowerCase() === norm) || null;
}

function generateNextId(all) {
  let maxId = 1000;
  all.forEach(s => {
    if (s.id && String(s.id).startsWith('NWS')) {
      const n = parseInt(String(s.id).substring(3), 10);
      if (!isNaN(n) && n > maxId && n < 9000) maxId = n;
    }
  });
  const next = maxId + 1;
  if (next > 8999) throw new Error('Maximum Newsletter ID limit (NWS8999) reached.');
  return 'NWS' + next;
}

function makeManageCode() {
  return 'NWC-' + crypto.randomBytes(3).toString('hex').toUpperCase(); 
}

function isValidEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function validateSubscription(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { isValid: false, errors: ['Subscription must be an object.'] };

  if (!obj.email || typeof obj.email !== 'string' || !isValidEmail(obj.email)) {
    errors.push('Valid email is required.');
  }
  if (typeof obj.active !== 'boolean') errors.push('Active must be boolean.');
  if (!obj.manageCode || typeof obj.manageCode !== 'string') errors.push('Manage code is required.');
  
  // Optional Group ID check
  if (obj.groupId && typeof obj.groupId !== 'string') {
      errors.push('Group ID must be a string.');
  }

  return errors.length ? { isValid: false, errors } : { isValid: true };
}

/** Public: subscribe (upsert by email) */
// ✅ UPDATED: Accepts groupId
async function subscribeEmail(email, meta = {}, groupId = null) {
  if (!isValidEmail(email)) throw new Error('Please enter a valid email address.');

  const now = new Date().toISOString();
  const norm = String(email).trim().toLowerCase();

  let result = null;

  await queueWrite(async () => {
    const all = await getAllSubscriptions();
    const idx = all.findIndex(x => String(x.email || '').trim().toLowerCase() === norm);

    if (idx >= 0) {
      const current = all[idx];

      const merged = {
        ...current,
        email: norm,
        active: true,
        status: 'subscribed',
        // Update group only if provided (or keep existing)
        groupId: groupId || current.groupId || null, 
        unsubscribedAt: null,
        meta: { ...(current.meta || {}), ...(meta || {}) },
        audit: {
          ...(current.audit || {}),
          lastUpdateDateTime: now
        }
      };

      const v = validateSubscription(merged);
      if (!v.isValid) throw new Error(v.errors.join('\r\n'));

      all[idx] = merged;
      result = merged;
      await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
      return;
    }

    const created = {
      id: generateNextId(all),
      email: norm,
      active: true,
      status: 'subscribed',
      // Assign Group
      groupId: groupId || null, 
      manageCode: makeManageCode(),
      subscribedAt: now,
      unsubscribedAt: null,
      meta: meta || {},
      note: '', 
      audit: {
        createDateTime: now,
        lastUpdateDateTime: now
      }
    };

    const v = validateSubscription(created);
    if (!v.isValid) throw new Error(v.errors.join('\r\n'));

    all.push(created);
    result = created;

    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
  });

  return result;
}

/** Public: unsubscribe (email + manageCode) */
async function unsubscribeEmail(email, manageCode, meta = {}) {
  if (!isValidEmail(email)) throw new Error('Please enter a valid email address.');
  if (!manageCode || typeof manageCode !== 'string') throw new Error('Manage code is required.');

  const now = new Date().toISOString();
  const norm = String(email).trim().toLowerCase();
  const code = String(manageCode).trim();

  let result = null;

  await queueWrite(async () => {
    const all = await getAllSubscriptions();
    const idx = all.findIndex(x => String(x.email || '').trim().toLowerCase() === norm);
    if (idx === -1) throw new Error('Subscription not found.');

    const current = all[idx];
    if (String(current.manageCode || '').trim() !== code) throw new Error('Invalid manage code.');

    const merged = {
      ...current,
      active: false,
      status: 'unsubscribed',
      unsubscribedAt: now,
      meta: { ...(current.meta || {}), ...(meta || {}) },
      audit: {
        ...(current.audit || {}),
        lastUpdateDateTime: now
      }
    };

    const v = validateSubscription(merged);
    if (!v.isValid) throw new Error(v.errors.join('\r\n'));

    all[idx] = merged;
    result = merged;

    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
  });

  return result;
}

/** Admin: update (email, active, note, status) */
async function updateSubscription(id, updates = {}) {
  const now = new Date().toISOString();

  await queueWrite(async () => {
    const all = await getAllSubscriptions();
    const idx = all.findIndex((x) => idsEqual(x?.id, id));
    if (idx === -1) throw new Error('Subscription not found.');

    const current = all[idx];

    // Email uniqueness check
    if (updates.email && String(updates.email).trim().toLowerCase() !== String(current.email).trim().toLowerCase()) {
      const norm = String(updates.email).trim().toLowerCase();
      if (!isValidEmail(norm)) throw new Error('Valid email is required.');
      if (all.some((x) => !idsEqual(x?.id, id) && String(x.email || '').trim().toLowerCase() === norm)) {
        throw new Error('Email already exists.');
      }
    }

    const merged = {
      ...current,
      ...updates,
      email: updates.email ? String(updates.email).trim().toLowerCase() : current.email,
      audit: { ...(current.audit || {}), ...(updates.audit || {}), lastUpdateDateTime: now }
    };

    const v = validateSubscription(merged);
    if (!v.isValid) throw new Error(v.errors.join('\r\n'));

    all[idx] = merged;
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
  });

  return true;
}

async function deleteSubscription(id) {
  await queueWrite(async () => {
    const all = await getAllSubscriptions();
    const idx = all.findIndex((x) => idsEqual(x?.id, id));
    if (idx === -1) throw new Error('Subscription not found.');
    all.splice(idx, 1);
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
  });
}

async function unsubscribeByEmail(email, { mode = 'deactivate', meta = {} } = {}) {
  if (!isValidEmail(email)) throw new Error('Please enter a valid email address.');

  const now = new Date().toISOString();
  const norm = String(email).trim().toLowerCase();

  let changed = false;

  await queueWrite(async () => {
    const all = await getAllSubscriptions();
    const idx = all.findIndex(x => String(x.email || '').trim().toLowerCase() === norm);

    if (idx === -1) return;

    if (mode === 'delete') {
      all.splice(idx, 1);
      changed = true;
      await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
      return;
    }

    const current = all[idx];
    all[idx] = {
      ...current,
      active: false,
      status: 'unsubscribed',
      unsubscribedAt: now,
      meta: { ...(current.meta || {}), ...(meta || {}) },
      audit: { ...(current.audit || {}), lastUpdateDateTime: now }
    };

    changed = true;
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
  });

  return { changed };
}

// ✅ NEW: Admin Create (Strict Create)
async function adminCreateSubscription(data) {
  const { email, groupId, active, note, meta } = data;

  if (!isValidEmail(email)) throw new Error('Please enter a valid email address.');
  
  const now = new Date().toISOString();
  const norm = String(email).trim().toLowerCase();

  let result = null;

  await queueWrite(async () => {
    const all = await getAllSubscriptions();
    
    // 1. Duplication Check
    const exists = all.some(x => String(x.email || '').trim().toLowerCase() === norm);
    if (exists) {
      throw new Error('Subscription with this email already exists.');
    }

    // 2. Create Object
    const created = {
      id: generateNextId(all),
      email: norm,
      active: typeof active === 'boolean' ? active : true,
      status: 'subscribed',
      groupId: groupId || null,
      manageCode: makeManageCode(),
      subscribedAt: now,
      unsubscribedAt: null,
      meta: meta || {},
      note: typeof note === 'string' ? note : '',
      audit: {
        createDateTime: now,
        lastUpdateDateTime: now,
        createUser: data.auditUser || 'admin'
      }
    };

    // 3. Validate
    const v = validateSubscription(created);
    if (!v.isValid) throw new Error(v.errors.join('\r\n'));

    all.push(created);
    result = created;

    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
  });

  return result;
}

module.exports = {
  getAllSubscriptions,
  querySubscriptions,
  buildNewsletterSubscriptionQueryPlan,
  getSubscriptionById,
  getSubscriptionByEmail,
  subscribeEmail,
  unsubscribeEmail,
  updateSubscription,
  deleteSubscription,
  unsubscribeByEmail,
  adminCreateSubscription // ✅ Export new method
};
