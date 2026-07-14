const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const dataPath = path.join(resolveCoreRoot(), 'data/school/studentProgramRegistrations.json');

if (!fsSync.existsSync(dataPath)) {
  fsSync.writeFileSync(dataPath, '[]');
}

const REGISTRATION_STATUSES = new Set(['draft', 'registered', 'withdrawn', 'cancelled', 'completed', 'error', 'rolled_back', 'void']);
const { applyVoidMetadata } = require('./voidRecordMetadata');

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

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
  if (!/^[A-Za-z0-9:_-]+$/.test(s)) throw new Error('Invalid id format.');
  return s;
}

function cleanDateOnly(v, { allowEmpty = false } = {}) {
  if (v === undefined || v === null || v === '') return allowEmpty ? '' : null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Invalid date format. Use YYYY-MM-DD.');
  return s;
}

function sanitizeRegistrationInput(input, { isUpdate = false } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid student program registration payload.');
  const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
  const studentId = cleanId(input.studentId, { max: 64, allowEmpty: false });
  const personId = cleanId(input.personId, { max: 64, allowEmpty: false });
  const programId = cleanId(input.programId, { max: 64, allowEmpty: false });
  if (!orgId || !studentId || !personId || !programId) {
    throw new Error('orgId, studentId, personId, and programId are required.');
  }

  const status = cleanString(input.status, { max: 20, allowEmpty: true }).toLowerCase() || 'registered';
  if (!REGISTRATION_STATUSES.has(status)) throw new Error('Invalid student program registration status.');

  const out = {
    orgId,
    studentId,
    personId,
    programId,
    registrationDate: cleanDateOnly(input.registrationDate, { allowEmpty: isUpdate }) || new Date().toISOString().slice(0, 10),
    status,
    feeCategorySnapshot: cleanString(input.feeCategorySnapshot, { max: 80, allowEmpty: true }),
    note: cleanString(input.note, { max: 2000, allowEmpty: true }),
    transactionSummary: isPlainObject(input.transactionSummary) ? input.transactionSummary : {},
    academicSummary: isPlainObject(input.academicSummary) ? input.academicSummary : {}
  };

  if (!isUpdate && input.id) {
    out.id = cleanId(input.id, { max: 64, allowEmpty: false });
  }

  return applyVoidMetadata(out, input);
}

function generateId(existingIds) {
  for (let i = 0; i < 50; i++) {
    const candidate = `SPR-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `SPR-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

async function getAllRegistrations() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(data || '[]');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve student program registrations.');
  }
}

async function getRegistrationById(id) {
  const all = await getAllRegistrations();
  return all.find((row) => idsEqual(row.id, id)) || null;
}

async function findByStudentAndProgram(studentId, programId) {
  const all = await getAllRegistrations();
  return all.filter((row) =>
    idsEqual(row.studentId, studentId) &&
    idsEqual(row.programId, programId)
  );
}

async function addRegistration(data, options = {}) {
  void options;
  return queueWrite(async () => {
    const all = await getAllRegistrations();
    const sanitized = sanitizeRegistrationInput(data, { isUpdate: false });
    const activeDuplicate = all.find((row) =>
      idsEqual(row.studentId, sanitized.studentId) &&
      idsEqual(row.programId, sanitized.programId) &&
      !['withdrawn', 'cancelled', 'completed', 'rolled_back', 'void'].includes(String(row.status || '').toLowerCase())
    );
    if (activeDuplicate) {
      throw new Error('Student already has an active registration in this program.');
    }

    const ids = new Set(all.map((row) => toPublicId(row.id)).filter(Boolean));
    const created = {
      ...sanitized,
      id: sanitized.id || generateId(ids),
      audit: { createDateTime: new Date().toISOString() }
    };
    all.push(created);
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return created;
  });
}

async function updateRegistration(id, data, options = {}) {
  void options;
  return queueWrite(async () => {
    const all = await getAllRegistrations();
    const index = all.findIndex((row) => idsEqual(row.id, id));
    if (index === -1) throw new Error('Student program registration not found.');

    const existing = all[index];
    const sanitized = sanitizeRegistrationInput({
      ...data,
      orgId: existing.orgId,
      studentId: existing.studentId,
      personId: existing.personId,
      programId: existing.programId
    }, { isUpdate: true });

    delete sanitized.id;
    all[index] = {
      ...existing,
      ...sanitized,
      audit: { ...existing.audit, lastUpdateDateTime: new Date().toISOString() }
    };
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return all[index];
  });
}

async function clearRegistrationsByOrg(orgId) {
  return queueWrite(async () => {
    const targetOrgId = toPublicId(orgId);
    if (!targetOrgId) throw new Error('orgId is required to clear student program registrations.');

    const all = await getAllRegistrations();
    const before = all.length;
    const filtered = all.filter((row) => !idsEqual(row?.orgId, targetOrgId));
    const removed = before - filtered.length;
    if (!removed) return { removed: 0, remaining: before };

    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
    return { removed, remaining: filtered.length };
  });
}

async function deleteRegistration(id, options = {}) {
  void options;
  return queueWrite(async () => {
    const normalizedId = toPublicId(id);
    if (!normalizedId) throw new Error('Registration id is required.');

    const all = await getAllRegistrations();
    const filtered = all.filter((row) => !idsEqual(row?.id, normalizedId));
    if (filtered.length === all.length) throw new Error('Student program registration not found.');

    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
    return { id: normalizedId, deleted: true };
  });
}

module.exports = {
  REGISTRATION_STATUSES: Object.freeze([...REGISTRATION_STATUSES]),
  getAllRegistrations,
  getRegistrationById,
  findByStudentAndProgram,
  addRegistration,
  updateRegistration,
  deleteRegistration,
  clearRegistrationsByOrg
};


