'use strict';

const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const {
  SKILL_KINDS,
  DEFAULT_SKILL_DEFINITIONS,
  normalizeSkillCode
} = require('../../../config/skillDefinitions');

const dataPath = path.join(resolveCoreRoot(), 'data/school/skills.json');
const VALID_KINDS = new Set(Object.values(SKILL_KINDS));

function cleanString(value, { max = 500, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const cleaned = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !cleaned) return null;
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
}

function cleanId(value, { max = 80, allowEmpty = false } = {}) {
  const cleaned = cleanString(value, { max, allowEmpty });
  if (cleaned === null) return null;
  if (!cleaned) return allowEmpty ? '' : null;
  if (!/^[A-Za-z0-9_-]+$/.test(cleaned)) throw new Error('Invalid id format.');
  return cleaned;
}

function cleanBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return Boolean(fallback);
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return Boolean(fallback);
}

function cleanSortOrder(value, fallback = 100) {
  if (value === undefined || value === null || value === '') return Number(fallback);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number(fallback);
  if (parsed < 0 || parsed > 9999) throw new Error('Sort order must be between 0 and 9999.');
  return Math.round(parsed);
}

function normalizeKind(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_KINDS.has(normalized) ? normalized : SKILL_KINDS.GENERAL;
}

function generateSkillId() {
  const year = new Date().getFullYear();
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `SKL-${year}-${random}`;
}

function getDefaultSkillsForOrg(orgId, userId = 'SYSTEM') {
  const now = new Date().toISOString();
  return DEFAULT_SKILL_DEFINITIONS.map((definition) => ({
    id: generateSkillId(),
    orgId: String(orgId || '').trim(),
    ...definition,
    active: true,
    audit: {
      createUser: String(userId || 'SYSTEM'),
      createDateTime: now,
      lastUpdateUser: String(userId || 'SYSTEM'),
      lastUpdateDateTime: now
    }
  }));
}

function normalizeStoredSkill(row = {}) {
  const now = new Date().toISOString();
  const code = normalizeSkillCode(row.code);
  const kind = normalizeKind(row.kind);
  return {
    id: cleanId(row.id || generateSkillId(), { max: 80, allowEmpty: false }),
    orgId: cleanId(row.orgId || '', { max: 64, allowEmpty: false }),
    code,
    label: cleanString(row.label, { max: 120, allowEmpty: true }) || code,
    kind,
    supportsTeachingOutline: kind === SKILL_KINDS.CLB
      && cleanBoolean(row.supportsTeachingOutline, false),
    active: cleanBoolean(row.active, true),
    sortOrder: cleanSortOrder(row.sortOrder, 100),
    audit: {
      createUser: cleanString(row?.audit?.createUser, { max: 80, allowEmpty: true }) || 'SYSTEM',
      createDateTime: cleanString(row?.audit?.createDateTime, { max: 40, allowEmpty: true }) || now,
      lastUpdateUser: cleanString(row?.audit?.lastUpdateUser, { max: 80, allowEmpty: true }) || 'SYSTEM',
      lastUpdateDateTime: cleanString(row?.audit?.lastUpdateDateTime, { max: 40, allowEmpty: true }) || now
    }
  };
}

function sanitizeInput(input, { isUpdate = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid skill payload.');
  }
  const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
  const code = normalizeSkillCode(input.code);
  const label = cleanString(input.label, { max: 120, allowEmpty: false });
  const kind = normalizeKind(input.kind);
  if (!orgId) throw new Error('Organization is required.');
  if (!code) throw new Error('Skill code is required.');
  if (!label) throw new Error('Skill label is required.');
  const output = {
    orgId: String(orgId),
    code,
    label,
    kind,
    supportsTeachingOutline: kind === SKILL_KINDS.CLB
      && cleanBoolean(input.supportsTeachingOutline, false),
    active: cleanBoolean(input.active, true),
    sortOrder: cleanSortOrder(input.sortOrder, 100)
  };
  if (!isUpdate && input.id) {
    output.id = cleanId(input.id, { max: 80, allowEmpty: false });
  }
  return output;
}

function assertUniqueCode(rows, candidate, { excludeId = null } = {}) {
  const duplicate = (Array.isArray(rows) ? rows : []).some((row) => (
    (!excludeId || String(row.id) !== String(excludeId))
    && String(row.orgId || '') === String(candidate.orgId || '')
    && normalizeSkillCode(row.code) === normalizeSkillCode(candidate.code)
  ));
  if (duplicate) throw new Error(`Skill code "${candidate.code}" already exists.`);
}

async function ensureDataFile() {
  if (!fsSync.existsSync(path.dirname(dataPath))) {
    fsSync.mkdirSync(path.dirname(dataPath), { recursive: true });
  }
  if (!fsSync.existsSync(dataPath)) {
    fsSync.writeFileSync(dataPath, '[]');
  }
}

async function getAllSkills() {
  await ensureDataFile();
  const content = await fs.readFile(dataPath, 'utf8');
  let parsed = [];
  try {
    parsed = JSON.parse(String(content || '[]').replace(/^\uFEFF/, '') || '[]');
  } catch (_) {
    parsed = [];
  }
  return Array.isArray(parsed) ? parsed.map(normalizeStoredSkill) : [];
}

async function getSkillById(id) {
  const rows = await getAllSkills();
  return rows.find((row) => String(row.id) === String(id)) || null;
}

async function addSkill(payload) {
  return queueWrite(async () => {
    const rows = await getAllSkills();
    const sanitized = sanitizeInput(payload, { isUpdate: false });
    assertUniqueCode(rows, sanitized);
    const now = new Date().toISOString();
    const created = {
      id: sanitized.id || generateSkillId(),
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

async function updateSkill(id, payload) {
  return queueWrite(async () => {
    const rows = await getAllSkills();
    const index = rows.findIndex((row) => String(row.id) === String(id));
    if (index < 0) throw new Error('Skill not found.');
    const current = rows[index];
    const sanitized = sanitizeInput({
      ...current,
      ...payload,
      orgId: current.orgId
    }, { isUpdate: true });
    assertUniqueCode(rows, sanitized, { excludeId: current.id });
    const now = new Date().toISOString();
    rows[index] = {
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
    return rows[index];
  });
}

async function deleteSkill(id) {
  return queueWrite(async () => {
    const rows = await getAllSkills();
    const index = rows.findIndex((row) => String(row.id) === String(id));
    if (index < 0) return false;
    rows.splice(index, 1);
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return true;
  });
}

module.exports = {
  getAllSkills,
  getSkillById,
  addSkill,
  updateSkill,
  deleteSkill,
  getDefaultSkillsForOrg,
  normalizeStoredSkill,
  sanitizeInput,
  generateSkillId
};
