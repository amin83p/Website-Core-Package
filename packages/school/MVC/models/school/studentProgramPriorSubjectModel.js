const { requireCoreModule, resolveCoreRoot } = require('../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const dataPath = path.join(resolveCoreRoot(), 'data/school/studentProgramPriorSubjects.json');

if (!fsSync.existsSync(dataPath)) {
  fsSync.writeFileSync(dataPath, '[]');
}

const PRIOR_SUBJECT_STATUSES = new Set(['active', 'revoked']);
const PRIOR_SUBJECT_SOURCES = new Set(['transfer', 'placement', 'equivalent', 'manual_waiver']);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function cleanString(v, { max = 2000, allowEmpty = true } = {}) {
  if (v === undefined || v === null) return allowEmpty ? '' : null;
  const s = String(v).replace(/\0/g, '').trim();
  if (!allowEmpty && !s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function cleanId(v, { max = 64, allowEmpty = false } = {}) {
  const s = cleanString(v, { max, allowEmpty });
  if (s === null) return null;
  if (!s) return allowEmpty ? '' : null;
  if (!/^[A-Za-z0-9:_-]+$/.test(s)) throw new Error('Invalid id format.');
  return s;
}

function sanitizeInput(input, { isUpdate = false, lockKeys = null } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid prior subject credit payload.');

  const orgId = lockKeys?.orgId ?? cleanId(input.orgId, { allowEmpty: false });
  const studentId = lockKeys?.studentId ?? cleanId(input.studentId, { allowEmpty: false });
  const programId = lockKeys?.programId ?? cleanId(input.programId, { allowEmpty: false });
  const subjectId = lockKeys?.subjectId ?? cleanId(input.subjectId, { allowEmpty: false });

  if (!orgId || !studentId || !programId || !subjectId) {
    throw new Error('orgId, studentId, programId, and subjectId are required.');
  }

  const sourceRaw = cleanString(input.source, { max: 40, allowEmpty: true }).toLowerCase() || 'manual_waiver';
  if (!PRIOR_SUBJECT_SOURCES.has(sourceRaw)) {
    throw new Error('Invalid prior subject source.');
  }

  const statusRaw = cleanString(input.status, { max: 20, allowEmpty: true }).toLowerCase() || 'active';
  if (!PRIOR_SUBJECT_STATUSES.has(statusRaw)) {
    throw new Error('Invalid prior subject credit status.');
  }

  const out = {
    orgId,
    studentId,
    programId,
    subjectId,
    source: sourceRaw,
    status: statusRaw,
    evidenceNote: cleanString(input.evidenceNote, { max: 4000, allowEmpty: true })
  };

  if (!isUpdate && input.id) {
    out.id = cleanId(input.id, { allowEmpty: false });
  }

  return out;
}

function generateId(existingIds) {
  for (let i = 0; i < 50; i++) {
    const candidate = `SPPS-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `SPPS-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

async function getAllRecords() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(data || '[]');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve student program prior subject credits.');
  }
}

async function getRecordById(id) {
  const all = await getAllRecords();
  return all.find((row) => idsEqual(row.id, id)) || null;
}

function findActiveDuplicate(all, { orgId, studentId, programId, subjectId, excludeId }) {
  return all.find((row) =>
    idsEqual(row.orgId, orgId) &&
    idsEqual(row.studentId, studentId) &&
    idsEqual(row.programId, programId) &&
    idsEqual(row.subjectId, subjectId) &&
    String(row.status || '').toLowerCase() === 'active' &&
    (!excludeId || !idsEqual(row.id, excludeId))
  ) || null;
}

async function addRecord(data, options = {}) {
  void options;
  return queueWrite(async () => {
    const all = await getAllRecords();
    const sanitized = sanitizeInput(data, { isUpdate: false });
    if (findActiveDuplicate(all, sanitized)) {
      throw new Error('An active prior credit already exists for this student, program, and subject.');
    }

    const ids = new Set(all.map((row) => toPublicId(row.id)).filter(Boolean));
    const nowIso = new Date().toISOString();
    const created = {
      ...sanitized,
      id: sanitized.id || generateId(ids),
      audit: { createDateTime: nowIso, lastUpdateDateTime: nowIso }
    };
    all.push(created);
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return created;
  });
}

async function updateRecord(id, data, options = {}) {
  void options;
  return queueWrite(async () => {
    const all = await getAllRecords();
    const index = all.findIndex((row) => idsEqual(row.id, id));
    if (index === -1) throw new Error('Prior subject credit not found.');

    const existing = all[index];
    const sanitized = sanitizeInput({
      ...existing,
      ...data,
      orgId: existing.orgId,
      studentId: existing.studentId,
      programId: existing.programId,
      subjectId: existing.subjectId
    }, {
      isUpdate: true,
      lockKeys: {
        orgId: existing.orgId,
        studentId: existing.studentId,
        programId: existing.programId,
        subjectId: existing.subjectId
      }
    });

    const dup = findActiveDuplicate(all, {
      orgId: sanitized.orgId,
      studentId: sanitized.studentId,
      programId: sanitized.programId,
      subjectId: sanitized.subjectId,
      excludeId: existing.id
    });
    if (dup && String(sanitized.status || '').toLowerCase() === 'active') {
      throw new Error('Another active prior credit already exists for this student, program, and subject.');
    }

    delete sanitized.id;
    const prevAudit = isPlainObject(existing.audit) ? existing.audit : {};
    all[index] = {
      ...existing,
      ...sanitized,
      id: existing.id,
      audit: {
        ...prevAudit,
        lastUpdateDateTime: new Date().toISOString()
      }
    };
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return all[index];
  });
}

async function deleteRecord(id, options = {}) {
  void options;
  return queueWrite(async () => {
    const all = await getAllRecords();
    const filtered = all.filter((row) => !idsEqual(row.id, id));
    if (filtered.length === all.length) throw new Error('Prior subject credit not found.');
    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
  });
}

async function clearByOrg(orgId, options = {}) {
  void options;
  return queueWrite(async () => {
    const targetOrgId = toPublicId(orgId);
    if (!targetOrgId) throw new Error('orgId is required to clear prior subject credits.');

    const all = await getAllRecords();
    const before = all.length;
    const filtered = all.filter((row) => !idsEqual(row?.orgId, targetOrgId));
    const removed = before - filtered.length;
    if (!removed) return { removed: 0, remaining: before };

    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
    return { removed, remaining: filtered.length };
  });
}

module.exports = {
  PRIOR_SUBJECT_SOURCES: Object.freeze([...PRIOR_SUBJECT_SOURCES]),
  PRIOR_SUBJECT_STATUSES: Object.freeze([...PRIOR_SUBJECT_STATUSES]),
  getAllRecords,
  getRecordById,
  addRecord,
  updateRecord,
  deleteRecord,
  clearByOrg
};

