'use strict';

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { idsEqual } = require('../utils/idAdapter');

const DATA_PATH = path.join(__dirname, '../../data/smsOutbox.json');

if (!fsSync.existsSync(path.dirname(DATA_PATH))) {
  fsSync.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
}
if (!fsSync.existsSync(DATA_PATH)) {
  fsSync.writeFileSync(DATA_PATH, '[]');
}

const OUTBOX_STATUSES = Object.freeze(['queued', 'sending', 'sent', 'failed', 'cancelled']);

function cleanText(value, { max = 4000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const out = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !out) return null;
  return out.length > max ? out.slice(0, max) : out;
}

function cleanIso(value) {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function generateId(existingRows = []) {
  const existing = new Set((Array.isArray(existingRows) ? existingRows : []).map((row) => String(row?.id || '').trim()).filter(Boolean));
  const dateToken = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  for (let i = 0; i < 300; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `SMSOBX${dateToken}${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `SMSOBX${Date.now()}`;
}

function normalizeSmsOutboxRecord(record = {}, existing = null, { strict = false } = {}) {
  const input = record && typeof record === 'object' ? record : {};
  const base = existing && typeof existing === 'object' ? existing : {};
  const nowIso = new Date().toISOString();
  const status = OUTBOX_STATUSES.includes(cleanText(input.status || base.status))
    ? cleanText(input.status || base.status)
    : 'queued';

  const normalized = {
    ...base,
    id: cleanText(input.id || base.id, { max: 120 }),
    orgId: cleanText(input.orgId || base.orgId, { max: 120, allowEmpty: true }),
    eventKey: cleanText(input.eventKey || base.eventKey, { max: 120, allowEmpty: true }).toUpperCase(),
    to: cleanText(input.to || base.to, { max: 32, allowEmpty: true }),
    body: cleanText(input.body || base.body, { max: 320, allowEmpty: true }),
    providerId: cleanText(input.providerId || base.providerId, { max: 120, allowEmpty: true }),
    sendAt: cleanIso(input.sendAt || base.sendAt) || nowIso,
    status,
    dedupeKey: cleanText(input.dedupeKey || base.dedupeKey, { max: 500, allowEmpty: true }),
    taskRunId: cleanText(input.taskRunId || base.taskRunId, { max: 120, allowEmpty: true }),
    preparedAt: cleanIso(input.preparedAt || base.preparedAt) || nowIso,
    sentAt: cleanIso(input.sentAt || base.sentAt),
    attemptCount: Number(input.attemptCount ?? base.attemptCount ?? 0) || 0,
    lastError: cleanText(input.lastError || base.lastError, { max: 5000, allowEmpty: true }),
    meta: input.meta !== undefined ? input.meta : (base.meta || {}),
    createdAt: cleanIso(base.createdAt) || nowIso,
    updatedAt: nowIso
  };

  if (strict) {
    if (!normalized.to) throw new Error('SMS recipient is required.');
    if (!normalized.body) throw new Error('SMS body is required.');
  }

  return normalized;
}

async function readAll() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve SMS outbox entries.');
  }
}

async function getById(id) {
  const rows = await readAll();
  return rows.find((row) => idsEqual(row?.id, id)) || null;
}

async function getByDedupeKey(orgId, dedupeKey) {
  const key = cleanText(dedupeKey, { max: 500, allowEmpty: true });
  if (!key) return null;
  const rows = await readAll();
  return rows.find((row) => cleanText(row?.dedupeKey) === key && cleanText(row?.orgId) === cleanText(orgId)) || null;
}

async function add(record = {}) {
  return queueWrite(async () => {
    const rows = await readAll();
    const normalized = normalizeSmsOutboxRecord(record, null, { strict: true });
    normalized.id = normalized.id || generateId(rows);
    rows.push(normalized);
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return normalized;
  });
}

async function update(id, patch = {}) {
  return queueWrite(async () => {
    const rows = await readAll();
    const index = rows.findIndex((row) => idsEqual(row?.id, id));
    if (index < 0) throw new Error('SMS outbox entry not found.');
    const normalized = normalizeSmsOutboxRecord(patch, rows[index]);
    normalized.id = rows[index].id;
    rows[index] = normalized;
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return normalized;
  });
}

async function remove(id) {
  return queueWrite(async () => {
    const rows = await readAll();
    const index = rows.findIndex((row) => idsEqual(row?.id, id));
    if (index < 0) throw new Error('SMS outbox entry not found.');
    rows.splice(index, 1);
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return true;
  });
}

module.exports = {
  OUTBOX_STATUSES,
  normalizeSmsOutboxRecord,
  getAll: readAll,
  getById,
  getByDedupeKey,
  add,
  update,
  remove,
  generateId
};
