const schoolDataService = require('./schoolDataService');
const reportRuleEngineService = require('./reportRuleEngineService');
const schoolIdentityLookupService = require('./schoolIdentityLookupService');
const { requireCoreModule } = require('./schoolCoreContracts');
const uploadMiddleware = requireCoreModule('MVC/middleware/upload');
const adminChekersService = requireCoreModule('MVC/services/adminChekersService');
const { SECTIONS, OPERATIONS } = requireCoreModule('config/accessConstants');
const reportAssignmentModel = require('../../models/school/reportAssignmentModel');
const classEnrollmentReadService = require('./classEnrollmentReadService');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function isSchoolReportAdminViewer(reqUser) {
  return adminChekersService.isAdminForRequest(reqUser, SECTIONS.SCHOOL_REPORTS_INSTANCES, OPERATIONS.READ_ALL, {
    orgId: reqUser?.activeOrgId,
    section: { id: SECTIONS.SCHOOL_REPORTS_INSTANCES, category: 'SCHOOL' }
  });
}

function parseJsonSafe(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  try {
    return JSON.parse(v);
  } catch (_) {
    return fallback;
  }
}

function parseStringArrayField(rawValue) {
  const pushClean = (acc, value) => {
    const clean = String(value || '').trim();
    if (clean) acc.push(clean);
    return acc;
  };

  if (Array.isArray(rawValue)) {
    return rawValue.reduce(pushClean, []);
  }

  if (rawValue === undefined || rawValue === null) return [];

  const text = String(rawValue).trim();
  if (!text) return [];

  if (text.startsWith('[')) {
    const parsed = parseJsonSafe(text, []);
    if (Array.isArray(parsed)) return parsed.reduce(pushClean, []);
  }

  return text.split(',').reduce(pushClean, []);
}

function parseDateOnlyList(rawValue) {
  const seen = new Set();
  return parseStringArrayField(rawValue)
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .filter((date) => {
      if (seen.has(date)) return false;
      seen.add(date);
      return true;
    });
}

function parseDateOnlyValue(rawValue) {
  const value = String(rawValue || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function parseTimeValue(rawValue) {
  const value = String(rawValue || '').trim();
  if (!/^\d{2}:\d{2}$/.test(value)) return '';
  const [hRaw, mRaw] = value.split(':');
  const hour = Number(hRaw);
  const minute = Number(mRaw);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return '';
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseBooleanFlag(rawValue, fallback = false) {
  if (typeof rawValue === 'boolean') return rawValue;
  if (rawValue === undefined || rawValue === null || rawValue === '') return Boolean(fallback);
  const value = String(rawValue).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return Boolean(fallback);
}

function parseTargetRowsField(rawValue) {
  const parsed = parseJsonSafe(rawValue, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((row) => row && typeof row === 'object' && !Array.isArray(row))
    .map((row) => ({
      rowId: String(row.rowId || '').trim(),
      targetType: String(row.targetType || 'session').trim().toLowerCase() || 'session',
      sessionId: String(row.sessionId || '').trim(),
      sessionDate: parseDateOnlyValue(row.sessionDate),
      dueDate: parseDateOnlyValue(row.dueDate),
      reportStartDate: parseDateOnlyValue(row.reportStartDate),
      reportDueDate: parseDateOnlyValue(row.reportDueDate),
      taskStartTime: parseTimeValue(row.taskStartTime),
      taskEndTime: parseTimeValue(row.taskEndTime),
      conflictPermitted: parseBooleanFlag(row.conflictPermitted, false),
      timesheetReflection: parseBooleanFlag(row.timesheetReflection, false),
      allocatedHours: (() => {
        const n = parseFloat(row.allocatedHours);
        return Number.isFinite(n) ? n : 0;
      })(),
      teacherId: String(row.teacherId || '').trim(),
      status: String(row.status || 'active').trim().toLowerCase() || 'active',
      notes: String(row.notes || '').trim()
    }));
}

function getEffectiveAssignmentRows(assignment = {}) {
  if (reportAssignmentModel && typeof reportAssignmentModel.getEffectiveTargetRows === 'function') {
    return reportAssignmentModel.getEffectiveTargetRows(assignment);
  }
  return [];
}

function applyAssignmentRow(assignment = {}, row = null) {
  if (reportAssignmentModel && typeof reportAssignmentModel.applyTargetRowToAssignment === 'function') {
    return reportAssignmentModel.applyTargetRowToAssignment(assignment, row);
  }
  return assignment;
}

function findAssignmentRow(assignment = {}, rowId = '') {
  if (reportAssignmentModel && typeof reportAssignmentModel.findEffectiveTargetRow === 'function') {
    return reportAssignmentModel.findEffectiveTargetRow(assignment, rowId);
  }
  return null;
}

function resolveReportPeriod({ requestedStartDate = '', requestedDueDate = '', selectedSessionIds = [], selectedDateTargets = [], sessions = [] }) {
  const start = parseDateOnlyValue(requestedStartDate);
  const due = parseDateOnlyValue(requestedDueDate);
  if (start && due) return { reportStartDate: start, reportDueDate: due };

  const dates = [];
  const sessionIdSet = new Set((Array.isArray(selectedSessionIds) ? selectedSessionIds : []).map((id) => String(id || '').trim()).filter(Boolean));
  (Array.isArray(sessions) ? sessions : []).forEach((session) => {
    const sid = String(session?.sessionId || '').trim();
    if (!sid || !sessionIdSet.has(sid)) return;
    const date = parseDateOnlyValue(session?.date);
    if (date) dates.push(date);
  });
  (Array.isArray(selectedDateTargets) ? selectedDateTargets : []).forEach((date) => {
    const clean = parseDateOnlyValue(date);
    if (clean) dates.push(clean);
  });

  if (!dates.length) return { reportStartDate: '', reportDueDate: '' };
  dates.sort();
  return {
    reportStartDate: dates[0],
    reportDueDate: dates[dates.length - 1]
  };
}

function inferAssignmentTargetType(row) {
  const explicit = String(row?.targetType || '').trim().toLowerCase();
  if (explicit === 'date') return 'date';
  if (explicit === 'session') return 'session';
  return String(row?.sessionId || '').trim() ? 'session' : 'date';
}

function inferAssignmentReportScope(row) {
  const explicit = String(row?.reportScope || '').trim().toLowerCase();
  if (reportAssignmentModel.ASSIGNMENT_REPORT_SCOPES?.includes(explicit)) return explicit;
  return 'class';
}

function getClassStudentIds(classData, sessions = []) {
  const out = new Set();
  const sessionRows = Array.isArray(sessions) ? sessions : [];
  sessionRows.forEach((session) => {
    const roster = Array.isArray(session?.roster) ? session.roster : [];
    roster.forEach((row) => {
      const personId = String(row?.personId || '').trim();
      if (personId) out.add(personId);
    });
  });

  return [...out];
}

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function normalizeClassRegistrationMode(value) {
  return String(value || '').trim().toLowerCase() === 'rolling' ? 'rolling' : 'term_based';
}

function buildClassLifecycleSnapshot(classRow = {}) {
  const registrationMode = normalizeClassRegistrationMode(classRow?.registrationMode);
  const parsedCycleNo = Number.parseInt(String(classRow?.cycleNo || '').trim(), 10);
  const cycleNo = Number.isFinite(parsedCycleNo) && parsedCycleNo > 0 ? parsedCycleNo : 1;
  return {
    registrationMode,
    cycleNo,
    cycleGroupId: String(classRow?.cycleGroupId || '').trim(),
    cycleStartDate: String(classRow?.cycleStartDate || '').trim(),
    cycleEndDate: String(classRow?.cycleEndDate || '').trim(),
    isClosedForNewEnrollment: classRow?.isClosedForNewEnrollment === true || String(classRow?.isClosedForNewEnrollment || '').trim().toLowerCase() === 'true',
    previousClassId: String(classRow?.previousClassId || '').trim(),
    nextClassId: String(classRow?.nextClassId || '').trim()
  };
}

async function resolveClassStudentIds({ classData, sessions = [], reqUser, referenceDate = '', students = [] } = {}) {
  const classId = String(classData?.id || '').trim();
  if (!classId) return [];
  const snapshot = await classEnrollmentReadService.listActiveStudentIdsForClass({
    classId,
    classItem: classData,
    reqUser,
    activeOrgId: classData?.orgId,
    sessionDates: (Array.isArray(sessions) ? sessions : []).map((row) => String(row?.date || '').trim()).filter(Boolean),
    startDate: referenceDate,
    endDate: referenceDate,
    canonicalStatuses: classEnrollmentReadService.getReportRosterStatusesForClass(classData)
  });
  const activeStudentIds = snapshot?.studentIds instanceof Set ? [...snapshot.studentIds] : [];
  if (!activeStudentIds.length) return [];

  const studentRows = Array.isArray(students) && students.length
    ? students
    : await schoolDataService.fetchData('students', {}, reqUser);
  const studentToPersonMap = new Map(
    (Array.isArray(studentRows) ? studentRows : [])
      .map((row) => [String(row?.id || '').trim(), String(row?.personId || '').trim()])
      .filter(([studentId, personId]) => Boolean(studentId && personId))
  );

  const personIds = new Set();
  activeStudentIds.forEach((studentId) => {
    const resolved = String(studentToPersonMap.get(String(studentId || '').trim()) || '').trim();
    if (resolved) personIds.add(resolved);
  });
  return [...personIds];
}

function buildClassStudentOptionsFromIds(studentIds = [], sessions = [], personMap = new Map()) {
  const ids = Array.isArray(studentIds) ? studentIds : [];
  const rosterNameMap = new Map();
  (Array.isArray(sessions) ? sessions : []).forEach((session) => {
    const roster = Array.isArray(session?.roster) ? session.roster : [];
    roster.forEach((row) => {
      const personId = String(row?.personId || '').trim();
      const label = String(row?.name || '').trim();
      if (personId && label && !rosterNameMap.has(personId)) rosterNameMap.set(personId, label);
    });
  });
  return ids
    .map((personId) => ({
      id: personId,
      name: personMap.get(personId) || rosterNameMap.get(personId) || personId
    }))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

function buildClassStudentOptions(classData, sessions, personMap) {
  const ids = getClassStudentIds(classData, sessions);
  const rosterNameMap = new Map();
  (Array.isArray(sessions) ? sessions : []).forEach((session) => {
    const roster = Array.isArray(session?.roster) ? session.roster : [];
    roster.forEach((row) => {
      const personId = String(row?.personId || '').trim();
      const label = String(row?.name || '').trim();
      if (personId && label && !rosterNameMap.has(personId)) rosterNameMap.set(personId, label);
    });
  });
  return ids
    .map((personId) => ({
      id: personId,
      name: personMap.get(personId) || rosterNameMap.get(personId) || personId
    }))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

function getScopedActiveOrgId(reqUser) {
  if (!reqUser) return '';
  return toPublicId(reqUser.activeOrgId);
}

function getActiveOrgRoleSet(reqUser) {
  const activeOrgId = getScopedActiveOrgId(reqUser);
  if (!activeOrgId) return new Set();
  const memberships = Array.isArray(reqUser?.allowedOrgs) ? reqUser.allowedOrgs : [];
  const membership = memberships.find((row) => idsEqual(row?.orgId, activeOrgId)) || null;
  const rawRoles = Array.isArray(membership?.roles) ? membership.roles : (membership?.role ? [membership.role] : []);
  return new Set(rawRoles.map((role) => String(role || '').trim().toLowerCase()).filter(Boolean));
}

function canBypassOrgScope(reqUser) {
  if (!reqUser) return false;
  if (!adminChekersService.isSuperAdmin(reqUser)) return false;
  return String(getScopedActiveOrgId(reqUser) || '').toUpperCase() === 'SYSTEM';
}

function isRecordAccessibleByOrg(record, reqUser) {
  if (!record) return false;
  if (canBypassOrgScope(reqUser)) return true;
  const activeOrgId = getScopedActiveOrgId(reqUser);
  if (!activeOrgId) return false;
  return idsEqual(record.orgId, activeOrgId);
}

function filterRecordsByOrg(rows, reqUser) {
  const list = Array.isArray(rows) ? rows : [];
  if (canBypassOrgScope(reqUser)) return list;
  const activeOrgId = getScopedActiveOrgId(reqUser);
  if (!activeOrgId) return [];
  return list.filter((row) => idsEqual(row?.orgId, activeOrgId));
}

function resolveUploadedFileRecord(file) {
  if (!file) return null;
  const storedPath = uploadMiddleware.getStoredFilePath(file);
  const storedUrl = uploadMiddleware.getStoredFileUrl(file);
  if (!storedPath && !storedUrl) return null;
  return {
    fileName: String(file.filename),
    originalName: String(file.originalname || file.filename),
    path: String(storedPath || storedUrl),
    url: String(storedUrl || storedPath),
    uploadedAt: new Date().toISOString()
  };
}

function buildSchemaFromBuilderPayload(body) {
  const schemaFromHidden = parseJsonSafe(body.schemaJson, null);
  if (schemaFromHidden && Array.isArray(schemaFromHidden.fields)) return schemaFromHidden;
  return {
    version: Number(body.schemaVersion || 1) || 1,
    fields: []
  };
}

function buildPlaceholderMapFromPayload(body) {
  const mapFromHidden = parseJsonSafe(body.placeholderMapJson, null);
  return mapFromHidden && typeof mapFromHidden === 'object' ? mapFromHidden : {};
}

async function buildPersonNameMap(reqUser) {
  const payload = await schoolIdentityLookupService.listSchoolPersonRecords({
    reqUser,
    requireSchoolRole: false,
    query: { limit: 1000 }
  });
  const persons = payload.allRows || payload.rows || [];
  const map = new Map();
  persons.forEach((person) => {
    const id = toPublicId(person?.id);
    if (!id) return;
    const fullName = `${person?.name?.first || ''} ${person?.name?.last || ''}`.trim();
    const preferred = String(person?.name?.preferred || '').trim();
    map.set(id, preferred || fullName || id);
  });
  return map;
}

async function listAllReportTemplates(reqUser) {
  return await schoolDataService.fetchData('reportTemplates', {}, reqUser);
}

async function listAllReportAssignments(reqUser) {
  return await schoolDataService.fetchData('reportAssignments', {}, reqUser);
}

async function listAllReportInstances(reqUser) {
  return await schoolDataService.fetchData('reportInstances', {}, reqUser);
}

function buildHomeSummary(allTemplates, allAssignments, allInstances, reqUser) {
  const templates = filterRecordsByOrg(allTemplates, reqUser);
  const assignments = filterRecordsByOrg(allAssignments, reqUser);
  const assignmentIds = new Set(assignments.map((row) => toPublicId(row?.id)).filter(Boolean));
  const instances = filterRecordsByOrg(allInstances, reqUser)
    .filter(isActiveReportInstance)
    .filter((row) => assignmentIds.has(toPublicId(row?.assignmentId)));

  return {
    templateCount: templates.length,
    assignmentCount: assignments.length,
    instanceCount: instances.length,
    draftCount: instances.filter((row) => String(row.status || '') === 'draft').length,
    submittedCount: instances.filter((row) => String(row.status || '') === 'submitted').length
  };
}

function isActiveReportInstance(row) {
  return String(row?.status || '').trim().toLowerCase() !== 'archived';
}

function isActiveReportAssignment(row) {
  return String(row?.status || '').trim().toLowerCase() === 'active';
}

function buildInstanceIdentityKey(assignmentId = '', teacherId = '', targetKey = 'class') {
  return [
    toPublicId(assignmentId),
    '',
    toPublicId(teacherId),
    String(targetKey || 'class').trim() || 'class'
  ].join('|');
}

function buildInstanceIdentityKeyForRow(assignmentId = '', assignmentRowId = '', teacherId = '', targetKey = 'class') {
  return [
    toPublicId(assignmentId),
    toPublicId(assignmentRowId),
    toPublicId(teacherId),
    String(targetKey || 'class').trim() || 'class'
  ].join('|');
}

function normalizeInstanceTargetKey(row = {}) {
  const targetKey = String(row?.targetKey || '').trim();
  if (targetKey) return targetKey;
  const studentId = toPublicId(row?.studentId);
  return studentId ? `student:${studentId}` : 'class';
}

function isSameReportReviewTarget(left = {}, right = {}) {
  const leftStudentId = toPublicId(left?.studentId);
  const rightStudentId = toPublicId(right?.studentId);
  const leftTargetKey = normalizeInstanceTargetKey(left);
  const rightTargetKey = normalizeInstanceTargetKey(right);

  if (!leftStudentId && !rightStudentId) {
    return leftTargetKey === 'class' && rightTargetKey === 'class';
  }

  return Boolean(leftStudentId && rightStudentId)
    && idsEqual(leftStudentId, rightStudentId)
    && leftTargetKey === rightTargetKey;
}

function isReportInstanceAssignmentConsistent(instance = {}, assignment = {}) {
  if (!assignment) return false;
  return idsEqual(instance?.orgId, assignment?.orgId)
    && idsEqual(instance?.classId, assignment?.classId)
    && idsEqual(instance?.templateId, assignment?.templateId);
}

function resolveReviewNavigatorSortDate(instance = {}, assignment = {}) {
  return String(
    instance?.sessionDate
    || assignment?.reportDueDate
    || assignment?.dueDate
    || assignment?.sessionDate
    || ''
  ).trim();
}

function canParticipantReviewInstance(row = {}, viewerPersonId = '') {
  if (!viewerPersonId) return false;
  return idsEqual(row?.teacherId, viewerPersonId) || idsEqual(row?.studentId, viewerPersonId);
}

function resolveAssignmentTargetDate(assignment = {}) {
  const row = findAssignmentRow(assignment, assignment.assignmentRowId || assignment.rowId || '');
  if (row) return String(row.reportDueDate || row.dueDate || row.sessionDate || '').trim();
  return String(
    assignment?.reportDueDate ||
    assignment?.dueDate ||
    assignment?.sessionDate ||
    ''
  ).trim();
}

async function resolvePendingAssignmentStudentTargets({ assignment, classItem, reqUser, students = [] } = {}) {
  const reportScope = inferAssignmentReportScope(assignment);
  if (reportScope === 'class') return [''];
  if (reportScope === 'selected_students') {
    return [...new Set((Array.isArray(assignment?.targetStudentIds) ? assignment.targetStudentIds : [])
      .map((id) => toPublicId(id))
      .filter(Boolean))];
  }
  if (!classItem) return [];
  const sessions = await schoolDataService.getClassSessions(toPublicId(classItem?.id), reqUser);
  return resolveClassStudentIds({
    classData: classItem,
    sessions,
    reqUser,
    referenceDate: resolveAssignmentTargetDate(assignment),
    students
  });
}

function buildTemplateSavePayload({
  body,
  existingTemplate,
  activeOrgId,
  reqUser,
  uploadedFile
}) {
  const payload = {
    orgId: existingTemplate?.orgId || activeOrgId,
    type: String(body.type || '').trim().toLowerCase(),
    version: Number(body.version || 1) || 1,
    title: String(body.title || '').trim(),
    status: String(body.status || 'draft').trim().toLowerCase(),
    description: String(body.description || '').trim(),
    schema: buildSchemaFromBuilderPayload(body),
    placeholderMap: buildPlaceholderMapFromPayload(body),
    audit: {
      createUser: existingTemplate?.audit?.createUser || reqUser?.id || '',
      createDateTime: existingTemplate?.audit?.createDateTime || new Date().toISOString(),
      lastUpdateUser: reqUser?.id || '',
      lastUpdateDateTime: new Date().toISOString()
    }
  };

  const uploadedDocx = resolveUploadedFileRecord(uploadedFile);
  if (uploadedDocx) payload.docxTemplate = uploadedDocx;
  else if (existingTemplate?.docxTemplate) payload.docxTemplate = existingTemplate.docxTemplate;

  return payload;
}

function parseAssignmentSaveRequest(body) {
  const targetRows = parseTargetRowsField(body.targetRowsJson || body.targetRows);
  return {
    classId: String(body.classId || '').trim(),
    templateId: String(body.templateId || '').trim(),
    selectedSessionIds: [...new Set(parseStringArrayField(body.sessionIdsJson || body.sessionIds || body.sessionId))],
    selectedDateTargets: parseDateOnlyList(body.dateTargetsJson || body.dateTargets || body.dueDate),
    requestedReportStartDate: parseDateOnlyValue(body.reportStartDate),
    requestedReportDueDate: parseDateOnlyValue(body.reportDueDate),
    requestedTaskStartTime: parseTimeValue(body.taskStartTime),
    requestedTaskEndTime: parseTimeValue(body.taskEndTime),
    conflictPermitted: parseBooleanFlag(body.conflictPermitted, false),
    selectedTargetStudentIds: [...new Set(parseStringArrayField(body.targetStudentIdsJson || body.targetStudentIds))],
    reportScope: String(body.reportScope || 'class').trim().toLowerCase() || 'class',
    teacherIds: [...new Set((Array.isArray(body.teacherIds)
      ? body.teacherIds
      : (body.teacherIds ? [body.teacherIds] : []))
      .map((item) => String(item || '').trim())
      .filter(Boolean))],
    status: String(body.status || 'active').trim().toLowerCase(),
    notes: String(body.notes || '').trim(),
    timesheetReflection: parseBooleanFlag(body.timesheetReflection, false),
    allocatedHours: (() => {
      const n = parseFloat(body.allocatedHours);
      return Number.isFinite(n) ? n : 0;
    })(),
    targetRows
  };
}

async function buildAssignmentListContext({
  reqUser,
  classFilter = '',
  classIds = [],
  teacherPersonId = '',
  reportScope = '',
  q = ''
}) {
  const requestedClassIds = [...new Set(
    [...parseStringArrayField(classIds), ...parseStringArrayField(classFilter)]
      .map((id) => toPublicId(id))
      .filter(Boolean)
  )];
  const requestedTeacherPersonId = toPublicId(teacherPersonId);
  const normalizedReportScope = String(reportScope || '').trim().toLowerCase();
  const requestedReportScope = reportAssignmentModel.ASSIGNMENT_REPORT_SCOPES?.includes(normalizedReportScope)
    ? normalizedReportScope
    : '';

  const [allAssignments, allTemplates, classes, personMap] = await Promise.all([
    listAllReportAssignments(reqUser),
    listAllReportTemplates(reqUser),
    schoolDataService.fetchData('classes', {}, reqUser),
    requestedTeacherPersonId ? buildPersonNameMap(reqUser) : Promise.resolve(new Map())
  ]);

  const classMap = new Map(
    (Array.isArray(classes) ? classes : [])
      .map((row) => [toPublicId(row?.id), row])
      .filter(([id]) => Boolean(id))
  );
  const templateMap = new Map(
    (Array.isArray(allTemplates) ? allTemplates : [])
      .map((row) => [toPublicId(row?.id), row])
      .filter(([id]) => Boolean(id))
  );
  const classTitleMap = new Map();
  const classLifecycleMap = new Map();
  classMap.forEach((classItem, id) => {
    classTitleMap.set(id, classItem?.title || id);
    classLifecycleMap.set(id, buildClassLifecycleSnapshot(classItem || {}));
  });

  const scopedAssignments = filterRecordsByOrg(allAssignments, reqUser)
    .filter((row) => {
      const rowClassId = toPublicId(row?.classId);
      if (requestedClassIds.length && !requestedClassIds.some((id) => idsEqual(id, rowClassId))) return false;

      if (requestedTeacherPersonId) {
        const rowTeacherIds = (Array.isArray(row?.teacherIds) ? row.teacherIds : [])
          .map((id) => toPublicId(id))
          .filter(Boolean);
        if (!rowTeacherIds.some((id) => idsEqual(id, requestedTeacherPersonId))) return false;
      }

      if (requestedReportScope && inferAssignmentReportScope(row) !== requestedReportScope) return false;
      return true;
    });

  const rows = scopedAssignments
    .map((row) => {
      const template = templateMap.get(toPublicId(row?.templateId)) || null;
      const targetRows = getEffectiveAssignmentRows(row);
      const activeTargetRows = targetRows.filter((targetRow) => String(targetRow?.status || '').trim().toLowerCase() === 'active');
      const firstRow = activeTargetRows[0] || targetRows[0] || {};
      const targetType = firstRow.targetType || inferAssignmentTargetType(row);
      const targetDate = String(firstRow.sessionDate || firstRow.dueDate || row.sessionDate || row.dueDate || '').trim();
      const taskTimeRange = String(firstRow.taskStartTime || '').trim() && String(firstRow.taskEndTime || '').trim()
        ? `${firstRow.taskStartTime} - ${firstRow.taskEndTime}`
        : '';
      const resolvedReportScope = inferAssignmentReportScope(row);
      const classId = toPublicId(row?.classId) || String(row?.classId || '').trim();
      return {
        ...row,
        targetRows,
        targetRowCount: targetRows.length,
        targetType,
        targetDate,
        taskTimeRange,
        reportScope: resolvedReportScope,
        targetStudentCount: Array.isArray(row.targetStudentIds) ? row.targetStudentIds.length : 0,
        classTitle: classTitleMap.get(classId) || classId,
        classLifecycle: classLifecycleMap.get(classId) || buildClassLifecycleSnapshot({}),
        templateTitle: template?.title || row.templateId
      };
    })
    .filter((row) => {
      if (!q) return true;
      return [
        row.id,
        row.classTitle,
        row.templateTitle,
        row.targetDate,
        row.targetType,
        row.reportScope,
        row.status,
        row.reportStartDate,
        row.reportDueDate,
        row.taskStartTime,
        row.taskEndTime,
        row.taskTimeRange,
        Array.isArray(row.targetRows) ? row.targetRows.map((targetRow) => [
          targetRow.sessionId,
          targetRow.sessionDate,
          targetRow.reportStartDate,
          targetRow.reportDueDate,
          targetRow.taskStartTime,
          targetRow.taskEndTime,
          targetRow.teacherId,
          targetRow.status
        ].join(' ')).join(' ') : '',
        Array.isArray(row.teacherIds) ? row.teacherIds.join(' ') : ''
      ]
        .map((v) => String(v || '').toLowerCase())
        .some((v) => v.includes(q));
    })
    .sort((a, b) => String(b.targetDate || '').localeCompare(String(a.targetDate || '')));

  const selectedClasses = requestedClassIds.map((id) => ({
    id,
    name: classTitleMap.get(id) || id
  }));

  return {
    rows,
    selectedClassTitle: selectedClasses.length === 1 ? selectedClasses[0].name : '',
    selectedClassIds: requestedClassIds,
    selectedClasses,
    selectedTeacherPersonId: requestedTeacherPersonId,
    selectedTeacherName: requestedTeacherPersonId ? (personMap.get(requestedTeacherPersonId) || requestedTeacherPersonId) : '',
    selectedReportScope: requestedReportScope
  };
}

async function buildAssignmentFormContext({ assignment = null, requestedClassId = '', reqUser }) {
  const [allTemplates, classes, allStudents, personMap] = await Promise.all([
    listAllReportTemplates(reqUser),
    schoolDataService.fetchData('classes', {}, reqUser),
    schoolDataService.fetchData('students', {}, reqUser),
    buildPersonNameMap(reqUser)
  ]);

  const templates = filterRecordsByOrg(allTemplates, reqUser).filter((row) => row.status !== 'archived');
  const selectedClassId = String(requestedClassId || assignment?.classId || '').trim();
  const selectedClass = classes.find((row) => idsEqual(row.id, selectedClassId)) || null;
  const sessionsRaw = selectedClassId
    ? await schoolDataService.getClassSessions(selectedClassId, reqUser)
    : [];
  const sessions = [...sessionsRaw].sort((a, b) => {
    const left = `${String(a?.date || '')}T${String(a?.startTime || '00:00')}`;
    const right = `${String(b?.date || '')}T${String(b?.startTime || '00:00')}`;
    return right.localeCompare(left);
  });

  const selectedTemplateId = String(assignment?.templateId || '').trim();
  const selectedTemplate = templates.find((tpl) => idsEqual(tpl.id, selectedTemplateId)) || null;

  const selectedSessionIds = [];
  const selectedDateTargets = [];
  const selectedTargetRows = [];
  const selectedReportScope = inferAssignmentReportScope(assignment);
  const selectedTargetStudentIds = [];
  const selectedTaskStartTime = String(assignment?.taskStartTime || '').trim();
  const selectedTaskEndTime = String(assignment?.taskEndTime || '').trim();
  const selectedConflictPermitted = assignment?.targetType === 'session'
    ? true
    : Boolean(assignment?.conflictPermitted);
  const selectedReportStartDate = String(assignment?.reportStartDate || '').trim();
  const selectedReportDueDate = String(assignment?.reportDueDate || '').trim();
  const canReuseAssignmentTargets = assignment && idsEqual(assignment?.classId, selectedClassId);
  if (canReuseAssignmentTargets) {
    const effectiveRows = getEffectiveAssignmentRows(assignment);
    effectiveRows.forEach((targetRow) => {
      selectedTargetRows.push(targetRow);
      const sid = String(targetRow?.sessionId || '').trim();
      if (sid) selectedSessionIds.push(sid);
      const dateTarget = String(targetRow?.dueDate || targetRow?.sessionDate || '').trim();
      if (dateTarget) selectedDateTargets.push(dateTarget);
    });
    if (Array.isArray(assignment?.targetStudentIds)) {
      assignment.targetStudentIds
        .map((id) => toPublicId(id))
        .filter(Boolean)
        .forEach((id) => selectedTargetStudentIds.push(id));
    }
  }

  const teacherOptionsMap = new Map();
  if (selectedClass && Array.isArray(selectedClass.instructors)) {
    selectedClass.instructors.forEach((inst) => {
      const personId = toPublicId(inst?.personId);
      if (!personId) return;
      const label = personMap.get(personId) || personId;
      teacherOptionsMap.set(personId, { id: personId, name: label });
    });
  }
  sessions.forEach((session) => {
    const deliveredBy = toPublicId(session?.delivery?.deliveredBy);
    if (!deliveredBy || teacherOptionsMap.has(deliveredBy)) return;
    teacherOptionsMap.set(deliveredBy, {
      id: deliveredBy,
      name: personMap.get(deliveredBy) || deliveredBy
    });
  });

  const resolvedStudentIds = selectedClass
    ? await resolveClassStudentIds({
      classData: selectedClass,
      sessions,
      reqUser,
      referenceDate: selectedReportDueDate || '',
      students: allStudents
    })
    : [];

  return {
    classes,
    templates,
    sessions,
    selectedClassId,
    selectedClassTitle: selectedClass?.title || '',
    selectedTemplateId,
    selectedTemplateTitle: selectedTemplate?.title || '',
    selectedSessionIds,
    selectedDateTargets,
    selectedTaskStartTime,
    selectedTaskEndTime,
    selectedConflictPermitted,
    selectedReportStartDate,
    selectedReportDueDate,
    selectedTargetRows,
    selectedReportScope,
    selectedTargetStudentIds,
    teacherOptions: Array.from(teacherOptionsMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    studentOptions: selectedClass ? buildClassStudentOptionsFromIds(resolvedStudentIds, sessions, personMap) : []
  };
}

async function buildInstanceListRows({ reqUser, assignmentFilter = '', q = '' }) {
  const [allInstances, allAssignments, allTemplates, classes, students, personMap] = await Promise.all([
    listAllReportInstances(reqUser),
    listAllReportAssignments(reqUser),
    listAllReportTemplates(reqUser),
    schoolDataService.fetchData('classes', {}, reqUser),
    schoolDataService.fetchData('students', {}, reqUser),
    buildPersonNameMap(reqUser)
  ]);
  const assignmentMap = new Map(
    (Array.isArray(allAssignments) ? allAssignments : [])
      .map((row) => [toPublicId(row?.id), row])
      .filter(([id]) => Boolean(id))
  );
  const templateMap = new Map(
    (Array.isArray(allTemplates) ? allTemplates : [])
      .map((row) => [toPublicId(row?.id), row])
      .filter(([id]) => Boolean(id))
  );
  const classMap = new Map(
    (Array.isArray(classes) ? classes : [])
      .map((row) => [toPublicId(row?.id), row])
      .filter(([id]) => Boolean(id))
  );

  const activeInstanceRows = filterRecordsByOrg(allInstances, reqUser)
    .filter(isActiveReportInstance)
    .filter((row) => assignmentMap.has(toPublicId(row?.assignmentId)))
    .map((row) => {
      const assignment = assignmentMap.get(toPublicId(row?.assignmentId)) || null;
      const template = templateMap.get(toPublicId(row?.templateId)) || null;
      const classItem = classMap.get(toPublicId(row?.classId)) || null;
      const teacherId = toPublicId(row?.teacherId);
      const studentId = toPublicId(row?.studentId);
      return {
        ...row,
        isPendingAssignment: false,
        classTitle: classItem?.title || row.classId,
        classLifecycle: buildClassLifecycleSnapshot(classItem || {}),
        templateTitle: template?.title || row.templateId,
        hasDocxTemplate: Boolean(template?.docxTemplate?.path),
        assignmentStatus: assignment?.status || '',
        teacherName: personMap.get(teacherId) || teacherId || '-',
        studentName: studentId ? (personMap.get(studentId) || studentId) : 'Whole class'
      };
    });

  const existingInstanceKeys = new Set(
    activeInstanceRows.map((row) => buildInstanceIdentityKeyForRow(row.assignmentId, row.assignmentRowId || '', row.teacherId, row.targetKey || 'class'))
  );

  const pendingRows = [];
  const scopedAssignments = filterRecordsByOrg(allAssignments, reqUser)
    .filter(isActiveReportAssignment)
    .filter((row) => !assignmentFilter || idsEqual(row.id, assignmentFilter));

  for (const assignment of scopedAssignments) {
    const assignmentId = toPublicId(assignment?.id);
    if (!assignmentId) continue;
    const classItem = classMap.get(toPublicId(assignment?.classId)) || null;
    const template = templateMap.get(toPublicId(assignment?.templateId)) || null;
    const teacherIds = [...new Set((Array.isArray(assignment?.teacherIds) ? assignment.teacherIds : [])
      .map((id) => toPublicId(id))
      .filter(Boolean))];
    const targetRows = getEffectiveAssignmentRows(assignment)
      .filter((targetRow) => String(targetRow?.status || '').trim().toLowerCase() === 'active');
    const rowsForTargets = targetRows.length ? targetRows : getEffectiveAssignmentRows(assignment);

    for (const targetRow of rowsForTargets) {
      const rowTeacherId = toPublicId(targetRow?.teacherId) || teacherIds[0] || '';
      if (!rowTeacherId) continue;
      const rowAssignment = applyAssignmentRow(assignment, targetRow);
      // eslint-disable-next-line no-await-in-loop
      const targetStudentIds = await resolvePendingAssignmentStudentTargets({
        assignment: rowAssignment,
        classItem,
        reqUser,
        students
      });
      const targets = targetStudentIds.length ? targetStudentIds : [''];

      [rowTeacherId].forEach((teacherId) => {
        targets.forEach((studentId) => {
          const targetKey = studentId ? `student:${studentId}` : 'class';
          const assignmentRowId = String(targetRow?.rowId || '').trim();
          const identityKey = buildInstanceIdentityKeyForRow(assignmentId, assignmentRowId, teacherId, targetKey);
          if (existingInstanceKeys.has(identityKey)) return;
          pendingRows.push({
            id: `pending-${assignmentId}-${assignmentRowId || 'legacy'}-${teacherId}-${targetKey}`.replace(/[^A-Za-z0-9_-]/g, '-'),
            isPendingAssignment: true,
            orgId: assignment.orgId,
            assignmentId,
            assignmentRowId,
            classId: assignment.classId,
            sessionId: targetRow.sessionId,
            sessionDate: String(targetRow.sessionDate || targetRow.reportDueDate || targetRow.dueDate || '').trim(),
            templateId: assignment.templateId,
            templateVersion: assignment.templateVersion || template?.version || 1,
            teacherId,
            teacherName: personMap.get(teacherId) || teacherId || '-',
            studentId,
            studentName: studentId ? (personMap.get(studentId) || studentId) : 'Whole class',
            targetKey,
            status: 'pending',
            classTitle: classItem?.title || assignment.classId,
            classLifecycle: buildClassLifecycleSnapshot(classItem || {}),
            templateTitle: template?.title || assignment.templateId,
            hasDocxTemplate: Boolean(template?.docxTemplate?.path),
            assignmentStatus: assignment.status || '',
            audit: assignment.audit || {}
          });
        });
      });
    }
  }

  return [...activeInstanceRows, ...pendingRows]
    .filter((row) => !assignmentFilter || idsEqual(row.assignmentId, assignmentFilter))
    .filter((row) => {
      if (!q) return true;
      return [
        row.id,
        row.assignmentId,
        row.classTitle,
        row.templateTitle,
        row.status,
        row.sessionDate,
        row.teacherId,
        row.teacherName,
        row.studentId,
        row.studentName
      ]
        .map((v) => String(v || '').toLowerCase())
        .some((v) => v.includes(q));
    })
    .sort((a, b) => {
      const dateCompare = String(b.sessionDate || '').localeCompare(String(a.sessionDate || ''));
      if (dateCompare) return dateCompare;
      if (a.isPendingAssignment !== b.isPendingAssignment) return a.isPendingAssignment ? -1 : 1;
      return String(b.audit?.createDateTime || '').localeCompare(String(a.audit?.createDateTime || ''));
    });
}

async function buildReportReviewNavigator({ currentInstance, reqUser, participantOnly = false } = {}) {
  const currentId = toPublicId(currentInstance?.id);
  if (!currentId) {
    return { rows: [], currentIndex: -1, olderCount: 0, olderHref: '', newerHref: '' };
  }

  const [allInstances, allAssignments] = await Promise.all([
    listAllReportInstances(reqUser),
    listAllReportAssignments(reqUser)
  ]);
  const assignmentMap = new Map(
    (Array.isArray(allAssignments) ? allAssignments : [])
      .map((row) => [toPublicId(row?.id), row])
      .filter(([id]) => Boolean(id))
  );
  const viewerPersonId = toPublicId(reqUser?.personId || reqUser?.id || '');

  const rows = filterRecordsByOrg(allInstances, reqUser)
    .filter(isActiveReportInstance)
    .filter((row) => idsEqual(row?.orgId, currentInstance?.orgId))
    .filter((row) => idsEqual(row?.classId, currentInstance?.classId))
    .filter((row) => idsEqual(row?.templateId, currentInstance?.templateId))
    .filter((row) => isSameReportReviewTarget(row, currentInstance))
    .filter((row) => {
      const assignment = assignmentMap.get(toPublicId(row?.assignmentId)) || null;
      return isReportInstanceAssignmentConsistent(row, assignment);
    })
    .filter((row) => !participantOnly || canParticipantReviewInstance(row, viewerPersonId))
    .map((row) => {
      const assignment = assignmentMap.get(toPublicId(row?.assignmentId)) || null;
      const sortDate = resolveReviewNavigatorSortDate(row, assignment);
      const id = toPublicId(row?.id);
      return {
        id,
        href: `/school/reports/instances/edit-v2/${encodeURIComponent(id)}`,
        sessionDate: sortDate,
        status: String(row?.status || '').trim(),
        teacherId: toPublicId(row?.teacherId) || String(row?.teacherId || '').trim(),
        isCurrent: idsEqual(id, currentId),
        _sortDate: sortDate,
        _createdAt: String(row?.audit?.createDateTime || '').trim()
      };
    })
    .filter((row) => row.id)
    .sort((a, b) => {
      const dateCompare = String(b._sortDate || '').localeCompare(String(a._sortDate || ''));
      if (dateCompare) return dateCompare;
      const createdCompare = String(b._createdAt || '').localeCompare(String(a._createdAt || ''));
      if (createdCompare) return createdCompare;
      return String(b.id || '').localeCompare(String(a.id || ''));
    })
    .map((row) => {
      const { _sortDate, _createdAt, ...safeRow } = row;
      return safeRow;
    });

  const currentIndex = rows.findIndex((row) => row.isCurrent);
  const olderRow = currentIndex >= 0 ? rows[currentIndex + 1] : null;
  const newerRow = currentIndex > 0 ? rows[currentIndex - 1] : null;

  return {
    rows,
    currentIndex,
    olderCount: currentIndex >= 0 ? Math.max(0, rows.length - currentIndex - 1) : 0,
    olderHref: olderRow?.href || '',
    newerHref: newerRow?.href || ''
  };
}

async function buildPersonReportListContext({ reqUser, requestedScope = '', requestedPersonId = '', q = '' }) {
  const validScopes = new Set(['teacher', 'staff', 'student']);
  const requestedValidScope = validScopes.has(requestedScope) ? requestedScope : '';
  const isAdminViewer = isSchoolReportAdminViewer(reqUser);
  const viewerPersonId = toPublicId(reqUser?.personId);

  const [
    allInstances,
    allAssignments,
    allTemplates,
    classes,
    teachers,
    staffRows,
    students,
    personMap
  ] = await Promise.all([
    listAllReportInstances(reqUser),
    listAllReportAssignments(reqUser),
    listAllReportTemplates(reqUser),
    schoolDataService.fetchData('classes', {}, reqUser),
    schoolDataService.fetchData('teachers', {}, reqUser),
    schoolDataService.fetchData('staff', {}, reqUser),
    schoolDataService.fetchData('students', {}, reqUser),
    buildPersonNameMap(reqUser)
  ]);
  const assignmentMap = new Map(
    (Array.isArray(allAssignments) ? allAssignments : [])
      .map((row) => [toPublicId(row?.id), row])
      .filter(([id]) => Boolean(id))
  );
  const templateMap = new Map(
    (Array.isArray(allTemplates) ? allTemplates : [])
      .map((row) => [toPublicId(row?.id), row])
      .filter(([id]) => Boolean(id))
  );
  const classMap = new Map(
    (Array.isArray(classes) ? classes : [])
      .map((row) => [toPublicId(row?.id), row])
      .filter(([id]) => Boolean(id))
  );

  const teacherPersonSet = new Set((teachers || []).map((row) => toPublicId(row?.personId)).filter(Boolean));
  const staffPersonSet = new Set((staffRows || []).map((row) => toPublicId(row?.personId)).filter(Boolean));
  const studentPersonSet = new Set((students || []).map((row) => toPublicId(row?.personId)).filter(Boolean));
  const activeOrgRoles = getActiveOrgRoleSet(reqUser);

  const viewerRoles = [];
  if (teacherPersonSet.has(viewerPersonId) || activeOrgRoles.has('school_teacher')) viewerRoles.push('teacher');
  if (staffPersonSet.has(viewerPersonId) || activeOrgRoles.has('school_staff')) viewerRoles.push('staff');
  if (studentPersonSet.has(viewerPersonId) || activeOrgRoles.has('school_student')) viewerRoles.push('student');

  let effectiveScope = requestedValidScope;
  let effectivePersonId = toPublicId(requestedPersonId);
  if (!isAdminViewer) {
    effectiveScope = '';
    effectivePersonId = viewerPersonId;
  }

  const rows = filterRecordsByOrg(allInstances, reqUser)
    .filter(isActiveReportInstance)
    .filter((row) => assignmentMap.has(toPublicId(row?.assignmentId)))
    .filter((row) => {
      const rowTeacherId = toPublicId(row?.teacherId);
      const rowStudentId = toPublicId(row?.studentId);
      if (isAdminViewer) {
        if (!effectivePersonId) return true;
        if (effectiveScope === 'teacher' || effectiveScope === 'staff') return idsEqual(rowTeacherId, effectivePersonId);
        if (effectiveScope === 'student') return idsEqual(rowStudentId, effectivePersonId);
        return idsEqual(rowTeacherId, effectivePersonId) || idsEqual(rowStudentId, effectivePersonId);
      }

      if (!effectivePersonId || !viewerRoles.length) return false;
      const teacherStaffMatch = (viewerRoles.includes('teacher') || viewerRoles.includes('staff')) && idsEqual(rowTeacherId, effectivePersonId);
      const studentMatch = viewerRoles.includes('student') && idsEqual(rowStudentId, effectivePersonId);
      return teacherStaffMatch || studentMatch;
    })
    .map((row) => {
      const assignment = assignmentMap.get(toPublicId(row?.assignmentId)) || null;
      const template = templateMap.get(toPublicId(row?.templateId)) || null;
      const classItem = classMap.get(toPublicId(row?.classId)) || null;
      const teacherId = toPublicId(row.teacherId);
      const studentId = toPublicId(row.studentId);
      return {
        ...row,
        classTitle: classItem?.title || row.classId,
        classLifecycle: buildClassLifecycleSnapshot(classItem || {}),
        templateTitle: template?.title || row.templateId,
        assignmentStatus: assignment?.status || '',
        teacherName: personMap.get(teacherId) || teacherId || '-',
        studentName: personMap.get(studentId) || studentId || '-'
      };
    })
    .filter((row) => {
      if (!q) return true;
      return [
        row.id,
        row.assignmentId,
        row.classTitle,
        row.templateTitle,
        row.teacherId,
        row.teacherName,
        row.studentId,
        row.studentName,
        row.status,
        row.sessionDate
      ]
        .map((v) => String(v || '').toLowerCase())
        .some((v) => v.includes(q));
    })
    .sort((a, b) => String(b.audit?.createDateTime || '').localeCompare(String(a.audit?.createDateTime || '')));

  return {
    rows,
    isAdminViewer,
    viewerRoles,
    selectedScope: effectiveScope,
    selectedPersonId: effectivePersonId,
    selectedPersonLabel: effectivePersonId ? (personMap.get(effectivePersonId) || effectivePersonId) : ''
  };
}

function buildInstanceAnswers(template, body = {}, existingMerged = {}) {
  const fields = Array.isArray(template?.schema?.fields) ? template.schema.fields : [];
  const answers = {};
  const issues = [];
  const existing = existingMerged && typeof existingMerged === 'object' ? existingMerged : {};

  fields.forEach((field) => {
    const fieldType = String(field?.type || '').trim().toLowerCase();
    const visualOnly = fieldType === 'section' || fieldType === 'subheader' || fieldType === 'row_break';
    if (visualOnly || !field?.id) return;
    const calculatedField = reportRuleEngineService.isCalculatedField(field);
    if (field.readOnly === true || calculatedField) {
      const prev = existing[field.id];
      if (field.type === 'checkbox') {
        answers[field.id] = prev === true || String(prev).toLowerCase() === 'true';
      } else if (field.type === 'number') {
        if (prev === undefined || prev === null || prev === '') answers[field.id] = '';
        else {
          const n = Number(prev);
          answers[field.id] = Number.isFinite(n) ? n : '';
        }
      } else {
        answers[field.id] = prev === undefined || prev === null ? '' : String(prev).trim();
      }
      return;
    }

    const key = `field__${field.id}`;
    const rawValue = body[key];
    let value;

    if (field.type === 'checkbox') {
      value = rawValue === 'on' || rawValue === 'true' || rawValue === '1';
    } else if (field.type === 'number') {
      if (rawValue === undefined || rawValue === null || rawValue === '') value = '';
      else {
        const n = Number(rawValue);
        if (!Number.isFinite(n)) {
          value = '';
          issues.push({
            fieldId: String(field.id || '').trim(),
            fieldLabel: String(field.label || field.id || 'Field').trim(),
            severity: 'error',
            message: `Invalid numeric value for "${field.label}".`,
            source: 'parse'
          });
        } else value = n;
      }
    } else {
      value = rawValue === undefined || rawValue === null ? '' : String(rawValue).trim();
    }

    answers[field.id] = value;
  });

  return { answers, issues };
}

function resolveInstanceNextStatus(instance, submitActionRaw) {
  const submitAction = String(submitActionRaw || 'save').trim().toLowerCase();
  let nextStatus = String(instance?.status || 'draft').toLowerCase();
  if (submitAction === 'submit') nextStatus = 'submitted';
  if (!['draft', 'submitted', 'locked'].includes(nextStatus)) nextStatus = 'draft';
  return nextStatus;
}

module.exports = {
  parseDateOnlyValue,
  parseDateOnlyList,
  parseStringArrayField,
  resolveReportPeriod,
  inferAssignmentTargetType,
  inferAssignmentReportScope,
  getEffectiveAssignmentRows,
  findAssignmentRow,
  applyAssignmentRow,
  getClassStudentIds,
  buildClassStudentOptions,
  isRecordAccessibleByOrg,
  filterRecordsByOrg,
  buildHomeSummary,
  buildTemplateSavePayload,
  parseAssignmentSaveRequest,
  buildAssignmentListContext,
  buildAssignmentFormContext,
  buildInstanceListRows,
  buildReportReviewNavigator,
  buildPersonReportListContext,
  buildInstanceAnswers,
  resolveInstanceNextStatus
};
