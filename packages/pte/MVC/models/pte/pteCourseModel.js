const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('../fileQueue');
const { idsEqual } = require('../../utils/idAdapter');

const DATA_PATH = path.join(__dirname, '../../../../../data/pteCourses.json');
const STATUS_VALUES = new Set(['draft', 'active', 'closed', 'archived']);
const COURSE_TYPE_VALUES = new Set(['CORE', 'ACADEMIC']);

if (!fsSync.existsSync(path.dirname(DATA_PATH))) {
  fsSync.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
}
if (!fsSync.existsSync(DATA_PATH)) {
  fsSync.writeFileSync(DATA_PATH, '[]');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, { max = 500, allowEmpty = true } = {}) {
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

function cleanDateOnly(value, { allowEmpty = true } = {}) {
  const token = cleanString(value, { max: 40, allowEmpty: true }) || '';
  if (!token) return allowEmpty ? '' : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) throw new Error('Date fields must use YYYY-MM-DD format.');
  return token;
}

function cleanIsoDateTime(value, { allowEmpty = false } = {}) {
  if (value === undefined || value === null || value === '') return allowEmpty ? '' : null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid datetime value.');
  return parsed.toISOString();
}

function cleanNonNegativeInteger(value, { allowEmpty = true, fallback = 0 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (allowEmpty) return Number(fallback || 0);
    throw new Error('Numeric value is required.');
  }
  const numeric = Number.parseInt(String(value), 10);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric) || numeric < 0) {
    throw new Error('Numeric value must be a non-negative integer.');
  }
  return numeric;
}

function normalizeCourseType(value, fallback = 'CORE') {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toUpperCase();
  if (COURSE_TYPE_VALUES.has(token)) return token;
  const fallbackToken = cleanString(fallback, { max: 40, allowEmpty: true }).toUpperCase();
  if (COURSE_TYPE_VALUES.has(fallbackToken)) return fallbackToken;
  return 'CORE';
}

function sanitizeMemberRows(rows = [], { memberType = 'person', includeMembershipStatus = false } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const out = [];
  const seen = new Set();

  list.forEach((raw) => {
    const row = isPlainObject(raw) ? raw : { id: raw };
    const id = cleanId(row.id || row.personId || row.userId || row.applicantId || '', { max: 120, allowEmpty: true }) || '';
    if (!id) return;
    const type = cleanString(row.type, { max: 60, allowEmpty: true }).toLowerCase() || memberType;
    const key = `${type}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);

    const normalized = {
      type,
      id,
      displayName: cleanString(row.displayName || row.name, { max: 220, allowEmpty: true }) || id,
      email: cleanString(row.email, { max: 220, allowEmpty: true }) || '',
      addedDate: cleanIsoDateTime(row.addedDate, { allowEmpty: true }) || new Date().toISOString(),
      addedBy: cleanString(row.addedBy, { max: 120, allowEmpty: true }) || 'System'
    };

    if (includeMembershipStatus) {
      normalized.membershipStatus = cleanString(row.membershipStatus, { max: 60, allowEmpty: true }) || 'active';
    }

    out.push(normalized);
  });

  return out;
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
  const creatorUser = creatorType === 'system'
    ? 'System'
    : (cleanId(creator?.userId, { max: 120, allowEmpty: true }) || 'System');
  return {
    createUser: cleanString(existing.createUser || source.createUser, { max: 120, allowEmpty: true }) || creatorUser,
    createDateTime: cleanIsoDateTime(existing.createDateTime || source.createDateTime, { allowEmpty: true }) || nowIso,
    lastUpdateUser: cleanString(source.lastUpdateUser, { max: 120, allowEmpty: true }) || creatorUser,
    lastUpdateDateTime: cleanIsoDateTime(source.lastUpdateDateTime, { allowEmpty: true }) || nowIso
  };
}

function sanitizeCourse(raw = {}, options = {}) {
  const input = isPlainObject(raw) ? raw : {};
  const existing = isPlainObject(options.existing) ? options.existing : null;

  const id = cleanId(input.id || existing?.id, { max: 120, allowEmpty: true }) || '';
  const orgId = cleanId(input.orgId || existing?.orgId, { max: 120, allowEmpty: false });
  if (!orgId) throw new Error('orgId is required.');

  const name = cleanString(input.name || existing?.name, { max: 220, allowEmpty: true }) || '';
  if (!name) throw new Error('Course name is required.');

  const code = cleanString(input.code, { max: 120, allowEmpty: true }) || '';
  const normalizedCode = code.toUpperCase();

  const startDate = cleanDateOnly(
    input.startDate !== undefined ? input.startDate : existing?.startDate,
    { allowEmpty: true }
  ) || '';
  const endDate = cleanDateOnly(
    input.endDate !== undefined ? input.endDate : existing?.endDate,
    { allowEmpty: true }
  ) || '';
  if (startDate && endDate && endDate < startDate) {
    throw new Error('Course end date cannot be earlier than start date.');
  }

  const statusToken = cleanString(input.status || existing?.status || 'draft', { max: 30, allowEmpty: true }).toLowerCase();
  const status = STATUS_VALUES.has(statusToken) ? statusToken : 'draft';
  const courseType = normalizeCourseType(
    input.courseType !== undefined ? input.courseType : input.level,
    normalizeCourseType(
      existing?.courseType !== undefined ? existing.courseType : existing?.level,
      'CORE'
    )
  );

  const creator = sanitizeCreator(input.creator || existing?.creator || {});
  const audit = sanitizeAudit(input.audit || {}, { creator, existingAudit: existing?.audit || null });

  return {
    id,
    orgId,
    code: normalizedCode,
    name,
    description: cleanString(input.description || existing?.description, { max: 4000, allowEmpty: true }) || '',
    startDate,
    endDate,
    status,
    courseType,
    // Keep legacy `level` key aligned with `courseType` for older consumers.
    level: courseType,
    maxStudents: cleanNonNegativeInteger(
      input.maxStudents !== undefined ? input.maxStudents : existing?.maxStudents,
      { allowEmpty: true, fallback: 0 }
    ),
    teachers: sanitizeMemberRows(
      input.teachers !== undefined ? input.teachers : existing?.teachers || [],
      { memberType: 'person', includeMembershipStatus: false }
    ),
    students: sanitizeMemberRows(
      input.students !== undefined ? input.students : existing?.students || [],
      { memberType: 'applicant', includeMembershipStatus: true }
    ),
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
    const candidate = `PTECRS${dateToken}${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `PTECRS${Date.now()}`;
}

async function getAllCourses() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve PTE courses.');
  }
}

async function getCourseById(id) {
  const rows = await getAllCourses();
  return rows.find((row) => idsEqual(row?.id, id)) || null;
}

async function addCourse(payload) {
  return queueWrite(async () => {
    const rows = await getAllCourses();
    const sanitized = sanitizeCourse(payload);
    sanitized.id = sanitized.id || generateId(rows);
    if (rows.some((row) => idsEqual(row?.id, sanitized.id))) {
      throw new Error(`PTE course id '${sanitized.id}' already exists.`);
    }
    rows.push(sanitized);
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return sanitized;
  });
}

async function updateCourse(id, payload) {
  return queueWrite(async () => {
    const rows = await getAllCourses();
    const index = rows.findIndex((row) => idsEqual(row?.id, id));
    if (index < 0) throw new Error('PTE course not found.');
    const existing = rows[index];
    const merged = sanitizeCourse(
      { ...existing, ...(isPlainObject(payload) ? payload : {}), id: existing.id },
      { existing }
    );
    rows[index] = { ...existing, ...merged, id: existing.id };
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return rows[index];
  });
}

async function deleteCourse(id) {
  return queueWrite(async () => {
    const rows = await getAllCourses();
    const filtered = rows.filter((row) => !idsEqual(row?.id, id));
    if (filtered.length === rows.length) return false;
    await fs.writeFile(DATA_PATH, JSON.stringify(filtered, null, 2));
    return true;
  });
}

module.exports = {
  STATUS_VALUES: Object.freeze(Array.from(STATUS_VALUES)),
  sanitizeCourse,
  getAllCourses,
  getCourseById,
  addCourse,
  updateCourse,
  deleteCourse,
  generateId
};
