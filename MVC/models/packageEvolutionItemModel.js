'use strict';

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('./fileQueue');
const { idsEqual } = require('../utils/idAdapter');

const DATA_PATH = path.join(__dirname, '../../data/packageEvolutionItems.json');

const CHANGE_TYPES = Object.freeze(['bug', 'update', 'new']);
const STATUSES = Object.freeze(['draft', 'published']);
const SOURCES = Object.freeze(['git-stub', 'agent-import', 'manual']);

if (!fsSync.existsSync(path.dirname(DATA_PATH))) {
  fsSync.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
}
if (!fsSync.existsSync(DATA_PATH)) {
  fsSync.writeFileSync(DATA_PATH, '[]');
}

function cleanText(value, { max = 8000, allowEmpty = true } = {}) {
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

function toShortHash(value = '') {
  const token = cleanText(value, { max: 128 }).toLowerCase();
  if (!token) return '';
  if (token.length <= 12) return token;
  return token.slice(-12);
}

function normalizeStringList(input, { maxItems = 500, maxLen = 500 } = {}) {
  const source = Array.isArray(input) ? input : (typeof input === 'string' ? input.split(/\r?\n|,/) : []);
  const seen = new Set();
  const out = [];
  for (const raw of source) {
    const token = cleanText(raw, { max: maxLen });
    if (!token) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizeTeamMembers(input = []) {
  const rows = Array.isArray(input) ? input : [];
  return rows.map((row) => {
    const item = row && typeof row === 'object' ? row : {};
    return {
      name: cleanText(item.name, { max: 200 }),
      userId: cleanText(item.userId, { max: 120, allowEmpty: true }),
      role: cleanText(item.role, { max: 120, allowEmpty: true })
    };
  }).filter((row) => row.name);
}

function normalizeApproval(input = null) {
  const item = input && typeof input === 'object' ? input : {};
  const name = cleanText(item.name, { max: 200, allowEmpty: true });
  const userId = cleanText(item.userId, { max: 120, allowEmpty: true });
  if (!name && !userId) return { name: '', userId: '' };
  return { name, userId };
}

function normalizeDuration(input = null) {
  const item = input && typeof input === 'object' ? input : {};
  const toInt = (v) => {
    const n = Number.parseInt(String(v ?? ''), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  return {
    days: toInt(item.days),
    hours: toInt(item.hours),
    minutes: toInt(item.minutes)
  };
}

function normalizeBudget(input = null) {
  const item = input && typeof input === 'object' ? input : {};
  let amount = null;
  if (item.amount !== undefined && item.amount !== null && item.amount !== '') {
    const n = Number(item.amount);
    amount = Number.isFinite(n) ? n : null;
  }
  return {
    amount,
    currency: cleanText(item.currency, { max: 12, allowEmpty: true }) || 'CAD',
    note: cleanText(item.note, { max: 2000, allowEmpty: true })
  };
}

function normalizeTechnical(input = null) {
  const item = input && typeof input === 'object' ? input : {};
  return {
    files: normalizeStringList(item.files),
    collections: normalizeStringList(item.collections),
    other: normalizeStringList(item.other)
  };
}

function normalizeChangeType(value = '') {
  const token = cleanText(value, { max: 40 }).toLowerCase();
  if (CHANGE_TYPES.includes(token)) return token;
  return 'update';
}

function normalizeStatus(value = '') {
  const token = cleanText(value, { max: 40 }).toLowerCase();
  if (STATUSES.includes(token)) return token;
  return 'draft';
}

function normalizeSource(value = '') {
  const token = cleanText(value, { max: 40 }).toLowerCase();
  if (SOURCES.includes(token)) return token;
  return 'manual';
}

function generateId(existingRows = [], prefix = 'PEVOL') {
  const existing = new Set((Array.isArray(existingRows) ? existingRows : []).map((row) => String(row?.id || '').trim()).filter(Boolean));
  const dateToken = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  for (let i = 0; i < 300; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `${prefix}${dateToken}${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${prefix}${Date.now()}`;
}

function buildUpsertKey(row = {}) {
  const sha = cleanText(row.commitSha, { max: 128 }).toLowerCase();
  const pkg = cleanText(row.packageName, { max: 80 }).toUpperCase();
  const title = cleanText(row.title, { max: 500 }).toLowerCase();
  return `${sha}|${pkg}|${title}`;
}

function normalizePackageEvolutionItem(record = {}, existing = null, { strict = false } = {}) {
  const input = record && typeof record === 'object' ? record : {};
  const base = existing && typeof existing === 'object' ? existing : {};
  const nowIso = new Date().toISOString();
  const teamInput = input.team !== undefined ? input.team : base.team;
  const teamObj = teamInput && typeof teamInput === 'object' ? teamInput : {};

  const commitSha = cleanText(input.commitSha || base.commitSha, { max: 128, allowEmpty: !strict });
  const packageName = cleanText(input.packageName || base.packageName, { max: 80, allowEmpty: !strict }).toUpperCase();

  const normalized = {
    ...base,
    id: cleanText(input.id || base.id, { max: 120 }),
    packageName,
    commitSha,
    commitShortHash: toShortHash(input.commitShortHash || base.commitShortHash || commitSha),
    committedAt: cleanIso(input.committedAt || base.committedAt),
    changeType: normalizeChangeType(input.changeType || base.changeType),
    title: cleanText(input.title || base.title, { max: 500, allowEmpty: !strict }),
    description: cleanText(input.description || base.description, { max: 12000, allowEmpty: true }),
    purpose: cleanText(input.purpose || base.purpose, { max: 8000, allowEmpty: true }),
    team: {
      members: normalizeTeamMembers(teamObj.members !== undefined ? teamObj.members : base.team?.members),
      approval: normalizeApproval(teamObj.approval !== undefined ? teamObj.approval : base.team?.approval)
    },
    budget: normalizeBudget(input.budget !== undefined ? input.budget : base.budget),
    taskDuration: normalizeDuration(input.taskDuration !== undefined ? input.taskDuration : base.taskDuration),
    technical: normalizeTechnical(input.technical !== undefined ? input.technical : base.technical),
    status: normalizeStatus(input.status !== undefined ? input.status : base.status || 'draft'),
    source: normalizeSource(input.source !== undefined ? input.source : base.source),
    createdByUserId: cleanText(
      input.createdByUserId !== undefined ? input.createdByUserId : base.createdByUserId,
      { max: 120, allowEmpty: true }
    ),
    updatedByUserId: cleanText(
      input.updatedByUserId !== undefined ? input.updatedByUserId : base.updatedByUserId,
      { max: 120, allowEmpty: true }
    ),
    createdAt: cleanIso(base.createdAt) || nowIso,
    updatedAt: nowIso
  };

  if (strict) {
    if (!normalized.packageName) throw new Error('Package name is required.');
    if (!normalized.commitSha) throw new Error('Commit SHA is required.');
    if (!normalized.title) throw new Error('Title is required.');
    if (!normalized.committedAt) throw new Error('Committed date is required.');
  }

  normalized.upsertKey = buildUpsertKey(normalized);
  return normalized;
}

async function readAll() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve package evolution items.');
  }
}

async function getById(id) {
  const rows = await readAll();
  return rows.find((row) => idsEqual(row?.id, id)) || null;
}

async function findByUpsertKey(upsertKey = '') {
  const key = cleanText(upsertKey, { max: 800 });
  if (!key) return null;
  const rows = await readAll();
  return rows.find((row) => String(row?.upsertKey || buildUpsertKey(row)) === key) || null;
}

async function add(record = {}) {
  return queueWrite(async () => {
    const rows = await readAll();
    const normalized = normalizePackageEvolutionItem(record, null, { strict: true });
    const existingKey = rows.find((row) => String(row?.upsertKey || buildUpsertKey(row)) === normalized.upsertKey);
    if (existingKey) throw new Error('An evolution item with the same commit, package, and title already exists.');
    normalized.id = normalized.id || generateId(rows);
    if (rows.some((row) => idsEqual(row?.id, normalized.id))) {
      throw new Error(`Package evolution item '${normalized.id}' already exists.`);
    }
    rows.push(normalized);
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return normalized;
  });
}

async function update(id, patch = {}) {
  return queueWrite(async () => {
    const rows = await readAll();
    const index = rows.findIndex((row) => idsEqual(row?.id, id));
    if (index < 0) throw new Error('Package evolution item not found.');
    const normalized = normalizePackageEvolutionItem(patch, rows[index], { strict: false });
    normalized.id = rows[index].id;
    const dup = rows.find((row, i) => i !== index
      && String(row?.upsertKey || buildUpsertKey(row)) === normalized.upsertKey);
    if (dup) throw new Error('An evolution item with the same commit, package, and title already exists.');
    rows[index] = normalized;
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return normalized;
  });
}

async function upsertByKey(record = {}) {
  return queueWrite(async () => {
    const rows = await readAll();
    const normalized = normalizePackageEvolutionItem(record, null, { strict: false });
    if (!normalized.packageName || !normalized.commitSha || !normalized.title) {
      throw new Error('Package name, commit SHA, and title are required for upsert.');
    }
    const key = normalized.upsertKey;
    const index = rows.findIndex((row) => String(row?.upsertKey || buildUpsertKey(row)) === key);
    if (index >= 0) {
      const merged = normalizePackageEvolutionItem(record, rows[index], { strict: false });
      merged.id = rows[index].id;
      merged.createdAt = rows[index].createdAt || merged.createdAt;
      rows[index] = merged;
      await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
      return { row: merged, created: false };
    }
    if (!normalized.committedAt) {
      throw new Error('Committed date is required for new evolution items.');
    }
    normalized.id = normalized.id || generateId(rows);
    rows.push(normalized);
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return { row: normalized, created: true };
  });
}

async function remove(id) {
  return queueWrite(async () => {
    const rows = await readAll();
    const next = rows.filter((row) => !idsEqual(row?.id, id));
    if (next.length === rows.length) throw new Error('Package evolution item not found.');
    await fs.writeFile(DATA_PATH, JSON.stringify(next, null, 2));
    return true;
  });
}

module.exports = {
  CHANGE_TYPES,
  STATUSES,
  SOURCES,
  normalizePackageEvolutionItem,
  buildUpsertKey,
  getAll: readAll,
  getById,
  findByUpsertKey,
  add,
  update,
  upsertByKey,
  remove,
  generateId
};