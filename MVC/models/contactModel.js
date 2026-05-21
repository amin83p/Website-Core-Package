// MVC/models/contactModel.js

const fs = require('fs').promises;
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { applyGenericFilter } = require('../utils/queryEngine');
const { idsEqual } = require('../utils/idAdapter');
const { getEntityQueryExecutor } = require('./queryExecutionBridge');

const dataPath = path.join(__dirname, '../../data/contactMessages.json');

const ALLOWED_STATUSES = new Set(['Unread', 'Under view', 'Done']);

async function getAllContactMessages() {
  try {
    const raw = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function applyContactScope(rows, scope = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (scope?.canViewAll !== false) return list;
  return scope?.isAuthenticated ? list : [];
}

function buildContactQueryPlan(options = {}) {
  const query = options?.query || {};
  const incomingScope = options?.scope || {};

  return {
    entity: 'contacts',
    query,
    scope: {
      canViewAll: incomingScope?.canViewAll !== false,
      isAuthenticated: incomingScope?.isAuthenticated === true
    },
    projection: options?.projection || null,
    pagination: options?.pagination || null,
    sort: options?.sort || null,
    fallback: {
      defaultSearchFields: ['id', 'name', 'email', 'subject', 'status'],
      dateFields: ['createdAt', 'updatedAt', 'audit.createDateTime', 'audit.lastUpdateDateTime']
    }
  };
}

async function queryContactMessages(options = {}) {
  const plan = buildContactQueryPlan(options);
  const executor = getEntityQueryExecutor('contacts');

  if (typeof executor === 'function') {
    const result = await executor(plan);
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.items)) return result.items;
  }

  const allMessages = await getAllContactMessages();
  const scopedMessages = applyContactScope(allMessages, plan.scope);
  return applyGenericFilter(scopedMessages, plan.query, plan.fallback);
}

async function getContactMessageById(id) {
  const list = await getAllContactMessages();
  return list.find((m) => idsEqual(m?.id, id));
}

// Generate ID: CNT1001, CNT1002, etc.
function generateNextId(list) {
  let maxId = 1000;

  (list || []).forEach(m => {
    if (m.id && String(m.id).startsWith('CNT')) {
      const n = parseInt(String(m.id).slice(3), 10);
      if (!isNaN(n) && n > maxId && n < 9000) maxId = n;
    }
  });

  const next = maxId + 1;
  if (next > 8999) throw new Error('Maximum Contact ID limit (CNT8999) reached.');
  return 'CNT' + next;
}

function validate(msg) {
  const errors = [];
  if (!msg || typeof msg !== 'object') return { isValid: false, errors: ['Message must be a valid object.'] };

  const name = String(msg.name || '').trim();
  const email = String(msg.email || '').trim();
  const subject = String(msg.subject || '').trim();
  const message = String(msg.message || '').trim();

  if (!name) errors.push('Name is required.');
  if (!email) errors.push('Email is required.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Email is not valid.');
  if (!subject) errors.push('Subject is required.');
  if (!message) errors.push('Message is required.');

  if (msg.status && !ALLOWED_STATUSES.has(String(msg.status))) {
    errors.push('Status must be one of: Unread, Under view, Done.');
  }

  if (msg.note !== undefined && typeof msg.note !== 'string') errors.push('Note must be a string.');
  if (typeof msg.note === 'string' && msg.note.length > 5000) errors.push('Note is too long (max 5000 chars).');

  if (msg.attachments !== undefined && !Array.isArray(msg.attachments)) {
    errors.push('Attachments must be an array.');
  }

  if (msg.userNote !== undefined && typeof msg.userNote !== 'string') {
    errors.push('User note must be a string.');
  }
  if (typeof msg.userNote === 'string' && msg.userNote.length > 2000) {
    errors.push('User note is too long (max 2000 chars).');
  }
  return errors.length ? { isValid: false, errors } : { isValid: true };
}

function ensureDefaults(msg) {
  if (!msg.status) msg.status = 'Unread';
  if (typeof msg.note !== 'string') msg.note = '';
  if (!Array.isArray(msg.attachments)) msg.attachments = [];
  if (!msg.meta || typeof msg.meta !== 'object') msg.meta = {};
  if (!msg.audit || typeof msg.audit !== 'object') msg.audit = {};
}

async function addContactMessage(msg) {
  ensureDefaults(msg);

  await queueWrite(async () => {
    const list = await getAllContactMessages();

    msg.id = generateNextId(list);

    // Ensure audit baseline
    const now = new Date().toISOString();
    msg.audit.createDateTime = msg.audit.createDateTime || now;
    msg.audit.lastUpdateDateTime = msg.audit.lastUpdateDateTime || msg.audit.createDateTime || now;
    if (typeof msg.userNote !== 'string') msg.userNote = '';

    const v = validate(msg);
    if (!v.isValid) throw new Error(v.errors.join('\r\n'));

    list.push(msg);
    await fs.writeFile(dataPath, JSON.stringify(list, null, 2));
  });

  return msg;
}

async function updateContactMessage(id, updates, auditUser = 'system') {
  await queueWrite(async () => {
    const list = await getAllContactMessages();
    const idx = list.findIndex((m) => idsEqual(m?.id, id));
    if (idx === -1) throw new Error('Message not found');

    const current = list[idx];
    const now = new Date().toISOString();

    const merged = {
      ...current,
      ...updates,
      // Keep attachments unless explicitly provided
      attachments: updates.attachments !== undefined ? updates.attachments : (current.attachments || []),
      audit: {
        ...(current.audit || {}),
        ...(updates.audit || {}),
        lastUpdateUser: auditUser,
        lastUpdateDateTime: now
      }
    };

    ensureDefaults(merged);

    const v = validate(merged);
    if (!v.isValid) throw new Error(v.errors.join('\r\n'));

    list[idx] = merged;
    await fs.writeFile(dataPath, JSON.stringify(list, null, 2));
  });

  return await getContactMessageById(id);
}

async function deleteContactMessage(id) {
  await queueWrite(async () => {
    const list = await getAllContactMessages();
    const idx = list.findIndex((m) => idsEqual(m?.id, id));
    if (idx === -1) throw new Error('Message not found');

    list.splice(idx, 1);
    await fs.writeFile(dataPath, JSON.stringify(list, null, 2));
  });

  return { id };
}

module.exports = {
  getAllContactMessages,
  queryContactMessages,
  buildContactQueryPlan,
  getContactMessageById,
  addContactMessage,
  updateContactMessage,
  deleteContactMessage
};
