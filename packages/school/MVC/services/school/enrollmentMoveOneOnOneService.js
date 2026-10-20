'use strict';

const schoolDataService = require('./schoolDataService');

let dependencies = {
  schoolDataService
};
const classSessionCapacityService = require('./classSessionCapacityService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
const scheduleMoveSessionsService = require('./scheduleMoveSessionsService');
const sessionConflictDetectionService = require('./sessionConflictDetectionService');
const attendanceMatrixMetricsService = require('./attendanceMatrixMetricsService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function isOneOnOneSessionCapacityType(value) {
  const token = String(value || '').trim().toLowerCase();
  return token === 'one_on_one' || token === '1_on_1' || token === 'oneonone';
}

function requiresIntegratedSessionMove({ sourcePeriod, sourceClass, targetClass, normalized } = {}) {
  const targetType = normalized?.target?.sessionCapacityType || sourcePeriod?.sessionCapacityType || 'group';
  if (isOneOnOneSessionCapacityType(targetType)) return true;
  const targetCapacity = classSessionCapacityService.resolveClassMaxCapacity(targetClass || {});
  if (targetCapacity === 1) return true;
  const sourceCapacity = classSessionCapacityService.resolveClassMaxCapacity(sourceClass || {});
  return isOneOnOneSessionCapacityType(sourcePeriod?.sessionCapacityType) && sourceCapacity === 1;
}

function isStudentActiveOnSession(session, personId, sourcePeriod) {
  const resolvedPersonId = toPublicId(personId);
  if (!resolvedPersonId) return false;
  if (!classEnrollmentSessionApplicabilityService.periodCoversSession(sourcePeriod, session)) return false;
  const roster = Array.isArray(session?.roster) ? session.roster : [];
  const row = roster.find((entry) => idsEqual(entry?.personId, resolvedPersonId));
  if (!row) return false;
  const attendance = attendanceMatrixMetricsService.normalizeAttendanceStatusForSave(row.attendance, '');
  if (attendance === attendanceMatrixMetricsService.ATTENDANCE_STATUS.NOT_APPLICABLE) return false;
  return true;
}

function selectSourceSessionsForEnrollmentMove({
  sourcePeriod,
  sourceSessions = [],
  moveStartDate = '',
  personId = ''
} = {}) {
  const start = normalizeDateOnly(moveStartDate);
  return (Array.isArray(sourceSessions) ? sourceSessions : [])
    .filter((session) => {
      const date = normalizeDateOnly(session?.date || session?.sessionDate || '');
      if (!date || !start || date < start) return false;
      return isStudentActiveOnSession(session, personId, sourcePeriod);
    })
    .sort((a, b) => {
      const dateA = normalizeDateOnly(a?.date || '');
      const dateB = normalizeDateOnly(b?.date || '');
      return dateA.localeCompare(dateB);
    });
}

function buildMasterScheduleUrl({ personId = '', date = '', classId = '' } = {}) {
  const params = new URLSearchParams();
  const pid = toPublicId(personId);
  const cid = toPublicId(classId);
  const day = normalizeDateOnly(date);
  if (pid) params.set('personId', pid);
  if (day) params.set('date', day);
  if (cid) params.set('classId', cid);
  const query = params.toString();
  return query ? `/school/schedules/viewer?${query}` : '/school/schedules/viewer';
}

function buildProposedSessionsFromPlans(sessionPlans = [], sourceSessions = [], targetClass = {}) {
  const teacher = scheduleMoveSessionsService.resolveTargetTeacher(targetClass);
  const sourceById = new Map(
    (Array.isArray(sourceSessions) ? sourceSessions : []).map((session) => [
      scheduleMoveSessionsService.sessionIdentity(session),
      session
    ])
  );
  return (Array.isArray(sessionPlans) ? sessionPlans : []).map((plan) => {
    const source = sourceById.get(toPublicId(plan?.sourceSessionId || '')) || {};
    return {
      sessionId: toPublicId(plan?.targetSessionId || plan?.sourceSessionId || 'proposed'),
      date: plan.date,
      startTime: plan.startTime,
      endTime: plan.endTime,
      status: source.status || 'scheduled',
      delivery: {
        deliveredBy: teacher.teacherId || null,
        deliveredByName: teacher.teacherName || ''
      }
    };
  });
}

async function detectTeacherScheduleConflictsForTransfer({
  targetClass,
  sessionPlans = [],
  sourceSessions = [],
  reqUser
} = {}) {
  const proposedSessions = buildProposedSessionsFromPlans(sessionPlans, sourceSessions, targetClass);
  if (!proposedSessions.length) {
    return { hasConflicts: false, conflicts: [], message: '' };
  }
  const teacher = scheduleMoveSessionsService.resolveTargetTeacher(targetClass);
  const activeOrgId = toPublicId(targetClass?.orgId || reqUser?.activeOrgId || '');
  const dates = proposedSessions.map((row) => normalizeDateOnly(row.date)).filter(Boolean).sort();
  const conflicts = await sessionConflictDetectionService.detectSessionConflicts({
    classId: toPublicId(targetClass?.id),
    sessions: proposedSessions,
    activeOrgId,
    reqUser,
    fallbackTeacherId: teacher.teacherId,
    instructorPersonId: teacher.teacherId,
    includeExternalScheduleConflicts: true,
    startDate: dates[0] || '',
    endDate: dates[dates.length - 1] || ''
  });
  if (!conflicts.length) {
    return { hasConflicts: false, conflicts: [], message: '' };
  }
  return {
    hasConflicts: true,
    conflicts,
    message: 'The target teacher has scheduling conflicts for one or more sessions being moved. Resolve conflicts on the master schedule before continuing.'
  };
}

async function planOneOnOneEnrollmentMove({
  sourcePeriod,
  sourceClass,
  targetClass,
  normalized,
  reqUser,
  options = {}
} = {}) {
  const blockers = [];
  const warnings = [];
  const notices = [];
  let personId = toPublicId(sourcePeriod?.personId || '');
  if (!personId && sourcePeriod?.studentId) {
    try {
      const student = await dependencies.schoolDataService.getDataById(
        'students',
        sourcePeriod.studentId,
        reqUser
      );
      personId = toPublicId(student?.personId || student?.userId || '');
    } catch (error) {
      personId = '';
    }
  }
  const moveStartDate = normalizeDateOnly(normalized?.target?.startDate || '');
  const targetClassId = toPublicId(targetClass?.id || normalized?.target?.classId || '');

  const capacityBlockers = scheduleMoveSessionsService.evaluateCapacityGate({
    sourceClass,
    targetClass
  });
  blockers.push(...capacityBlockers.map((row) => ({
    code: row.code,
    message: row.message
  })));

  if (blockers.length) {
    return { blockers, warnings, notices, sessionTransferPlan: null };
  }

  const [sourceSessions, targetSessions, targetPeriods] = await Promise.all([
    dependencies.schoolDataService.getClassSessions(sourceClass.id, reqUser),
    dependencies.schoolDataService.getClassSessions(targetClassId, reqUser),
    dependencies.schoolDataService.getClassEnrollmentPeriodsByClassId(targetClassId, reqUser)
  ]);

  const selectedSessions = selectSourceSessionsForEnrollmentMove({
    sourcePeriod,
    sourceSessions,
    moveStartDate,
    personId
  });

  if (!selectedSessions.length) {
    blockers.push({
      code: 'NO_SESSIONS_TO_MOVE',
      message: 'No future 1-on-1 sessions to move from the move start date.'
    });
    return { blockers, warnings, notices, sessionTransferPlan: null };
  }

  const targetCapacity = classSessionCapacityService.resolveClassMaxCapacity(targetClass);
  const conflict = scheduleMoveSessionsService.evaluateSessionTransferPlans({
    selectedSessions,
    targetSessions,
    targetCapacity,
    sourcePeriods: [sourcePeriod],
    targetPeriods: Array.isArray(targetPeriods) ? targetPeriods : [],
    cycleStartDate: targetClass?.cycleStartDate,
    cycleEndDate: targetClass?.cycleEndDate
  });

  conflict.blockers.forEach((row) => {
    blockers.push({
      code: row.code,
      message: row.message,
      sessions: row.sessions || []
    });
  });
  notices.push(...(conflict.notices || []));

  if (blockers.length) {
    const teacher = scheduleMoveSessionsService.resolveTargetTeacher(targetClass);
    const firstDate = selectedSessions.length
      ? normalizeDateOnly(selectedSessions[0]?.date || '')
      : moveStartDate;
    return {
      blockers,
      warnings,
      notices,
      sessionTransferPlan: {
        sourceSessionIds: selectedSessions.map((s) => scheduleMoveSessionsService.sessionIdentity(s)),
        plans: conflict.plans || [],
        masterScheduleUrl: buildMasterScheduleUrl({
          personId: teacher.teacherId,
          date: firstDate,
          classId: targetClassId
        })
      }
    };
  }

  const teacherConflict = await detectTeacherScheduleConflictsForTransfer({
    targetClass,
    sessionPlans: conflict.plans,
    sourceSessions,
    reqUser
  });
  if (teacherConflict.hasConflicts) {
    const teacher = scheduleMoveSessionsService.resolveTargetTeacher(targetClass);
    const firstConflictDate = teacherConflict.conflicts?.[0]?.date
      || normalizeDateOnly(selectedSessions[0]?.date || '');
    blockers.push({
      code: 'TARGET_TEACHER_SCHEDULE_CONFLICT',
      message: teacherConflict.message,
      conflicts: teacherConflict.conflicts
    });
    return {
      blockers,
      warnings,
      notices,
      sessionTransferPlan: {
        sourceSessionIds: selectedSessions.map((s) => scheduleMoveSessionsService.sessionIdentity(s)),
        plans: conflict.plans || [],
        masterScheduleUrl: buildMasterScheduleUrl({
          personId: teacher.teacherId,
          date: firstConflictDate,
          classId: targetClassId
        })
      },
      teacherScheduleConflicts: teacherConflict
    };
  }

  const targetUnmarkSessionIds = scheduleMoveSessionsService.resolveTargetUnmarkSessionIdsFromPlans(
    conflict.plans,
    targetSessions
  );

  const sessionTransferPlan = {
    sourceSessionIds: selectedSessions.map((s) => scheduleMoveSessionsService.sessionIdentity(s)),
    plans: conflict.plans || [],
    createCount: (conflict.plans || []).filter((row) => row.action === 'create').length,
    reuseCount: (conflict.plans || []).filter((row) => row.action === 'reuse').length,
    targetUnmarkSessionIds,
    masterScheduleUrl: buildMasterScheduleUrl({
      personId: scheduleMoveSessionsService.resolveTargetTeacher(targetClass).teacherId,
      date: moveStartDate,
      classId: targetClassId
    })
  };

  warnings.push({
    code: 'SESSION_TRANSFER',
    message: `Move ${selectedSessions.length} session(s) to ${String(targetClass?.title || targetClassId).trim()} and enroll the student on those sessions.`
  });

  return {
    blockers,
    warnings,
    notices,
    sessionTransferPlan
  };
}

function __setDependenciesForTest(nextDeps = {}) {
  dependencies = { ...dependencies, ...nextDeps };
}

function __resetDependenciesForTest() {
  dependencies = { schoolDataService };
}

module.exports = {
  normalizeDateOnly,
  requiresIntegratedSessionMove,
  selectSourceSessionsForEnrollmentMove,
  planOneOnOneEnrollmentMove,
  buildMasterScheduleUrl,
  detectTeacherScheduleConflictsForTransfer,
  __setDependenciesForTest,
  __resetDependenciesForTest
};
