const schoolRepositories = require('../../repositories/school');
const schoolDataService = require('./schoolDataService');
const schoolRecordAccessService = require('./schoolRecordAccessService');
const schoolStudentProfileLinkService = require('./schoolStudentProfileLinkService');
const sessionStudentCaseModel = require('../../models/school/sessionStudentCaseModel');
const { SCOPE_MODES } = require('./schoolDataScopeBuilder');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function normalizeText(value = '') {
  return String(value || '').trim();
}

function lower(value = '') {
  return normalizeText(value).toLowerCase();
}

function getActiveOrgId(user) {
  return toPublicId(user?.activeOrgId || user?.activeOrganization?.id || user?.primaryOrgId || '');
}

function objectSearchText(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map(objectSearchText).join(' ');
  if (typeof value === 'object') return Object.values(value).map(objectSearchText).join(' ');
  return normalizeText(value);
}

function rowMatchesWorkspaceSearch(row, searchTerm) {
  const term = lower(searchTerm);
  if (!term) return true;
  return lower(objectSearchText(row)).includes(term);
}

function buildSessionIssueActionLinks(row) {
  const classId = normalizeText(row?.classId);
  const sessionId = normalizeText(row?.sessionId);
  const caseId = normalizeText(row?.id);
  if (!classId || !sessionId || !caseId) return [];
  return [{
    label: 'Review',
    href: `/school/classes/${encodeURIComponent(classId)}/sessions/${encodeURIComponent(sessionId)}?caseId=${encodeURIComponent(caseId)}`,
    icon: 'bi bi-box-arrow-in-right',
    tone: 'primary'
  }];
}

function normalizeSessionIssueRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const updatedAt = normalizeText(row?.audit?.lastUpdateDateTime || row?.audit?.createDateTime || '');
    return {
      id: normalizeText(row?.id),
      classId: normalizeText(row?.classId),
      classTitle: normalizeText(row?.classTitle || row?.className || row?.classId || 'Class'),
      sessionId: normalizeText(row?.sessionId),
      sessionDate: normalizeText(row?.sessionDate),
      sessionStartTime: normalizeText(row?.sessionStartTime),
      sessionEndTime: normalizeText(row?.sessionEndTime),
      studentPersonId: normalizeText(row?.studentPersonId),
      studentRecordId: normalizeText(row?.studentRecordId || ''),
      studentName: normalizeText(row?.studentName || row?.studentPersonId || '-'),
      teacherPersonId: normalizeText(row?.teacherPersonId),
      teacherName: normalizeText(row?.teacherName || row?.teacherPersonId || 'Unassigned'),
      category: lower(row?.category || 'other'),
      severity: lower(row?.severity || 'info'),
      status: lower(row?.status || 'open'),
      summary: normalizeText(row?.summary || '-'),
      updatedAt,
      actions: buildSessionIssueActionLinks(row)
    };
  });
}

function splitFilterIds(value) {
  return String(value || '')
    .split(',')
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function sessionIssueMatchesFilters(row, queryInput = {}, searchTerm = '') {
  const severity = lower(queryInput.severity || '');
  const category = lower(queryInput.category || '');
  const statusGroup = lower(queryInput.statusGroup || '');
  const startDate = normalizeText(queryInput.startDate || '');
  const endDate = normalizeText(queryInput.endDate || '');
  const classIds = splitFilterIds(queryInput.classId || queryInput.classIds);
  const teacherIds = splitFilterIds(queryInput.teacherPersonId || queryInput.teacherId || queryInput.teacherIds);
  const studentIds = splitFilterIds(queryInput.studentPersonId || queryInput.studentId || queryInput.studentIds);
  const rowStatus = lower(row?.status || '');

  if (severity && lower(row?.severity) !== severity) return false;
  if (category && lower(row?.category) !== category) return false;
  if (statusGroup === 'open' && !['open', 'in_progress', 'reopened'].includes(rowStatus)) return false;
  if (statusGroup === 'resolved' && !['resolved', 'cancelled'].includes(rowStatus)) return false;
  if (startDate && normalizeText(row?.sessionDate) < startDate) return false;
  if (endDate && normalizeText(row?.sessionDate) > endDate) return false;
  if (classIds.length && !classIds.some((id) => idsEqual(row?.classId, id))) return false;
  if (teacherIds.length && !teacherIds.some((id) => idsEqual(row?.teacherPersonId, id))) return false;
  if (studentIds.length && !studentIds.some((id) => idsEqual(row?.studentPersonId, id))) return false;

  return rowMatchesWorkspaceSearch(row, searchTerm);
}

function sortSessionIssueRows(rows) {
  const severityRank = new Map([
    ['urgent', 0],
    ['warning', 1],
    ['info', 2]
  ]);
  const statusRank = new Map([
    ['open', 0],
    ['in_progress', 0],
    ['reopened', 0],
    ['resolved', 1],
    ['cancelled', 2]
  ]);
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const statusDelta = (statusRank.get(a.status) ?? 9) - (statusRank.get(b.status) ?? 9);
    if (statusDelta) return statusDelta;
    const severityDelta = (severityRank.get(a.severity) ?? 9) - (severityRank.get(b.severity) ?? 9);
    if (severityDelta) return severityDelta;
    return String(b.sessionDate || b.updatedAt || '').localeCompare(String(a.sessionDate || a.updatedAt || ''));
  });
}

function teacherPersonMatchesScope(row, access = {}) {
  const teacherPersonId = toPublicId(row?.teacherPersonId);
  if (!teacherPersonId) return false;
  const personId = toPublicId(access?.personId);
  if (personId && idsEqual(teacherPersonId, personId)) return true;
  const aliasIds = Array.isArray(access?.delivererAliasIds) ? access.delivererAliasIds : [];
  return aliasIds.some((aliasId) => idsEqual(teacherPersonId, aliasId));
}

async function resolveAssignmentAccessContext(req, accessContext = {}) {
  const access = schoolRecordAccessService.resolveAccessFromRequest(req);
  if (access.scopeMode !== SCOPE_MODES.ASSIGNMENT) return access;
  const scope = { ...access };
  const teachers = await schoolDataService.fetchAllData('teachers', { personId__eq: scope.personId, page: 1, limit: 100 }, req.user, { scopeId: 'SCP_ORG' });
  scope.delivererAliasIds = (Array.isArray(teachers) ? teachers : [])
    .map((row) => toPublicId(row?.id))
    .filter(Boolean);
  return scope;
}

async function filterCasesByAccessScope({ rows, req, accessContext = {}, applyAccessScope = true }) {
  const list = Array.isArray(rows) ? rows : [];
  if (!applyAccessScope) return list;

  const access = await resolveAssignmentAccessContext(req, accessContext);
  if (schoolRecordAccessService.isOrgWideScope(access)) return list;
  if (access.scopeMode === SCOPE_MODES.USER) return [];

  if (access.scopeMode === SCOPE_MODES.OWNER) {
    return list.filter((row) => schoolRecordAccessService.isRecordOwnedByUser(row, access.userId));
  }

  if (access.scopeMode === SCOPE_MODES.ASSIGNMENT) {
    const classes = await schoolDataService.fetchAllData('classes', {}, req.user, accessContext);
    const classIds = new Set((Array.isArray(classes) ? classes : []).map((row) => toPublicId(row?.id)).filter(Boolean));
    return list.filter((row) => {
      const classId = toPublicId(row?.classId);
      if (classId && classIds.has(classId)) return true;
      return teacherPersonMatchesScope(row, access);
    });
  }

  return list;
}

function buildClassFilterOptions(classes = []) {
  return (Array.isArray(classes) ? classes : [])
    .map((row) => ({
      value: normalizeText(row?.id),
      label: normalizeText(row?.title || row?.name || row?.id)
    }))
    .filter((row) => row.value)
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function listSessionStudentCasesForRequest(req, options = {}) {
  const {
    queryInput = {},
    searchQuery = '',
    applyAccessScope = true,
    accessContext = schoolDataService.buildRouteAccessContext(req)
  } = options;

  const orgId = getActiveOrgId(req.user);
  const rawRows = await schoolRepositories.sessionStudentCases.list({
    query: {},
    scope: { activeOrgId: orgId }
  });
  const scopedRows = await filterCasesByAccessScope({
    rows: rawRows,
    req,
    accessContext,
    applyAccessScope
  });

  const students = await schoolDataService.fetchAllData('students', {}, req.user, accessContext);
  const personToStudentMap = schoolStudentProfileLinkService.buildPersonIdToStudentRecordIdMap(students, orgId);
  const rows = sortSessionIssueRows(
    normalizeSessionIssueRows(scopedRows)
      .map((row) => ({
        ...row,
        studentRecordId: schoolStudentProfileLinkService.resolveStudentRecordId({
          personId: row.studentPersonId,
          personToStudentMap
        })
      }))
      .filter((row) => sessionIssueMatchesFilters(row, queryInput, searchQuery))
  );

  const classes = await schoolDataService.fetchAllData('classes', {}, req.user, accessContext);

  return {
    rows,
    total: rows.length,
    filters: {
      severity: lower(queryInput?.severity || ''),
      category: lower(queryInput?.category || ''),
      statusGroup: lower(queryInput?.statusGroup || ''),
      classId: normalizeText(queryInput?.classId || queryInput?.classIds || ''),
      teacherPersonId: normalizeText(queryInput?.teacherPersonId || queryInput?.teacherId || queryInput?.teacherIds || ''),
      studentPersonId: normalizeText(queryInput?.studentPersonId || queryInput?.studentId || queryInput?.studentIds || ''),
      startDate: normalizeText(queryInput?.startDate || ''),
      endDate: normalizeText(queryInput?.endDate || '')
    },
    severityOptions: sessionStudentCaseModel.CASE_SEVERITIES || ['info', 'warning', 'urgent'],
    categoryOptions: sessionStudentCaseModel.CASE_CATEGORIES || ['learning', 'technology', 'engagement', 'behavior', 'support', 'resources', 'lesson_delivery', 'other'],
    statusGroupOptions: [
      { value: '', label: 'All Cases' },
      { value: 'open', label: 'Open / Active' },
      { value: 'resolved', label: 'Resolved / Cancelled' }
    ],
    classOptions: buildClassFilterOptions(classes),
    searchQuery: normalizeText(searchQuery)
  };
}

module.exports = {
  normalizeText,
  buildSessionIssueActionLinks,
  normalizeSessionIssueRows,
  splitFilterIds,
  sessionIssueMatchesFilters,
  sortSessionIssueRows,
  filterCasesByAccessScope,
  listSessionStudentCasesForRequest
};
