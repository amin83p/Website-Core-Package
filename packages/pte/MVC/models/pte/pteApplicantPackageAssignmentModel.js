const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = require('../fileQueue');
const { idsEqual } = require('../../utils/idAdapter');

const DATA_PATH = path.join(__dirname, '../../../../../data/pteApplicantPackageAssignments.json');
const STATUS_VALUES = new Set(['active', 'removed']);

if (!fsSync.existsSync(path.dirname(DATA_PATH))) {
  fsSync.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
}
if (!fsSync.existsSync(DATA_PATH)) {
  fsSync.writeFileSync(DATA_PATH, '[]');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, { max = 320, allowEmpty = true } = {}) {
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

function cleanIso(value, { allowEmpty = false } = {}) {
  if (value === undefined || value === null || value === '') return allowEmpty ? '' : null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid datetime value.');
  return parsed.toISOString();
}

function cleanIdList(values = []) {
  const rows = Array.isArray(values) ? values : [values];
  const out = [];
  const seen = new Set();
  rows.forEach((value) => {
    const id = cleanId(value, { max: 120, allowEmpty: true }) || '';
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  });
  return out;
}

function sanitizeCreator(raw = {}) {
  const input = isPlainObject(raw) ? raw : {};
  const type = cleanString(input.type, { max: 20, allowEmpty: true }).toLowerCase() === 'system' ? 'system' : 'user';
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

  const userId = cleanId(input.userId, { max: 120, allowEmpty: true }) || '';
  if (!userId) {
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
  const input = isPlainObject(rawAudit) ? rawAudit : {};
  const existing = isPlainObject(existingAudit) ? existingAudit : {};
  const creatorUser = String(creator?.type || '').toLowerCase() === 'system'
    ? 'System'
    : (cleanId(creator?.userId, { max: 120, allowEmpty: true }) || 'System');

  return {
    createUser: cleanString(existing.createUser || input.createUser, { max: 120, allowEmpty: true }) || creatorUser,
    createDateTime: cleanIso(existing.createDateTime || input.createDateTime, { allowEmpty: true }) || nowIso,
    lastUpdateUser: cleanString(input.lastUpdateUser, { max: 120, allowEmpty: true }) || creatorUser,
    lastUpdateDateTime: cleanIso(input.lastUpdateDateTime, { allowEmpty: true }) || nowIso
  };
}

function sanitizeAssignment(raw = {}, options = {}) {
  const input = isPlainObject(raw) ? raw : {};
  const existing = isPlainObject(options.existing) ? options.existing : null;

  const orgId = cleanId(input.orgId || existing?.orgId, { max: 120, allowEmpty: false });
  const applicantId = cleanId(input.applicantId || existing?.applicantId, { max: 120, allowEmpty: false });
  const packageId = cleanId(input.packageId || existing?.packageId, { max: 120, allowEmpty: false });
  if (!orgId) throw new Error('orgId is required.');
  if (!applicantId) throw new Error('applicantId is required.');
  if (!packageId) throw new Error('packageId is required.');

  const creator = sanitizeCreator(input.creator || existing?.creator || {});
  const audit = sanitizeAudit(input.audit || {}, { creator, existingAudit: existing?.audit || null });
  const statusToken = cleanString(input.status || existing?.status || 'active', { max: 40, allowEmpty: true }).toLowerCase();
  const status = STATUS_VALUES.has(statusToken) ? statusToken : 'active';

  const packageSnapshot = isPlainObject(input.packageSnapshot)
    ? input.packageSnapshot
    : (isPlainObject(existing?.packageSnapshot) ? existing.packageSnapshot : {});

  return {
    id: cleanId(input.id || existing?.id, { max: 120, allowEmpty: true }) || '',
    orgId,
    applicantId,
    personId: cleanId(input.personId || existing?.personId, { max: 120, allowEmpty: true }) || '',
    userId: cleanId(input.userId || existing?.userId, { max: 120, allowEmpty: true }) || '',
    packageId,
    packageName: cleanString(input.packageName || existing?.packageName, { max: 220, allowEmpty: true }) || packageId,
    packageSnapshot,
    packageProfileIds: cleanIdList(input.packageProfileIds !== undefined ? input.packageProfileIds : existing?.packageProfileIds || []),
    preExistingProfileIds: cleanIdList(input.preExistingProfileIds !== undefined ? input.preExistingProfileIds : existing?.preExistingProfileIds || []),
    addedProfileIds: cleanIdList(input.addedProfileIds !== undefined ? input.addedProfileIds : existing?.addedProfileIds || []),
    membershipPeriodId: cleanId(input.membershipPeriodId || existing?.membershipPeriodId, { max: 180, allowEmpty: true }) || '',
    ledgerEntryIds: cleanIdList(input.ledgerEntryIds !== undefined ? input.ledgerEntryIds : existing?.ledgerEntryIds || []),
    reversalLedgerEntryIds: cleanIdList(
      input.reversalLedgerEntryIds !== undefined ? input.reversalLedgerEntryIds : existing?.reversalLedgerEntryIds || []
    ),
    appliedAt: cleanIso(input.appliedAt || existing?.appliedAt, { allowEmpty: true }) || new Date().toISOString(),
    removedAt: cleanIso(input.removedAt || existing?.removedAt, { allowEmpty: true }) || '',
    status,
    notes: cleanString(input.notes || existing?.notes, { max: 500, allowEmpty: true }) || '',
    creator,
    audit
  };
}

function generateId(rows = []) {
  const existing = new Set(
    (Array.isArray(rows) ? rows : [])
      .map((row) => String(row?.id || '').trim())
      .filter(Boolean)
  );
  for (let i = 0; i < 300; i += 1) {
    const candidate = `PTEPKG${Date.now()}${Math.floor(Math.random() * 1000)}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `PTEPKG${Date.now()}`;
}

async function getAllAssignments() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve PTE package assignments.');
  }
}

async function getAssignmentById(id) {
  const rows = await getAllAssignments();
  return rows.find((row) => idsEqual(row?.id, id)) || null;
}

async function addAssignment(payload) {
  return queueWrite(async () => {
    const rows = await getAllAssignments();
    const sanitized = sanitizeAssignment(payload);
    sanitized.id = sanitized.id || generateId(rows);
    if (rows.some((row) => idsEqual(row?.id, sanitized.id))) {
      throw new Error(`PTE package assignment id '${sanitized.id}' already exists.`);
    }
    rows.push(sanitized);
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return sanitized;
  });
}

async function updateAssignment(id, payload) {
  return queueWrite(async () => {
    const rows = await getAllAssignments();
    const index = rows.findIndex((row) => idsEqual(row?.id, id));
    if (index < 0) throw new Error('PTE package assignment not found.');
    const existing = rows[index];
    const sanitized = sanitizeAssignment({ ...existing, ...(isPlainObject(payload) ? payload : {}), id: existing.id }, { existing });
    rows[index] = { ...existing, ...sanitized, id: existing.id };
    await fs.writeFile(DATA_PATH, JSON.stringify(rows, null, 2));
    return rows[index];
  });
}

async function deleteAssignment(id) {
  return queueWrite(async () => {
    const rows = await getAllAssignments();
    const filtered = rows.filter((row) => !idsEqual(row?.id, id));
    if (filtered.length === rows.length) return false;
    await fs.writeFile(DATA_PATH, JSON.stringify(filtered, null, 2));
    return true;
  });
}

module.exports = {
  STATUS_VALUES: Object.freeze(Array.from(STATUS_VALUES)),
  sanitizeAssignment,
  getAllAssignments,
  getAssignmentById,
  addAssignment,
  updateAssignment,
  deleteAssignment,
  generateId
};
