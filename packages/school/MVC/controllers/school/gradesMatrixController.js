/**
 * Grades matrix: session-scoped gradebook / quiz / assignment scores per student,
 * with evaluation rules from the class and a computed final column.
 */
const schoolDataService = require('../../services/school/schoolDataService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const dataService = requireCoreModule('MVC/services/dataService');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const sessionStatusPolicyService = require('../../services/school/sessionStatusPolicyService');
const classEnrollmentReadService = require('../../services/school/classEnrollmentReadService');
const classEnrollmentSessionApplicabilityService = require('../../services/school/classEnrollmentSessionApplicabilityService');
const leaveRequestService = require('../../services/school/leaveRequestService');
const attendanceMatrixMetricsService = require('../../services/school/attendanceMatrixMetricsService');
const schoolPersonAccessService = require('../../services/school/schoolPersonAccessService');
const attendanceMatrixPolicyModel = require('../../models/school/attendanceMatrixPolicyModel');
const schoolStudentProfileLinkService = require('../../services/school/schoolStudentProfileLinkService');
const {
  userCanOpenAttendanceMatrix
} = require('../../services/school/attendanceMatrixAccessService');
const matrixWindowService = require('../../services/school/matrixWindowService');
const matrixRollupService = require('../../services/school/matrixRollupService');
const gradebookWeightService = require('../../services/school/gradebookWeightService');
const gradesMatrixWeightSaveService = require('../../services/school/gradesMatrixWeightSaveService');

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function enrollmentPeriodCoversDate(period, sessionDate) {
  const status = String(period?.status || '').trim().toLowerCase();
  if (!classEnrollmentReadService.HISTORICAL_ROLLING_ROSTER_STATUSES.includes(status)) return false;
  const date = normalizeDateOnly(sessionDate);
  const start = normalizeDateOnly(period?.startDate);
  const end = normalizeDateOnly(period?.endDate) || '9999-12-31';
  return Boolean(date && start && start <= date && end >= date);
}

function buildApplicabilityKey(personId, sessionId) {
  return String(personId || '').trim() + '::' + String(sessionId || '').trim();
}

function normalizeEvaluation(classData) {
  const ev = classData?.evaluation && typeof classData.evaluation === 'object' ? classData.evaluation : {};
  const w = ev.weights && typeof ev.weights === 'object' ? ev.weights : {};
  const rolling = String(classData?.registrationMode || '').trim().toLowerCase() === 'rolling';
  const base = {
    passingScore: Number(ev.passingScore) || 60,
    weights: {
      attendance: Number(w.attendance) || 0,
      assignments: Number(w.assignments) || 0,
      midterm: Number(w.midterm) || 0,
      finalExam: Number(w.finalExam) || 0
    }
  };
  if (rolling) {
    base.weights.midterm = 0;
    base.weights.finalExam = 0;
  }
  return base;
}

function getScoreFromMap(scores, personId) {
  if (!scores || typeof scores !== 'object') return null;
  const pid = String(personId);
  let v = scores[pid];
  if (v === undefined) v = scores[personId];
  if (v === '' || v === undefined) return null;
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getCommentFromMap(scoreComments, personId) {
  if (!scoreComments || typeof scoreComments !== 'object') return null;
  const pid = String(personId);
  let v = scoreComments[pid];
  if (v === undefined) v = scoreComments[personId];
  if (v == null || v === '') return null;
  const s = String(v).trim();
  return s || null;
}

function formatColumnWeightLabel(col) {
  if (!col || typeof col !== 'object') return null;
  const kind = String(col.kind || '').trim().toLowerCase();
  const explicit = kind === 'gradebook' ? Number(col._explicitWeight) : NaN;
  if (kind === 'gradebook' && Number.isFinite(explicit) && explicit > 0) {
    return { text: `W ${explicit}%`, title: 'Percent of final grade' };
  }
  const weight = Number(col.weight);
  const total = Number(col.totalScore);
  const pts = Number.isFinite(weight) && weight > 0
    ? weight
    : (Number.isFinite(total) && total > 0 ? total : 0);
  if (!pts) return null;
  return { text: `${pts} pts`, title: 'Points used in category average weighting' };
}

function sanitizeActivityAttachments(attachments = []) {
  return (Array.isArray(attachments) ? attachments : [])
    .map((row) => ({
      id: String(row?.id || '').trim(),
      name: String(row?.name || 'Attachment').trim().slice(0, 200),
      url: String(row?.url || '').trim(),
      role: String(row?.role || '').trim()
    }))
    .filter((row) => row.url)
    .slice(0, 20);
}

function buildColumnActivityDetails(item, kind, session) {
  const activityContent = String(
    item?.activityContent || item?.instructions || item?.description || item?.content || ''
  ).trim().slice(0, 12000);
  const details = {
    sessionStartTime: String(session?.startTime || '').trim(),
    sessionStatus: String(session?.status || '').trim(),
    activityContent
  };
  if (kind === 'gradebook') {
    details.attachments = sanitizeActivityAttachments(item?.attachments);
    details.skills = Array.isArray(item?.skills)
      ? item.skills.map((skill) => String(skill || '').trim()).filter(Boolean).slice(0, 50)
      : [];
    if (item?.skillFocus) {
      details.skillFocus = String(item.skillFocus).trim().slice(0, 200);
    }
  }
  return details;
}

function findGradebookItem(session, itemId) {
  const arr = Array.isArray(session.gradebooks) ? session.gradebooks : [];
  const byId = arr.find((g) => String(g?.id || '') === String(itemId));
  if (byId) return byId;
  const m = /^gb_(\d+)$/.exec(String(itemId));
  if (m) return arr[Number(m[1])];
  return null;
}

function findQuizItem(session, itemId) {
  const arr = Array.isArray(session.quizzes) ? session.quizzes : [];
  const byId = arr.find((g) => String(g?.id || '') === String(itemId));
  if (byId) return byId;
  const m = /^quiz_(\d+)$/.exec(String(itemId));
  if (m) return arr[Number(m[1])];
  return null;
}

function findAssignmentItem(session, itemId) {
  const arr = Array.isArray(session.assignments) ? session.assignments : [];
  const byId = arr.find((g) => String(g?.id || '') === String(itemId));
  if (byId) return byId;
  const m = /^asg_(\d+)$/.exec(String(itemId));
  if (m) return arr[Number(m[1])];
  return null;
}

function collectColumns(filteredSessions) {
  const columns = [];
  const dateOrder = [];
  const dateSeen = new Set();
  filteredSessions.forEach((ses) => {
    const date = String(ses.date || '').trim();
    if (date && !dateSeen.has(date)) {
      dateSeen.add(date);
      dateOrder.push(date);
    }
  });
  const dateBand = new Map(dateOrder.map((d, i) => [d, i]));

  filteredSessions.forEach((ses) => {
    const date = String(ses.date || '').trim();
    const band = dateBand.get(date) ?? 0;

    (Array.isArray(ses.gradebooks) ? ses.gradebooks : []).forEach((gb) => {
      const id = String(gb?.id || '').trim() || `gb_${columns.length}`;
      const total = Number(gb?.totalScore) || 0;
      columns.push({
        colKey: `${ses.sessionId}::gradebook::${id}`,
        sessionId: ses.sessionId,
        date,
        dateBand: band,
        kind: 'gradebook',
        kindLabel: 'Gradebook',
        itemId: id,
        label: String(gb?.name || 'Activity').slice(0, 120),
        includeInGradeCalculation: gb?.includeInGradeCalculation !== false,
        weight: gradebookWeightService.resolveActivityWeight(gb),
        _explicitWeight: Number(gb?.weight),
        totalScore: total > 0 ? total : 0,
        ...buildColumnActivityDetails(gb, 'gradebook', ses)
      });
    });

    (Array.isArray(ses.quizzes) ? ses.quizzes : []).forEach((q, idx) => {
      const id = String(q?.id || `quiz_${idx}`).trim();
      const total = Number(q?.totalScore) || 0;
      columns.push({
        colKey: `${ses.sessionId}::quiz::${id}`,
        sessionId: ses.sessionId,
        date,
        dateBand: band,
        kind: 'quiz',
        kindLabel: 'Quiz',
        itemId: id,
        label: String(q?.name || `Quiz ${idx + 1}`).slice(0, 120),
        includeInGradeCalculation: q?.includeInGradeCalculation !== false,
        weight: gradebookWeightService.resolveActivityWeight(q),
        totalScore: total > 0 ? total : 0,
        ...buildColumnActivityDetails(q, 'quiz', ses)
      });
    });

    (Array.isArray(ses.assignments) ? ses.assignments : []).forEach((a, idx) => {
      const id = String(a?.id || `asg_${idx}`).trim();
      const total = Number(a?.totalScore) || 0;
      columns.push({
        colKey: `${ses.sessionId}::assignment::${id}`,
        sessionId: ses.sessionId,
        date,
        dateBand: band,
        kind: 'assignment',
        kindLabel: 'Assignment',
        itemId: id,
        label: String(a?.name || `Assignment ${idx + 1}`).slice(0, 120),
        includeInGradeCalculation: a?.includeInGradeCalculation !== false,
        weight: gradebookWeightService.resolveActivityWeight(a),
        totalScore: total > 0 ? total : 0,
        ...buildColumnActivityDetails(a, 'assignment', ses)
      });
    });
  });

  return { columns, dateOrder };
}

function pickPayload(session, col) {
  if (col.kind === 'gradebook') return findGradebookItem(session, col.itemId);
  if (col.kind === 'quiz') return findQuizItem(session, col.itemId);
  if (col.kind === 'assignment') return findAssignmentItem(session, col.itemId);
  return null;
}

const { assignmentsCategoryAveragePercents, computeFinalPercent } = matrixRollupService;

function parseIncludeAttendanceInFinal(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const token = String(value).trim().toLowerCase();
  if (token === 'true' || token === '1' || token === 'yes') return true;
  if (token === 'false' || token === '0' || token === 'no') return false;
  return defaultValue;
}

function resolveIncludeAttendanceInFinal(query = {}, options = {}) {
  if (options.includeAttendanceInFinal != null) {
    return Boolean(options.includeAttendanceInFinal);
  }
  return parseIncludeAttendanceInFinal(query.includeAttendanceInFinal, false);
}

function buildGradesAttendanceRecord(stu, ses, ctx, rosterRecord) {
  const {
    classData,
    orgPolicyCatalog,
    attendancePolicy,
    enabledAttendanceStatuses,
    forceNotApplicableSessionKeys,
    getApplicabilityForSession
  } = ctx;
  const applicabilityState = getApplicabilityForSession(stu, ses);
  const forceNotApplicable = forceNotApplicableSessionKeys.has(String(ses?.sessionId || ses?.id || '').trim())
    || forceNotApplicableSessionKeys.has(String(ses?.date || '').trim());
  const expectedForSession = !forceNotApplicable && Boolean(applicabilityState.expected);
  const hasApprovedLeave = applicabilityState.reason === 'approved_leave';
  let status = forceNotApplicable
    ? attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE
    : (rosterRecord
      ? attendanceMatrixMetricsService.normalizeAttendanceStatusForSave(rosterRecord.attendance, '')
      : (expectedForSession ? '' : attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE));
  if (!forceNotApplicable && hasApprovedLeave && (!rosterRecord || attendanceMatrixMetricsService.isAbsentLikeStatus(status))) {
    status = attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE;
  }
  const scheduledMinutes = attendanceMatrixMetricsService.scheduledMinutesFromSession(
    ses,
    attendancePolicy.scheduledMinutes
  );
  const record = {
    sessionId: ses.sessionId,
    date: ses.date,
    status,
    lateMinutes: status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE ? 0 : (rosterRecord?.lateMinutes || 0),
    earlyLeaveMinutes: status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE ? 0 : (rosterRecord?.earlyLeaveMinutes || 0),
    scheduledMinutes
  };
  const recordPolicy = attendanceMatrixMetricsService.resolvePolicyForScheduledMinutes(
    classData,
    orgPolicyCatalog,
    scheduledMinutes
  );
  record.status = attendanceMatrixMetricsService.resolveEffectiveAttendanceStatus(
    record,
    recordPolicy,
    enabledAttendanceStatuses
  );
  return record;
}

function buildGradesAttendanceRecords(stu, sessions, ctx, rosterMaps) {
  return (Array.isArray(sessions) ? sessions : []).map((ses) => {
    const rosterRecord = matrixWindowService.rosterRecordForSession(rosterMaps, ses, stu.personId);
    return buildGradesAttendanceRecord(stu, ses, ctx, rosterRecord);
  });
}

function buildGradesMatrixCell(stu, col, ctx, rosterMaps) {
  const {
    classData,
    orgPolicyCatalog,
    attendancePolicy,
    enabledAttendanceStatuses,
    forceNotApplicableSessionKeys,
    sessionById,
    getApplicabilityForSession
  } = ctx;
  const ses = sessionById.get(col.sessionId);
  if (!ses) {
    return {
      score: null,
      percent: null,
      absent: true,
      notApplicable: false,
      attendanceStatus: attendanceMatrixMetricsService.ATTENDANCE_STATUS.ABSENT,
      effective: false,
      includeInGradeCalculation: false
    };
  }
  const rosterRecord = matrixWindowService.rosterRecordForSession(rosterMaps, ses, stu.personId);
  const applicabilityState = getApplicabilityForSession(stu, ses);
  const forceNotApplicable = forceNotApplicableSessionKeys.has(String(ses?.sessionId || ses?.id || '').trim())
    || forceNotApplicableSessionKeys.has(String(ses?.date || '').trim());
  const expectedForSession = !forceNotApplicable && Boolean(applicabilityState.expected);
  const hasApprovedLeave = applicabilityState.reason === 'approved_leave';
  let att = forceNotApplicable
    ? attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE
    : (rosterRecord
      ? attendanceMatrixMetricsService.normalizeAttendanceStatusForSave(rosterRecord.attendance, '')
      : (expectedForSession ? '' : attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE));
  if (!forceNotApplicable && hasApprovedLeave && (!rosterRecord || attendanceMatrixMetricsService.isAbsentLikeStatus(att))) {
    att = attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE;
  }
  const scheduledMinutes = attendanceMatrixMetricsService.scheduledMinutesFromSession(
    ses,
    attendancePolicy.scheduledMinutes
  );
  const cellPolicy = attendanceMatrixMetricsService.resolvePolicyForScheduledMinutes(
    classData,
    orgPolicyCatalog,
    scheduledMinutes
  );
  att = attendanceMatrixMetricsService.resolveEffectiveAttendanceStatus({
    status: att,
    lateMinutes: rosterRecord?.lateMinutes || 0,
    earlyLeaveMinutes: rosterRecord?.earlyLeaveMinutes || 0
  }, cellPolicy, enabledAttendanceStatuses);
  const notApplicable = att === attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE;
  const absent = !notApplicable && attendanceMatrixMetricsService.isAbsentLikeStatus(att);

  const payload = pickPayload(ses, col);
  if (!payload) {
    return {
      score: null,
      percent: null,
      absent,
      notApplicable,
      attendanceStatus: att,
      effective: col.includeInGradeCalculation === true && !notApplicable,
      includeInGradeCalculation: !!col.includeInGradeCalculation
    };
  }

  const total = Number(col.totalScore) > 0 ? Number(col.totalScore) : Number(payload.totalScore) || 0;
  const raw = (absent || notApplicable) ? null : getScoreFromMap(payload.scores, stu.personId);
  let percent = null;
  if (!absent && !notApplicable && raw != null && total > 0) {
    percent = Math.round((raw / total) * 1000) / 10;
  }
  const effective = col.includeInGradeCalculation === true && !notApplicable;

  const cell = {
    score: (absent || notApplicable) ? null : raw,
    percent,
    absent,
    notApplicable,
    attendanceStatus: att,
    effective,
    includeInGradeCalculation: col.includeInGradeCalculation
  };

  if (!absent && !notApplicable && col.kind === 'gradebook') {
    const comment = getCommentFromMap(payload.scoreComments, stu.personId);
    if (comment) cell.comment = comment;
  }

  return cell;
}

async function loadGradesMatrixSharedContext(req, query) {
  const classId = String(query?.classId || '').trim();
  const startDate = String(query?.startDate || '').trim();
  const endDate = String(query?.endDate || '').trim();
  if (!classId) throw new Error('Class ID is required.');

  const classData = await schoolDataService.getDataById('classes', classId, req.user);
  if (!classData) throw new Error('Class not found.');

  const allSessions = await schoolDataService.getClassSessions(classId, req.user);
  const statusMap = await sessionStatusPolicyService.getStatusMap(classData?.orgId || req.user?.activeOrgId || '', {
    includeInactive: true
  });
  const filteredSessions = [];
  (allSessions || []).forEach((sessionRow) => {
    if (
      sessionStatusPolicyService.shouldExcludeFromAttendanceByMap(statusMap, {
        status: sessionRow?.status,
        notes: sessionRow?.notes
      })
    ) {
      return;
    }
    if (startDate && sessionRow.date < startDate) return;
    if (endDate && sessionRow.date > endDate) return;
    filteredSessions.push(sessionRow);
  });
  filteredSessions.sort((a, b) => new Date(`${a.date}T${a.startTime || '00:00'}`) - new Date(`${b.date}T${b.startTime || '00:00'}`));

  const students = await schoolDataService.fetchAllData('students', {}, req.user);

  const studentToPersonMap = new Map(
    (Array.isArray(students) ? students : [])
      .map((row) => [String(row?.id || '').trim(), String(row?.personId || '').trim()])
      .filter(([studentId, personId]) => studentId && personId)
  );

  const activeOrgId = String(req.user?.activeOrgId || classData?.orgId || '').trim();
  const forceNotApplicableSessionKeys = sessionStatusPolicyService.buildForceNotApplicableAttendanceSessionKeys(statusMap, filteredSessions);
  const sessionDates = filteredSessions.map((row) => String(row?.date || '').trim()).filter(Boolean);
  const isRollingClass = String(classData?.registrationMode || '').trim().toLowerCase() === 'rolling';
  const enrollmentSnapshot = await classEnrollmentReadService.listActiveStudentIdsForClass({
    classId: classData.id,
    classItem: classData,
    reqUser: req.user,
    activeOrgId,
    sessionDates,
    startDate,
    endDate,
    canonicalStatuses: isRollingClass
      ? classEnrollmentReadService.HISTORICAL_ROLLING_ROSTER_STATUSES
      : null
  });
  let rollingApplicability = null;
  const activePersonIds = new Set();
  if (isRollingClass) {
    const rollingPeriodRows = await schoolDataService.getClassEnrollmentPeriodsByClassId(classData.id, req.user);
    rollingApplicability = await classEnrollmentSessionApplicabilityService.resolveRollingEnrollmentApplicabilityWithLeaves({
      sessions: filteredSessions,
      periodRows: Array.isArray(rollingPeriodRows) ? rollingPeriodRows : [],
      studentToPersonMap,
      activeOrgId,
      orgId: classData?.orgId || activeOrgId,
      reqUser: req.user,
      allowedStatuses: classEnrollmentSessionApplicabilityService.OPEN_OR_HISTORICAL_STATUSES,
      forceNotApplicableSessionKeys
    });
    rollingApplicability.personIds.forEach((personId) => activePersonIds.add(String(personId || '').trim()));
  } else {
    const studentIds = enrollmentSnapshot.studentIds instanceof Set ? enrollmentSnapshot.studentIds : new Set();
    studentIds.forEach((id) => {
      const studentId = String(id || '').trim();
      if (!studentId) return;
      activePersonIds.add(String(studentToPersonMap.get(studentId) || studentId).trim());
    });
  }
  const personById = await schoolPersonAccessService.buildPersonByIdMap({
    reqUser: req.user,
    personIds: Array.from(activePersonIds)
  });

  const personToStudentMap = schoolStudentProfileLinkService.buildPersonIdToStudentRecordIdMap(students, activeOrgId);

  let studentList = Array.from(activePersonIds).map((uid) => {
    const person = personById.get(String(uid || '').trim());
    const name = person ? schoolPersonAccessService.formatPersonName(person, `Person ${uid}`) : `Person ${uid}`;
    return {
      personId: uid,
      name,
      studentRecordId: schoolStudentProfileLinkService.resolveStudentRecordId({
        personId: uid,
        personToStudentMap
      })
    };
  });
  studentList.sort((a, b) => a.name.localeCompare(b.name));

  const orgIdForPolicy = String(req.user?.activeOrgId || classData?.orgId || '').trim();
  const [orgPolicyCatalog, orgPolicyLayer] = await Promise.all([
    attendanceMatrixPolicyModel.getPolicyCatalogForOrg(orgIdForPolicy),
    attendanceMatrixPolicyModel.getPolicyForOrg(orgIdForPolicy)
  ]);
  const attendancePolicy = attendanceMatrixMetricsService.resolvePolicy(classData, orgPolicyLayer);
  const enabledAttendanceStatuses = attendanceMatrixMetricsService.resolveEnabledAttendanceStatuses(classData);

  const sessionById = new Map(filteredSessions.map((s) => [s.sessionId, s]));

  const { columns, dateOrder } = collectColumns(filteredSessions);
  columns.forEach((c) => {
    c.category = 'assignment';
  });

  const evaluation = normalizeEvaluation(classData);
  const getApplicabilityForSession = (stu, ses) => {
    if (!isRollingClass) return { expected: true, reason: 'date_window' };
    return classEnrollmentSessionApplicabilityService.getApplicabilityState(
      rollingApplicability?.stateByKey,
      stu.personId,
      ses,
      ses?.sessionId || ses?.id
    ) || { expected: false, reason: 'not_enrolled' };
  };

  return {
    classData,
    filteredSessions,
    studentList,
    columns,
    dateOrder,
    sessionById,
    evaluation,
    isRollingClass,
    enrollmentSnapshot,
    orgPolicyCatalog,
    attendancePolicy,
    enabledAttendanceStatuses,
    forceNotApplicableSessionKeys,
    getApplicabilityForSession
  };
}

async function showGradesMatrixPage(req, res) {
  try {
    const q = req.query || {};
    const initialClassId = String(q.classId || '').trim();
    const initialStartDate = String(q.startDate || '').trim();
    const initialEndDate = String(q.endDate || '').trim();
    const initialRange = String(q.range || '').trim();
    let initialClassName = String(q.className || '').trim();
    if (initialClassId && !initialClassName) {
      try {
        const classRow = await schoolDataService.getDataById('classes', initialClassId, req.user);
        if (classRow?.title) initialClassName = String(classRow.title).trim();
      } catch (e) {
        /* ignore */
      }
    }

    const canOpenAttendanceMatrix = await userCanOpenAttendanceMatrix(req.user, req.ip);

    res.render('school/grades/gradesMatrix', {
      title: 'Grades Matrix',
      includeModal: true,
      includePrintManager: true,
      user: req.user,
      actionStateId: req.actionStateId,
      tableName: 'Grades_Matrix',
      initialClassId,
      initialClassName,
      initialStartDate,
      initialEndDate,
      initialRange,
      canOpenAttendanceMatrix
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

/**
 * Same payload as GET /school/grades-matrix/api/data (for server-side pages and tools).
 * @param {import('express').Request} req
 * @param {{ classId: string, startDate?: string, endDate?: string }} query
 */
function annotateMatrixColumnsForClient(columns = []) {
  return columns.map((col) => {
    const weight = gradebookWeightService.resolveActivityWeight(col);
    const saved = col?._savedWeight != null ? Number(col._savedWeight) : weight;
    return {
      ...col,
      weight,
      _savedWeight: Number.isFinite(saved) && saved > 0 ? saved : weight
    };
  });
}

async function buildGradesMatrixPayload(req, query, options = {}) {
  const ctx = await loadGradesMatrixSharedContext(req, query);
  const assignmentsOnlyFinal = options.assignmentsOnlyFinal === true;
  const includeAttendanceInFinal = assignmentsOnlyFinal
    ? false
    : resolveIncludeAttendanceInFinal(query, options);
  const {
    classData,
    filteredSessions,
    studentList,
    columns,
    dateOrder,
    sessionById,
    evaluation,
    enrollmentSnapshot,
    orgPolicyCatalog
  } = ctx;

  const windowQuery = {
    studentOffset: query?.studentOffset,
    studentLimit: query?.studentLimit,
    columnOffset: query?.columnOffset,
    columnLimit: query?.columnLimit,
    fullMatrix: query?.fullMatrix || query?.full
  };
  const windowParams = options.windowParams || matrixWindowService.parseMatrixWindowQuery(windowQuery);
  const effectiveApplyWindow = options.applyWindow !== false && windowParams.applyWindow;
  const buildPlan = matrixWindowService.planGradesMatrixBuild(
    studentList.length,
    columns.length,
    { ...windowParams, applyWindow: effectiveApplyWindow }
  );
  const buildStudentList = studentList.slice(buildPlan.studentStart, buildPlan.studentEnd);
  const buildColumns = columns.slice(buildPlan.columnStart, buildPlan.columnEnd);
  const attendanceSessionIds = new Set(
    buildColumns.map((col) => String(col?.sessionId || '').trim()).filter(Boolean)
  );
  const buildSessionsForAttendance = filteredSessions.filter((ses) =>
    attendanceSessionIds.has(String(ses?.sessionId || '').trim())
  );
  const rosterMaps = matrixWindowService.buildRosterLookupMaps(buildSessionsForAttendance);

  const matrix = buildStudentList.map((stu) => {
    const attendanceRecords = buildGradesAttendanceRecords(stu, buildSessionsForAttendance, ctx, rosterMaps);
    const attSummary = attendanceMatrixMetricsService.computeStudentMatrixSummary(attendanceRecords, classData, orgPolicyCatalog);
    const attendancePct = attSummary.performancePercent;
    const cells = buildColumns.map((col) => buildGradesMatrixCell(stu, col, ctx, rosterMaps));
    const assignmentsPct = assignmentsCategoryAveragePercents(cells, buildColumns);
    const { finalPercent, parts } = computeFinalPercent(
      evaluation,
      attendancePct,
      assignmentsPct,
      null,
      null,
      { includeAttendanceInFinal }
    );

    return {
      personId: stu.personId,
      name: stu.name,
      studentRecordId: stu.studentRecordId,
      attendancePct,
      attendanceSummary: attSummary,
      assignmentsPct,
      cells,
      finalPercent,
      finalParts: parts,
      _attendanceRecords: attendanceRecords
    };
  });

  const payload = {
    status: 'success',
    classId: classData.id,
    className: classData.title,
    registrationMode: String(classData?.registrationMode || 'term_based').trim().toLowerCase() === 'rolling'
      ? 'rolling'
      : 'term_based',
    evaluation,
    sessions: filteredSessions.map((s) => ({ id: s.sessionId, date: s.date, startTime: s.startTime })),
    dateOrder,
    columns: buildColumns,
    matrix,
    enrollmentSource: String(enrollmentSnapshot?.source || 'canonical'),
    attendancePolicyNote: 'Attendance % uses the same session credit rules as the attendance matrix.',
    includeAttendanceInFinal,
    window: buildPlan.window
  };

  return matrixRollupService.recomputeGradesMatrixRollups(payload, {
    classData,
    orgPolicyCatalog,
    evaluation,
    includeAttendanceInFinal,
    assignmentsOnlyFinal
  });
}

async function getGradesMatrixData(req, res) {
  try {
    const { classId, startDate, endDate } = req.query;
    const payload = await buildGradesMatrixPayload(req, {
      classId,
      startDate,
      endDate,
      studentOffset: req.query.studentOffset,
      studentLimit: req.query.studentLimit,
      columnOffset: req.query.columnOffset,
      columnLimit: req.query.columnLimit,
      fullMatrix: req.query.fullMatrix || req.query.full
    }, { assignmentsOnlyFinal: true });
    const clientPayload = {
      ...payload,
      columns: annotateMatrixColumnsForClient(payload.columns),
      matrix: (payload.matrix || []).map(({ _attendanceRecords, ...row }) => row),
      weightDirty: false
    };
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.json(clientPayload);
  } catch (error) {
    res.status(400).json({ status: 'error', message: error.message });
  }
}

async function postGradesRollups(req, res) {
  try {
    const classId = String(req.body?.classId || '').trim();
    if (!classId) throw new Error('Class ID is required.');
    const startDate = String(req.body?.startDate || '').trim();
    const endDate = String(req.body?.endDate || '').trim();
    const columns = Array.isArray(req.body?.columns) ? req.body.columns : [];
    const students = Array.isArray(req.body?.students) ? req.body.students : [];
    const ctx = await loadGradesMatrixSharedContext(req, { classId, startDate, endDate });
    const { classData, filteredSessions, studentList, orgPolicyCatalog, evaluation } = ctx;
    const sessionIds = new Set(
      columns.map((col) => String(col?.sessionId || '').trim()).filter(Boolean)
    );
    const sessionsForAttendance = filteredSessions.filter((ses) =>
      sessionIds.has(String(ses?.sessionId || '').trim())
    );
    const rosterMaps = matrixWindowService.buildRosterLookupMaps(sessionsForAttendance);
    const studentByPersonId = new Map(studentList.map((row) => [String(row.personId), row]));
    const rollupRows = students.map((student) => {
      const personId = String(student?.personId || '').trim();
      const stu = studentByPersonId.get(personId) || { personId, name: `Person ${personId}` };
      const attendanceRecords = buildGradesAttendanceRecords(stu, sessionsForAttendance, ctx, rosterMaps);
      return {
        personId,
        cells: Array.isArray(student?.cells) ? student.cells : [],
        _attendanceRecords: attendanceRecords
      };
    });
    const rollups = matrixRollupService.summarizeGradesRollupsForRows(
      rollupRows,
      columns,
      {
        classData,
        orgPolicyCatalog,
        evaluation,
        assignmentsOnlyFinal: true
      }
    );
    return res.json({ status: 'success', rollups });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function postSaveActivityWeights(req, res) {
  try {
    const classId = String(req.body?.classId || '').trim();
    const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];
    const result = await gradesMatrixWeightSaveService.saveActivityWeights({ classId, updates }, req.user);
    return res.json({ status: 'success', saved: result.saved, touchedSessions: result.touchedSessions });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

module.exports = {
  showGradesMatrixPage,
  getGradesMatrixData,
  postGradesRollups,
  postSaveActivityWeights,
  buildGradesMatrixPayload,
  annotateMatrixColumnsForClient,
  collectColumns,
  buildGradesMatrixCell,
  formatColumnWeightLabel,
  buildColumnActivityDetails,
  getCommentFromMap,
  computeFinalPercent,
  parseIncludeAttendanceInFinal,
  resolveIncludeAttendanceInFinal
};
