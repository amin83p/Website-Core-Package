const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('../fileQueue');
const { idsEqual, toPublicId } = require('../../utils/idAdapter');

const DATA_PATH = path.join(__dirname, '../../../data/pteApplicants.json');
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

function cleanAttachmentRows(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const out = [];
  list.forEach((raw) => {
    const row = isPlainObject(raw) ? raw : {};
    const id = cleanId(row.id, { max: 120, allowEmpty: true }) || '';
    const originalName = cleanString(row.originalName, { max: 260, allowEmpty: true }) || '';
    const filename = cleanString(row.filename, { max: 260, allowEmpty: true }) || '';
    const filePath = cleanString(row.path, { max: 800, allowEmpty: true }) || '';
    if (!id && !filename && !filePath) return;
    out.push({
      id: id || `ATT-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      originalName,
      filename,
      path: filePath,
      url: cleanString(row.url, { max: 800, allowEmpty: true }) || '',
      size: Number(row.size || 0) || 0,
      uploadDate: cleanIsoDateTime(row.uploadDate, { allowEmpty: true }) || new Date().toISOString(),
      comment: cleanString(row.comment, { max: 500, allowEmpty: true }) || ''
    });
  });
  return out;
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

function cleanPackageRows(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const map = new Map();
  list.forEach((raw, index) => {
    const row = isPlainObject(raw) ? raw : { id: raw };
    const id = cleanId(row.id || row.packageId, { max: 120, allowEmpty: true }) || '';
    const name = cleanString(row.name, { max: 220, allowEmpty: true }) || '';
    const key = id || name || `package_${index + 1}`;
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
  if (type === 'user' && !userId) {
    return {
      type: 'system',
      displayName: 'System',
      userId: '',
      username: '',
      email: '',
      orgId: cleanId(input.orgId, { max: 120, allowEmpty: true }) || ''
    };
  }
  if (type === 'system') {
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

function sanitizeApplicant(raw = {}, options = {}) {
  const input = isPlainObject(raw) ? raw : {};
  const existing = isPlainObject(options.existing) ? options.existing : null;
  const id = cleanId(input.id || existing?.id, { max: 120, allowEmpty: true }) || '';
  const orgId = cleanId(input.orgId || existing?.orgId, { max: 120, allowEmpty: false });
  const personId = cleanId(input.personId || existing?.personId, { max: 120, allowEmpty: false });
  if (!orgId) throw new Error('orgId is required.');
  if (!personId) throw new Error('personId is required.');

  const statusToken = cleanString(input.status || existing?.status || 'active', { max: 30, allowEmpty: true }).toLowerCase();
  const status = STATUS_VALUES.has(statusToken) ? statusToken : 'active';

  const creator = sanitizeCreator(input.creator || existing?.creator || {});
  const audit = sanitizeAudit(input.audit || {}, { creator, existingAudit: existing?.audit || null });

  return {
    id,
    orgId,
    personId,
    userId: cleanId(input.userId || existing?.userId, { max: 120, allowEmpty: true }) || '',
    applicantId: cleanString(input.applicantId || existing?.applicantId, { max: 120, allowEmpty: true }) || '',
    courses: cleanCourseRows(input.courses !== undefined ? input.courses : existing?.courses || []),
    countryOfOrigin: cleanString(input.countryOfOrigin || existing?.countryOfOrigin, { max: 120, allowEmpty: true }) || '',
    localId: cleanString(input.localId || existing?.localId, { max: 120, allowEmpty: true }) || '',
    admissionsNotes: cleanString(input.admissionsNotes || existing?.admissionsNotes, { max: 4000, allowEmpty: true }) || '',
    globalAcademicStatus: cleanString(input.globalAcademicStatus || existing?.globalAcademicStatus || 'Active', { max: 80, allowEmpty: true }) || 'Active',
    selectedPackages: cleanPackageRows(input.selectedPackages !== undefined ? input.selectedPackages : existing?.selectedPackages || []),
    packageAssignmentIds: Array.isArray(input.packageAssignmentIds !== undefined ? input.packageAssignmentIds : existing?.packageAssignmentIds || [])
      ? (input.packageAssignmentIds !== undefined ? input.packageAssignmentIds : existing?.packageAssignmentIds || []).map((v) => cleanId(v, { max: 120, allowEmpty: true }) || '').filter(Boolean)
      : [],
    status,
    attachments: cleanAttachmentRows(input.attachments !== undefined ? input.attachments : existing?.attachments || []),
    personRoleToken: cleanString(input.personRoleToken || existing?.personRoleToken || 'PTE_Student', { max: 80, allowEmpty: true }) || 'PTE_Student',
    creator,
    audit
  };
}

function generateId(existingRows = []) {
  const existing = new Set(
    (Array.isArray(existingRows) ? existingRows : [])
      .map((row) => String(row?.id || '').trim())
      .filter(Boolean)
  );
  for (let i = 0; i < 300; i += 1) {
    const candidate = `PTEAPP${Date.now()}${Math.floor(Math.random() * 1000)}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `PTEAPP${Date.now()}`;
}

async function getAllApplicants() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve pte applicants.');
  }
}

async function getApplicantById(id) {
  const rows = await getAllApplicants();
  return rows.find((row) => idsEqual(row?.id, id)) || null;
}

async function addApplicant(payload) {
  return queueWrite(async () => {
    const rows = await getAllApplicants();
    const sanitized = sanitizeApplicant(payload);
    sanitized.id = sanitized.id || generateId(rows);
    if (rows.some((row) => idsEqual(row?.id, sanitized.id))) {
      throw new Error(`PTE applicant id '${sanitized.id}' already exists.`);
    }
    rows.push(sanitized);
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return sanitized;
  });
}

async function updateApplicant(id, payload) {
  return queueWrite(async () => {
    const rows = await getAllApplicants();
    const index = rows.findIndex((row) => idsEqual(row?.id, id));
    if (index < 0) throw new Error('PTE applicant not found.');
    const existing = rows[index];
    const sanitized = sanitizeApplicant({ ...existing, ...(isPlainObject(payload) ? payload : {}), id: existing.id }, { existing });
    rows[index] = { ...existing, ...sanitized, id: existing.id };
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return rows[index];
  });
}

async function deleteApplicant(id) {
  return queueWrite(async () => {
    const rows = await getAllApplicants();
    const filtered = rows.filter((row) => !idsEqual(row?.id, id));
    if (filtered.length === rows.length) return false;
    await fs.writeFile(DATA_PATH, JSON.stringify(filtered, null, 2));
    return true;
  });
}

module.exports = {
  STATUS_VALUES: Object.freeze(Array.from(STATUS_VALUES)),
  sanitizeApplicant,
  getAllApplicants,
  getApplicantById,
  addApplicant,
  updateApplicant,
  deleteApplicant,
  generateId
};
