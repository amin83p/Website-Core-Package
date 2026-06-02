const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const dataPath = path.join(resolveCoreRoot(), 'data/school/reportAssignments.json');

if (!fsSync.existsSync(dataPath)) {
  fsSync.writeFileSync(dataPath, '[]');
}

const ASSIGNMENT_STATUSES = new Set(['active', 'inactive', 'archived']);
const ASSIGNMENT_TARGET_TYPES = new Set(['session', 'date']);
const ASSIGNMENT_REPORT_SCOPES = new Set(['class', 'each_student', 'selected_students']);

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

function cleanTimeOnly(v, { allowEmpty = true } = {}) {
  const s = cleanString(v, { max: 5, allowEmpty });
  if (s === null) return null;
  if (!s) return allowEmpty ? '' : null;
  if (!/^\d{2}:\d{2}$/.test(s)) throw new Error('Invalid time format. Use HH:MM (24-hour).');
  const [hRaw, mRaw] = s.split(':');
  const hour = Number(hRaw);
  const minute = Number(mRaw);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('Invalid hour value in time.');
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error('Invalid minute value in time.');
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function cleanInteger(v, { min = 1, max = 1000000, allowEmpty = true } = {}) {
  if (v === undefined || v === null || v === '') return allowEmpty ? null : NaN;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error('Invalid integer value.');
  if (n < min || n > max) throw new Error('Integer out of range.');
  return n;
}

function cleanBoolean(v, fallback = false) {
  if (typeof v === 'boolean') return v;
  if (v === undefined || v === null || v === '') return Boolean(fallback);
  const raw = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return Boolean(fallback);
}

/** Positive hours for timesheet / schedule totals (max 24 per assignment row). */
function cleanAllocatedHours(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error('Allocated hours must be a positive number when timesheet reflection is enabled.');
  }
  if (n > 24) throw new Error('Allocated hours cannot exceed 24 per report assignment.');
  return Number(n.toFixed(2));
}

function sanitizeTeacherIds(v) {
  const rows = Array.isArray(v) ? v : [];
  const seen = new Set();
  return rows
    .map((id) => cleanId(id, { max: 80, allowEmpty: false }))
    .filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

function sanitizeStudentIds(v) {
  const rows = Array.isArray(v) ? v : [];
  const seen = new Set();
  return rows
    .map((id) => cleanId(id, { max: 80, allowEmpty: false }))
    .filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

function sanitizeAudit(v, existingAudit = {}) {
  const raw = isPlainObject(v) ? v : {};
  return {
    createUser: cleanString(raw.createUser || existingAudit.createUser, { max: 80, allowEmpty: true }),
    createDateTime: cleanString(raw.createDateTime || existingAudit.createDateTime, { max: 60, allowEmpty: true }) || new Date().toISOString(),
    lastUpdateUser: cleanString(raw.lastUpdateUser, { max: 80, allowEmpty: true }),
    lastUpdateDateTime: cleanString(raw.lastUpdateDateTime, { max: 60, allowEmpty: true })
  };
}

function cleanSharedAnswersObject(v) {
  if (!isPlainObject(v)) return {};
  const out = {};
  Object.keys(v).forEach((key) => {
    const safeKey = cleanString(key, { max: 120, allowEmpty: false });
    if (!safeKey || !/^[A-Za-z0-9:_-]+$/.test(safeKey)) return;
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

function sanitizeAssignment(input, { isUpdate = false, existing = null } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid report assignment payload.');

  const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
  const classId = cleanId(input.classId, { max: 80, allowEmpty: false });
  const templateId = cleanId(input.templateId, { max: 80, allowEmpty: false });
  const targetTypeInput = cleanString(input.targetType, { max: 20, allowEmpty: true }).toLowerCase();
  const targetType = ASSIGNMENT_TARGET_TYPES.has(targetTypeInput)
    ? targetTypeInput
    : (String(input.sessionId || '').trim() ? 'session' : 'date');
  const sessionId = cleanId(input.sessionId, { max: 80, allowEmpty: targetType === 'date' });
  const sessionDate = cleanDateOnly(input.sessionDate, { allowEmpty: false });
  const templateVersion = cleanInteger(input.templateVersion, { min: 1, max: 1000, allowEmpty: false });
  const teacherIds = sanitizeTeacherIds(input.teacherIds);
  if (!teacherIds.length) throw new Error('Select at least one teacher for assignment.');
  const reportScope = cleanString(input.reportScope, { max: 40, allowEmpty: true }).toLowerCase() || 'class';
  if (!ASSIGNMENT_REPORT_SCOPES.has(reportScope)) throw new Error('Invalid assignment report scope.');
  const targetStudentIds = sanitizeStudentIds(input.targetStudentIds);
  if (reportScope === 'selected_students' && !targetStudentIds.length) {
    throw new Error('Select at least one student for "specific students" scope.');
  }

  const status = cleanString(input.status, { max: 20, allowEmpty: true }).toLowerCase() || 'active';
  if (!ASSIGNMENT_STATUSES.has(status)) throw new Error('Invalid assignment status.');

  if (!ASSIGNMENT_TARGET_TYPES.has(targetType)) throw new Error('Invalid assignment target type.');

  const dueDate = cleanDateOnly(input.dueDate, { allowEmpty: true });
  if (targetType === 'date' && !dueDate) throw new Error('Due date is required when session is not selected.');
  const taskStartTime = cleanTimeOnly(input.taskStartTime, { allowEmpty: false });
  const taskEndTime = cleanTimeOnly(input.taskEndTime, { allowEmpty: false });
  if (!taskStartTime || !taskEndTime) {
    throw new Error('Task start/end time are required for schedule conflict checks.');
  }
  if (taskStartTime >= taskEndTime) {
    throw new Error('Task end time must be later than task start time.');
  }
  const reportStartDate = cleanDateOnly(input.reportStartDate, { allowEmpty: true });
  const reportDueDate = cleanDateOnly(input.reportDueDate, { allowEmpty: true });
  if ((reportStartDate && !reportDueDate) || (!reportStartDate && reportDueDate)) {
    throw new Error('Provide both report start date and report due date, or leave both empty.');
  }
  if (reportStartDate && reportDueDate && reportStartDate > reportDueDate) {
    throw new Error('Report start date cannot be after report due date.');
  }

  const conflictPermitted = (targetType === 'session')
    ? true
    : cleanBoolean(input.conflictPermitted, false);

  const timesheetReflection = cleanBoolean(input.timesheetReflection, false);
  const allocatedHours = timesheetReflection ? cleanAllocatedHours(input.allocatedHours) : 0;

  const out = {
    orgId,
    targetType,
    classId,
    sessionId,
    sessionDate,
    reportScope,
    targetStudentIds: reportScope === 'selected_students' ? targetStudentIds : [],
    templateId,
    templateVersion,
    teacherIds,
    dueDate,
    conflictPermitted,
    taskStartTime,
    taskEndTime,
    reportStartDate,
    reportDueDate,
    status,
    timesheetReflection,
    allocatedHours,
    sharedAnswers: cleanSharedAnswersObject(
      input.sharedAnswers !== undefined ? input.sharedAnswers : (existing?.sharedAnswers || {})
    ),
    notes: cleanString(input.notes, { max: 1500, allowEmpty: true }),
    audit: sanitizeAudit(input.audit, existing?.audit || {})
  };

  if (!isUpdate && input.id) out.id = cleanId(input.id, { max: 80, allowEmpty: false });
  return out;
}

function generateAssignmentId(existingIds) {
  const year = new Date().getFullYear();
  for (let i = 0; i < 50; i++) {
    const candidate = `RPTASG-${year}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `RPTASG-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

async function getAllAssignments() {
  try {
    const raw = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve report assignments.');
  }
}

async function getAssignmentById(id) {
  const all = await getAllAssignments();
  return all.find((row) => idsEqual(row.id, id)) || null;
}

function assertUniqueInOrg(list, candidate, { excludeId = null } = {}) {
  const incomingTeachers = [...candidate.teacherIds].sort().join('|');
  const incomingStudents = [...(candidate.targetStudentIds || [])].sort().join('|');
  const duplicate = list.some((row) => {
    if (excludeId && idsEqual(row.id, excludeId)) return false;
    const rowTeachers = Array.isArray(row.teacherIds) ? [...row.teacherIds].sort().join('|') : '';
    const rowStudents = Array.isArray(row.targetStudentIds) ? [...row.targetStudentIds].sort().join('|') : '';
    const rowTargetType = ASSIGNMENT_TARGET_TYPES.has(String(row.targetType || '').toLowerCase())
      ? String(row.targetType || '').toLowerCase()
      : (String(row.sessionId || '').trim() ? 'session' : 'date');
    const rowReportScope = ASSIGNMENT_REPORT_SCOPES.has(String(row.reportScope || '').toLowerCase())
      ? String(row.reportScope || '').toLowerCase()
      : 'class';
    return (
      idsEqual(row.orgId, candidate.orgId) &&
      String(rowTargetType || '') === String(candidate.targetType || '') &&
      String(rowReportScope || '') === String(candidate.reportScope || 'class') &&
      idsEqual(row.classId, candidate.classId) &&
      idsEqual(row.sessionId, candidate.sessionId) &&
      String(row.sessionDate || '') === String(candidate.sessionDate || '') &&
      String(row.reportStartDate || '') === String(candidate.reportStartDate || '') &&
      String(row.reportDueDate || '') === String(candidate.reportDueDate || '') &&
      String(row.taskStartTime || '') === String(candidate.taskStartTime || '') &&
      String(row.taskEndTime || '') === String(candidate.taskEndTime || '') &&
      idsEqual(row.templateId, candidate.templateId) &&
      Number(row.templateVersion || 0) === Number(candidate.templateVersion || 0) &&
      rowTeachers === incomingTeachers &&
      rowStudents === incomingStudents
    );
  });

  if (duplicate) {
    throw new Error('A matching assignment already exists for this target, template version, and teacher set.');
  }
}

async function addAssignment(input) {
  return queueWrite(async () => {
    const all = await getAllAssignments();
    const sanitized = sanitizeAssignment(input, { isUpdate: false });
    assertUniqueInOrg(all, sanitized);

    const existingIds = new Set(all.map((row) => toPublicId(row.id)).filter(Boolean));
    const id = sanitized.id || generateAssignmentId(existingIds);
    if (existingIds.has(id)) throw new Error('Assignment id already exists.');

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

async function updateAssignment(id, updates) {
  return queueWrite(async () => {
    const all = await getAllAssignments();
    const index = all.findIndex((row) => idsEqual(row.id, id));
    if (index === -1) throw new Error('Report assignment not found.');

    const existing = all[index];
    const mergedInput = { ...existing, ...updates };
    const sanitized = sanitizeAssignment(mergedInput, { isUpdate: true, existing });
    assertUniqueInOrg(all, sanitized, { excludeId: id });

    all[index] = {
      ...existing,
      ...sanitized,
      id: existing.id,
      audit: {
        ...existing.audit,
        ...sanitized.audit,
        createDateTime: existing.audit?.createDateTime || sanitized.audit?.createDateTime || new Date().toISOString(),
        lastUpdateDateTime: new Date().toISOString()
      }
    };

    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return all[index];
  });
}

async function deleteAssignment(id) {
  return queueWrite(async () => {
    const all = await getAllAssignments();
    const filtered = all.filter((row) => !idsEqual(row.id, id));
    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
  });
}

async function clearByOrg(orgId, options = {}) {
  void options;
  return queueWrite(async () => {
    const targetOrgId = toPublicId(orgId);
    if (!targetOrgId) throw new Error('orgId is required to clear report assignments.');
    const all = await getAllAssignments();
    const kept = all.filter((row) => !idsEqual(row.orgId, targetOrgId));
    const removed = all.length - kept.length;
    await fs.writeFile(dataPath, JSON.stringify(kept, null, 2));
    return { removed, remaining: kept.length };
  });
}

module.exports = {
  ASSIGNMENT_STATUSES: Object.freeze([...ASSIGNMENT_STATUSES]),
  ASSIGNMENT_REPORT_SCOPES: Object.freeze([...ASSIGNMENT_REPORT_SCOPES]),
  getAllAssignments,
  getAssignmentById,
  addAssignment,
  updateAssignment,
  deleteAssignment,
  clearByOrg
};


