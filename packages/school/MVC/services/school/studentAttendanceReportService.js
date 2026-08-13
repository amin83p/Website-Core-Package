const schoolDataService = require('./schoolDataService');
const schoolIdentityLookupService = require('./schoolIdentityLookupService');
const classEnrollmentReadService = require('./classEnrollmentReadService');
const attendanceMatrixMetricsService = require('./attendanceMatrixMetricsService');
const matrixRollupService = require('./matrixRollupService');
const attendanceMatrixPolicyModel = require('../../models/school/attendanceMatrixPolicyModel');
const schoolStudentProfileLinkService = require('./schoolStudentProfileLinkService');
const { buildAttendanceMatrixPayload } = require('../../controllers/school/attendanceController');
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

function buildDateRangeDays(startDate = '', endDate = '') {
  const start = normalizeDateOnly(startDate);
  const end = normalizeDateOnly(endDate);
  if (!start || !end || end < start) return [];
  const days = [];
  const cursor = new Date(`${start}T00:00:00`);
  const endDateObj = new Date(`${end}T00:00:00`);
  while (cursor <= endDateObj) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function isActiveAttendanceClass(row = {}) {
  return String(row?.status || '').trim().toLowerCase() === 'active';
}

function classBelongsToActiveOrg(row = {}, activeOrgId = '') {
  const scopedOrgId = String(activeOrgId || '').trim();
  if (!scopedOrgId) return true;
  const rowOrgId = String(row?.orgId || row?.organizationId || row?.schoolOrgId || '').trim();
  if (!rowOrgId) return true;
  return idsEqual(rowOrgId, scopedOrgId);
}

function recordHasNotes(record = {}) {
  const comments = Array.isArray(record?.comments) ? record.comments : [];
  return Boolean(
    comments.length
    || String(record?.rosterStudentNotes || '').trim()
    || String(record?.excuseRef || '').trim()
  );
}

function countStatusBreakdown(records = []) {
  const counts = {
    present: 0,
    late: 0,
    excused: 0,
    absent: 0,
    acf: 0,
    notApplicable: 0,
    unmarked: 0
  };
  (Array.isArray(records) ? records : []).forEach((record) => {
    const status = attendanceMatrixMetricsService.normalizeStatus(record?.status, '');
    const absenceExcused = attendanceMatrixMetricsService.isAbsenceExcused(record)
      || status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.EXCUSED;
    if (!status) {
      counts.unmarked += 1;
      return;
    }
    if (status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.PRESENT) counts.present += 1;
    else if (status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.LATE) counts.late += 1;
    else if (status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.EXCUSED || absenceExcused) counts.excused += 1;
    else if (status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.ABSENT) counts.absent += 1;
    else if (status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.ACF) counts.acf += 1;
    else if (status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE) counts.notApplicable += 1;
  });
  return counts;
}

function serializeAttendanceComment(comment = {}) {
  if (!comment) return null;
  if (typeof comment === 'string') {
    return {
      authorName: '',
      authorEmail: '',
      text: String(comment).trim(),
      timestamp: '',
      mentions: [],
      attachment: null
    };
  }
  if (typeof comment !== 'object') return null;
  return {
    authorName: String(comment.authorName || '').trim(),
    authorEmail: String(comment.authorEmail || '').trim(),
    text: String(comment.text || comment.body || '').trim(),
    timestamp: String(comment.timestamp || comment.createdAt || comment.createDateTime || '').trim(),
    mentions: (Array.isArray(comment.mentions) ? comment.mentions : []).map((mention) => ({
      id: String(mention?.id || '').trim(),
      name: String(mention?.name || '').trim(),
      email: String(mention?.email || '').trim()
    })).filter((mention) => mention.id || mention.name),
    attachment: comment.attachment && typeof comment.attachment === 'object' ? comment.attachment : null
  };
}

function serializeAttendanceAttachment(attachment = null) {
  if (!attachment || typeof attachment !== 'object') return null;
  return {
    name: String(attachment.name || attachment.originalName || '').trim(),
    url: String(
      attachment.dataUrl
      || attachment.url
      || attachment.uploadUrl
      || attachment.storagePath
      || attachment.path
      || ''
    ).trim()
  };
}

function buildClassDayCells(days = [], rollupRecords = []) {
  const recordByDate = new Map();
  (Array.isArray(rollupRecords) ? rollupRecords : []).forEach((record) => {
    const date = normalizeDateOnly(record?.date);
    if (!date || recordByDate.has(date)) return;
    recordByDate.set(date, record);
  });

  return days.map((date) => {
    const record = recordByDate.get(date) || null;
    if (!record) {
      return {
        date,
        hasSession: false,
        sessionId: '',
        status: '',
        notesExist: false
      };
    }
    const sessionId = String(record?.sessionId || '').trim();
    const comments = (Array.isArray(record?.comments) ? record.comments : [])
      .map((comment) => serializeAttendanceComment(comment))
      .filter(Boolean);
    return {
      date,
      hasSession: true,
      sessionId,
      status: String(record?.status || '').trim(),
      applicability: String(record?.applicability || '').trim(),
      withinEnrollmentWindow: record?.withinEnrollmentWindow !== false,
      enrollmentWindowReason: String(record?.enrollmentWindowReason || '').trim(),
      hasApprovedLeave: Boolean(record?.hasApprovedLeave),
      expectedForSession: record?.expectedForSession !== false,
      lateMinutes: Number(record?.lateMinutes) || 0,
      earlyLeaveMinutes: Number(record?.earlyLeaveMinutes) || 0,
      lateExcused: Boolean(record?.lateExcused),
      earlyLeaveExcused: Boolean(record?.earlyLeaveExcused),
      absenceExcused: Boolean(record?.absenceExcused),
      excuseRef: String(record?.excuseRef || '').trim(),
      excuseAttachment: serializeAttendanceAttachment(record?.excuseAttachment),
      rosterStudentNotes: String(record?.rosterStudentNotes || '').trim(),
      sessionLocked: Boolean(record?.sessionLocked),
      scheduledMinutes: Number(record?.scheduledMinutes) || 0,
      comments,
      notesExist: recordHasNotes(record)
    };
  });
}

function initStudentRow({ personId, name, studentRecordId }) {
  return {
    personId,
    studentRecordId,
    name,
    summary: {
      present: 0,
      late: 0,
      excused: 0,
      absent: 0,
      acf: 0,
      notApplicable: 0,
      rollupPercent: null,
      notesExist: false
    },
    classes: [],
    _rollupRecords: []
  };
}

function computeAttendanceRollupSummary(rollupRecords = [], classData = {}, orgPolicyCatalog = {}) {
  const personId = 'rollup';
  const rollups = matrixRollupService.summarizeAttendanceRollupsForStudents(
    [{ personId, _rollupRecords: rollupRecords }],
    { classData, orgPolicyCatalog }
  );
  return rollups[personId] || attendanceMatrixMetricsService.computeStudentMatrixSummary(
    rollupRecords,
    classData,
    orgPolicyCatalog
  );
}

function finalizeStudentSummary(studentRow = {}, orgPolicyCatalog = {}) {
  const rollupRecords = Array.isArray(studentRow._rollupRecords) ? studentRow._rollupRecords : [];
  const breakdown = countStatusBreakdown(rollupRecords);
  const matrixSummary = computeAttendanceRollupSummary(rollupRecords, {}, orgPolicyCatalog);
  studentRow.summary = {
    present: breakdown.present,
    late: breakdown.late,
    excused: breakdown.excused,
    absent: breakdown.absent,
    acf: breakdown.acf,
    notApplicable: breakdown.notApplicable,
    rollupPercent: matrixSummary.performancePercent,
    totalPresentSessions: matrixSummary.totalPresentSessions,
    totalAbsentSessions: matrixSummary.totalAbsentSessions,
    totalNotApplicableSessions: matrixSummary.totalNotApplicableSessions,
    notesExist: rollupRecords.some((record) => recordHasNotes(record))
  };
  delete studentRow._rollupRecords;
  studentRow.classes.sort((a, b) => String(a.className || '').localeCompare(String(b.className || '')));
  return studentRow;
}

async function resolveSelectedStudents(req, studentIds = []) {
  const routeAccessContext = schoolDataService.buildRouteAccessContext(req);
  const students = await schoolDataService.fetchAllData('students', {}, req.user, routeAccessContext);
  const studentRows = Array.isArray(students) ? students : [];
  const studentById = new Map(
    studentRows.map((row) => [String(row?.id || '').trim(), row]).filter(([id]) => id)
  );
  const personToStudentMap = schoolStudentProfileLinkService.buildPersonIdToStudentRecordIdMap(
    studentRows,
    String(req.user?.activeOrgId || '').trim()
  );

  const persons = await schoolIdentityLookupService.listSchoolPersonRecords({
    reqUser: req.user,
    requireSchoolRole: false,
    query: { limit: 2000 }
  }).then((payload) => payload.allRows || payload.rows || []);
  const personById = new Map(
    (Array.isArray(persons) ? persons : [])
      .map((row) => [String(row?.id || '').trim(), row])
      .filter(([id]) => id)
  );

  const selected = [];
  const seenPersonIds = new Set();
  studentIds.forEach((rawId) => {
    const token = String(rawId || '').trim();
    if (!token) return;
    let studentRecord = studentById.get(token) || null;
    let personId = '';
    if (studentRecord) {
      personId = String(studentRecord?.personId || '').trim();
    } else if (personById.has(token)) {
      personId = token;
      const studentRecordId = schoolStudentProfileLinkService.resolveStudentRecordId({
        personId,
        personToStudentMap
      });
      studentRecord = studentById.get(String(studentRecordId || '').trim()) || null;
    }
    if (!personId) return;
    if (seenPersonIds.has(personId)) return;
    seenPersonIds.add(personId);
    const person = personById.get(personId) || {};
    const firstName = String(person?.name?.first || studentRecord?.firstName || '').trim();
    const lastName = String(person?.name?.last || studentRecord?.lastName || '').trim();
    const name = `${firstName} ${lastName}`.trim() || String(person?.displayName || token).trim();
    selected.push({
      personId,
      studentRecordId: String(studentRecord?.id || personToStudentMap.get(personId) || '').trim(),
      name
    });
  });
  return selected;
}

async function buildStudentAttendanceReportPayload(req, options = {}) {
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

  const days = buildDateRangeDays(startDate, endDate);
  const activeOrgId = String(req.user?.activeOrgId || '').trim();
  const routeAccessContext = schoolDataService.buildRouteAccessContext(req);
  const selectedStudents = await resolveSelectedStudents(req, studentIds);
  if (!selectedStudents.length) {
    throw new Error('No matching students were found for the current selection.');
  }

  const selectedStudentIdSet = new Set(
    selectedStudents.map((row) => String(row.studentRecordId || '').trim()).filter(Boolean)
  );
  const selectedPersonIdSet = new Set(selectedStudents.map((row) => row.personId));
  const studentMap = new Map(
    selectedStudents.map((row) => [row.personId, initStudentRow(row)])
  );

  const classes = await schoolDataService.fetchAllData('classes', {}, req.user, routeAccessContext);
  const activeClasses = (Array.isArray(classes) ? classes : [])
    .filter((row) => classBelongsToActiveOrg(row, activeOrgId))
    .filter(isActiveAttendanceClass);

  const orgPolicyCatalog = await attendanceMatrixPolicyModel.getPolicyCatalogForOrg(activeOrgId);
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

    const matchedPersonIds = selectedStudents
      .filter((row) => matchedStudentIds.includes(String(row.studentRecordId || '').trim()))
      .map((row) => row.personId)
      .filter((personId) => selectedPersonIdSet.has(personId));
    if (!matchedPersonIds.length) continue;

    const matrixReq = {
      user: req.user,
      query: {
        classId,
        startDate,
        endDate
      }
    };
    const payload = await buildAttendanceMatrixPayload(matrixReq, {
      applyWindow: false,
      filterPersonIds: matchedPersonIds.join(',')
    });
    const matrixRows = Array.isArray(payload?.matrix) ? payload.matrix : [];

    matrixRows.forEach((matrixRow) => {
      const personId = String(matrixRow?.personId || '').trim();
      if (!personId || !studentMap.has(personId)) return;
      const studentRow = studentMap.get(personId);
      const rollupRecords = Array.isArray(matrixRow._rollupRecords) && matrixRow._rollupRecords.length
        ? matrixRow._rollupRecords
        : (Array.isArray(matrixRow.records) ? matrixRow.records : []);
      const classRollupSummary = matrixRow.summary && typeof matrixRow.summary === 'object'
        ? matrixRow.summary
        : computeAttendanceRollupSummary(rollupRecords, classRow, orgPolicyCatalog);
      studentRow._rollupRecords.push(...rollupRecords);
      studentRow.classes.push({
        classId: payload.classId,
        className: payload.className,
        teacherName: payload.teacherName || '',
        teacherId: String(classRow?.instructors?.[0]?.personId || classRow?.instructors?.[0]?.id || '').trim(),
        summary: classRollupSummary,
        days: buildClassDayCells(days, rollupRecords)
      });
    });
  }

  const students = [...studentMap.values()].map((row) => finalizeStudentSummary(row, orgPolicyCatalog));
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
    days,
    students,
    enabledAttendanceStatuses: attendanceMatrixMetricsService.ALL_ATTENDANCE_STATUSES_ORDERED
  };
}

module.exports = {
  buildDateRangeDays,
  buildClassDayCells,
  buildStudentAttendanceReportPayload,
  resolveSelectedStudents
};
