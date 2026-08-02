'use strict';

const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { CLB_SKILLS } = require('./studentModel');

const dataPath = path.join(resolveCoreRoot(), 'data/school/teachingOutlineItems.json');

const ITEM_KINDS = new Set(['reference', 'group', 'checklist']);

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
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  return s;
}

function normalizeSkillId(v) {
  const skill = String(v || '').trim().toLowerCase();
  if (!CLB_SKILLS.includes(skill)) throw new Error(`Invalid skill id: ${skill}`);
  return skill;
}

function normalizeSectionKey(v) {
  const raw = String(v || '').trim().toLowerCase();
  if (!raw) return '';
  return raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
}

function normalizeItemKind(v, fallback = 'checklist') {
  const kind = String(v || fallback).trim().toLowerCase();
  return ITEM_KINDS.has(kind) ? kind : fallback;
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

function generateItemId() {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `TOI-${rand}`;
}

async function ensureDataFile() {
  if (!fsSync.existsSync(path.dirname(dataPath))) {
    fsSync.mkdirSync(path.dirname(dataPath), { recursive: true });
  }
  if (!fsSync.existsSync(dataPath)) {
    fsSync.writeFileSync(dataPath, '[]');
  }
}

function normalizeStoredItem(row) {
  const now = new Date().toISOString();
  const itemKind = normalizeItemKind(row?.itemKind, 'checklist');
  return {
    id: cleanId(row?.id || generateItemId(), { max: 80, allowEmpty: false }) || generateItemId(),
    orgId: cleanId(row?.orgId || '', { max: 64, allowEmpty: false }) || '',
    skillId: normalizeSkillId(row?.skillId),
    levelId: cleanId(row?.levelId || '', { max: 80, allowEmpty: false }) || '',
    sectionKey: normalizeSectionKey(row?.sectionKey),
    parentId: cleanId(row?.parentId, { max: 80, allowEmpty: true }) || null,
    itemKind,
    label: cleanString(row?.label, { max: 2000, allowEmpty: false }) || 'Item',
    description: cleanString(row?.description, { max: 4000, allowEmpty: true }),
    displayOrder: cleanNumber(row?.displayOrder, { min: 0, max: 99999, defaultValue: 100 }),
    isSelectable: cleanBoolean(row?.isSelectable, itemKind === 'checklist'),
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
    throw new Error('Invalid teaching outline item payload.');
  }
  const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
  const skillId = normalizeSkillId(input.skillId);
  const levelId = cleanId(input.levelId, { max: 80, allowEmpty: false });
  const sectionKey = normalizeSectionKey(input.sectionKey);
  const label = cleanString(input.label, { max: 2000, allowEmpty: false });
  if (!orgId) throw new Error('Organization is required.');
  if (!levelId) throw new Error('Level is required.');
  if (!sectionKey) throw new Error('Section key is required.');
  if (!label) throw new Error('Item label is required.');
  const itemKind = normalizeItemKind(input.itemKind, 'checklist');
  const out = {
    orgId: String(orgId),
    skillId,
    levelId: String(levelId),
    sectionKey,
    parentId: cleanId(input.parentId, { max: 80, allowEmpty: true }) || null,
    itemKind,
    label,
    description: cleanString(input.description, { max: 4000, allowEmpty: true }),
    displayOrder: cleanNumber(input.displayOrder, { min: 0, max: 99999, defaultValue: 100 }),
    isSelectable: cleanBoolean(input.isSelectable, itemKind === 'checklist'),
    isActive: cleanBoolean(input.isActive, true)
  };
  if (!isUpdate && input.id) {
    out.id = cleanId(input.id, { max: 80, allowEmpty: false });
  }
  return out;
}

async function getAllTeachingOutlineItems() {
  await ensureDataFile();
  const data = await fs.readFile(dataPath, 'utf8');
  let parsed = [];
  try {
    parsed = JSON.parse(String(data || '[]').replace(/^\uFEFF/, '') || '[]');
  } catch (_) {
    parsed = [];
  }
  return Array.isArray(parsed) ? parsed.map(normalizeStoredItem) : [];
}

async function getTeachingOutlineItemById(id) {
  const rows = await getAllTeachingOutlineItems();
  return rows.find((row) => String(row.id) === String(id)) || null;
}

async function addTeachingOutlineItem(payload) {
  return queueWrite(async () => {
    const rows = await getAllTeachingOutlineItems();
    const sanitized = sanitizeInput(payload, { isUpdate: false });
    const now = new Date().toISOString();
    const created = {
      id: sanitized.id || generateItemId(),
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

async function updateTeachingOutlineItem(id, payload) {
  return queueWrite(async () => {
    const rows = await getAllTeachingOutlineItems();
    const idx = rows.findIndex((row) => String(row.id) === String(id));
    if (idx < 0) throw new Error('Teaching outline item not found.');
    const current = rows[idx];
    const sanitized = sanitizeInput({
      ...current,
      ...payload,
      orgId: current.orgId,
      skillId: current.skillId,
      levelId: current.levelId
    }, { isUpdate: true });
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

async function deleteTeachingOutlineItem(id) {
  return queueWrite(async () => {
    const rows = await getAllTeachingOutlineItems();
    const idx = rows.findIndex((row) => String(row.id) === String(id));
    if (idx < 0) return false;
    rows.splice(idx, 1);
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return true;
  });
}

async function bulkReplaceItemsForSkillLevel(orgId, skillId, levelId, items, userId = 'SYSTEM') {
  return queueWrite(async () => {
    const rows = await getAllTeachingOutlineItems();
    const org = String(orgId || '');
    const skill = normalizeSkillId(skillId);
    const level = String(levelId || '');
    const kept = rows.filter((row) => !(
      String(row.orgId) === org && row.skillId === skill && String(row.levelId) === level
    ));
    const now = new Date().toISOString();
    const incoming = (Array.isArray(items) ? items : []).map((row, index) => {
      const sanitized = sanitizeInput({ ...row, orgId: org, skillId: skill, levelId: level }, { isUpdate: false });
      return {
        id: sanitized.id || generateItemId(),
        ...sanitized,
        audit: {
          createUser: String(userId || 'SYSTEM'),
          createDateTime: now,
          lastUpdateUser: String(userId || 'SYSTEM'),
          lastUpdateDateTime: now
        }
      };
    });
    const merged = [...kept, ...incoming];
    await fs.writeFile(dataPath, JSON.stringify(merged, null, 2));
    return incoming;
  });
}

module.exports = {
  ITEM_KINDS,
  getAllTeachingOutlineItems,
  getTeachingOutlineItemById,
  addTeachingOutlineItem,
  updateTeachingOutlineItem,
  deleteTeachingOutlineItem,
  bulkReplaceItemsForSkillLevel,
  normalizeStoredItem,
  sanitizeInput,
  generateItemId
};
