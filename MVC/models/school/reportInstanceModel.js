const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('../fileQueue');
const { idsEqual, toPublicId } = require('../../utils/idAdapter');

const dataPath = path.join(__dirname, '../../../data/school/reportInstances.json');

if (!fsSync.existsSync(dataPath)) {
  fsSync.writeFileSync(dataPath, '[]');
}

const INSTANCE_STATUSES = new Set(['draft', 'submitted', 'locked']);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function cleanString(v, { max = 500, allowEmpty = true } = {}) {
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

function cleanDateOnly(v, { allowEmpty = true } = {}) {
  const s = cleanString(v, { max: 10, allowEmpty });
  if (s === null) return null;
  if (!s) return allowEmpty ? '' : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Invalid date format. Use YYYY-MM-DD.');
  return s;
}

function cleanInteger(v, { min = 1, max = 1000000, allowEmpty = true } = {}) {
  if (v === undefined || v === null || v === '') return allowEmpty ? null : NaN;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error('Invalid integer value.');
  if (n < min || n > max) throw new Error('Integer out of range.');
  return n;
}

function cleanPlainObject(v, label) {
  if (!isPlainObject(v)) return {};
  const out = {};
  Object.keys(v).forEach((key) => {
    const safeKey = cleanString(key, { max: 120, allowEmpty: false });
    if (!safeKey) return;
    const value = v[key];
    if (value === undefined) return;
    if (value === null) {
      out[safeKey] = null;
      return;
    }
    const valueType = typeof value;
    if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
      out[safeKey] = value;
      return;
    }
    if (Array.isArray(value) || isPlainObject(value)) {
      out[safeKey] = value;
      return;
    }
    out[safeKey] = String(value);
  });
  return out;
}

function sanitizeGeneratedDocs(v) {
  const list = Array.isArray(v) ? v : [];
  return list.map((doc) => ({
    fileName: cleanString(doc?.fileName || doc?.filename, { max: 260, allowEmpty: false }),
    originalName: cleanString(doc?.originalName, { max: 260, allowEmpty: true }),
    path: cleanString(doc?.path, { max: 600, allowEmpty: true }),
    url: cleanString(doc?.url, { max: 600, allowEmpty: true }),
    format: cleanString(doc?.format, { max: 40, allowEmpty: true }),
    generatedAt: cleanString(doc?.generatedAt, { max: 60, allowEmpty: true }) || new Date().toISOString()
  }));
}

function sanitizeAudit(v, existingAudit = {}) {
  const raw = isPlainObject(v) ? v : {};
  return {
    createUser: cleanString(raw.createUser || existingAudit.createUser, { max: 80, allowEmpty: true }),
    createDateTime: cleanString(raw.createDateTime || existingAudit.createDateTime, { max: 60, allowEmpty: true }) || new Date().toISOString(),
    lastUpdateUser: cleanString(raw.lastUpdateUser, { max: 80, allowEmpty: true }),
    lastUpdateDateTime: cleanString(raw.lastUpdateDateTime, { max: 60, allowEmpty: true }),
    submittedAt: cleanString(raw.submittedAt || existingAudit.submittedAt, { max: 60, allowEmpty: true }),
    lockedAt: cleanString(raw.lockedAt || existingAudit.lockedAt, { max: 60, allowEmpty: true })
  };
}

function sanitizeInstance(input, { isUpdate = false, existing = null } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid report instance payload.');

  const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
  const assignmentId = cleanId(input.assignmentId, { max: 80, allowEmpty: false });
  const classId = cleanId(input.classId, { max: 80, allowEmpty: false });
  const templateId = cleanId(input.templateId, { max: 80, allowEmpty: false });
  const templateVersion = cleanInteger(input.templateVersion, { min: 1, max: 1000, allowEmpty: false });
  const sessionId = cleanId(input.sessionId, { max: 80, allowEmpty: true }) || '';
  const sessionDate = cleanDateOnly(input.sessionDate, { allowEmpty: false });
  const teacherId = cleanId(input.teacherId, { max: 80, allowEmpty: false });

  const status = cleanString(input.status, { max: 20, allowEmpty: true }).toLowerCase() || 'draft';
  if (!INSTANCE_STATUSES.has(status)) throw new Error('Invalid instance status.');

  const out = {
    orgId,
    assignmentId,
    classId,
    sessionId,
    sessionDate,
    templateId,
    templateVersion,
    teacherId,
    studentId: cleanId(input.studentId, { max: 80, allowEmpty: true }),
    targetKey: cleanString(input.targetKey, { max: 120, allowEmpty: true }) || 'class',
    status,
    answers: cleanPlainObject(input.answers, 'answers'),
    prefillSnapshot: cleanPlainObject(input.prefillSnapshot, 'prefillSnapshot'),
    generatedDocs: sanitizeGeneratedDocs(input.generatedDocs),
    audit: sanitizeAudit(input.audit, existing?.audit || {})
  };

  if (!isUpdate && input.id) out.id = cleanId(input.id, { max: 80, allowEmpty: false });
  return out;
}

function generateInstanceId(existingIds) {
  const year = new Date().getFullYear();
  for (let i = 0; i < 50; i++) {
    const candidate = `RPTINS-${year}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `RPTINS-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

async function getAllInstances() {
  try {
    const raw = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve report instances.');
  }
}

async function getInstanceById(id) {
  const all = await getAllInstances();
  return all.find((row) => idsEqual(row.id, id)) || null;
}

async function findByAssignmentTeacherTarget(assignmentId, teacherId, targetKey = 'class') {
  const all = await getAllInstances();
  return all.find((row) =>
    idsEqual(row.assignmentId, assignmentId) &&
    idsEqual(row.teacherId, teacherId) &&
    String(row.targetKey || 'class') === String(targetKey || 'class')
  ) || null;
}

function assertUnique(list, candidate, { excludeId = null } = {}) {
  const duplicate = list.some((row) => {
    if (excludeId && idsEqual(row.id, excludeId)) return false;
    return (
      idsEqual(row.assignmentId, candidate.assignmentId) &&
      idsEqual(row.teacherId, candidate.teacherId) &&
      String(row.targetKey || 'class') === String(candidate.targetKey || 'class')
    );
  });

  if (duplicate) {
    throw new Error('A report instance already exists for the same assignment, teacher, and target.');
  }
}

async function addInstance(input) {
  return queueWrite(async () => {
    const all = await getAllInstances();
    const sanitized = sanitizeInstance(input, { isUpdate: false });
    assertUnique(all, sanitized);

    const existingIds = new Set(all.map((row) => toPublicId(row.id)).filter(Boolean));
    const id = sanitized.id || generateInstanceId(existingIds);
    if (existingIds.has(id)) throw new Error('Instance id already exists.');

    const record = {
      ...sanitized,
      id,
      audit: {
        ...sanitized.audit,
        createDateTime: sanitized.audit.createDateTime || new Date().toISOString()
      }
    };

    all.push(record);
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return record;
  });
}

async function updateInstance(id, updates) {
  return queueWrite(async () => {
    const all = await getAllInstances();
    const index = all.findIndex((row) => idsEqual(row.id, id));
    if (index === -1) throw new Error('Report instance not found.');

    const existing = all[index];
    const mergedInput = { ...existing, ...updates };
    const sanitized = sanitizeInstance(mergedInput, { isUpdate: true, existing });

    assertUnique(all, sanitized, { excludeId: id });

    const nextAudit = {
      ...existing.audit,
      ...sanitized.audit,
      createDateTime: existing.audit?.createDateTime || sanitized.audit?.createDateTime || new Date().toISOString(),
      lastUpdateDateTime: new Date().toISOString()
    };
    if (sanitized.status === 'submitted' && !nextAudit.submittedAt) nextAudit.submittedAt = new Date().toISOString();
    if (sanitized.status === 'locked' && !nextAudit.lockedAt) nextAudit.lockedAt = new Date().toISOString();

    all[index] = {
      ...existing,
      ...sanitized,
      id: existing.id,
      audit: nextAudit
    };

    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return all[index];
  });
}

async function deleteInstance(id) {
  return queueWrite(async () => {
    const all = await getAllInstances();
    const filtered = all.filter((row) => !idsEqual(row.id, id));
    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
  });
}

async function clearByOrg(orgId, options = {}) {
  void options;
  return queueWrite(async () => {
    const targetOrgId = toPublicId(orgId);
    if (!targetOrgId) throw new Error('orgId is required to clear report instances.');
    const all = await getAllInstances();
    const kept = all.filter((row) => !idsEqual(row.orgId, targetOrgId));
    const removed = all.length - kept.length;
    await fs.writeFile(dataPath, JSON.stringify(kept, null, 2));
    return { removed, remaining: kept.length };
  });
}

module.exports = {
  INSTANCE_STATUSES: Object.freeze([...INSTANCE_STATUSES]),
  getAllInstances,
  getInstanceById,
  findByAssignmentTeacherTarget,
  addInstance,
  updateInstance,
  deleteInstance,
  clearByOrg
};
