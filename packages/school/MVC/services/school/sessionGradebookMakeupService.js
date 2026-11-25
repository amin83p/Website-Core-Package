const attendanceMatrixMetricsService = require('./attendanceMatrixMetricsService');
const sessionAccessPolicyService = require('./sessionAccessPolicyService');
const {
  addDaysToDateKey,
  endOfMonthDateKey
} = require('./sessionAttendanceEditAccessService');

const MAKEUP_SOURCE_LOOKBACK_DAYS = sessionAccessPolicyService.DEFAULT_GRADEBOOK_ACTIVITY_MAKEUP.lookbackDays;

const ATT = attendanceMatrixMetricsService.ATTENDANCE_STATUS;

function sanitizeMakeupAttachments(rawList) {
  return require('./sessionGradebookService').sanitizeGradebookAttachments(rawList);
}

function cleanId(value) {
  return String(value || '').trim();
}

function isOriginalGradebookActivity(gb) {
  if (!gb || typeof gb !== 'object') return false;
  const srcSession = cleanId(gb.makeupSource?.sessionId);
  const srcGb = cleanId(gb.makeupSource?.gradebookId);
  return !srcSession && !srcGb;
}

function isMakeupSourceEligibleActivity(gb) {
  if (!isOriginalGradebookActivity(gb)) return false;
  if (Boolean(gb.periodPerformanceLog)) return false;
  return true;
}

function isMakeupLinkedGradebookActivity(gb) {
  if (!gb || typeof gb !== 'object') return false;
  const srcSession = cleanId(gb.makeupSource?.sessionId);
  const srcGb = cleanId(gb.makeupSource?.gradebookId);
  return Boolean(srcSession && srcGb);
}

function partitionGradebooksForSessionManagerClient(gradebooks = []) {
  const inline = [];
  const makeupLinked = [];
  (Array.isArray(gradebooks) ? gradebooks : []).forEach((gb) => {
    if (isMakeupLinkedGradebookActivity(gb)) makeupLinked.push(gb);
    else inline.push(gb);
  });
  return { inline, makeupLinked };
}

function normalizeAttendanceStatus(raw) {
  return attendanceMatrixMetricsService.normalizeStatus(raw, '');
}

function attendanceFromRosterMap(rosterMap, personId) {
  const pid = cleanId(personId);
  if (!pid || !rosterMap) return '';
  if (rosterMap instanceof Map) {
    return rosterMap.has(pid) ? rosterMap.get(pid) : '';
  }
  return Object.prototype.hasOwnProperty.call(rosterMap, pid) ? rosterMap[pid] : '';
}

function isMissedSessionAttendance(att) {
  const status = normalizeAttendanceStatus(att);
  if (attendanceMatrixMetricsService.isUnmarkedAttendanceStatus(att)) return false;
  if (status === ATT.NOT_APPLICABLE) return true;
  return attendanceMatrixMetricsService.isAbsentLikeStatus(status);
}

function isGradeableOnCurrentSession(att) {
  if (attendanceMatrixMetricsService.isUnmarkedAttendanceStatus(att)) return false;
  const status = normalizeAttendanceStatus(att);
  if (status === ATT.NOT_APPLICABLE) return false;
  if (attendanceMatrixMetricsService.isAbsentLikeStatus(status)) return false;
  return true;
}

function buildRosterAttendanceMap(session) {
  const map = new Map();
  (Array.isArray(session?.roster) ? session.roster : []).forEach((row) => {
    const pid = cleanId(row?.personId);
    if (!pid) return;
    map.set(pid, normalizeAttendanceStatus(row?.attendance));
  });
  return map;
}

function getScoreFromMap(scores, personId) {
  const pid = cleanId(personId);
  if (!scores || !pid) return null;
  let v = scores[pid];
  if (v === undefined) v = scores[String(pid)];
  if (v === '' || v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function compareSessionDateDesc(a, b) {
  const dateA = String(a?.date || '');
  const dateB = String(b?.date || '');
  if (dateA !== dateB) return dateB.localeCompare(dateA);
  const timeA = String(a?.startTime || '');
  const timeB = String(b?.startTime || '');
  return timeB.localeCompare(timeA);
}

function cleanDateKey(value) {
  const token = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(token) ? token : '';
}

function compareDateKeys(left = '', right = '') {
  return String(left || '').localeCompare(String(right || ''));
}

function startOfWeekMondayDateKey(dateKey = '') {
  const token = cleanDateKey(dateKey);
  if (!token) return '';
  const [year, month, day] = token.split('-').map((part) => Number(part));
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
  return addDaysToDateKey(token, -daysFromMonday);
}

function startOfMonthDateKey(dateKey = '') {
  const token = cleanDateKey(dateKey);
  if (!token) return '';
  const [year, month] = token.split('-');
  return `${year}-${month}-01`;
}

function normalizeMakeupPolicy(makeupPolicy) {
  if (makeupPolicy && typeof makeupPolicy === 'object' && makeupPolicy.windowType) {
    return sessionAccessPolicyService.normalizeGradebookActivityMakeupSettings(makeupPolicy);
  }
  return sessionAccessPolicyService.normalizeGradebookActivityMakeupSettings({});
}

function resolveGradebookMakeupSourceDateBounds({ currentSessionDate, makeupPolicy } = {}) {
  const current = cleanDateKey(currentSessionDate);
  if (!current) return { minDate: '', maxDate: '' };

  const policy = normalizeMakeupPolicy(makeupPolicy);
  const windowType = policy.windowType;
  const dayBeforeCurrent = addDaysToDateKey(current, -1);
  if (!dayBeforeCurrent) return { minDate: '', maxDate: '' };

  const weekStart = startOfWeekMondayDateKey(current);
  let minDate = '';
  let maxDate = dayBeforeCurrent;

  switch (windowType) {
    case 'last_n_days': {
      const days = Number(policy.lookbackDays) || MAKEUP_SOURCE_LOOKBACK_DAYS;
      minDate = addDaysToDateKey(current, -days);
      break;
    }
    case 'this_week':
      minDate = weekStart;
      break;
    case 'this_month':
      minDate = startOfMonthDateKey(current);
      break;
    case 'last_week':
      minDate = addDaysToDateKey(weekStart, -7);
      maxDate = addDaysToDateKey(weekStart, -1);
      break;
    case 'last_two_weeks':
      minDate = addDaysToDateKey(weekStart, -14);
      maxDate = addDaysToDateKey(weekStart, -1);
      break;
    case 'month_half': {
      const dayOfMonth = Number(current.split('-')[2]);
      if (!Number.isFinite(dayOfMonth) || dayOfMonth < 1) {
        return { minDate: '', maxDate: '' };
      }
      if (dayOfMonth <= 15) {
        minDate = startOfMonthDateKey(current);
        const halfEnd = `${current.slice(0, 8)}15`;
        maxDate = compareDateKeys(halfEnd, dayBeforeCurrent) <= 0 ? halfEnd : dayBeforeCurrent;
      } else {
        minDate = `${current.slice(0, 8)}16`;
        const halfEnd = endOfMonthDateKey(current);
        maxDate = compareDateKeys(halfEnd, dayBeforeCurrent) <= 0 ? halfEnd : dayBeforeCurrent;
      }
      break;
    }
    default:
      minDate = addDaysToDateKey(current, -MAKEUP_SOURCE_LOOKBACK_DAYS);
  }

  if (minDate && maxDate && compareDateKeys(minDate, maxDate) > 0) {
    return { minDate: '', maxDate: '' };
  }
  return { minDate, maxDate };
}

function isSessionDateWithinMakeupSourceWindow(sessionDate, bounds = {}) {
  const date = cleanDateKey(sessionDate);
  const minDate = cleanDateKey(bounds.minDate);
  const maxDate = cleanDateKey(bounds.maxDate);
  if (!date || !minDate || !maxDate) return false;
  if (compareDateKeys(minDate, maxDate) > 0) return false;
  return compareDateKeys(date, minDate) >= 0 && compareDateKeys(date, maxDate) <= 0;
}

function describeGradebookActivityMakeupWindow(makeupPolicy) {
  const policy = normalizeMakeupPolicy(makeupPolicy);
  const labels = {
    month_half: 'the same half of the calendar month as this session (1st–15th or 16th–end)',
    last_week: 'the previous calendar week',
    last_two_weeks: 'the two calendar weeks before this week',
    this_week: 'this calendar week',
    this_month: 'this calendar month',
    last_n_days: `up to the last ${policy.lookbackDays || MAKEUP_SOURCE_LOOKBACK_DAYS} days`
  };
  return labels[policy.windowType] || labels.last_n_days;
}

function assertSourceSessionWithinMakeupWindow(sourceSession, currentSession, makeupPolicy) {
  const sourceDate = String(sourceSession?.date || '').trim();
  const currentDate = String(currentSession?.date || '').trim();
  const bounds = resolveGradebookMakeupSourceDateBounds({
    currentSessionDate: currentDate,
    makeupPolicy
  });
  if (!isSessionDateWithinMakeupSourceWindow(sourceDate, bounds)) {
    const description = describeGradebookActivityMakeupWindow(makeupPolicy);
    throw new Error(`That source session is outside the allowed make-up window (${description} before this session).`);
  }
}

function hasDuplicateMakeupLink(currentSession, sourceSessionId, sourceGradebookId) {
  const srcSid = cleanId(sourceSessionId);
  const srcGb = cleanId(sourceGradebookId);
  if (!srcSid || !srcGb) return false;
  return (Array.isArray(currentSession?.gradebooks) ? currentSession.gradebooks : []).some((gb) => (
    cleanId(gb?.makeupSource?.sessionId) === srcSid
    && cleanId(gb?.makeupSource?.gradebookId) === srcGb
  ));
}

function classifyMakeupCohort({
  sourceSession,
  sourceGradebook,
  currentSession,
  currentPersonIds = []
} = {}) {
  const sourceAtt = buildRosterAttendanceMap(sourceSession);
  const currentAtt = buildRosterAttendanceMap(currentSession);
  const personSet = new Set((Array.isArray(currentPersonIds) ? currentPersonIds : []).map(cleanId).filter(Boolean));

  const missedOnSource = [];
  const makeupEligible = [];
  const blocked = [];
  const done = [];
  const notOnCurrentRoster = [];

  sourceAtt.forEach((_att, personId) => {
    if (isMissedSessionAttendance(sourceAtt.get(personId))) {
      missedOnSource.push(personId);
    }
  });

  missedOnSource.forEach((personId) => {
    if (!personSet.has(personId)) {
      notOnCurrentRoster.push(personId);
      return;
    }
    const curAtt = currentAtt.get(personId) || '';
    if (isGradeableOnCurrentSession(curAtt)) makeupEligible.push(personId);
    else blocked.push(personId);
  });

  personSet.forEach((personId) => {
    if (missedOnSource.includes(personId)) return;
    const srcAtt = sourceAtt.get(personId) || '';
    if (isMissedSessionAttendance(srcAtt)) return;
    if (attendanceMatrixMetricsService.isUnmarkedAttendanceStatus(srcAtt)) return;
    done.push(personId);
  });

  return {
    missedOnSource,
    makeupEligible,
    blocked,
    done,
    notOnCurrentRoster,
    onCurrentRoster: [...personSet],
    presentOnCurrent: [...personSet].filter((pid) => isGradeableOnCurrentSession(currentAtt.get(pid) || ''))
  };
}

function buildMakeupScoreIndex(allSessions = []) {
  const index = new Map();
  (Array.isArray(allSessions) ? allSessions : []).forEach((session) => {
    (Array.isArray(session?.gradebooks) ? session.gradebooks : []).forEach((gb) => {
      const srcSid = cleanId(gb?.makeupSource?.sessionId);
      const srcGb = cleanId(gb?.makeupSource?.gradebookId);
      if (!srcSid || !srcGb) return;
      const prefix = `${srcSid}|${srcGb}|`;
      const scores = gb.scores && typeof gb.scores === 'object' ? gb.scores : {};
      Object.keys(scores).forEach((pid) => {
        const score = getScoreFromMap(scores, pid);
        if (score == null) return;
        index.set(`${prefix}${cleanId(pid)}`, score);
      });
    });
  });
  return index;
}

function resolveEffectiveGradebookScoreForStudent({
  allSessions = [],
  sourceSessionId,
  sourceGradebookId,
  personId,
  sourceSessionAttendance = ''
} = {}) {
  const srcSid = cleanId(sourceSessionId);
  const srcGb = cleanId(sourceGradebookId);
  const pid = cleanId(personId);
  if (!srcSid || !srcGb || !pid) return null;

  const sourceSession = (Array.isArray(allSessions) ? allSessions : []).find(
    (row) => cleanId(row?.sessionId || row?.id) === srcSid
  );
  const sourceGradebook = (Array.isArray(sourceSession?.gradebooks) ? sourceSession.gradebooks : [])
    .find((row) => cleanId(row?.id) === srcGb);
  if (!sourceGradebook) return null;

  const att = sourceSessionAttendance || attendanceFromRosterMap(buildRosterAttendanceMap(sourceSession), pid);
  const direct = getScoreFromMap(sourceGradebook.scores, pid);
  if (!isMissedSessionAttendance(att)) {
    return direct;
  }
  const index = buildMakeupScoreIndex(allSessions);
  const makeupScore = index.get(`${srcSid}|${srcGb}|${pid}`);
  if (makeupScore != null) return makeupScore;
  return null;
}

function listMakeupPickerRows({ allSessions = [], currentSession = {}, makeupPolicy } = {}) {
  const currentSessionId = cleanId(currentSession?.sessionId || currentSession?.id);
  const currentDate = String(currentSession?.date || '').trim();
  const bounds = resolveGradebookMakeupSourceDateBounds({
    currentSessionDate: currentDate,
    makeupPolicy
  });
  const rows = [];

  const candidates = (Array.isArray(allSessions) ? allSessions : [])
    .filter((session) => {
      const sid = cleanId(session?.sessionId || session?.id);
      if (!sid || sid === currentSessionId) return false;
      const date = String(session?.date || '').trim();
      if (currentDate && date && date >= currentDate) return false;
      if (!isSessionDateWithinMakeupSourceWindow(date, bounds)) return false;
      return true;
    })
    .sort(compareSessionDateDesc);

  candidates.forEach((session) => {
    const sessionId = cleanId(session?.sessionId || session?.id);
    const sessionDate = String(session?.date || '').trim();
    const startTime = String(session?.startTime || '').trim();
    (Array.isArray(session?.gradebooks) ? session.gradebooks : []).forEach((gb) => {
      if (!isMakeupSourceEligibleActivity(gb)) return;
      const gradebookId = cleanId(gb?.id);
      if (!gradebookId) return;
      rows.push({
        sessionId,
        sessionDate,
        sessionStartTime: startTime,
        gradebookId,
        name: String(gb?.name || 'Activity').trim(),
        totalScore: Number(gb?.totalScore) || 0,
        weight: Number(gb?.weight) || Number(gb?.totalScore) || 0
      });
    });
  });

  rows.sort((a, b) => {
    const dateCmp = String(b.sessionDate || '').localeCompare(String(a.sessionDate || ''));
    if (dateCmp !== 0) return dateCmp;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  return rows;
}

function buildMakeupGradebookFromSource({
  sourceSession,
  sourceGradebook,
  currentSession,
  currentPersonIds = [],
  cohort = null
} = {}) {
  const resolvedCohort = cohort || classifyMakeupCohort({
    sourceSession,
    sourceGradebook,
    currentSession,
    currentPersonIds
  });

  const sourceSessionId = cleanId(sourceSession?.sessionId || sourceSession?.id);
  const sourceGradebookId = cleanId(sourceGradebook?.id);
  const scores = {};
  const makeupRoles = {};

  (Array.isArray(currentPersonIds) ? currentPersonIds : []).forEach((personId) => {
    const pid = cleanId(personId);
    if (!pid) return;
    if (resolvedCohort.done.includes(pid)) {
      makeupRoles[pid] = 'done';
      scores[pid] = getScoreFromMap(sourceGradebook?.scores, pid);
      return;
    }
    if (resolvedCohort.makeupEligible.includes(pid)) {
      makeupRoles[pid] = 'makeup';
      scores[pid] = null;
      return;
    }
    if (resolvedCohort.blocked.includes(pid) || resolvedCohort.missedOnSource.includes(pid)) {
      makeupRoles[pid] = 'blocked';
      scores[pid] = null;
    }
  });

  resolvedCohort.done.forEach((pid) => {
    if (!makeupRoles[pid]) {
      makeupRoles[pid] = 'done';
      scores[pid] = getScoreFromMap(sourceGradebook?.scores, pid);
    }
  });

  const newId = `gb_makeup_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const sourceName = String(sourceGradebook?.name || 'Activity').trim();

  return {
    id: newId,
    name: sourceName.slice(0, 200),
    skills: Array.isArray(sourceGradebook?.skills) ? [...sourceGradebook.skills] : [],
    skillFocus: String(sourceGradebook?.skillFocus || '').trim(),
    weight: Number(sourceGradebook?.weight) || Number(sourceGradebook?.totalScore) || 0,
    totalScore: Number(sourceGradebook?.totalScore) || 0,
    activityContent: String(sourceGradebook?.activityContent || ''),
    includeInGradeCalculation: false,
    scores,
    scoreComments: {},
    attachments: sanitizeMakeupAttachments(sourceGradebook?.attachments),
    makeupSource: {
      sessionId: sourceSessionId,
      gradebookId: sourceGradebookId,
      sessionDate: String(sourceSession?.date || '').trim()
    },
    makeupRoles
  };
}

function previewMakeupGradebook({
  allSessions = [],
  currentSession = {},
  sourceSessionId,
  sourceGradebookId,
  currentPersonIds = [],
  makeupPolicy
} = {}) {
  const messages = [];
  const srcSid = cleanId(sourceSessionId);
  const srcGb = cleanId(sourceGradebookId);
  const sourceSession = (Array.isArray(allSessions) ? allSessions : []).find(
    (row) => cleanId(row?.sessionId || row?.id) === srcSid
  );
  if (!sourceSession) {
    return { status: 'blocked', messages: ['Source session was not found.'], cohort: null };
  }
  const sourceDate = String(sourceSession?.date || '').trim();
  const currentDate = String(currentSession?.date || '').trim();
  const bounds = resolveGradebookMakeupSourceDateBounds({
    currentSessionDate: currentDate,
    makeupPolicy
  });
  if (sourceDate && !isSessionDateWithinMakeupSourceWindow(sourceDate, bounds)) {
    return {
      status: 'blocked',
      messages: [
        `That source session is outside the allowed make-up window (${describeGradebookActivityMakeupWindow(makeupPolicy)} before this session).`
      ],
      cohort: null
    };
  }
  const sourceGradebook = (Array.isArray(sourceSession?.gradebooks) ? sourceSession.gradebooks : [])
    .find((row) => cleanId(row?.id) === srcGb);
  if (!sourceGradebook || !isOriginalGradebookActivity(sourceGradebook)) {
    return { status: 'blocked', messages: ['Source activity was not found or is not an original activity.'], cohort: null };
  }
  if (Boolean(sourceGradebook.periodPerformanceLog)) {
    return {
      status: 'blocked',
      messages: ['Period performance log activities cannot be used as make-up sources.'],
      cohort: null
    };
  }
  if (hasDuplicateMakeupLink(currentSession, srcSid, srcGb)) {
    return {
      status: 'blocked',
      messages: ['This session already has a make-up activity linked to that source activity.'],
      cohort: null
    };
  }

  const cohort = classifyMakeupCohort({
    sourceSession,
    sourceGradebook,
    currentSession,
    currentPersonIds
  });

  if (!cohort.missedOnSource.length) {
    return {
      status: 'blocked',
      messages: ['No students missed that session (Absent/ACF/N/A). A make-up activity is not needed.'],
      cohort
    };
  }

  if (cohort.notOnCurrentRoster.length) {
    messages.push(
      `${cohort.notOnCurrentRoster.length} student(s) who missed the source session are not on this session's attendance roster.`
    );
  }

  if (!cohort.makeupEligible.length) {
    return {
      status: 'blocked',
      messages: [
        ...messages,
        'None of the students who missed the source activity are present on this session, so there is no one to score.'
      ],
      cohort
    };
  }

  if (cohort.makeupEligible.length < cohort.missedOnSource.length) {
    messages.push(
      `Only ${cohort.makeupEligible.length} of ${cohort.missedOnSource.length} missed student(s) are present on this session and can receive scores.`
    );
  }

  const gradebook = buildMakeupGradebookFromSource({
    sourceSession,
    sourceGradebook,
    currentSession,
    currentPersonIds,
    cohort
  });

  return {
    status: messages.length ? 'warn' : 'ok',
    messages,
    cohort,
    gradebook
  };
}

function normalizeMakeupGradebookOnSave(gb, context = {}) {
  const {
    personIds = [],
    attendanceByPerson = new Map(),
    sourceSessionsById = new Map(),
    currentSessionDate = '',
    gradebookActivityMakeup
  } = context;
  const srcSid = cleanId(gb?.makeupSource?.sessionId);
  const srcGb = cleanId(gb?.makeupSource?.gradebookId);
  if (!srcSid || !srcGb) return gb;

  const sourceSession = sourceSessionsById.get(srcSid);
  const sourceGradebook = sourceSession
    ? (Array.isArray(sourceSession.gradebooks) ? sourceSession.gradebooks : []).find((row) => cleanId(row?.id) === srcGb)
    : null;

  if (sourceSession) {
    assertSourceSessionWithinMakeupWindow(
      sourceSession,
      { date: currentSessionDate },
      gradebookActivityMakeup
    );
  }

  const cohort = classifyMakeupCohort({
    sourceSession: sourceSession || { roster: [] },
    sourceGradebook: sourceGradebook || { scores: {} },
    currentSession: { roster: personIds.map((pid) => ({ personId: pid, attendance: attendanceByPerson.get(pid) || '' })) },
    currentPersonIds: personIds
  });

  const makeupRoles = { ...(gb.makeupRoles && typeof gb.makeupRoles === 'object' ? gb.makeupRoles : {}) };
  const scores = {};
  const scoreComments = gb.scoreComments && typeof gb.scoreComments === 'object' ? { ...gb.scoreComments } : {};
  const totalScore = Number(gb.totalScore);

  personIds.forEach((pid) => {
    const personId = cleanId(pid);
    if (!personId) return;
    const att = attendanceByPerson.has(personId) ? attendanceByPerson.get(personId) : '';

    if (cohort.done.includes(personId)) {
      makeupRoles[personId] = 'done';
      scores[personId] = getScoreFromMap(sourceGradebook?.scores, personId);
      return;
    }

    if (cohort.makeupEligible.includes(personId) && isGradeableOnCurrentSession(att)) {
      makeupRoles[personId] = 'makeup';
      let v = gb.scores && (Object.prototype.hasOwnProperty.call(gb.scores, personId) ? gb.scores[personId] : gb.scores[String(personId)]);
      if (v === '' || v === undefined) v = null;
      if (v !== null && v !== undefined) v = Number(v);
      if (v === null || Number.isNaN(v)) {
        scores[personId] = null;
      } else if (v < 0 || v > totalScore) {
        throw new Error(`Scores must be between 0 and ${totalScore} (${gb.name}).`);
      } else {
        scores[personId] = v;
      }
      return;
    }

    makeupRoles[personId] = 'blocked';
    scores[personId] = null;
    delete scoreComments[personId];
  });

  return {
    ...gb,
    includeInGradeCalculation: false,
    makeupRoles,
    scores,
    scoreComments
  };
}

module.exports = {
  MAKEUP_SOURCE_LOOKBACK_DAYS,
  resolveGradebookMakeupSourceDateBounds,
  isSessionDateWithinMakeupSourceWindow,
  describeGradebookActivityMakeupWindow,
  normalizeMakeupPolicy,
  isOriginalGradebookActivity,
  isMakeupSourceEligibleActivity,
  isMakeupLinkedGradebookActivity,
  partitionGradebooksForSessionManagerClient,
  isMissedSessionAttendance,
  isGradeableOnCurrentSession,
  classifyMakeupCohort,
  listMakeupPickerRows,
  previewMakeupGradebook,
  buildMakeupGradebookFromSource,
  buildMakeupScoreIndex,
  resolveEffectiveGradebookScoreForStudent,
  normalizeMakeupGradebookOnSave,
  hasDuplicateMakeupLink
};
