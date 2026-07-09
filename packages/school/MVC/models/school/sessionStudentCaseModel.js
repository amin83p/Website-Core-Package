const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const { deriveCaseSummary } = require('../../services/school/sessionStudentCasePresetService');

const dataPath = path.join(resolveCoreRoot(), 'data/school/sessionStudentCases.json');
const CASE_STATUSES = Object.freeze(['open', 'in_progress', 'resolved', 'reopened', 'cancelled']);
const CASE_SEVERITIES = Object.freeze(['info', 'warning', 'urgent']);
const CASE_CATEGORIES = Object.freeze([
  'learning',
  'technology',
  'engagement',
  'behavior',
  'support',
  'resources',
  'lesson_delivery',
  'other'
]);

fsSync.mkdirSync(path.dirname(dataPath), { recursive: true });
if (!fsSync.existsSync(dataPath)) fsSync.writeFileSync(dataPath, '[]');

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, { max = 5000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const text = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

function cleanId(value, { max = 120, allowEmpty = false } = {}) {
  const text = cleanString(value, { max, allowEmpty });
  if (text === null) return null;
  if (!text) return allowEmpty ? '' : null;
  if (!/^[A-Za-z0-9:_./-]+$/.test(text)) throw new Error('Invalid id format.');
  return text;
}

function cleanDateOnly(value, { allowEmpty = true } = {}) {
  const text = cleanString(value, { max: 20, allowEmpty });
  if (!text) return allowEmpty ? '' : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('Invalid date format. Use YYYY-MM-DD.');
  return text;
}

function cleanTime(value, { allowEmpty = true } = {}) {
  const text = cleanString(value, { max: 5, allowEmpty });
  if (!text) return allowEmpty ? '' : null;
  if (!/^\d{2}:\d{2}$/.test(text)) throw new Error('Time must use HH:mm.');
  return text;
}

function normalizeEnum(value, allowed, fallback) {
  const token = cleanString(value, { max: 80, allowEmpty: true }).toLowerCase();
  return allowed.includes(token) ? token : fallback;
}

function normalizeBoolean(value) {
  if (value === true || value === false) return value;
  const token = cleanString(value, { max: 20, allowEmpty: true }).toLowerCase();
  return ['true', '1', 'yes', 'on'].includes(token);
}

function generateCaseId(existingIds = new Set()) {
  for (let i = 0; i < 50; i += 1) {
    const candidate = `SSC-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `SSC-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function sanitizeStructuredFields(input = {}) {
  return {
    wasSubstitute: normalizeBoolean(input.wasSubstitute),
    classWentWellForStudent: normalizeBoolean(input.classWentWellForStudent),
    classWentWellForTeacher: normalizeBoolean(input.classWentWellForTeacher),
    teacherTechnologyIssue: normalizeBoolean(input.teacherTechnologyIssue),
    studentTechnologyIssue: normalizeBoolean(input.studentTechnologyIssue),
    issueDuringClass: normalizeBoolean(input.issueDuringClass),
    struggledWithMaterial: normalizeBoolean(input.struggledWithMaterial),
    requiredAdditionalSupport: normalizeBoolean(input.requiredAdditionalSupport),
    lessonDeliveryDifficulty: normalizeBoolean(input.lessonDeliveryDifficulty),
    behavioralIssue: normalizeBoolean(input.behavioralIssue),
    engagementIssue: normalizeBoolean(input.engagementIssue),
    sufficientResources: normalizeBoolean(input.sufficientResources)
  };
}

function sanitizeLifecycle(events) {
  return (Array.isArray(events) ? events : [])
    .map((event) => ({
      at: cleanString(event?.at, { max: 40, allowEmpty: true }) || new Date().toISOString(),
      action: cleanString(event?.action, { max: 80, allowEmpty: true }),
      actorUserId: cleanId(event?.actorUserId || event?.actorId, { max: 120, allowEmpty: true }) || '',
      actorPersonId: cleanId(event?.actorPersonId, { max: 120, allowEmpty: true }) || '',
      actorName: cleanString(event?.actorName, { max: 180, allowEmpty: true }),
      oldStatus: cleanString(event?.oldStatus, { max: 40, allowEmpty: true }),
      newStatus: cleanString(event?.newStatus, { max: 40, allowEmpty: true }),
      note: cleanString(event?.note, { max: 1000, allowEmpty: true })
    }))
    .filter((event) => event.action || event.oldStatus || event.newStatus);
}

function sanitizeCaseInput(input = {}, { isUpdate = false } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid student case payload.');
  const out = {
    orgId: cleanId(input.orgId, { max: 120, allowEmpty: isUpdate }) || '',
    classId: cleanId(input.classId, { max: 120, allowEmpty: isUpdate }) || '',
    classTitle: cleanString(input.classTitle, { max: 220, allowEmpty: true }),
    sessionId: cleanId(input.sessionId, { max: 120, allowEmpty: isUpdate }) || '',
    sessionDate: cleanDateOnly(input.sessionDate, { allowEmpty: true }) || '',
    sessionStartTime: cleanTime(input.sessionStartTime, { allowEmpty: true }) || '',
    sessionEndTime: cleanTime(input.sessionEndTime, { allowEmpty: true }) || '',
    studentPersonId: cleanId(input.studentPersonId || input.personId, { max: 120, allowEmpty: isUpdate }) || '',
    studentName: cleanString(input.studentName, { max: 180, allowEmpty: true }),
    teacherPersonId: cleanId(input.teacherPersonId, { max: 120, allowEmpty: true }) || '',
    teacherName: cleanString(input.teacherName, { max: 180, allowEmpty: true }),
    category: normalizeEnum(input.category, CASE_CATEGORIES, 'other'),
    severity: normalizeEnum(input.severity, CASE_SEVERITIES, 'info'),
    status: normalizeEnum(input.status, CASE_STATUSES, 'open'),
    summary: cleanString(input.summary, { max: 260, allowEmpty: true }),
    details: cleanString(input.details, { max: 5000, allowEmpty: true }),
    additionalComments: cleanString(input.additionalComments, { max: 3000, allowEmpty: true }),
    structured: sanitizeStructuredFields(input.structured || input),
    lifecycle: sanitizeLifecycle(input.lifecycle),
    revisionNo: Number.isFinite(Number(input.revisionNo)) ? Math.max(1, Math.floor(Number(input.revisionNo))) : 1
  };
  if (!isUpdate) {
    if (!out.orgId) throw new Error('Organization is required.');
    if (!out.classId) throw new Error('Class is required.');
    if (!out.sessionId) throw new Error('Session is required.');
    if (!out.studentPersonId) throw new Error('Student is required.');
  }
  if (!out.details) throw new Error('Case issue details are required.');
  if (!out.summary) {
    out.summary = deriveCaseSummary(out.category, out.details);
  }
  if (!out.summary) throw new Error('Case summary could not be derived from issue details.');
  if (input.id) out.id = cleanId(input.id, { max: 120, allowEmpty: false });
  return out;
}

async function getAllSessionStudentCases() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    const parsed = JSON.parse(data || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve school session student cases.');
  }
}

async function saveAll(rows) {
  await queueWrite(async () => fs.writeFile(dataPath, JSON.stringify(Array.isArray(rows) ? rows : [], null, 2)));
}

async function getSessionStudentCaseById(id) {
  const rows = await getAllSessionStudentCases();
  return rows.find((row) => idsEqual(row?.id, id)) || null;
}

async function addSessionStudentCase(input) {
  return queueWrite(async () => {
    const rows = await getAllSessionStudentCases();
    const existingIds = new Set(rows.map((row) => String(row?.id || '')).filter(Boolean));
    const sanitized = sanitizeCaseInput(input);
    const now = new Date().toISOString();
    const row = {
      ...sanitized,
      id: sanitized.id || generateCaseId(existingIds),
      audit: {
        createDateTime: now,
        lastUpdateDateTime: now,
        createdBy: cleanId(input?.audit?.createdBy || input?.createdBy, { max: 120, allowEmpty: true }) || '',
        updatedBy: cleanId(input?.audit?.updatedBy || input?.updatedBy, { max: 120, allowEmpty: true }) || ''
      }
    };
    rows.push(row);
    await saveAll(rows);
    return row;
  });
}

async function updateSessionStudentCase(id, input) {
  return queueWrite(async () => {
    const rows = await getAllSessionStudentCases();
    const index = rows.findIndex((row) => idsEqual(row?.id, id));
    if (index < 0) return null;
    const existing = rows[index];
    const sanitized = sanitizeCaseInput({ ...existing, ...input }, { isUpdate: true });
    const merged = {
      ...existing,
      ...sanitized,
      id: existing.id,
      audit: {
        ...(existing.audit || {}),
        lastUpdateDateTime: new Date().toISOString(),
        updatedBy: cleanId(input?.audit?.updatedBy || input?.updatedBy, { max: 120, allowEmpty: true }) || existing.audit?.updatedBy || ''
      }
    };
    rows[index] = merged;
    await saveAll(rows);
    return merged;
  });
}

async function deleteSessionStudentCase(id) {
  return queueWrite(async () => {
    const rows = await getAllSessionStudentCases();
    const kept = rows.filter((row) => !idsEqual(row?.id, id));
    if (kept.length === rows.length) return false;
    await saveAll(kept);
    return true;
  });
}

async function clearSessionStudentCasesByOrg(orgId) {
  const rows = await getAllSessionStudentCases();
  const kept = rows.filter((row) => !idsEqual(row?.orgId, orgId));
  if (kept.length === rows.length) return 0;
  await saveAll(kept);
  return rows.length - kept.length;
}

module.exports = {
  CASE_STATUSES,
  CASE_SEVERITIES,
  CASE_CATEGORIES,
  sanitizeCaseInput,
  getAllSessionStudentCases,
  getSessionStudentCaseById,
  addSessionStudentCase,
  updateSessionStudentCase,
  deleteSessionStudentCase,
  clearSessionStudentCasesByOrg
};
