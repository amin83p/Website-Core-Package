const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const dataPath = path.join(resolveCoreRoot(), 'data/school/attendanceChangeLogs.json');
const LOG_SOURCES = Object.freeze(['matrix_cell', 'session_save']);

fsSync.mkdirSync(path.dirname(dataPath), { recursive: true });
if (!fsSync.existsSync(dataPath)) fsSync.writeFileSync(dataPath, '[]');

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, { max = 500, allowEmpty = true } = {}) {
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

function cleanDateTime(value, { allowEmpty = false } = {}) {
  const text = cleanString(value, { max: 40, allowEmpty });
  if (!text) return allowEmpty ? '' : null;
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) throw new Error('Invalid datetime value.');
  return new Date(parsed).toISOString();
}

function normalizeSource(value) {
  const token = cleanString(value, { max: 40, allowEmpty: true }).toLowerCase();
  return LOG_SOURCES.includes(token) ? token : 'matrix_cell';
}

function sanitizeChangedBy(input = {}) {
  if (!isPlainObject(input)) return { userId: '', username: '', displayName: '' };
  return {
    userId: cleanId(input.userId, { max: 120, allowEmpty: true }) || '',
    username: cleanString(input.username, { max: 180, allowEmpty: true }) || '',
    displayName: cleanString(input.displayName, { max: 180, allowEmpty: true }) || ''
  };
}

function cleanNonNegInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function cleanBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function sanitizeLogInput(input = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid attendance change log payload.');
  return {
    id: cleanId(input.id, { max: 120, allowEmpty: true }) || '',
    orgId: cleanId(input.orgId, { max: 120, allowEmpty: false }) || '',
    classId: cleanId(input.classId, { max: 120, allowEmpty: false }) || '',
    sessionId: cleanId(input.sessionId, { max: 120, allowEmpty: false }) || '',
    sessionDate: cleanDateOnly(input.sessionDate, { allowEmpty: true }) || '',
    studentPersonId: cleanId(input.studentPersonId || input.personId, { max: 120, allowEmpty: false }) || '',
    source: normalizeSource(input.source),
    changedAt: cleanDateTime(input.changedAt, { allowEmpty: true }) || new Date().toISOString(),
    changedBy: sanitizeChangedBy(input.changedBy),
    fromStatus: cleanString(input.fromStatus, { max: 40, allowEmpty: true }) || '',
    toStatus: cleanString(input.toStatus, { max: 40, allowEmpty: true }) || '',
    fromLateMinutes: cleanNonNegInt(input.fromLateMinutes),
    toLateMinutes: cleanNonNegInt(input.toLateMinutes),
    fromEarlyLeaveMinutes: cleanNonNegInt(input.fromEarlyLeaveMinutes),
    toEarlyLeaveMinutes: cleanNonNegInt(input.toEarlyLeaveMinutes),
    fromLateExcused: cleanBoolean(input.fromLateExcused),
    toLateExcused: cleanBoolean(input.toLateExcused),
    fromEarlyLeaveExcused: cleanBoolean(input.fromEarlyLeaveExcused),
    toEarlyLeaveExcused: cleanBoolean(input.toEarlyLeaveExcused),
    fromAbsenceExcused: cleanBoolean(input.fromAbsenceExcused),
    toAbsenceExcused: cleanBoolean(input.toAbsenceExcused)
  };
}

function generateLogId(existingIds = new Set()) {
  for (let i = 0; i < 50; i += 1) {
    const candidate = `ACL-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `ACL-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

async function saveAll(rows) {
  await fs.writeFile(dataPath, JSON.stringify(rows, null, 2));
}

async function getAllAttendanceChangeLogs() {
  const raw = await fs.readFile(dataPath, 'utf8');
  const parsed = JSON.parse(raw || '[]');
  return Array.isArray(parsed) ? parsed : [];
}

async function getAttendanceChangeLogById(id) {
  const rows = await getAllAttendanceChangeLogs();
  return rows.find((row) => idsEqual(row?.id, id)) || null;
}

async function addAttendanceChangeLogs(entries) {
  return queueWrite(async () => {
    const rows = await getAllAttendanceChangeLogs();
    const existingIds = new Set(rows.map((row) => String(row?.id || '')).filter(Boolean));
    const normalizedEntries = (Array.isArray(entries) ? entries : [entries]).map((entry) => sanitizeLogInput(entry));
    const created = normalizedEntries.map((entry) => {
      const row = {
        ...entry,
        id: entry.id || generateLogId(existingIds)
      };
      existingIds.add(row.id);
      rows.push(row);
      return row;
    });
    await saveAll(rows);
    return created;
  });
}

async function addAttendanceChangeLog(entry) {
  const rows = await addAttendanceChangeLogs([entry]);
  return rows[0];
}

module.exports = {
  LOG_SOURCES,
  sanitizeLogInput,
  getAllAttendanceChangeLogs,
  getAttendanceChangeLogById,
  addAttendanceChangeLog,
  addAttendanceChangeLogs
};
