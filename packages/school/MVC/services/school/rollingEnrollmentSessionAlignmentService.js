const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const attendanceMatrixMetricsService = require('./attendanceMatrixMetricsService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
const sessionDeliveryTeamService = require('./sessionDeliveryTeamService');
const sessionIdService = require('./sessionIdService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function resolveSchoolDataService() {
  return require('./schoolDataService');
}

const DAY_NAME_TO_INDEX = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6
};

function cleanText(value) {
  return String(value || '').trim();
}

function normalizeDateOnly(value) {
  const token = cleanText(value);
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function getSessionId(session = {}, fallback = '') {
  return toPublicId(session.sessionId || session.id || fallback);
}

function getSessionDate(session = {}) {
  return normalizeDateOnly(session.date || session.sessionDate || session.startDate);
}

function getSessionSortKey(session = {}, index = 0) {
  return [
    getSessionDate(session) || '9999-12-31',
    cleanText(session.startTime || session.start || ''),
    String(index).padStart(6, '0')
  ].join('|');
}

function dateInWindow(date, startDate, endDate) {
  const d = normalizeDateOnly(date);
  const start = normalizeDateOnly(startDate);
  const end = normalizeDateOnly(endDate) || '9999-12-31';
  if (!d || !start) return false;
  return start <= d && d <= end;
}

function normalizeDaysOfWeek(input) {
  if (Array.isArray(input)) {
    return input
      .map((row) => {
        if (typeof row === 'number' && row >= 0 && row <= 6) return row;
        const name = cleanText(row);
        if (Object.prototype.hasOwnProperty.call(DAY_NAME_TO_INDEX, name)) return DAY_NAME_TO_INDEX[name];
        const parsed = Number.parseInt(name, 10);
        return Number.isFinite(parsed) && parsed >= 0 && parsed <= 6 ? parsed : null;
      })
      .filter((row) => row !== null);
  }
  return [];
}

function sanitizePlannedNaSessionIds(input) {
  const rows = Array.isArray(input) ? input : [];
  const out = [];
  const seen = new Set();
  rows.forEach((row) => {
    const id = toPublicId(row);
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
    if (out.length >= 200) return;
  });
  return out;
}

function classifySessionForWindow(session = {}, { startDate, endDate, statusMap, forceNaKeys } = {}) {
  const sessionId = getSessionId(session);
  const date = getSessionDate(session);
  const inWindow = dateInWindow(date, startDate, endDate);
  const excluded = sessionStatusPolicyService.shouldExcludeFromAttendanceByMap(statusMap, {
    status: session?.status,
    notes: session?.notes
  });
  const forceNa = forceNaKeys instanceof Set
    && (forceNaKeys.has(sessionId) || forceNaKeys.has(date));
  const countable = inWindow && !excluded && !forceNa;
  let excludeReason = '';
  if (!inWindow) excludeReason = 'out_of_window';
  else if (forceNa) excludeReason = 'makeup_required';
  else if (excluded) excludeReason = 'excluded_from_attendance';

  return {
    sessionId,
    date,
    startTime: cleanText(session.startTime || session.start || ''),
    endTime: cleanText(session.endTime || session.end || ''),
    status: cleanText(session.status || 'scheduled'),
    room: cleanText(session.room || ''),
    durationHours: classEnrollmentSessionApplicabilityService.resolveSessionDurationHours(session),
    inWindow,
    countable,
    excludeReason
  };
}

function listSessionsInWindow({ sessions = [], startDate = '', endDate = '', statusMap = {} } = {}) {
  const forceNaKeys = sessionStatusPolicyService.buildForceNotApplicableAttendanceSessionKeys(statusMap, sessions);
  const rows = (Array.isArray(sessions) ? sessions : [])
    .map((session, index) => ({
      session,
      index,
      sortKey: getSessionSortKey(session, index)
    }))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .map(({ session }) => classifySessionForWindow(session, { startDate, endDate, statusMap, forceNaKeys }))
    .filter((row) => row.inWindow);

  const countableSessions = rows.filter((row) => row.countable);
  return {
    sessions: rows,
    countableSessions,
    availableCount: countableSessions.length
  };
}

function sumCountableHours(countableSessions = []) {
  return classEnrollmentSessionApplicabilityService.roundTargetHours(
    (Array.isArray(countableSessions) ? countableSessions : [])
      .reduce((sum, row) => sum + Number(row?.durationHours || 0), 0)
  );
}

function computeHourAllocation(countableSessions = [], targetHours = 0) {
  const target = classEnrollmentSessionApplicabilityService.normalizeTargetHours(targetHours);
  if (!target) {
    return { allocatedSessionCount: 0, allocatedHours: 0, gapHours: 0 };
  }
  let allocatedHours = 0;
  let allocatedSessionCount = 0;
  (Array.isArray(countableSessions) ? countableSessions : []).forEach((row) => {
    if (allocatedHours >= target) return;
    const hours = Number(row?.durationHours || 0);
    allocatedSessionCount += 1;
    allocatedHours = classEnrollmentSessionApplicabilityService.roundTargetHours(allocatedHours + hours);
  });
  return {
    allocatedSessionCount,
    allocatedHours,
    gapHours: Math.max(0, classEnrollmentSessionApplicabilityService.roundTargetHours(target - allocatedHours))
  };
}

function evaluateHourAlignment({
  sessions = [],
  startDate = '',
  endDate = '',
  targetHours = 0,
  statusMap = {}
} = {}) {
  const normalizedStart = normalizeDateOnly(startDate);
  const normalizedEnd = normalizeDateOnly(endDate);
  const target = classEnrollmentSessionApplicabilityService.normalizeTargetHours(targetHours);
  if (!target) {
    return {
      availableCount: 0,
      availableHours: 0,
      sessions: [],
      countableSessions: [],
      alignmentStatus: 'no_end_date',
      requiredNaCount: 0,
      requiredNaHours: 0,
      gapCount: 0,
      gapHours: 0,
      effectiveTarget: 0,
      effectiveTargetHours: 0,
      allocatedSessionCount: 0,
      allocatedHours: 0
    };
  }

  if (!normalizedEnd) {
    const listed = listSessionsInWindow({
      sessions,
      startDate: normalizedStart,
      endDate: '',
      statusMap
    });
    const availableHours = sumCountableHours(listed.countableSessions);
    const allocation = computeHourAllocation(listed.countableSessions, target);
    let alignmentStatus = 'ok';
    let gapHours = 0;
    let requiredNaHours = 0;

    if (availableHours < target) {
      alignmentStatus = 'insufficient_hours';
      gapHours = classEnrollmentSessionApplicabilityService.roundTargetHours(target - availableHours);
    } else if (availableHours > target) {
      alignmentStatus = 'overage_requires_na';
      requiredNaHours = classEnrollmentSessionApplicabilityService.roundTargetHours(availableHours - target);
    }

    return {
      availableCount: listed.availableCount,
      availableHours,
      sessions: listed.sessions,
      countableSessions: listed.countableSessions,
      alignmentStatus,
      requiredNaCount: 0,
      requiredNaHours,
      gapCount: 0,
      gapHours,
      effectiveTarget: 0,
      effectiveTargetHours: target,
      allocatedSessionCount: allocation.allocatedSessionCount,
      allocatedHours: allocation.allocatedHours
    };
  }

  const listed = listSessionsInWindow({
    sessions,
    startDate: normalizedStart,
    endDate: normalizedEnd,
    statusMap
  });
  const availableHours = sumCountableHours(listed.countableSessions);
  const allocation = computeHourAllocation(listed.countableSessions, target);
  let alignmentStatus = 'ok';
  let gapHours = 0;
  let requiredNaHours = 0;

  if (availableHours < target) {
    alignmentStatus = 'insufficient_hours';
    gapHours = classEnrollmentSessionApplicabilityService.roundTargetHours(target - availableHours);
  } else if (availableHours > target) {
    alignmentStatus = 'overage_requires_na';
    requiredNaHours = classEnrollmentSessionApplicabilityService.roundTargetHours(availableHours - target);
  }

  return {
    availableCount: listed.availableCount,
    availableHours,
    sessions: listed.sessions,
    countableSessions: listed.countableSessions,
    alignmentStatus,
    requiredNaCount: 0,
    requiredNaHours,
    gapCount: 0,
    gapHours,
    effectiveTarget: 0,
    effectiveTargetHours: target,
    allocatedSessionCount: allocation.allocatedSessionCount,
    allocatedHours: allocation.allocatedHours
  };
}

function evaluateAlignment({
  sessions = [],
  startDate = '',
  endDate = '',
  targetSessionCount = 0,
  targetHours = 0,
  statusMap = {}
} = {}) {
  const hourTarget = classEnrollmentSessionApplicabilityService.normalizeTargetHours(targetHours);
  if (hourTarget > 0) {
    return evaluateHourAlignment({
      sessions,
      startDate,
      endDate,
      targetHours: hourTarget,
      statusMap
    });
  }

  const normalizedStart = normalizeDateOnly(startDate);
  const normalizedEnd = normalizeDateOnly(endDate);
  const target = classEnrollmentSessionApplicabilityService.normalizeTargetSessionCount(targetSessionCount);

  if (!normalizedEnd) {
    if (target <= 0) {
      return {
        availableCount: 0,
        availableHours: 0,
        sessions: [],
        countableSessions: [],
        alignmentStatus: 'no_end_date',
        requiredNaCount: 0,
        requiredNaHours: 0,
        gapCount: 0,
        gapHours: 0,
        effectiveTarget: target,
        effectiveTargetHours: 0,
        allocatedSessionCount: 0,
        allocatedHours: 0
      };
    }

    const listed = listSessionsInWindow({
      sessions,
      startDate: normalizedStart,
      endDate: '',
      statusMap
    });
    const availableCount = listed.availableCount;
    const effectiveTarget = target;
    let alignmentStatus = 'ok';
    let gapCount = 0;

    if (availableCount < effectiveTarget) {
      alignmentStatus = 'insufficient_sessions';
      gapCount = effectiveTarget - availableCount;
    }

    return {
      availableCount,
      availableHours: 0,
      sessions: listed.sessions,
      countableSessions: listed.countableSessions,
      alignmentStatus,
      requiredNaCount: 0,
      requiredNaHours: 0,
      gapCount,
      gapHours: 0,
      effectiveTarget,
      effectiveTargetHours: 0,
      allocatedSessionCount: 0,
      allocatedHours: 0
    };
  }

  const listed = listSessionsInWindow({
    sessions,
    startDate: normalizedStart,
    endDate: normalizedEnd,
    statusMap
  });
  const availableCount = listed.availableCount;
  const effectiveTarget = target > 0 ? target : availableCount;

  let alignmentStatus = 'ok';
  let requiredNaCount = 0;
  let gapCount = 0;

  if (availableCount === 0 || effectiveTarget > availableCount) {
    alignmentStatus = 'insufficient_sessions';
    gapCount = Math.max(0, effectiveTarget - availableCount);
  } else if (effectiveTarget > 0 && effectiveTarget < availableCount) {
    alignmentStatus = 'overage_requires_na';
    requiredNaCount = availableCount - effectiveTarget;
  }

  return {
    availableCount,
    availableHours: sumCountableHours(listed.countableSessions),
    sessions: listed.sessions,
    countableSessions: listed.countableSessions,
    alignmentStatus,
    requiredNaCount,
    requiredNaHours: 0,
    gapCount,
    gapHours: 0,
    effectiveTarget,
    effectiveTargetHours: 0,
    allocatedSessionCount: 0,
    allocatedHours: 0
  };
}

function resolveDisplayHourTarget({
  sessions = [],
  startDate = '',
  endDate = '',
  targetHours = 0,
  statusMap = {}
} = {}) {
  const target = classEnrollmentSessionApplicabilityService.normalizeTargetHours(targetHours);
  if (target <= 0) {
    return {
      targetHours: 0,
      effectiveTargetHours: null,
      allocatedSessionCount: null,
      targetSource: 'none'
    };
  }
  const alignment = evaluateHourAlignment({
    sessions,
    startDate,
    endDate,
    targetHours: target,
    statusMap
  });
  return {
    targetHours: target,
    effectiveTargetHours: target,
    allocatedSessionCount: alignment.allocatedSessionCount,
    allocatedHours: alignment.allocatedHours,
    targetSource: 'explicit_hours'
  };
}

function resolveDisplaySessionTarget({
  sessions = [],
  startDate = '',
  endDate = '',
  targetSessionCount = 0,
  statusMap = {}
} = {}) {
  const target = classEnrollmentSessionApplicabilityService.normalizeTargetSessionCount(targetSessionCount);
  if (target > 0) {
    return {
      targetSessionCount: target,
      effectiveTargetSessionCount: target,
      windowSessionCount: null,
      targetSource: 'explicit'
    };
  }
  const normalizedEnd = normalizeDateOnly(endDate);
  if (!normalizedEnd) {
    return {
      targetSessionCount: 0,
      effectiveTargetSessionCount: null,
      windowSessionCount: null,
      targetSource: 'none'
    };
  }
  const alignment = evaluateAlignment({
    sessions,
    startDate,
    endDate,
    targetSessionCount: 0,
    statusMap
  });
  return {
    targetSessionCount: 0,
    effectiveTargetSessionCount: alignment.effectiveTarget,
    windowSessionCount: alignment.availableCount,
    targetSource: 'date_window'
  };
}

function validatePlannedNaSelection({
  countableSessions = [],
  targetSessionCount = 0,
  targetHours = 0,
  plannedNaSessionIds = [],
  sessionsById = null
} = {}) {
  const hourTarget = classEnrollmentSessionApplicabilityService.normalizeTargetHours(targetHours);
  if (hourTarget > 0) {
    return validatePlannedNaSelectionForHours({
      countableSessions,
      targetHours: hourTarget,
      plannedNaSessionIds,
      sessionsById
    });
  }

  const target = classEnrollmentSessionApplicabilityService.normalizeTargetSessionCount(targetSessionCount);
  const availableCount = (Array.isArray(countableSessions) ? countableSessions : []).length;
  const requiredNaCount = target > 0 && availableCount > target ? availableCount - target : 0;
  const ids = sanitizePlannedNaSessionIds(plannedNaSessionIds);

  if (requiredNaCount === 0) {
    if (ids.length) {
      return { valid: false, message: 'No N/A session selection is required for this enrollment.' };
    }
    return { valid: true, plannedNaSessionIds: [] };
  }

  if (ids.length !== requiredNaCount) {
    return {
      valid: false,
      message: `Select exactly ${requiredNaCount} session(s) to mark N/A.`
    };
  }

  const allowed = new Set(
    (Array.isArray(countableSessions) ? countableSessions : []).map((row) => toPublicId(row.sessionId)).filter(Boolean)
  );
  const invalid = ids.filter((id) => !allowed.has(id));
  if (invalid.length) {
    return { valid: false, message: 'One or more selected sessions are not countable sessions in this enrollment window.' };
  }

  return { valid: true, plannedNaSessionIds: ids };
}

function resolveCountableSessionHours(row = {}, sessionsById = null) {
  const sessionId = toPublicId(row?.sessionId);
  if (sessionsById instanceof Map && sessionId && sessionsById.has(sessionId)) {
    return classEnrollmentSessionApplicabilityService.resolveSessionDurationHours(sessionsById.get(sessionId));
  }
  if (Number.isFinite(Number(row?.durationHours)) && Number(row.durationHours) > 0) {
    return Number(row.durationHours);
  }
  return classEnrollmentSessionApplicabilityService.resolveSessionDurationHours(row);
}

function validatePlannedNaSelectionForHours({
  countableSessions = [],
  targetHours = 0,
  plannedNaSessionIds = [],
  sessionsById = null
} = {}) {
  const target = classEnrollmentSessionApplicabilityService.normalizeTargetHours(targetHours);
  const rows = Array.isArray(countableSessions) ? countableSessions : [];
  const availableHours = sumCountableHours(rows);
  const requiredNaHours = target > 0 && availableHours > target
    ? classEnrollmentSessionApplicabilityService.roundTargetHours(availableHours - target)
    : 0;
  const ids = sanitizePlannedNaSessionIds(plannedNaSessionIds);

  if (requiredNaHours <= 0) {
    if (ids.length) {
      return { valid: false, message: 'No N/A session selection is required for this enrollment.' };
    }
    return { valid: true, plannedNaSessionIds: [] };
  }

  const allowed = new Set(rows.map((row) => toPublicId(row.sessionId)).filter(Boolean));
  const invalid = ids.filter((id) => !allowed.has(id));
  if (invalid.length) {
    return { valid: false, message: 'One or more selected sessions are not countable sessions in this enrollment window.' };
  }

  let selectedHours = 0;
  ids.forEach((id) => {
    const row = rows.find((item) => idsEqual(item.sessionId, id));
    if (row) selectedHours = classEnrollmentSessionApplicabilityService.roundTargetHours(
      selectedHours + resolveCountableSessionHours(row, sessionsById)
    );
  });

  if (selectedHours < requiredNaHours) {
    return {
      valid: false,
      message: `Select sessions totaling at least ${requiredNaHours} hour(s) to mark N/A (selected ${selectedHours} hr).`
    };
  }

  return { valid: true, plannedNaSessionIds: ids };
}

function extractScheduleDefaults(classData = {}) {
  const schedule = classData?.schedule?.current && typeof classData.schedule.current === 'object'
    ? classData.schedule.current
    : {};
  const daysOfWeek = normalizeDaysOfWeek(schedule.daysOfWeek);
  return {
    daysOfWeek,
    dayNames: daysOfWeek.map((idx) => Object.keys(DAY_NAME_TO_INDEX).find((name) => DAY_NAME_TO_INDEX[name] === idx)).filter(Boolean),
    startTime: cleanText(schedule.startTime || ''),
    endTime: cleanText(schedule.endTime || ''),
    room: cleanText(schedule.room || classData?.room || ''),
    exceptionDates: Array.isArray(schedule.exceptionDates)
      ? schedule.exceptionDates.map((row) => normalizeDateOnly(row)).filter(Boolean)
      : []
  };
}

function computeDurationHours(startTime, endTime) {
  return classEnrollmentSessionApplicabilityService.computeDurationHoursFromTimes(startTime, endTime);
}

function resolveSessionDurationHours(session = {}) {
  return classEnrollmentSessionApplicabilityService.resolveSessionDurationHours(session);
}

function isTargetHoursEnforced(targetHours = 0) {
  return classEnrollmentSessionApplicabilityService.normalizeTargetHours(targetHours) > 0;
}

function buildNextSessionId(classId, existingSessions = []) {
  return sessionIdService.buildNextSessionId(classId, existingSessions);
}

function collectRollingSessionDateViolations({
  registrationMode = 'term_based',
  cycleStartDate = '',
  cycleEndDate = '',
  sessions = []
} = {}) {
  const mode = String(registrationMode || '').trim().toLowerCase();
  if (mode !== 'rolling') return [];

  const normalizedStart = normalizeDateOnly(cycleStartDate);
  const normalizedEnd = normalizeDateOnly(cycleEndDate);
  const rows = Array.isArray(sessions) ? sessions : [];
  const violations = [];

  if (!normalizedStart) {
    violations.push({
      type: 'missing_cycle_start',
      message: 'Cycle Start Date is required for rolling classes before generating/saving sessions.'
    });
    return violations;
  }

  rows.forEach((row, index) => {
    const dateToken = String(row?.date || '').trim();
    if (!dateToken) return;
    const normalizedDate = normalizeDateOnly(dateToken);
    if (!normalizedDate) {
      violations.push({ type: 'invalid_session_date', index, date: dateToken, sessionId: getSessionId(row) });
      return;
    }
    if (normalizedDate < normalizedStart || (normalizedEnd && normalizedDate > normalizedEnd)) {
      violations.push({ type: 'out_of_cycle_window', index, date: normalizedDate, sessionId: getSessionId(row) });
    }
  });

  return violations;
}

function assertRollingSessionsWithinCycleWindowOrThrow(input = {}) {
  const violations = collectRollingSessionDateViolations(input);
  if (!violations.length) return;
  const missingCycleStart = violations.find((row) => row.type === 'missing_cycle_start');
  if (missingCycleStart) {
    throw new Error(String(missingCycleStart.message || 'Cycle Start Date is required for rolling classes.'));
  }
  const outsideRows = violations.filter((row) => row.type === 'out_of_cycle_window');
  const outsideSample = outsideRows.slice(0, 5).map((row) => {
    const sid = String(row?.sessionId || '').trim();
    return sid ? `${row.date} (${sid})` : row.date;
  }).join(', ');
  const outsideSuffix = outsideRows.length > 5 ? ` (+${outsideRows.length - 5} more)` : '';
  throw new Error(`Rolling class sessions must stay within cycle dates. Out-of-window session date(s): ${outsideSample}${outsideSuffix}.`);
}

function resolveDefaultTeacherFromClass(classData = {}, batchSpec = {}) {
  const fromSpecId = toPublicId(batchSpec.teacherId);
  if (fromSpecId) {
    return {
      teacherId: fromSpecId,
      teacherName: cleanText(batchSpec.teacherName)
    };
  }
  const fromPrimary = toPublicId(classData?.primaryTeacherId);
  if (fromPrimary) {
    return { teacherId: fromPrimary, teacherName: '' };
  }
  const instructors = Array.isArray(classData?.instructors) ? classData.instructors : [];
  const active = instructors.find((row) => String(row?.status || '').trim().toLowerCase() === 'active') || instructors[0] || null;
  return {
    teacherId: toPublicId(active?.personId),
    teacherName: cleanText(active?.name || '')
  };
}

function generateBatchSessionRows({
  classData = {},
  existingSessions = [],
  batchSpec = {}
} = {}) {
  const startDate = normalizeDateOnly(batchSpec.startDate);
  const endDate = normalizeDateOnly(batchSpec.endDate);
  if (!startDate || !endDate) throw new Error('startDate and endDate are required for batch session generation.');
  if (startDate > endDate) throw new Error('startDate must be on or before endDate.');

  const defaults = extractScheduleDefaults(classData);
  const daysOfWeek = normalizeDaysOfWeek(batchSpec.daysOfWeek).length
    ? normalizeDaysOfWeek(batchSpec.daysOfWeek)
    : defaults.daysOfWeek;
  if (!daysOfWeek.length) throw new Error('At least one weekday must be selected.');

  const startTime = cleanText(batchSpec.startTime || defaults.startTime);
  const endTime = cleanText(batchSpec.endTime || defaults.endTime);
  if (!startTime || !endTime) throw new Error('Start time and end time are required.');

  const exceptions = new Set(
    [
      ...(Array.isArray(defaults.exceptionDates) ? defaults.exceptionDates : []),
      ...(Array.isArray(batchSpec.exceptionDates) ? batchSpec.exceptionDates : [])
    ].map((row) => normalizeDateOnly(row)).filter(Boolean)
  );

  const existingDates = new Set(
    (Array.isArray(existingSessions) ? existingSessions : [])
      .map((row) => getSessionDate(row))
      .filter(Boolean)
  );

  const skipExistingDates = batchSpec.skipExistingDates !== false;
  const durationHours = computeDurationHours(startTime, endTime);
  const room = cleanText(batchSpec.room || defaults.room);
  const defaultStatus = cleanText(batchSpec.status || 'scheduled') || 'scheduled';
  const resolvedTeacher = resolveDefaultTeacherFromClass(classData, batchSpec);
  const teacherId = resolvedTeacher.teacherId;
  const teacherName = cleanText(batchSpec.teacherName || resolvedTeacher.teacherName);

  const created = [];
  const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
  const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
  const current = new Date(startYear, startMonth - 1, startDay);
  const end = new Date(endYear, endMonth - 1, endDay);

  while (current <= end) {
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, '0');
    const d = String(current.getDate()).padStart(2, '0');
    const dateString = `${y}-${m}-${d}`;
    if (daysOfWeek.includes(current.getDay()) && !exceptions.has(dateString)) {
      if (!skipExistingDates || !existingDates.has(dateString)) {
        created.push({
          sessionId: buildNextSessionId(classData?.id, [...(Array.isArray(existingSessions) ? existingSessions : []), ...created]),
          date: dateString,
          originalDate: dateString,
          startTime,
          endTime,
          durationHours,
          room,
          status: defaultStatus,
          notes: '',
          locked: false,
          delivery: {
            deliveredBy: teacherId || null,
            deliveredByName: teacherName || '',
            substitute: false,
            coTeachers: []
          },
          roster: []
        });
        existingDates.add(dateString);
      }
    }
    current.setDate(current.getDate() + 1);
  }

  return created;
}

function computeLatestSessionDate(sessions = []) {
  const rows = Array.isArray(sessions) ? sessions : [];
  let latest = '';
  rows.forEach((row) => {
    const dateToken = getSessionDate(row);
    if (dateToken && (!latest || dateToken > latest)) latest = dateToken;
  });
  return latest;
}

function computeProposedCycleEndDate({ cycleEndDate = '', sessions = [] } = {}) {
  const currentEnd = normalizeDateOnly(cycleEndDate);
  const latestSessionDate = computeLatestSessionDate(sessions);
  if (!latestSessionDate) return currentEnd;
  if (!currentEnd || latestSessionDate > currentEnd) return latestSessionDate;
  return currentEnd;
}

function isTargetSessionCountEnforced(targetSessionCount = 0) {
  const target = classEnrollmentSessionApplicabilityService.normalizeTargetSessionCount(targetSessionCount);
  return target >= 1;
}

async function appendBatchSessions({ classData, batchSpec = {}, reqUser, extendCycleEndDate = false } = {}) {
  if (!classData?.id) throw new Error('classData.id is required.');
  const schoolDataService = resolveSchoolDataService();
  const existingSessions = await schoolDataService.getClassSessions(classData.id, reqUser);
  const created = generateBatchSessionRows({ classData, existingSessions, batchSpec });
  if (!created.length) {
    return {
      createdCount: 0,
      sessions: existingSessions,
      createdSessions: [],
      cycleEndDateExtended: false,
      previousCycleEndDate: normalizeDateOnly(classData?.cycleEndDate),
      newCycleEndDate: normalizeDateOnly(classData?.cycleEndDate)
    };
  }

  const nextSessions = [...(Array.isArray(existingSessions) ? existingSessions : []), ...created];
  let workingClassData = { ...classData };
  const previousCycleEndDate = normalizeDateOnly(workingClassData?.cycleEndDate);
  const proposedCycleEndDate = computeProposedCycleEndDate({
    cycleEndDate: previousCycleEndDate,
    sessions: nextSessions
  });
  let cycleEndDateExtended = false;

  if (proposedCycleEndDate && proposedCycleEndDate !== previousCycleEndDate) {
    if (!extendCycleEndDate) {
      throw new Error(`New sessions extend beyond the cycle end date (${previousCycleEndDate || 'not set'}). Confirm cycle extension to add sessions through ${proposedCycleEndDate}.`);
    }
    workingClassData = await schoolDataService.updateData('classes', classData.id, {
      cycleEndDate: proposedCycleEndDate
    }, reqUser);
    cycleEndDateExtended = true;
  }

  assertRollingSessionsWithinCycleWindowOrThrow({
    registrationMode: workingClassData?.registrationMode,
    cycleStartDate: workingClassData?.cycleStartDate,
    cycleEndDate: workingClassData?.cycleEndDate,
    sessions: nextSessions
  });

  const saved = await schoolDataService.saveClassSessions(classData.id, nextSessions, reqUser);
  return {
    createdCount: created.length,
    sessions: saved,
    createdSessions: created,
    cycleEndDateExtended,
    previousCycleEndDate,
    newCycleEndDate: normalizeDateOnly(workingClassData?.cycleEndDate),
    classData: workingClassData
  };
}

/**
 * Remove a person from session rosters for enrollment-excluded sessions
 * (Manage enrollment sessions / rolling planned N/A). Does not write teacher N/A rows.
 */
function removePersonFromExcludedSessionRosters(sessions = [], personId = '', sessionIds = []) {
  const personToken = toPublicId(personId);
  const idSet = new Set(sanitizePlannedNaSessionIds(sessionIds));
  let updatedCount = 0;
  if (!personToken || !idSet.size) {
    return { nextSessions: Array.isArray(sessions) ? sessions : [], updatedCount: 0 };
  }
  const nextSessions = (Array.isArray(sessions) ? sessions : []).map((session) => {
    const sessionId = getSessionId(session);
    if (!idSet.has(sessionId)) return session;
    const roster = Array.isArray(session.roster) ? session.roster : [];
    const filtered = roster.filter((row) => !idsEqual(row?.personId, personToken));
    if (filtered.length === roster.length) return session;
    updatedCount += 1;
    return { ...session, roster: filtered };
  });
  return { nextSessions, updatedCount };
}

function filterSessionsInEnrollmentWindow(sessions = [], startDate = '', endDate = '') {
  const normalizedStart = normalizeDateOnly(startDate);
  const normalizedEnd = normalizeDateOnly(endDate);
  if (!normalizedStart) return [];
  return (Array.isArray(sessions) ? sessions : []).filter((session) => {
    const sessionDate = normalizeDateOnly(session?.date || session?.sessionDate || session?.startDate);
    if (!sessionDate) return false;
    if (sessionDate < normalizedStart) return false;
    if (normalizedEnd && sessionDate > normalizedEnd) return false;
    return true;
  });
}

function computeOneOnOneExcludedSessionIds({
  sessions = [],
  startDate = '',
  endDate = '',
  activeSessionIds = []
} = {}) {
  const activeSet = new Set(sanitizePlannedNaSessionIds(activeSessionIds));
  return sanitizePlannedNaSessionIds(
    filterSessionsInEnrollmentWindow(sessions, startDate, endDate)
      .map((session) => getSessionId(session))
      .filter((sessionId) => sessionId && !activeSet.has(sessionId))
  );
}

async function purgePersonFromEnrollmentWindowRosters({
  classId,
  personId,
  startDate = '',
  endDate = '',
  reqUser
} = {}) {
  const classToken = toPublicId(classId);
  const personToken = toPublicId(personId);
  if (!classToken || !personToken) return { updatedCount: 0, sessionIds: [] };

  const schoolDataService = resolveSchoolDataService();
  const sessions = await schoolDataService.getClassSessions(classToken, reqUser);
  const sessionIds = filterSessionsInEnrollmentWindow(sessions, startDate, endDate)
    .map((session) => getSessionId(session))
    .filter(Boolean);
  const { nextSessions, updatedCount } = removePersonFromExcludedSessionRosters(
    sessions,
    personToken,
    sessionIds
  );
  if (updatedCount > 0) {
    await schoolDataService.saveClassSessions(classToken, nextSessions, reqUser);
  }
  return { updatedCount, sessionIds };
}

async function materializePlannedNaAttendance({ classId, personId, sessionIds = [], reqUser } = {}) {
  const classToken = toPublicId(classId);
  const personToken = toPublicId(personId);
  const targetIds = sanitizePlannedNaSessionIds(sessionIds);
  if (!classToken || !personToken || !targetIds.length) {
    return { updatedCount: 0, sessionIds: [] };
  }

  const schoolDataService = resolveSchoolDataService();
  const sessions = await schoolDataService.getClassSessions(classToken, reqUser);
  const { nextSessions, updatedCount } = removePersonFromExcludedSessionRosters(
    sessions,
    personToken,
    targetIds
  );

  if (updatedCount > 0) {
    await schoolDataService.saveClassSessions(classToken, nextSessions, reqUser);
    const classData = await schoolDataService.getDataById('classes', classToken, reqUser);
    if (classData) {
      await classEnrollmentSessionApplicabilityService.recomputeSessionCappedEnrollmentCompletionsForClass({
        classData,
        sessions: nextSessions,
        reqUser,
        activeOrgId: classData?.orgId || reqUser?.activeOrgId || ''
      });
    }
  }

  return { updatedCount, sessionIds: targetIds };
}

function parsePlannedNaSessionIdsFromBody(body = {}) {
  const raw = body?.plannedNotApplicableSessionIds ?? body?.plannedNaSessionIds ?? [];
  if (Array.isArray(raw)) return sanitizePlannedNaSessionIds(raw);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return sanitizePlannedNaSessionIds(parsed);
    } catch (_) {
      return sanitizePlannedNaSessionIds(raw.split(','));
    }
  }
  return [];
}

function isEnrollmentSessionCountEnforced(classRow = {}) {
  return classRow?.enforceEnrollmentSessionCount === true
    || String(classRow?.enforceEnrollmentSessionCount || '').trim().toLowerCase() === 'true';
}

function assertEnrollmentSessionAlignmentForCreate({
  classData,
  payload = {},
  plannedNaSessionIds = []
} = {}) {
  void classData;
  void plannedNaSessionIds;
  const targetSessionCount = classEnrollmentSessionApplicabilityService.normalizeTargetSessionCount(payload.targetSessionCount);
  const enforced = isTargetSessionCountEnforced(targetSessionCount);
  const result = { ...payload, enforceSessionCount: enforced, targetSessionCount };

  // A target-session enrollment is completed by recorded attendance after its
  // start date, not by reserving a fixed schedule window at creation time.
  return result;
}

function parseGapBatchSpec(source = {}, defaults = {}) {
  const raw = source?.pendingGapBatch ?? source?.gapBatch ?? source?.batchSpec ?? source;
  const body = raw && typeof raw === 'object' ? raw : {};
  const startDate = normalizeDateOnly(body.startDate);
  const endDate = normalizeDateOnly(body.endDate);
  const startTime = cleanText(body.startTime || defaults.startTime || '');
  const endTime = cleanText(body.endTime || defaults.endTime || '');
  const daysOfWeek = normalizeDaysOfWeek(body.daysOfWeek).length
    ? normalizeDaysOfWeek(body.daysOfWeek)
    : normalizeDaysOfWeek(defaults.daysOfWeek);
  if (!startDate || !endDate || !startTime || !endTime || !daysOfWeek.length) return null;
  const skipExistingDates = body.skipExistingDates !== false && String(body.skipExistingDates).toLowerCase() !== 'false';
  return {
    startDate,
    endDate,
    startTime,
    endTime,
    daysOfWeek,
    room: cleanText(body.room || defaults.room || ''),
    teacherId: toPublicId(body.teacherId),
    teacherName: cleanText(body.teacherName || ''),
    exceptionDates: Array.isArray(body.exceptionDates)
      ? body.exceptionDates.map((row) => normalizeDateOnly(row)).filter(Boolean)
      : [],
    skipExistingDates,
    status: cleanText(body.status || 'scheduled') || 'scheduled',
    extendCycleEndDate: body.extendCycleEndDate === true || String(body.extendCycleEndDate).toLowerCase() === 'true'
  };
}

async function previewGapBatchSessions({ classData, batchSpec = {}, reqUser, additionalSessions = [] } = {}) {
  if (!classData?.id) throw new Error('classData.id is required.');
  const schoolDataService = resolveSchoolDataService();
  const existingSessions = await schoolDataService.getClassSessions(classData.id, reqUser);
  const stagedSessions = Array.isArray(additionalSessions) ? additionalSessions : [];
  const mergedExistingSessions = [...existingSessions, ...stagedSessions];
  const proposedSessions = generateBatchSessionRows({
    classData,
    existingSessions: mergedExistingSessions,
    batchSpec
  });
  return {
    createdCount: proposedSessions.length,
    proposedSessions,
    existingSessions: mergedExistingSessions
  };
}

async function commitGapBatchSessions({ classData, batchSpec = {}, reqUser, extendCycleEndDate = false } = {}) {
  return appendBatchSessions({ classData, batchSpec, reqUser, extendCycleEndDate });
}

function sanitizeStagedSessionRow(session = {}, index = 0) {
  const date = normalizeDateOnly(session?.date || session?.sessionDate);
  const startTime = cleanText(session?.startTime || session?.start || '');
  const endTime = cleanText(session?.endTime || session?.end || '');
  if (!date || !startTime || !endTime) return null;
  const sessionId = getSessionId(session, `STAGED_${String(index + 1).padStart(3, '0')}`);
  const teacherId = toPublicId(session?.delivery?.deliveredBy || session?.teacherId || '');
  const teacherName = cleanText(session?.delivery?.deliveredByName || session?.teacherName || '');
  const coTeachers = sessionDeliveryTeamService.normalizeSessionCoTeachers(
    session?.delivery?.coTeachers || session?.coTeachers,
    { mainTeacherId: teacherId || '' }
  );
  return {
    sessionId,
    date,
    originalDate: date,
    startTime,
    endTime,
    durationHours: computeDurationHours(startTime, endTime),
    room: cleanText(session?.room || ''),
    status: cleanText(session?.status || 'scheduled') || 'scheduled',
    notes: '',
    locked: false,
    delivery: {
      deliveredBy: teacherId || null,
      deliveredByName: teacherName,
      substitute: false,
      coTeachers
    },
    roster: Array.isArray(session?.roster) ? session.roster : []
  };
}

function parsePendingStagedSessions(source = {}) {
  let raw = source?.pendingStagedSessions ?? source?.stagedSessions ?? [];
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch (_) {
      raw = [];
    }
  }
  const rows = Array.isArray(raw) ? raw : [];
  return rows.map((row, index) => sanitizeStagedSessionRow(row, index)).filter(Boolean);
}

function sessionScheduleKey(session = {}) {
  return [
    normalizeDateOnly(session?.date),
    cleanText(session?.startTime || session?.start || ''),
    cleanText(session?.endTime || session?.end || '')
  ].join('|');
}

async function commitStagedSessions({
  classData,
  sessionsToAdd = [],
  reqUser,
  extendCycleEndDate = false
} = {}) {
  if (!classData?.id) throw new Error('classData.id is required.');
  const stagedRows = parsePendingStagedSessions({ pendingStagedSessions: sessionsToAdd });
  if (!stagedRows.length) {
    return {
      createdCount: 0,
      sessions: await resolveSchoolDataService().getClassSessions(classData.id, reqUser),
      createdSessions: [],
      cycleEndDateExtended: false,
      previousCycleEndDate: normalizeDateOnly(classData?.cycleEndDate),
      newCycleEndDate: normalizeDateOnly(classData?.cycleEndDate),
      classData
    };
  }

  const schoolDataService = resolveSchoolDataService();
  const existingSessions = await schoolDataService.getClassSessions(classData.id, reqUser);
  const existingDates = new Set(
    (Array.isArray(existingSessions) ? existingSessions : []).map((row) => getSessionDate(row)).filter(Boolean)
  );
  const existingIds = new Set(
    (Array.isArray(existingSessions) ? existingSessions : []).map((row) => getSessionId(row)).filter(Boolean)
  );
  const working = [...(Array.isArray(existingSessions) ? existingSessions : [])];
  const created = [];

  stagedRows.forEach((row, index) => {
    if (existingDates.has(row.date)) return;
    const nextRow = { ...row };
    if (!getSessionId(nextRow) || existingIds.has(getSessionId(nextRow))) {
      nextRow.sessionId = buildNextSessionId(classData.id, working);
    }
    while (existingIds.has(getSessionId(nextRow))) {
      nextRow.sessionId = buildNextSessionId(classData.id, [...working, ...created, nextRow]);
    }
    created.push(nextRow);
    working.push(nextRow);
    existingDates.add(nextRow.date);
    existingIds.add(getSessionId(nextRow));
  });

  if (!created.length) {
    return {
      createdCount: 0,
      sessions: existingSessions,
      createdSessions: [],
      cycleEndDateExtended: false,
      previousCycleEndDate: normalizeDateOnly(classData?.cycleEndDate),
      newCycleEndDate: normalizeDateOnly(classData?.cycleEndDate),
      classData
    };
  }

  let workingClassData = { ...classData };
  const previousCycleEndDate = normalizeDateOnly(workingClassData?.cycleEndDate);
  const proposedCycleEndDate = computeProposedCycleEndDate({
    cycleEndDate: previousCycleEndDate,
    sessions: working
  });
  let cycleEndDateExtended = false;

  if (proposedCycleEndDate && proposedCycleEndDate !== previousCycleEndDate) {
    if (!extendCycleEndDate) {
      throw new Error(`New sessions extend beyond the cycle end date (${previousCycleEndDate || 'not set'}). Confirm cycle extension to add sessions through ${proposedCycleEndDate}.`);
    }
    workingClassData = await schoolDataService.updateData('classes', classData.id, {
      cycleEndDate: proposedCycleEndDate
    }, reqUser);
    cycleEndDateExtended = true;
  }

  assertRollingSessionsWithinCycleWindowOrThrow({
    registrationMode: workingClassData?.registrationMode,
    cycleStartDate: workingClassData?.cycleStartDate,
    cycleEndDate: workingClassData?.cycleEndDate,
    sessions: working
  });

  const saved = await schoolDataService.saveClassSessions(classData.id, working, reqUser);
  return {
    createdCount: created.length,
    sessions: saved,
    createdSessions: created,
    cycleEndDateExtended,
    previousCycleEndDate,
    newCycleEndDate: normalizeDateOnly(workingClassData?.cycleEndDate),
    classData: workingClassData
  };
}

function resolveAnticipatedFinishDate({
  countableSessions = [],
  targetSessionCount = 0,
  targetHours = 0
} = {}) {
  const rows = (Array.isArray(countableSessions) ? countableSessions : [])
    .map((row) => ({
      date: normalizeDateOnly(row?.date || row?.session?.date || row?.sessionDate || ''),
      durationHours: Number(row?.durationHours || 0)
    }))
    .filter((row) => row.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  const sessionTarget = classEnrollmentSessionApplicabilityService.normalizeTargetSessionCount(targetSessionCount);
  if (sessionTarget > 0) {
    if (rows.length < sessionTarget) return null;
    return rows[sessionTarget - 1].date;
  }

  const hourTarget = classEnrollmentSessionApplicabilityService.normalizeTargetHours(targetHours);
  if (hourTarget > 0) {
    const allocation = computeHourAllocation(rows, hourTarget);
    if (!allocation.allocatedSessionCount || allocation.gapHours > 0) return null;
    return rows[allocation.allocatedSessionCount - 1]?.date || null;
  }

  return null;
}

module.exports = {
  listSessionsInWindow,
  evaluateAlignment,
  evaluateHourAlignment,
  resolveDisplaySessionTarget,
  resolveDisplayHourTarget,
  computeHourAllocation,
  sumCountableHours,
  validatePlannedNaSelection,
  validatePlannedNaSelectionForHours,
  extractScheduleDefaults,
  resolveDefaultTeacherFromClass,
  generateBatchSessionRows,
  parseGapBatchSpec,
  parsePendingStagedSessions,
  sanitizeStagedSessionRow,
  sessionScheduleKey,
  previewGapBatchSessions,
  commitGapBatchSessions,
  commitStagedSessions,
  appendBatchSessions,
  materializePlannedNaAttendance,
  removePersonFromExcludedSessionRosters,
  filterSessionsInEnrollmentWindow,
  computeOneOnOneExcludedSessionIds,
  purgePersonFromEnrollmentWindowRosters,
  sanitizePlannedNaSessionIds,
  parsePlannedNaSessionIdsFromBody,
  assertRollingSessionsWithinCycleWindowOrThrow,
  classifySessionForWindow,
  isEnrollmentSessionCountEnforced,
  isTargetSessionCountEnforced,
  isTargetHoursEnforced,
  resolveSessionDurationHours,
  computeDurationHours,
  computeProposedCycleEndDate,
  computeLatestSessionDate,
  assertEnrollmentSessionAlignmentForCreate,
  resolveAnticipatedFinishDate
};
