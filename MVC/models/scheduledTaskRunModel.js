'use strict';

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { idsEqual } = require('../utils/idAdapter');

const DATA_PATH = path.join(__dirname, '../../data/scheduledTaskRuns.json');

if (!fsSync.existsSync(path.dirname(DATA_PATH))) {
  fsSync.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
}
if (!fsSync.existsSync(DATA_PATH)) {
  fsSync.writeFileSync(DATA_PATH, '[]');
}

const RUN_STATUSES = Object.freeze(['pending', 'running', 'succeeded', 'failed', 'cancelled']);

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
    const candidate = `STRUN${dateToken}${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `STRUN${Date.now()}`;
}

function normalizeScheduledTaskRun(record = {}, existing = null) {
  const input = record && typeof record === 'object' ? record : {};
  const base = existing && typeof existing === 'object' ? existing : {};
  const nowIso = new Date().toISOString();
  const status = RUN_STATUSES.includes(cleanText(input.status || base.status))
    ? cleanText(input.status || base.status)
    : 'pending';

  return {
    ...base,
    id: cleanText(input.id || base.id, { max: 120 }),
    definitionId: cleanText(input.definitionId || base.definitionId, { max: 120, allowEmpty: true }),
    orgId: cleanText(input.orgId !== undefined ? input.orgId : base.orgId, { max: 120, allowEmpty: true }),
    packageName: cleanText(input.packageName || base.packageName, { max: 80, allowEmpty: true }).toUpperCase(),
    taskKey: cleanText(input.taskKey || base.taskKey, { max: 160, allowEmpty: true }),
    scheduledFor: cleanIso(input.scheduledFor || base.scheduledFor) || nowIso,
    startedAt: cleanIso(input.startedAt || base.startedAt),
    finishedAt: cleanIso(input.finishedAt || base.finishedAt),
    status,
    resultSummary: cleanText(input.resultSummary || base.resultSummary, { max: 2000, allowEmpty: true }),
    errorMessage: cleanText(input.errorMessage || base.errorMessage, { max: 5000, allowEmpty: true }),
    metrics: input.metrics !== undefined ? input.metrics : (base.metrics || {}),
    logs: Array.isArray(input.logs) ? input.logs.slice(0, 50) : (Array.isArray(base.logs) ? base.logs : []),
    createdAt: cleanIso(base.createdAt) || nowIso,
    updatedAt: nowIso
  };
}

async function readAll() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve scheduled task runs.');
  }
}

async function getById(id) {
  const rows = await readAll();
  return rows.find((row) => idsEqual(row?.id, id)) || null;
}

async function add(record = {}) {
  return queueWrite(async () => {
    const rows = await readAll();
    const normalized = normalizeScheduledTaskRun(record);
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
    if (index < 0) throw new Error('Scheduled task run not found.');
    const normalized = normalizeScheduledTaskRun(patch, rows[index]);
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
    if (index < 0) throw new Error('Scheduled task run not found.');
    rows.splice(index, 1);
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return true;
  });
}

module.exports = {
  RUN_STATUSES,
  normalizeScheduledTaskRun,
  getAll: readAll,
  getById,
  add,
  update,
  remove,
  generateId
};
