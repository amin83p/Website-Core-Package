const schoolDataService = require('./schoolDataService');
const classEnrollmentReadService = require('./classEnrollmentReadService');
const semiMonthlyReportPolicyModel = require('../../models/school/semiMonthlyReportPolicyModel');
const semiMonthlyReportPolicyService = require('./semiMonthlyReportPolicyService');
const studentAttendanceReportService = require('./studentAttendanceReportService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function normalizeDateOnly(value = '') {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function parseIdList(value = '') {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/[,|]/)
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function isActiveClass(row = {}) {
  return String(row?.status || '').trim().toLowerCase() === 'active';
}

function classBelongsToActiveOrg(row = {}, activeOrgId = '') {
  const scopedOrgId = String(activeOrgId || '').trim();
  if (!scopedOrgId) return true;
  const rowOrgId = String(row?.orgId || row?.organizationId || row?.schoolOrgId || '').trim();
  if (!rowOrgId) return true;
  return idsEqual(rowOrgId, scopedOrgId);
}

function buildTemplateIdSet(templateIds = []) {
  const set = new Set();
  (Array.isArray(templateIds) ? templateIds : []).forEach((id) => {
    const token = String(id || '').trim();
    if (token) set.add(token.toLowerCase());
  });
  return set;
}

function templateIdMatches(templateId = '', templateIdSet = new Set()) {
  const token = String(templateId || '').trim();
  if (!token || !templateIdSet.size) return false;
  return templateIdSet.has(token.toLowerCase());
}

function sessionDateInRange(sessionDate = '', startDate = '', endDate = '') {
  const date = normalizeDateOnly(sessionDate);
  if (!date || !startDate || !endDate) return false;
  return date >= startDate && date <= endDate;
}

/**
 * Class-level instances (no studentId) appear for every enrolled selected student on that class row.
 * Report instances usually store person id in studentId; prefill may carry student_record_id.
 */
function instanceMatchesStudent(instance = {}, studentRecordId = '', personId = '') {
  const instanceStudentId = String(instance?.studentId || '').trim();
  if (!instanceStudentId) return true;
  const targetStudentId = String(studentRecordId || '').trim();
  const targetPersonId = String(personId || '').trim();
  const prefillStudentRecordId = String(
    instance?.prefillSnapshot?.student_record_id
    || instance?.prefillSnapshot?.studentRecordId
    || ''
  ).trim();
  if (targetStudentId && (
    idsEqual(instanceStudentId, targetStudentId)
    || idsEqual(prefillStudentRecordId, targetStudentId)
  )) {
    return true;
  }
  if (targetPersonId && idsEqual(instanceStudentId, targetPersonId)) {
    return true;
  }
  return !targetStudentId && !targetPersonId;
}

function filterReportInstancesForClass({
  instances = [],
  templateIdSet = new Set(),
  startDate = '',
  endDate = '',
  classId = '',
  studentRecordId = '',
  personId = ''
}) {
  const normalizedClassId = String(classId || '').trim();
  if (!normalizedClassId) return [];
  return (Array.isArray(instances) ? instances : []).filter((row) => {
    if (!idsEqual(row?.classId, normalizedClassId)) return false;
    if (!templateIdMatches(row?.templateId, templateIdSet)) return false;
    if (!sessionDateInRange(row?.sessionDate, startDate, endDate)) return false;
    return instanceMatchesStudent(row, studentRecordId, personId);
  });
}

function serializeInstanceRow(instance = {}, templateLabelMap = new Map()) {
  const id = String(instance?.id || '').trim();
  const templateId = String(instance?.templateId || '').trim();
  const templateLabel = templateLabelMap.get(templateId) || templateId || 'Report';
  return {
    id,
    sessionDate: normalizeDateOnly(instance?.sessionDate),
    status: String(instance?.status || '').trim().toLowerCase() || 'draft',
    templateId,
    templateLabel,
    assignmentId: String(instance?.assignmentId || '').trim(),
    editUrl: id ? `/school/reports/instances/edit/${encodeURIComponent(toPublicId(id))}` : ''
  };
}

function sortInstancesDesc(instances = []) {
  return [...instances].sort((a, b) => {
    const aDate = String(a?.sessionDate || '');
    const bDate = String(b?.sessionDate || '');
    if (aDate !== bDate) return bDate.localeCompare(aDate);
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
}

async function buildTemplateLabelMap(templateIds = [], reqUser) {
  const map = new Map();
  for (const templateId of templateIds) {
    const id = String(templateId || '').trim();
    if (!id) continue;
    // eslint-disable-next-line no-await-in-loop
    const template = await schoolDataService.getDataById('reportTemplates', id, reqUser);
    map.set(id, semiMonthlyReportPolicyService.formatTemplateLabel(template, id));
  }
  return map;
}

async function buildSemiMonthlyReportPayload(req, options = {}) {
  const query = req?.query && typeof req.query === 'object' ? req.query : {};
  const startDate = normalizeDateOnly(query.startDate || options.startDate);
  const endDate = normalizeDateOnly(query.endDate || options.endDate);
  const studentIds = parseIdList(query.studentIds || query.personIds || options.studentIds);

  if (!startDate || !endDate) {
    throw new Error('Start date and end date are required.');
  }
  if (endDate < startDate) {
    throw new Error('End date must be on or after start date.');
  }
  if (!studentIds.length) {
    throw new Error('Select at least one student.');
  }

  const activeOrgId = String(req.user?.activeOrgId || '').trim();
  const policy = semiMonthlyReportPolicyService.resolvePolicy(activeOrgId
    ? await semiMonthlyReportPolicyModel.getPolicyForOrg(activeOrgId)
    : {});
  const reportTemplateIds = policy.reportTemplateIds || [];
  if (!reportTemplateIds.length) {
    return {
      startDate,
      endDate,
      students: [],
      configurationWarning: 'Add report templates in School Settings → School Semi-Monthly Report before loading data.'
    };
  }

  const routeAccessContext = schoolDataService.buildRouteAccessContext(req);
  const selectedStudents = await studentAttendanceReportService.resolveSelectedStudents(req, studentIds);
  if (!selectedStudents.length) {
    throw new Error('No matching students were found for the current selection.');
  }

  const templateIdSet = buildTemplateIdSet(reportTemplateIds);
  const templateLabelMap = await buildTemplateLabelMap(reportTemplateIds, req.user);

  const instanceQuery = activeOrgId ? { orgId__eq: activeOrgId } : {};
  const allInstances = await schoolDataService.fetchAllData(
    'reportInstances',
    instanceQuery,
    req.user,
    routeAccessContext
  );
  const instances = Array.isArray(allInstances) ? allInstances : [];

  const selectedStudentIdSet = new Set(
    selectedStudents.map((row) => String(row.studentRecordId || '').trim()).filter(Boolean)
  );

  const studentMap = new Map(
    selectedStudents.map((row) => [row.personId, {
      personId: row.personId,
      studentRecordId: String(row.studentRecordId || '').trim(),
      name: row.name,
      classes: []
    }])
  );

  const classes = await schoolDataService.fetchAllData('classes', {}, req.user, routeAccessContext);
  const activeClasses = (Array.isArray(classes) ? classes : [])
    .filter((row) => classBelongsToActiveOrg(row, activeOrgId))
    .filter(isActiveClass);

  const canonicalStatuses = classEnrollmentReadService.HISTORICAL_ROLLING_ROSTER_STATUSES;

  for (const classRow of activeClasses) {
    const classId = String(classRow?.id || '').trim();
    if (!classId) continue;

    const enrollmentSnapshot = await classEnrollmentReadService.listActiveStudentIdsForClass({
      classId,
      classItem: classRow,
      reqUser: req.user,
      activeOrgId,
      startDate,
      endDate,
      canonicalStatuses
    });
    const enrolledStudentIds = enrollmentSnapshot.studentIds instanceof Set
      ? enrollmentSnapshot.studentIds
      : new Set();
    const matchedStudentIds = [...selectedStudentIdSet].filter((studentId) => enrolledStudentIds.has(studentId));
    if (!matchedStudentIds.length) continue;

    const className = String(classRow?.name || classRow?.title || classId).trim();
    const teacherName = String(classRow?.instructors?.[0]?.name || classRow?.teacherName || '').trim();

    matchedStudentIds.forEach((studentRecordId) => {
      const studentRow = selectedStudents.find((row) => idsEqual(row.studentRecordId, studentRecordId));
      if (!studentRow || !studentMap.has(studentRow.personId)) return;
      const matched = filterReportInstancesForClass({
        instances,
        templateIdSet,
        startDate,
        endDate,
        classId,
        studentRecordId,
        personId: String(studentRow.personId || '').trim()
      });
      const serialized = sortInstancesDesc(
        matched.map((row) => serializeInstanceRow(row, templateLabelMap))
      );
      studentMap.get(studentRow.personId).classes.push({
        classId,
        className,
        teacherName,
        instances: serialized
      });
    });
  }

  const students = [...studentMap.values()].map((row) => {
    row.classes.sort((a, b) => String(a.className || '').localeCompare(String(b.className || '')));
    return row;
  });

  const rankByStudentId = new Map();
  studentIds.forEach((studentId, index) => {
    const key = String(studentId || '').trim();
    if (key) rankByStudentId.set(key, index);
  });
  students.sort((a, b) => {
    const aKey = String(a.studentRecordId || '').trim();
    const bKey = String(b.studentRecordId || '').trim();
    const aRank = rankByStudentId.has(aKey)
      ? rankByStudentId.get(aKey)
      : rankByStudentId.get(String(a.personId || '').trim());
    const bRank = rankByStudentId.has(bKey)
      ? rankByStudentId.get(bKey)
      : rankByStudentId.get(String(b.personId || '').trim());
    const aIndex = Number.isFinite(Number(aRank)) ? Number(aRank) : 9999;
    const bIndex = Number.isFinite(Number(bRank)) ? Number(bRank) : 9999;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  return {
    startDate,
    endDate,
    students,
    reportTemplateIds
  };
}

module.exports = {
  normalizeDateOnly,
  filterReportInstancesForClass,
  buildTemplateIdSet,
  sessionDateInRange,
  instanceMatchesStudent,
  buildSemiMonthlyReportPayload
};
