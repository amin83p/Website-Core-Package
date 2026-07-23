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
const { userCanManageAttendanceMatrixPolicy } = require('../../middleware/attendanceMatrixPolicyAdminMiddleware');

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
        totalScore: total > 0 ? total : 0
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
        totalScore: total > 0 ? total : 0
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
        totalScore: total > 0 ? total : 0
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

function computeFinalPercent(evaluation, attendancePct, assignmentsPct, midtermPct, finalExamPct) {
  const w = evaluation.weights;
  const parts = [];
  if (Number(w.attendance) > 0 && attendancePct != null && !Number.isNaN(Number(attendancePct))) {
    parts.push({ key: 'attendance', weight: Number(w.attendance), pct: Number(attendancePct) });
  }
  if (Number(w.assignments) > 0 && assignmentsPct != null && !Number.isNaN(Number(assignmentsPct))) {
    parts.push({ key: 'assignments', weight: Number(w.assignments), pct: Number(assignmentsPct) });
  }
  if (Number(w.midterm) > 0 && midtermPct != null && !Number.isNaN(Number(midtermPct))) {
    parts.push({ key: 'midterm', weight: Number(w.midterm), pct: Number(midtermPct) });
  }
  if (Number(w.finalExam) > 0 && finalExamPct != null && !Number.isNaN(Number(finalExamPct))) {
    parts.push({ key: 'finalExam', weight: Number(w.finalExam), pct: Number(finalExamPct) });
  }
  const sumW = parts.reduce((s, p) => s + p.weight, 0);
  if (!sumW) return { finalPercent: null, parts: [] };
  const finalPercent = parts.reduce((s, p) => s + p.weight * p.pct, 0) / sumW;
  return { finalPercent: Math.round(finalPercent * 100) / 100, parts };
}

function assignmentsCategoryAveragePercents(cells, columns) {
  const percents = [];
  for (let i = 0; i < columns.length; i += 1) {
    const col = columns[i];
    const cell = cells[i];
    if (!col || !cell) continue;
    if (!col.includeInGradeCalculation) continue;
    if (!cell.effective) continue;
    if (cell.percent == null) continue;
    percents.push(Number(cell.percent));
  }
  if (!percents.length) return null;
  const sum = percents.reduce((a, b) => a + b, 0);
  return Math.round((sum / percents.length) * 100) / 100;
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

    const canManageAttendanceMatrixPolicy = await userCanManageAttendanceMatrixPolicy(req.user, req.ip);

    res.render('school/grades/gradesMatrix', {
      title: 'Grades Matrix',
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId,
      tableName: 'Grades_Matrix',
      initialClassId,
      initialClassName,
      initialStartDate,
      initialEndDate,
      initialRange,
      canManageAttendanceMatrixPolicy
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
async function buildGradesMatrixPayload(req, query) {
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

  const students = await schoolDataService.fetchData('students', {}, req.user);

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
  const orgPolicyItems = await attendanceMatrixPolicyModel.listPolicyItemsForOrg(orgIdForPolicy);
  const orgPolicyCatalog = { items: orgPolicyItems };
  const orgPolicyLayer = await attendanceMatrixPolicyModel.getPolicyForOrg(orgIdForPolicy);
  const attendancePolicy = attendanceMatrixMetricsService.resolvePolicy(classData, orgPolicyLayer);

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
  const matrix = studentList.map((stu) => {
    const attendanceRecords = filteredSessions.map((ses) => {
      const rosterRecord = ses.roster?.find((r) => idsEqual(r.personId, stu.personId));
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
      return {
        sessionId: ses.sessionId,
        date: ses.date,
        status,
        lateMinutes: status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE ? 0 : (rosterRecord?.lateMinutes || 0),
        earlyLeaveMinutes: status === attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE ? 0 : (rosterRecord?.earlyLeaveMinutes || 0),
        scheduledMinutes: attendanceMatrixMetricsService.scheduledMinutesFromSession(ses, attendancePolicy.scheduledMinutes)
      };
    });
    const attSummary = attendanceMatrixMetricsService.computeStudentMatrixSummary(attendanceRecords, classData, orgPolicyCatalog);
    const attendancePct = attSummary.performancePercent;

    const cells = columns.map((col) => {
      const ses = sessionById.get(col.sessionId);
      if (!ses) {
        return { score: null, percent: null, absent: true, attendanceStatus: attendanceMatrixMetricsService.ATTENDANCE_STATUS.ABSENT, effective: false, includeInGradeCalculation: false };
      }
      const rosterRecord = ses.roster?.find((r) => idsEqual(r.personId, stu.personId));
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
      const absent = attendanceMatrixMetricsService.isAbsentLikeStatus(att)
        || att === attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE;

      const payload = pickPayload(ses, col);
      if (!payload) {
        return { score: null, percent: null, absent, attendanceStatus: att, effective: false, includeInGradeCalculation: !!col.includeInGradeCalculation };
      }

      const total = Number(col.totalScore) > 0 ? Number(col.totalScore) : Number(payload.totalScore) || 0;
      const raw = absent ? null : getScoreFromMap(payload.scores, stu.personId);
      let percent = null;
      if (!absent && raw != null && total > 0) {
        percent = Math.round((raw / total) * 1000) / 10;
      }
      const effective = col.includeInGradeCalculation === true && !absent && raw != null && total > 0;

      return {
        score: absent ? null : raw,
        percent,
        absent,
        attendanceStatus: att,
        effective,
        includeInGradeCalculation: col.includeInGradeCalculation
      };
    });

    const assignmentsPct = assignmentsCategoryAveragePercents(cells, columns);
    const { finalPercent, parts } = computeFinalPercent(
      evaluation,
      attendancePct,
      assignmentsPct,
      null,
      null
    );

    return {
      personId: stu.personId,
      name: stu.name,
      attendancePct,
      attendanceSummary: attSummary,
      assignmentsPct,
      cells,
      finalPercent,
      finalParts: parts
    };
  });

  return {
    status: 'success',
    classId: classData.id,
    className: classData.title,
    registrationMode: String(classData?.registrationMode || 'term_based').trim().toLowerCase() === 'rolling'
      ? 'rolling'
      : 'term_based',
    evaluation,
    sessions: filteredSessions.map((s) => ({ id: s.sessionId, date: s.date, startTime: s.startTime })),
    dateOrder,
    columns,
    matrix,
    enrollmentSource: String(enrollmentSnapshot?.source || 'canonical'),
    attendancePolicyNote: 'Attendance % uses the same session credit rules as the attendance matrix.'
  };
}

async function getGradesMatrixData(req, res) {
  try {
    const { classId, startDate, endDate } = req.query;
    const payload = await buildGradesMatrixPayload(req, { classId, startDate, endDate });
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.json(payload);
  } catch (error) {
    res.status(400).json({ status: 'error', message: error.message });
  }
}

module.exports = {
  showGradesMatrixPage,
  getGradesMatrixData,
  buildGradesMatrixPayload
};
