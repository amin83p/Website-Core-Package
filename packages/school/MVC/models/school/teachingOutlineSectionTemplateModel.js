'use strict';

const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { CLB_SKILLS } = require('./studentModel');

const dataPath = path.join(resolveCoreRoot(), 'data/school/teachingOutlineSectionTemplates.json');

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

function normalizeSectionKey(v) {
  const raw = String(v || '').trim().toLowerCase();
  if (!raw) return '';
  return raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
}

function cleanBoolean(v, defaultValue = false) {
  if (v === undefined || v === null || v === '') return Boolean(defaultValue);
  if (typeof v === 'boolean') return v;
  const normalized = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return Boolean(defaultValue);
}

function cleanNumber(v, { min = 0, max = 9999, defaultValue = 0 } = {}) {
  if (v === undefined || v === null || v === '') return Number(defaultValue);
  const n = Number(v);
  if (!Number.isFinite(n)) return Number(defaultValue);
  if (n < min || n > max) throw new Error('Numeric value out of allowed range.');
  return Math.round(n);
}

function normalizeSkillId(v) {
  const skill = String(v || '').trim().toLowerCase();
  if (!CLB_SKILLS.includes(skill)) throw new Error(`Invalid skill id: ${skill}`);
  return skill;
}

function generateTemplateId(skillId) {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `TOST_${String(skillId || 'skill').toUpperCase()}_${rand}`;
}

function cleanSections(input) {
  const source = Array.isArray(input) ? input : [];
  const seen = new Set();
  const out = [];
  source.forEach((row, index) => {
    if (!row || typeof row !== 'object') return;
    const key = normalizeSectionKey(row.key);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({
      key,
      title: cleanString(row.title, { max: 200, allowEmpty: false }) || key,
      isSelectable: cleanBoolean(row.isSelectable, false),
      allowsGroups: cleanBoolean(row.allowsGroups, false),
      displayOrder: cleanNumber(row.displayOrder, { min: 0, max: 9999, defaultValue: (index + 1) * 10 })
    });
  });
  out.sort((a, b) => a.displayOrder - b.displayOrder);
  return out.slice(0, 30);
}

async function ensureDataFile() {
  if (!fsSync.existsSync(path.dirname(dataPath))) {
    fsSync.mkdirSync(path.dirname(dataPath), { recursive: true });
  }
  if (!fsSync.existsSync(dataPath)) {
    fsSync.writeFileSync(dataPath, '[]');
  }
}

function normalizeStoredTemplate(row) {
  const now = new Date().toISOString();
  const skillId = normalizeSkillId(row?.skillId);
  return {
    id: cleanId(row?.id || generateTemplateId(skillId), { max: 80, allowEmpty: false }),
    orgId: cleanId(row?.orgId || '', { max: 64, allowEmpty: false }),
    skillId,
    sections: cleanSections(row?.sections),
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
    throw new Error('Invalid section template payload.');
  }
  const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
  const skillId = normalizeSkillId(input.skillId);
  if (!orgId) throw new Error('Organization is required.');
  const sections = cleanSections(input.sections);
  if (!sections.length) throw new Error('At least one section is required.');
  const out = { orgId: String(orgId), skillId, sections };
  if (!isUpdate && input.id) {
    out.id = cleanId(input.id, { max: 80, allowEmpty: false });
  }
  return out;
}

async function getAllTeachingOutlineSectionTemplates() {
  await ensureDataFile();
  const data = await fs.readFile(dataPath, 'utf8');
  let parsed = [];
  try {
    parsed = JSON.parse(String(data || '[]').replace(/^\uFEFF/, '') || '[]');
  } catch (_) {
    parsed = [];
  }
  return Array.isArray(parsed) ? parsed.map(normalizeStoredTemplate) : [];
}

async function getTeachingOutlineSectionTemplateById(id) {
  const rows = await getAllTeachingOutlineSectionTemplates();
  return rows.find((row) => String(row.id) === String(id)) || null;
}

async function addTeachingOutlineSectionTemplate(payload) {
  return queueWrite(async () => {
    const rows = await getAllTeachingOutlineSectionTemplates();
    const sanitized = sanitizeInput(payload, { isUpdate: false });
    const duplicate = rows.some((row) => (
      String(row.orgId) === String(sanitized.orgId) && row.skillId === sanitized.skillId
    ));
    if (duplicate) throw new Error(`Section template for skill "${sanitized.skillId}" already exists.`);
    const now = new Date().toISOString();
    const created = {
      id: sanitized.id || generateTemplateId(sanitized.skillId),
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

async function updateTeachingOutlineSectionTemplate(id, payload) {
  return queueWrite(async () => {
    const rows = await getAllTeachingOutlineSectionTemplates();
    const idx = rows.findIndex((row) => String(row.id) === String(id));
    if (idx < 0) throw new Error('Section template not found.');
    const current = rows[idx];
    const sanitized = sanitizeInput({
      ...current,
      ...payload,
      orgId: current.orgId,
      skillId: current.skillId
    }, { isUpdate: true });
    const now = new Date().toISOString();
    rows[idx] = {
      ...current,
      ...sanitized,
      orgId: current.orgId,
      skillId: current.skillId,
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

async function deleteTeachingOutlineSectionTemplate(id) {
  return queueWrite(async () => {
    const rows = await getAllTeachingOutlineSectionTemplates();
    const idx = rows.findIndex((row) => String(row.id) === String(id));
    if (idx < 0) return false;
    rows.splice(idx, 1);
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return true;
  });
}

module.exports = {
  getAllTeachingOutlineSectionTemplates,
  getTeachingOutlineSectionTemplateById,
  addTeachingOutlineSectionTemplate,
  updateTeachingOutlineSectionTemplate,
  deleteTeachingOutlineSectionTemplate,
  normalizeStoredTemplate,
  sanitizeInput,
  normalizeSectionKey,
  generateTemplateId
};
