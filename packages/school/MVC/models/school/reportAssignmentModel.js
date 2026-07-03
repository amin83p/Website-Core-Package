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

function generateTargetRowId(existingIds = new Set()) {
  for (let i = 0; i < 50; i += 1) {
    const candidate = `row_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `row_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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

function sanitizeAssignmentTargetRows(v, input = {}, existing = null) {
  const rows = Array.isArray(v) ? v : [];
  const existingRows = Array.isArray(existing?.targetRows) ? existing.targetRows : [];
  const existingRowIds = new Set(existingRows.map((row) => cleanString(row?.rowId, { max: 80, allowEmpty: true })).filter(Boolean));
  const seenRowIds = new Set();

  const fallbackRows = rows.length ? rows : [{
    rowId: input.assignmentRowId || input.rowId || '',
    targetType: input.targetType,
    sessionId: input.sessionId,
    sessionDate: input.sessionDate,
    dueDate: input.dueDate,
    reportStartDate: input.reportStartDate,
    reportDueDate: input.reportDueDate,
    taskStartTime: input.taskStartTime,
    taskEndTime: input.taskEndTime,
    conflictPermitted: input.conflictPermitted,
    timesheetReflection: input.timesheetReflection,
    allocatedHours: input.allocatedHours,
    teacherId: input.teacherId || (Array.isArray(input.teacherIds) ? input.teacherIds[0] : ''),
    status: input.status,
    notes: input.notes
  }];

  return fallbackRows.map((row) => {
    const targetTypeRaw = cleanString(row?.targetType, { max: 20, allowEmpty: true }).toLowerCase();
    const targetType = ASSIGNMENT_TARGET_TYPES.has(targetTypeRaw)
      ? targetTypeRaw
      : (String(row?.sessionId || '').trim() ? 'session' : 'date');
    const cleanExistingId = cleanString(row?.rowId, { max: 80, allowEmpty: true });
    let rowId = cleanExistingId && /^[A-Za-z0-9:_-]+$/.test(cleanExistingId) ? cleanExistingId : '';
    if (!rowId || seenRowIds.has(rowId)) rowId = generateTargetRowId(new Set([...existingRowIds, ...seenRowIds]));
    seenRowIds.add(rowId);

    const sessionId = cleanId(row?.sessionId, { max: 80, allowEmpty: targetType === 'date' }) || '';
    const teacherId = cleanId(row?.teacherId || (Array.isArray(input.teacherIds) ? input.teacherIds[0] : ''), { max: 80, allowEmpty: false });
    const sessionDate = cleanDateOnly(row?.sessionDate || row?.dueDate, { allowEmpty: false });
    const dueDate = targetType === 'date'
      ? cleanDateOnly(row?.dueDate || row?.sessionDate, { allowEmpty: false })
      : '';
    const taskStartTime = cleanTimeOnly(row?.taskStartTime, { allowEmpty: false });
    const taskEndTime = cleanTimeOnly(row?.taskEndTime, { allowEmpty: false });
    if (!taskStartTime || !taskEndTime) {
      throw new Error('Task start/end time are required for every report assignment row.');
    }
    if (taskStartTime >= taskEndTime) {
      throw new Error('Task end time must be later than task start time for every report assignment row.');
    }

    const reportStartDate = cleanDateOnly(row?.reportStartDate, { allowEmpty: false });
    const reportDueDate = cleanDateOnly(row?.reportDueDate, { allowEmpty: false });
    if (reportStartDate > reportDueDate) {
      throw new Error('Report start date cannot be after report due date.');
    }

    const rowStatus = cleanString(row?.status, { max: 20, allowEmpty: true }).toLowerCase() || 'active';
    if (!ASSIGNMENT_STATUSES.has(rowStatus)) throw new Error('Invalid assignment row status.');
    const timesheetReflection = cleanBoolean(row?.timesheetReflection, false);

    return {
      rowId,
      targetType,
      sessionId,
      sessionDate,
      dueDate,
      reportStartDate,
      reportDueDate,
      taskStartTime,
      taskEndTime,
      conflictPermitted: cleanBoolean(row?.conflictPermitted, targetType === 'session'),
      timesheetReflection,
      allocatedHours: timesheetReflection ? cleanAllocatedHours(row?.allocatedHours) : 0,
      teacherId,
      status: rowStatus,
      notes: cleanString(row?.notes, { max: 1500, allowEmpty: true })
    };
  });
}

function getEffectiveTargetRows(assignment = {}) {
  const rows = Array.isArray(assignment?.targetRows) ? assignment.targetRows : [];
  if (rows.length) return rows.map((row) => ({
    rowId: cleanString(row?.rowId, { max: 80, allowEmpty: true }) || '',
    targetType: ASSIGNMENT_TARGET_TYPES.has(String(row?.targetType || '').trim().toLowerCase())
      ? String(row?.targetType || '').trim().toLowerCase()
      : (String(row?.sessionId || '').trim() ? 'session' : 'date'),
    sessionId: cleanString(row?.sessionId, { max: 80, allowEmpty: true }),
    sessionDate: cleanString(row?.sessionDate, { max: 10, allowEmpty: true }),
    dueDate: cleanString(row?.dueDate, { max: 10, allowEmpty: true }),
    reportStartDate: cleanString(row?.reportStartDate, { max: 10, allowEmpty: true }),
    reportDueDate: cleanString(row?.reportDueDate, { max: 10, allowEmpty: true }),
    taskStartTime: cleanString(row?.taskStartTime, { max: 5, allowEmpty: true }),
    taskEndTime: cleanString(row?.taskEndTime, { max: 5, allowEmpty: true }),
    conflictPermitted: cleanBoolean(row?.conflictPermitted, String(row?.targetType || '').trim().toLowerCase() === 'session'),
    timesheetReflection: cleanBoolean(row?.timesheetReflection, false),
    allocatedHours: Number(row?.allocatedHours || 0),
    teacherId: cleanString(row?.teacherId, { max: 80, allowEmpty: true }),
    status: cleanString(row?.status, { max: 20, allowEmpty: true }).toLowerCase() || String(assignment?.status || 'active').toLowerCase(),
    notes: cleanString(row?.notes, { max: 1500, allowEmpty: true })
  }));

  const targetTypeRaw = cleanString(assignment?.targetType, { max: 20, allowEmpty: true }).toLowerCase();
  const targetType = ASSIGNMENT_TARGET_TYPES.has(targetTypeRaw)
    ? targetTypeRaw
    : (String(assignment?.sessionId || '').trim() ? 'session' : 'date');
  return [{
    rowId: cleanString(assignment?.assignmentRowId || assignment?.rowId, { max: 80, allowEmpty: true }) || '',
    targetType,
    sessionId: cleanString(assignment?.sessionId, { max: 80, allowEmpty: true }),
    sessionDate: cleanString(assignment?.sessionDate || assignment?.dueDate, { max: 10, allowEmpty: true }),
    dueDate: targetType === 'date'
      ? cleanString(assignment?.dueDate || assignment?.sessionDate, { max: 10, allowEmpty: true })
      : '',
    reportStartDate: cleanString(assignment?.reportStartDate, { max: 10, allowEmpty: true }),
    reportDueDate: cleanString(assignment?.reportDueDate, { max: 10, allowEmpty: true }),
    taskStartTime: cleanString(assignment?.taskStartTime, { max: 5, allowEmpty: true }),
    taskEndTime: cleanString(assignment?.taskEndTime, { max: 5, allowEmpty: true }),
    conflictPermitted: cleanBoolean(assignment?.conflictPermitted, targetType === 'session'),
    timesheetReflection: cleanBoolean(assignment?.timesheetReflection, false),
    allocatedHours: Number(assignment?.allocatedHours || 0),
    teacherId: cleanString(assignment?.teacherId || (Array.isArray(assignment?.teacherIds) ? assignment.teacherIds[0] : ''), { max: 80, allowEmpty: true }),
    status: cleanString(assignment?.status, { max: 20, allowEmpty: true }).toLowerCase() || 'active',
    notes: cleanString(assignment?.notes, { max: 1500, allowEmpty: true })
  }];
}

function findEffectiveTargetRow(assignment = {}, rowId = '') {
  const rows = getEffectiveTargetRows(assignment);
  const requested = cleanString(rowId, { max: 80, allowEmpty: true });
  if (requested) {
    const found = rows.find((row) => String(row?.rowId || '') === requested);
    if (found) return found;
  }
  return rows.find((row) => String(row?.status || '').toLowerCase() === 'active') || rows[0] || null;
}

function applyTargetRowToAssignment(assignment = {}, row = null) {
  const effectiveRow = row || findEffectiveTargetRow(assignment);
  if (!effectiveRow) return assignment;
  return {
    ...assignment,
    assignmentRowId: effectiveRow.rowId || '',
    rowId: effectiveRow.rowId || '',
    targetType: effectiveRow.targetType,
    sessionId: effectiveRow.sessionId,
    sessionDate: effectiveRow.sessionDate,
    dueDate: effectiveRow.dueDate,
    reportStartDate: effectiveRow.reportStartDate,
    reportDueDate: effectiveRow.reportDueDate,
    taskStartTime: effectiveRow.taskStartTime,
    taskEndTime: effectiveRow.taskEndTime,
    conflictPermitted: effectiveRow.conflictPermitted,
    timesheetReflection: effectiveRow.timesheetReflection,
    allocatedHours: effectiveRow.allocatedHours,
    teacherId: effectiveRow.teacherId || '',
    teacherIds: effectiveRow.teacherId ? [effectiveRow.teacherId] : (Array.isArray(assignment?.teacherIds) ? assignment.teacherIds : []),
    rowStatus: effectiveRow.status,
    rowNotes: effectiveRow.notes
  };
}

function sanitizeAssignment(input, { isUpdate = false, existing = null } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid report assignment payload.');

  const orgId = cleanId(input.orgId, { max: 64, allowEmpty: false });
  const classId = cleanId(input.classId, { max: 80, allowEmpty: false });
  const templateId = cleanId(input.templateId, { max: 80, allowEmpty: false });
  const targetRows = sanitizeAssignmentTargetRows(input.targetRows, input, existing);
  if (!targetRows.length) throw new Error('Add at least one report assignment target row.');
  const firstActiveRow = targetRows.find((row) => row.status === 'active') || targetRows[0];
  const targetType = firstActiveRow.targetType;
  const sessionId = firstActiveRow.sessionId;
  const sessionDate = firstActiveRow.sessionDate;
  const templateVersion = cleanInteger(input.templateVersion, { min: 1, max: 1000, allowEmpty: false });
  const teacherIds = sanitizeTeacherIds(
    [...new Set([
      ...targetRows
        .filter((row) => row.status === 'active')
        .map((row) => row.teacherId)
        .filter(Boolean),
      ...targetRows
        .map((row) => row.teacherId)
        .filter(Boolean),
      ...(Array.isArray(input.teacherIds) ? input.teacherIds : [])
    ])]
  );
  if (!teacherIds.length) throw new Error('Select at least one teacher for assignment.');
  const reportScope = cleanString(input.reportScope, { max: 40, allowEmpty: true }).toLowerCase() || 'class';
  if (!ASSIGNMENT_REPORT_SCOPES.has(reportScope)) throw new Error('Invalid assignment report scope.');
  const targetStudentIds = sanitizeStudentIds(input.targetStudentIds);
  if (reportScope === 'selected_students' && !targetStudentIds.length) {
    throw new Error('Select at least one student for "specific students" scope.');
  }

  const status = cleanString(input.status, { max: 20, allowEmpty: true }).toLowerCase() || 'active';
  if (!ASSIGNMENT_STATUSES.has(status)) throw new Error('Invalid assignment status.');

  const dueDate = firstActiveRow.dueDate;
  const taskStartTime = firstActiveRow.taskStartTime;
  const taskEndTime = firstActiveRow.taskEndTime;
  const reportStartDate = firstActiveRow.reportStartDate;
  const reportDueDate = firstActiveRow.reportDueDate;
  const conflictPermitted = firstActiveRow.conflictPermitted;
  const timesheetReflection = firstActiveRow.timesheetReflection;
  const allocatedHours = firstActiveRow.allocatedHours;

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
    targetRows,
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
  getEffectiveTargetRows,
  findEffectiveTargetRow,
  applyTargetRowToAssignment,
  getAllAssignments,
  getAssignmentById,
  addAssignment,
  updateAssignment,
  deleteAssignment,
  clearByOrg
};


