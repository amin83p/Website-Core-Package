const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('../fileQueue');
const { idsEqual, toPublicId } = require('../../utils/idAdapter');

const DATA_PATH = path.join(__dirname, '../../../../../data/pteTeachers.json');
const STATUS_VALUES = new Set(['active', 'archived']);

if (!fsSync.existsSync(path.dirname(DATA_PATH))) {
  fsSync.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
}
if (!fsSync.existsSync(DATA_PATH)) {
  fsSync.writeFileSync(DATA_PATH, '[]');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, { max = 300, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const out = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !out) return null;
  return out.length > max ? out.slice(0, max) : out;
}

function cleanId(value, { max = 120, allowEmpty = true } = {}) {
  const token = cleanString(value, { max, allowEmpty });
  if (token === null) return null;
  if (!token && allowEmpty) return '';
  if (!/^[A-Za-z0-9_.:-]+$/.test(token)) throw new Error('Invalid id format.');
  return token;
}

function cleanIsoDateTime(value, { allowEmpty = false } = {}) {
  if (value === undefined || value === null || value === '') return allowEmpty ? '' : null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid datetime value.');
  return parsed.toISOString();
}

function cleanCourseRows(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const map = new Map();
  list.forEach((raw, index) => {
    const row = isPlainObject(raw) ? raw : { id: raw };
    const id = cleanId(row.id || row.courseId, { max: 120, allowEmpty: true }) || '';
    const name = cleanString(row.name || row.title, { max: 180, allowEmpty: true }) || '';
    const key = id || name || `course_${index + 1}`;
    map.set(key, {
      id: id || '',
      name: name || id || key
    });
  });
  return Array.from(map.values());
}

function sanitizeCreator(rawCreator = {}) {
  const input = isPlainObject(rawCreator) ? rawCreator : {};
  const type = cleanString(input.type, { max: 20, allowEmpty: true }).toLowerCase() === 'system' ? 'system' : 'user';
  const userId = cleanId(input.userId, { max: 120, allowEmpty: true }) || '';
  if (type === 'system' || !userId) {
    return {
      type: 'system',
      displayName: 'System',
      userId: '',
      username: '',
      email: '',
      orgId: cleanId(input.orgId, { max: 120, allowEmpty: true }) || ''
    };
  }
  return {
    type: 'user',
    displayName: cleanString(input.displayName, { max: 180, allowEmpty: true }) || userId,
    userId,
    username: cleanString(input.username, { max: 140, allowEmpty: true }) || '',
    email: cleanString(input.email, { max: 220, allowEmpty: true }) || '',
    orgId: cleanId(input.orgId, { max: 120, allowEmpty: true }) || ''
  };
}

function sanitizeAudit(rawAudit = {}, { creator = null, existingAudit = null } = {}) {
  const nowIso = new Date().toISOString();
  const source = isPlainObject(rawAudit) ? rawAudit : {};
  const existing = isPlainObject(existingAudit) ? existingAudit : {};
  const creatorType = String(creator?.type || '').toLowerCase();
  const creatorUser = creatorType === 'system' ? 'System' : (cleanId(creator?.userId, { max: 120, allowEmpty: true }) || 'System');
  return {
    createUser: cleanString(existing.createUser || source.createUser, { max: 120, allowEmpty: true }) || creatorUser,
    createDateTime: cleanIsoDateTime(existing.createDateTime || source.createDateTime, { allowEmpty: true }) || nowIso,
    lastUpdateUser: cleanString(source.lastUpdateUser, { max: 120, allowEmpty: true }) || creatorUser,
    lastUpdateDateTime: cleanIsoDateTime(source.lastUpdateDateTime, { allowEmpty: true }) || nowIso
  };
}

function normalizeStatus(value, fallback = 'active') {
  const token = cleanString(value, { max: 30, allowEmpty: true }).toLowerCase();
  if (STATUS_VALUES.has(token)) return token;
  return fallback;
}

function sanitizeTeacher(raw = {}, options = {}) {
  const input = isPlainObject(raw) ? raw : {};
  const existing = isPlainObject(options.existing) ? options.existing : null;

  const id = cleanId(input.id || existing?.id, { max: 120, allowEmpty: true }) || '';
  const orgId = cleanId(input.orgId || existing?.orgId, { max: 120, allowEmpty: false });
  const personId = cleanId(input.personId || existing?.personId, { max: 120, allowEmpty: false });
  if (!orgId) throw new Error('orgId is required.');
  if (!personId) throw new Error('personId is required.');

  const creator = sanitizeCreator(input.creator || existing?.creator || {});
  const audit = sanitizeAudit(input.audit || {}, { creator, existingAudit: existing?.audit || null });

  return {
    id,
    orgId,
    personId,
    userId: cleanId(input.userId || existing?.userId, { max: 120, allowEmpty: true }) || '',
    teacherId: cleanString(input.teacherId || existing?.teacherId, { max: 120, allowEmpty: true }) || '',
    notes: cleanString(input.notes || existing?.notes, { max: 4000, allowEmpty: true }) || '',
    courses: cleanCourseRows(input.courses !== undefined ? input.courses : existing?.courses || []),
    status: normalizeStatus(input.status || existing?.status || 'active'),
    personRoleToken: cleanString(input.personRoleToken || existing?.personRoleToken || 'PTE_Teacher', { max: 80, allowEmpty: true }) || 'PTE_Teacher',
    creator,
    audit
  };
}

function buildDateToken(value) {
  return String(value || new Date().toISOString()).slice(0, 10).replace(/-/g, '');
}

function generateId(existingRows = []) {
  const existing = new Set(
    (Array.isArray(existingRows) ? existingRows : [])
      .map((row) => String(row?.id || '').trim())
      .filter(Boolean)
  );
  const dateToken = buildDateToken();
  for (let i = 0; i < 300; i += 1) {
    const suffix = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const candidate = `PTETCH${dateToken}${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `PTETCH${Date.now()}`;
}

function assertUniqueOrgPerson(rows = [], teacher = {}, excludeId = '') {
  const targetOrgId = toPublicId(teacher?.orgId || '');
  const targetPersonId = toPublicId(teacher?.personId || '');
  const excluded = toPublicId(excludeId || '');
  if (!targetOrgId || !targetPersonId) return;

  const duplicate = (Array.isArray(rows) ? rows : []).find((row) => {
    if (!idsEqual(row?.orgId, targetOrgId)) return false;
    if (!idsEqual(row?.personId, targetPersonId)) return false;
    if (excluded && idsEqual(row?.id, excluded)) return false;
    return true;
  });
  if (duplicate) {
    throw new Error('A PTE teacher record already exists for this person in the active organization.');
  }
}

async function getAllTeachers() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve pte teachers.');
  }
}

async function getTeacherById(id) {
  const rows = await getAllTeachers();
  return rows.find((row) => idsEqual(row?.id, id)) || null;
}

async function addTeacher(payload) {
  return queueWrite(async () => {
    const rows = await getAllTeachers();
    const sanitized = sanitizeTeacher(payload);
    sanitized.id = sanitized.id || generateId(rows);
    if (rows.some((row) => idsEqual(row?.id, sanitized.id))) {
      throw new Error(`PTE teacher id '${sanitized.id}' already exists.`);
    }
    assertUniqueOrgPerson(rows, sanitized, '');
    rows.push(sanitized);
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return sanitized;
  });
}

async function updateTeacher(id, payload) {
  return queueWrite(async () => {
    const rows = await getAllTeachers();
    const index = rows.findIndex((row) => idsEqual(row?.id, id));
    if (index < 0) throw new Error('PTE teacher not found.');
    const existing = rows[index];
    const sanitized = sanitizeTeacher({ ...existing, ...(isPlainObject(payload) ? payload : {}), id: existing.id }, { existing });
    assertUniqueOrgPerson(rows, sanitized, existing.id);
    rows[index] = { ...existing, ...sanitized, id: existing.id };
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return rows[index];
  });
}

async function deleteTeacher(id) {
  return queueWrite(async () => {
    const rows = await getAllTeachers();
    const filtered = rows.filter((row) => !idsEqual(row?.id, id));
    if (filtered.length === rows.length) return false;
    await fs.writeFile(DATA_PATH, JSON.stringify(filtered, null, 2));
    return true;
  });
}

module.exports = {
  STATUS_VALUES: Object.freeze(Array.from(STATUS_VALUES)),
  sanitizeTeacher,
  getAllTeachers,
  getTeacherById,
  addTeacher,
  updateTeacher,
  deleteTeacher,
  generateId
};
