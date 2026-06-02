const { requireCoreModule, resolveCoreRoot } = require('../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const dataPath = path.join(resolveCoreRoot(), 'data/school/classEnrollmentPeriods.json');

if (!fsSync.existsSync(dataPath)) {
  fsSync.writeFileSync(dataPath, '[]');
}

const PERIOD_STATUSES = new Set([
  'draft',
  'planned',
  'active',
  'completed',
  'withdrawn',
  'cancelled',
  'archived',
  'error'
]);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function sanitizeTransactionSummary(value) {
  if (!isPlainObject(value)) return {};
  const raw = value;
  const totalAmount = Number(raw.totalAmount);
  const transactionCount = Number(raw.transactionCount);
  return {
    mode: cleanString(raw.mode, { max: 30, allowEmpty: true }).toLowerCase() || '',
    currency: (cleanString(raw.currency, { max: 3, allowEmpty: true }) || 'CAD').toUpperCase(),
    totalAmount: Number.isFinite(totalAmount) ? Number(totalAmount.toFixed(2)) : 0,
    transactionCount: Number.isFinite(transactionCount) ? Math.max(0, Math.floor(transactionCount)) : 0,
    draftTransactionItems: Array.isArray(raw.draftTransactionItems) ? raw.draftTransactionItems : [],
    draftPreviewRows: Array.isArray(raw.draftPreviewRows) ? raw.draftPreviewRows : [],
    postedTransactionIds: Array.isArray(raw.postedTransactionIds)
      ? raw.postedTransactionIds.map((id) => cleanId(id, { max: 120, allowEmpty: true })).filter(Boolean)
      : [],
    draftSavedAt: cleanString(raw.draftSavedAt, { max: 40, allowEmpty: true }),
    postedAt: cleanString(raw.postedAt, { max: 40, allowEmpty: true }),
    note: cleanString(raw.note, { max: 500, allowEmpty: true }),
    warnings: Array.isArray(raw.warnings)
      ? raw.warnings.map((w) => cleanString(w, { max: 500, allowEmpty: true })).filter(Boolean)
      : []
  };
}

function cleanString(v, { max = 5000, allowEmpty = true } = {}) {
  if (v === undefined || v === null) return allowEmpty ? '' : null;
  const s = String(v).replace(/\0/g, '').trim();
  if (!allowEmpty && !s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function cleanId(v, { max = 80, allowEmpty = false } = {}) {
  const s = cleanString(v, { max, allowEmpty });
  if (s === null) return null;
  if (!s) return allowEmpty ? '' : null;
  if (!/^[A-Za-z0-9:_-]+$/.test(s)) throw new Error('Invalid id format.');
  return s;
}

function cleanDateOnly(v, { allowEmpty = false } = {}) {
  if (v === undefined || v === null || v === '') return allowEmpty ? '' : null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Invalid date format. Use YYYY-MM-DD.');
  return s;
}

function normalizeDateOrEmpty(value) {
  return cleanDateOnly(value, { allowEmpty: true }) || '';
}

function normalizeDateOrThrow(value, fieldName = 'date') {
  const normalized = cleanDateOnly(value, { allowEmpty: false });
  if (!normalized) throw new Error(`${fieldName} is required.`);
  return normalized;
}

function overlapsRange(periodStart, periodEnd, targetStart, targetEnd) {
  const pStart = normalizeDateOrEmpty(periodStart);
  const pEnd = normalizeDateOrEmpty(periodEnd);
  const tStart = normalizeDateOrEmpty(targetStart);
  const tEnd = normalizeDateOrEmpty(targetEnd);
  if (!tStart || !tEnd) return false;
  const normalizedPeriodEnd = pEnd || '9999-12-31';
  return pStart <= tEnd && normalizedPeriodEnd >= tStart;
}

function includesDate(periodStart, periodEnd, dateValue) {
  const day = normalizeDateOrEmpty(dateValue);
  if (!day) return false;
  return overlapsRange(periodStart, periodEnd, day, day);
}

function normalizeStatuses(input = []) {
  const rows = Array.isArray(input) ? input : [input];
  return rows
    .map((row) => String(row || '').trim().toLowerCase())
    .filter((row) => PERIOD_STATUSES.has(row));
}

function sanitizePeriodInput(input, { isUpdate = false } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid class enrollment period payload.');

  const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
  const classId = cleanId(input.classId, { max: 64, allowEmpty: false });
  const studentId = cleanId(input.studentId, { max: 64, allowEmpty: false });
  if (!orgId || !classId || !studentId) {
    throw new Error('orgId, classId, and studentId are required.');
  }

  const startDate = cleanDateOnly(input.startDate, { allowEmpty: isUpdate });
  const endDate = cleanDateOnly(input.endDate, { allowEmpty: true });
  if (!isUpdate && !startDate) throw new Error('startDate is required.');
  if (startDate && endDate && endDate < startDate) {
    throw new Error('endDate cannot be before startDate.');
  }

  const status = cleanString(input.status, { max: 30, allowEmpty: true }).toLowerCase() || 'active';
  if (!PERIOD_STATUSES.has(status)) throw new Error('Invalid class enrollment period status.');

  const parsedSequence = Number.parseInt(String(input.sequenceNo || '').trim(), 10);
  const sequenceNo = Number.isFinite(parsedSequence) && parsedSequence > 0 ? parsedSequence : 1;

  const createdBy = cleanId(input.createdBy, { max: 80, allowEmpty: true });
  const updatedBy = cleanId(input.updatedBy, { max: 80, allowEmpty: true });

  const programId = cleanId(input.programId, { max: 64, allowEmpty: true }) || '';
  const termId = cleanId(input.termId, { max: 64, allowEmpty: true }) || '';

  const out = {
    orgId,
    classId,
    studentId,
    status,
    startDate: startDate || '',
    endDate: endDate || '',
    programId,
    termId,
    funderType: cleanString(input.funderType, { max: 80, allowEmpty: true }),
    funderId: cleanId(input.funderId, { max: 80, allowEmpty: true }),
    authorizationRef: cleanString(input.authorizationRef, { max: 120, allowEmpty: true }),
    reasonStart: cleanString(input.reasonStart, { max: 300, allowEmpty: true }),
    reasonEnd: cleanString(input.reasonEnd, { max: 300, allowEmpty: true }),
    notes: cleanString(input.notes, { max: 1000, allowEmpty: true }),
    completionDecision: (() => {
      const raw = String(input.completionDecision || '').trim().toLowerCase();
      return ['pass', 'continue', 'withdraw'].includes(raw) ? raw : '';
    })(),
    completionDecisionNotes: cleanString(input.completionDecisionNotes, { max: 2000, allowEmpty: true }),
    transactionSummary: sanitizeTransactionSummary(input.transactionSummary),
    sequenceNo,
    createdBy: createdBy || '',
    updatedBy: updatedBy || ''
  };

  if (!isUpdate && input.id) {
    out.id = cleanId(input.id, { max: 80, allowEmpty: false });
  }

  return out;
}

function generateId(existingIds) {
  for (let i = 0; i < 50; i++) {
    const candidate = `CEP-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `CEP-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

async function getAllEnrollmentPeriods() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(data || '[]');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve class enrollment periods.');
  }
}

async function getEnrollmentPeriodById(id) {
  const all = await getAllEnrollmentPeriods();
  return all.find((row) => idsEqual(row?.id, id)) || null;
}

async function findByClassId(classId) {
  const all = await getAllEnrollmentPeriods();
  return all.filter((row) => idsEqual(row?.classId, classId));
}

async function findByStudentId(studentId) {
  const all = await getAllEnrollmentPeriods();
  return all.filter((row) => idsEqual(row?.studentId, studentId));
}

async function findByOrgId(orgId) {
  const all = await getAllEnrollmentPeriods();
  return all.filter((row) => idsEqual(row?.orgId, orgId));
}

async function findByClassIdInRange(classId, startDate, endDate, options = {}) {
  const from = normalizeDateOrThrow(startDate, 'startDate');
  const to = normalizeDateOrThrow(endDate, 'endDate');
  const statuses = normalizeStatuses(options?.statuses);
  const all = await getAllEnrollmentPeriods();
  return all.filter((row) => {
    if (!idsEqual(row?.classId, classId)) return false;
    if (statuses.length && !statuses.includes(String(row?.status || '').trim().toLowerCase())) return false;
    return overlapsRange(row?.startDate, row?.endDate, from, to);
  });
}

async function findByStudentIdInRange(studentId, startDate, endDate, options = {}) {
  const from = normalizeDateOrThrow(startDate, 'startDate');
  const to = normalizeDateOrThrow(endDate, 'endDate');
  const statuses = normalizeStatuses(options?.statuses);
  const all = await getAllEnrollmentPeriods();
  return all.filter((row) => {
    if (!idsEqual(row?.studentId, studentId)) return false;
    if (statuses.length && !statuses.includes(String(row?.status || '').trim().toLowerCase())) return false;
    return overlapsRange(row?.startDate, row?.endDate, from, to);
  });
}

async function findActiveByClassIdOnDate(classId, onDate) {
  const day = normalizeDateOrThrow(onDate, 'onDate');
  const all = await getAllEnrollmentPeriods();
  return all.filter((row) =>
    idsEqual(row?.classId, classId) &&
    String(row?.status || '').trim().toLowerCase() === 'active' &&
    includesDate(row?.startDate, row?.endDate, day)
  );
}

async function findActiveByStudentIdOnDate(studentId, onDate) {
  const day = normalizeDateOrThrow(onDate, 'onDate');
  const all = await getAllEnrollmentPeriods();
  return all.filter((row) =>
    idsEqual(row?.studentId, studentId) &&
    String(row?.status || '').trim().toLowerCase() === 'active' &&
    includesDate(row?.startDate, row?.endDate, day)
  );
}

async function addEnrollmentPeriod(data, options = {}) {
  void options;
  return queueWrite(async () => {
    const all = await getAllEnrollmentPeriods();
    const sanitized = sanitizePeriodInput(data, { isUpdate: false });
    const ids = new Set(all.map((row) => toPublicId(row?.id)).filter(Boolean));
    const now = new Date().toISOString();
    const createdBy = sanitized.createdBy || 'system';
    const updatedBy = sanitized.updatedBy || createdBy;

    const created = {
      ...sanitized,
      id: sanitized.id || generateId(ids),
      createdBy,
      updatedBy,
      audit: {
        createUser: createdBy,
        createDateTime: now,
        lastUpdateUser: updatedBy,
        lastUpdateDateTime: now
      }
    };
    all.push(created);
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return created;
  });
}

async function updateEnrollmentPeriod(id, data, options = {}) {
  void options;
  return queueWrite(async () => {
    const all = await getAllEnrollmentPeriods();
    const index = all.findIndex((row) => idsEqual(row?.id, id));
    if (index === -1) throw new Error('Class enrollment period not found.');

    const existing = all[index];
    const mergedInput = {
      ...existing,
      ...data,
      orgId: existing.orgId,
      classId: existing.classId,
      studentId: existing.studentId
    };
    const sanitized = sanitizePeriodInput(mergedInput, { isUpdate: true });
    delete sanitized.id;

    const now = new Date().toISOString();
    const createdBy = existing.createdBy || existing?.audit?.createUser || 'system';
    const updatedBy = sanitized.updatedBy || data?.updatedBy || existing.updatedBy || createdBy;

    all[index] = {
      ...existing,
      ...sanitized,
      createdBy,
      updatedBy,
      audit: {
        ...(isPlainObject(existing.audit) ? existing.audit : {}),
        createUser: existing?.audit?.createUser || createdBy,
        createDateTime: existing?.audit?.createDateTime || now,
        lastUpdateUser: updatedBy,
        lastUpdateDateTime: now
      }
    };
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return all[index];
  });
}

async function deleteEnrollmentPeriod(id, options = {}) {
  void options;
  return queueWrite(async () => {
    const all = await getAllEnrollmentPeriods();
    const filtered = all.filter((row) => !idsEqual(row?.id, id));
    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
  });
}

async function clearByOrg(orgId) {
  return queueWrite(async () => {
    const targetOrgId = toPublicId(orgId);
    if (!targetOrgId) throw new Error('orgId is required to clear class enrollment periods.');

    const all = await getAllEnrollmentPeriods();
    const before = all.length;
    const filtered = all.filter((row) => !idsEqual(row?.orgId, targetOrgId));
    const removed = before - filtered.length;
    if (!removed) return { removed: 0, remaining: before };

    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
    return { removed, remaining: filtered.length };
  });
}

module.exports = {
  PERIOD_STATUSES: Object.freeze([...PERIOD_STATUSES]),
  getAllEnrollmentPeriods,
  getEnrollmentPeriodById,
  findByClassId,
  findByStudentId,
  findByOrgId,
  findByClassIdInRange,
  findByStudentIdInRange,
  findActiveByClassIdOnDate,
  findActiveByStudentIdOnDate,
  addEnrollmentPeriod,
  updateEnrollmentPeriod,
  deleteEnrollmentPeriod,
  clearByOrg
};

