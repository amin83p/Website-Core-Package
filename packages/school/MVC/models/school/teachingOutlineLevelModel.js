'use strict';

const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');

const dataPath = path.join(resolveCoreRoot(), 'data/school/teachingOutlineLevels.json');

const LEVEL_KINDS = new Set(['pre_clb', 'benchmark', 'extended', 'custom']);

function cleanString(v, { max = 500, allowEmpty = true } = {}) {
  if (v === undefined || v === null) return allowEmpty ? '' : null;
  const s = String(v).replace(/\0/g, '').trim();
  if (!allowEmpty && !s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function cleanId(v, { max = 64, allowEmpty = false } = {}) {
  const s = cleanString(v, { max, allowEmpty });
  if (s === null) return null;
  if (!s) return allowEmpty ? '' : null;
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error('Invalid id format.');
  return s;
}

function normalizeCode(v) {
  const raw = String(v || '').trim().toLowerCase();
  if (!raw) return '';
  return raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
}

function cleanBoolean(v, defaultValue = false) {
  if (v === undefined || v === null || v === '') return Boolean(defaultValue);
  if (typeof v === 'boolean') return v;
  const normalized = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return Boolean(defaultValue);
}

function cleanNumber(v, { min = 0, max = 99999, defaultValue = 0 } = {}) {
  if (v === undefined || v === null || v === '') return Number(defaultValue);
  const n = Number(v);
  if (!Number.isFinite(n)) return Number(defaultValue);
  if (n < min || n > max) throw new Error('Numeric value out of allowed range.');
  return Math.round(n);
}

function cleanAliases(input) {
  const source = Array.isArray(input) ? input : (input ? [input] : []);
  const seen = new Set();
  const out = [];
  source.forEach((value) => {
    const alias = cleanString(value, { max: 80, allowEmpty: false });
    if (!alias) return;
    const key = alias.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(alias);
  });
  return out.slice(0, 40);
}

function generateLevelId() {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `TOL-${rand}`;
}

async function ensureDataFile() {
  if (!fsSync.existsSync(path.dirname(dataPath))) {
    fsSync.mkdirSync(path.dirname(dataPath), { recursive: true });
  }
  if (!fsSync.existsSync(dataPath)) {
    fsSync.writeFileSync(dataPath, '[]');
  }
}

function normalizeStoredLevel(row) {
  const now = new Date().toISOString();
  const code = normalizeCode(row?.code);
  const levelKind = LEVEL_KINDS.has(String(row?.levelKind || '').trim())
    ? String(row.levelKind).trim()
    : 'custom';
  return {
    id: cleanId(row?.id || generateLevelId(), { max: 80, allowEmpty: false }),
    orgId: cleanId(row?.orgId || '', { max: 64, allowEmpty: false }),
    code: code || 'level',
    title: cleanString(row?.title, { max: 160, allowEmpty: false }) || code,
    shortTitle: cleanString(row?.shortTitle, { max: 80, allowEmpty: true }) || cleanString(row?.title, { max: 80, allowEmpty: false }),
    levelKind,
    sortOrder: cleanNumber(row?.sortOrder, { min: 0, max: 99999, defaultValue: 100 }),
    matchAliases: cleanAliases(row?.matchAliases),
    description: cleanString(row?.description, { max: 2000, allowEmpty: true }),
    isActive: cleanBoolean(row?.isActive, true),
    audit: {
      createUser: cleanString(row?.audit?.createUser, { max: 64, allowEmpty: true }) || 'SYSTEM',
      createDateTime: cleanString(row?.audit?.createDateTime, { max: 40, allowEmpty: true }) || now,
      lastUpdateUser: cleanString(row?.audit?.lastUpdateUser, { max: 64, allowEmpty: true }) || 'SYSTEM',
      lastUpdateDateTime: cleanString(row?.audit?.lastUpdateDateTime, { max: 40, allowEmpty: true }) || now
    }
  };
}

function sanitizeInput(input, { isUpdate = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid teaching outline level payload.');
  }
  const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
  const code = normalizeCode(input.code);
  const title = cleanString(input.title, { max: 160, allowEmpty: false });
  if (!orgId) throw new Error('Organization is required.');
  if (!code) throw new Error('Level code is required.');
  if (!title) throw new Error('Level title is required.');
  const levelKind = LEVEL_KINDS.has(String(input.levelKind || '').trim())
    ? String(input.levelKind).trim()
    : 'custom';
  const out = {
    orgId: String(orgId),
    code,
    title,
    shortTitle: cleanString(input.shortTitle, { max: 80, allowEmpty: true }) || title,
    levelKind,
    sortOrder: cleanNumber(input.sortOrder, { min: 0, max: 99999, defaultValue: 100 }),
    matchAliases: cleanAliases(input.matchAliases),
    description: cleanString(input.description, { max: 2000, allowEmpty: true }),
    isActive: cleanBoolean(input.isActive, true)
  };
  if (!isUpdate && input.id) {
    out.id = cleanId(input.id, { max: 80, allowEmpty: false });
  }
  return out;
}

function assertUniqueCode(rows, candidate, { excludeId = null } = {}) {
  const org = String(candidate.orgId || '');
  const code = normalizeCode(candidate.code);
  const duplicate = (rows || []).some((row) => {
    if (excludeId && String(row.id) === String(excludeId)) return false;
    return String(row.orgId || '') === org && normalizeCode(row.code) === code;
  });
  if (duplicate) throw new Error(`Teaching outline level code "${code}" already exists.`);
}

async function getAllTeachingOutlineLevels() {
  await ensureDataFile();
  const data = await fs.readFile(dataPath, 'utf8');
  let parsed = [];
  try {
    parsed = JSON.parse(String(data || '[]').replace(/^\uFEFF/, '') || '[]');
  } catch (_) {
    parsed = [];
  }
  return Array.isArray(parsed) ? parsed.map(normalizeStoredLevel) : [];
}

async function getTeachingOutlineLevelById(id) {
  const rows = await getAllTeachingOutlineLevels();
  return rows.find((row) => String(row.id) === String(id)) || null;
}

async function addTeachingOutlineLevel(payload) {
  return queueWrite(async () => {
    const rows = await getAllTeachingOutlineLevels();
    const sanitized = sanitizeInput(payload, { isUpdate: false });
    assertUniqueCode(rows, sanitized);
    const now = new Date().toISOString();
    const created = {
      id: sanitized.id || generateLevelId(),
      ...sanitized,
      audit: {
        createUser: String(payload?.audit?.createUser || 'SYSTEM'),
        createDateTime: now,
        lastUpdateUser: String(payload?.audit?.lastUpdateUser || payload?.audit?.createUser || 'SYSTEM'),
        lastUpdateDateTime: now
      }
    };
    rows.push(created);
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return created;
  });
}

async function updateTeachingOutlineLevel(id, payload) {
  return queueWrite(async () => {
    const rows = await getAllTeachingOutlineLevels();
    const idx = rows.findIndex((row) => String(row.id) === String(id));
    if (idx < 0) throw new Error('Teaching outline level not found.');
    const current = rows[idx];
    const sanitized = sanitizeInput({ ...current, ...payload, orgId: current.orgId }, { isUpdate: true });
    assertUniqueCode(rows, sanitized, { excludeId: current.id });
    const now = new Date().toISOString();
    rows[idx] = {
      ...current,
      ...sanitized,
      orgId: current.orgId,
      audit: {
        ...current.audit,
        lastUpdateUser: String(payload?.audit?.lastUpdateUser || 'SYSTEM'),
        lastUpdateDateTime: now
      }
    };
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return rows[idx];
  });
}

async function deleteTeachingOutlineLevel(id) {
  return queueWrite(async () => {
    const rows = await getAllTeachingOutlineLevels();
    const idx = rows.findIndex((row) => String(row.id) === String(id));
    if (idx < 0) return false;
    rows.splice(idx, 1);
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return true;
  });
}

module.exports = {
  LEVEL_KINDS,
  getAllTeachingOutlineLevels,
  getTeachingOutlineLevelById,
  addTeachingOutlineLevel,
  updateTeachingOutlineLevel,
  deleteTeachingOutlineLevel,
  normalizeStoredLevel,
  sanitizeInput,
  normalizeCode,
  generateLevelId
};
