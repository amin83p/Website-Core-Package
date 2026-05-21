const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('../fileQueue');

const dataPath = path.join(__dirname, '../../../data/school/sessionStatuses.json');

const DEFAULT_SESSION_STATUS_TEMPLATES = Object.freeze([
  Object.freeze({
    code: 'scheduled',
    label: 'Scheduled',
    description: 'Session is planned but not finalized.',
    timesheetFormula: 'duration',
    isFinal: false,
    makeUpRequired: false,
    excludeFromAttendance: false,
    excludeFromTeacherIndex: false,
    excludeFromStudentIndex: false,
    active: true,
    sortOrder: 10,
    colorBg: '#e7f1ff',
    colorText: '#084298',
    colorBorder: '#b6d4fe'
  }),
  Object.freeze({
    code: 'completed',
    label: 'Completed',
    description: 'Session delivered as planned.',
    timesheetFormula: 'duration',
    isFinal: true,
    makeUpRequired: false,
    excludeFromAttendance: false,
    excludeFromTeacherIndex: false,
    excludeFromStudentIndex: false,
    active: true,
    sortOrder: 20,
    colorBg: '#d1e7dd',
    colorText: '#0f5132',
    colorBorder: '#a3cfbb'
  }),
  Object.freeze({
    code: 'cancelled',
    label: 'Cancelled',
    description: 'Session was cancelled and does not count in payroll.',
    timesheetFormula: '0',
    isFinal: true,
    makeUpRequired: false,
    excludeFromAttendance: true,
    excludeFromTeacherIndex: true,
    excludeFromStudentIndex: true,
    active: true,
    sortOrder: 30,
    colorBg: '#f8d7da',
    colorText: '#842029',
    colorBorder: '#f1aeb5'
  }),
  Object.freeze({
    code: 'missed_informed24',
    label: 'Missed (Informed-24)',
    description: 'Session missed after 24-hour notice; no payroll, makeup session required.',
    timesheetFormula: '0',
    isFinal: true,
    makeUpRequired: true,
    excludeFromAttendance: true,
    excludeFromTeacherIndex: false,
    excludeFromStudentIndex: false,
    active: true,
    sortOrder: 40,
    colorBg: '#fff3cd',
    colorText: '#664d03',
    colorBorder: '#ffe69c'
  })
]);

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
  return raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50);
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
  return Number(n.toFixed(2));
}

function cleanColor(v, fallback) {
  const s = String(v || '').trim();
  if (!s) return fallback;
  const normalized = s.startsWith('#') ? s : `#${s}`;
  if (!/^#[0-9A-Fa-f]{6}$/.test(normalized)) throw new Error('Color must be a 6-digit hex value.');
  return normalized.toUpperCase();
}

function cleanFormula(v) {
  const s = cleanString(v, { max: 180, allowEmpty: false });
  if (!s) return 'duration';
  if (!/^[A-Za-z0-9_+\-*/().\s]+$/.test(s)) {
    throw new Error('Formula contains unsupported characters.');
  }
  return s;
}

function generateStatusId() {
  const year = new Date().getFullYear();
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `SSS-${year}-${rand}`;
}

function getDefaultStatusesForOrg(orgId, userId = 'SYSTEM') {
  const now = new Date().toISOString();
  return DEFAULT_SESSION_STATUS_TEMPLATES.map((tpl) => ({
    id: generateStatusId(),
    orgId: String(orgId || ''),
    ...tpl,
    audit: {
      createUser: String(userId || 'SYSTEM'),
      createDateTime: now,
      lastUpdateUser: String(userId || 'SYSTEM'),
      lastUpdateDateTime: now
    }
  }));
}

async function ensureDataFile() {
  if (!fsSync.existsSync(path.dirname(dataPath))) {
    fsSync.mkdirSync(path.dirname(dataPath), { recursive: true });
  }
  if (!fsSync.existsSync(dataPath)) {
    fsSync.writeFileSync(dataPath, '[]');
  }
}

function normalizeStoredStatus(row) {
  const code = normalizeCode(row?.code);
  const label = cleanString(row?.label, { max: 120, allowEmpty: true }) || code;
  const now = new Date().toISOString();
  return {
    id: cleanId(row?.id || generateStatusId(), { max: 80, allowEmpty: false }),
    orgId: cleanId(row?.orgId || '', { max: 64, allowEmpty: false }),
    code,
    label,
    description: cleanString(row?.description, { max: 1000, allowEmpty: true }),
    timesheetFormula: cleanFormula(row?.timesheetFormula || 'duration'),
    isFinal: cleanBoolean(row?.isFinal, false),
    makeUpRequired: cleanBoolean(row?.makeUpRequired, false),
    excludeFromAttendance: cleanBoolean(row?.excludeFromAttendance, false),
    excludeFromTeacherIndex: cleanBoolean(row?.excludeFromTeacherIndex, false),
    excludeFromStudentIndex: cleanBoolean(row?.excludeFromStudentIndex, false),
    active: cleanBoolean(row?.active, true),
    sortOrder: cleanNumber(row?.sortOrder, { min: 0, max: 9999, defaultValue: 100 }),
    colorBg: cleanColor(row?.colorBg, '#E2E3E5'),
    colorText: cleanColor(row?.colorText, '#41464B'),
    colorBorder: cleanColor(row?.colorBorder, '#C6C8CA'),
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
    throw new Error('Invalid session status payload.');
  }

  const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
  const code = normalizeCode(input.code);
  const label = cleanString(input.label, { max: 120, allowEmpty: false });

  if (!orgId) throw new Error('Organization is required.');
  if (!code) throw new Error('Status code is required.');
  if (!label) throw new Error('Status label is required.');

  const out = {
    orgId: String(orgId),
    code,
    label,
    description: cleanString(input.description, { max: 1000, allowEmpty: true }),
    timesheetFormula: cleanFormula(input.timesheetFormula || 'duration'),
    isFinal: cleanBoolean(input.isFinal, false),
    makeUpRequired: cleanBoolean(input.makeUpRequired, false),
    excludeFromAttendance: cleanBoolean(input.excludeFromAttendance, false),
    excludeFromTeacherIndex: cleanBoolean(input.excludeFromTeacherIndex, false),
    excludeFromStudentIndex: cleanBoolean(input.excludeFromStudentIndex, false),
    active: cleanBoolean(input.active, true),
    sortOrder: cleanNumber(input.sortOrder, { min: 0, max: 9999, defaultValue: 100 }),
    colorBg: cleanColor(input.colorBg, '#E2E3E5'),
    colorText: cleanColor(input.colorText, '#41464B'),
    colorBorder: cleanColor(input.colorBorder, '#C6C8CA')
  };

  if (!isUpdate && input.id) {
    out.id = cleanId(input.id, { max: 80, allowEmpty: false });
  }

  return out;
}

function assertUniqueCode(rows, candidate, { excludeId = null } = {}) {
  const candidateOrg = String(candidate.orgId || '');
  const candidateCode = normalizeCode(candidate.code);
  const duplicate = (rows || []).some((row) => {
    if (excludeId && String(row.id) === String(excludeId)) return false;
    return String(row.orgId || '') === candidateOrg && normalizeCode(row.code) === candidateCode;
  });
  if (duplicate) throw new Error(`Session status code "${candidateCode}" already exists.`);
}

async function getAllSessionStatuses() {
  await ensureDataFile();
  const data = await fs.readFile(dataPath, 'utf8');
  let parsed = [];
  try {
    parsed = JSON.parse(String(data || '[]').replace(/^\uFEFF/, '') || '[]');
  } catch (_) {
    parsed = [];
  }
  return Array.isArray(parsed) ? parsed.map(normalizeStoredStatus) : [];
}

async function getSessionStatusById(id) {
  const rows = await getAllSessionStatuses();
  return rows.find((row) => String(row.id) === String(id)) || null;
}

async function ensureOrgDefaultSessionStatuses(orgId, userId = 'SYSTEM') {
  const targetOrgId = cleanId(orgId, { max: 64, allowEmpty: false });
  if (!targetOrgId) throw new Error('Organization is required.');

  return queueWrite(async () => {
    const rows = await getAllSessionStatuses();
    const orgRows = rows.filter((row) => String(row.orgId) === String(targetOrgId));
    if (orgRows.length > 0) return orgRows;

    const defaults = getDefaultStatusesForOrg(targetOrgId, userId);
    const merged = [...rows, ...defaults];
    await fs.writeFile(dataPath, JSON.stringify(merged, null, 2));
    return defaults;
  });
}

async function addSessionStatus(payload) {
  return queueWrite(async () => {
    const rows = await getAllSessionStatuses();
    const sanitized = sanitizeInput(payload, { isUpdate: false });
    assertUniqueCode(rows, sanitized);

    const now = new Date().toISOString();
    const created = {
      id: sanitized.id || generateStatusId(),
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

async function updateSessionStatus(id, payload) {
  return queueWrite(async () => {
    const rows = await getAllSessionStatuses();
    const idx = rows.findIndex((row) => String(row.id) === String(id));
    if (idx < 0) throw new Error('Session status not found.');

    const current = rows[idx];
    const sanitized = sanitizeInput({
      ...current,
      ...payload,
      orgId: current.orgId
    }, { isUpdate: true });

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

async function deleteSessionStatus(id) {
  return queueWrite(async () => {
    const rows = await getAllSessionStatuses();
    const idx = rows.findIndex((row) => String(row.id) === String(id));
    if (idx < 0) return false;

    const target = rows[idx];
    if (String(target.orgId || '').toUpperCase() === 'SYSTEM') {
      throw new Error('System-level session statuses cannot be deleted.');
    }

    rows.splice(idx, 1);
    await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
    return true;
  });
}

module.exports = {
  getAllSessionStatuses,
  getSessionStatusById,
  addSessionStatus,
  updateSessionStatus,
  deleteSessionStatus,
  ensureOrgDefaultSessionStatuses,
  DEFAULT_SESSION_STATUS_TEMPLATES
};
