'use strict';

const classModel = require('../../models/school/classModel');
const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const sessionDeliveryTeamService = require('./sessionDeliveryTeamService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const sessionAttendanceEditAccessService = require('./sessionAttendanceEditAccessService');
const { SESSION_DATE_RANGE_TYPES } = require('./sessionAccessPolicyService');

function cleanText(value) {
  return String(value || '').trim();
}

function buildSessionName(session = {}) {
  const date = cleanText(session?.date);
  const start = cleanText(session?.startTime).slice(0, 5);
  const end = cleanText(session?.endTime).slice(0, 5);
  const room = cleanText(session?.room);
  const parts = [date, [start, end].filter(Boolean).join('-'), room].filter(Boolean);
  return parts.join(' ') || cleanText(session?.sessionId || session?.id) || 'Session';
}

function listSessionEditorIds(session = {}) {
  const ids = [];
  const mainTeacherId = sessionDeliveryTeamService.getSessionMainTeacherId(session);
  if (mainTeacherId) ids.push(mainTeacherId);
  sessionDeliveryTeamService.getSessionCoTeachers(session).forEach((row) => {
    if (row?.personId && row.canEdit === true && !ids.includes(row.personId)) {
      ids.push(row.personId);
    }
  });
  return ids;
}

function compareDateKeys(left = '', right = '') {
  return cleanText(left).localeCompare(cleanText(right));
}

function isSessionUncompleted({ session = {}, statusMap = {} } = {}) {
  if (session?.locked === true) return false;
  return !sessionStatusPolicyService.isFinalStatusByMap(statusMap, session);
}

function cleanDateKey(value) {
  const token = cleanText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(token) ? token : '';
}

function isSessionOnOrBeforeDate(session = {}, throughDate = '') {
  const sessionDate = cleanText(session?.date);
  const cutoff = cleanText(throughDate);
  if (!sessionDate || !cutoff) return false;
  return compareDateKeys(sessionDate, cutoff) <= 0;
}

function isSessionOnOrAfterDate(session = {}, fromDate = '') {
  const sessionDate = cleanText(session?.date);
  const start = cleanText(fromDate);
  if (!sessionDate || !start) return false;
  return compareDateKeys(sessionDate, start) >= 0;
}

function isSessionWithinDateRange(session = {}, fromDate = '', throughDate = '') {
  return isSessionOnOrAfterDate(session, fromDate) && isSessionOnOrBeforeDate(session, throughDate);
}

function startOfWeekMondayDateKey(dateKey = '') {
  const token = cleanDateKey(dateKey);
  if (!token) return '';
  const [year, month, day] = token.split('-').map((part) => Number(part));
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
  return sessionAttendanceEditAccessService.addDaysToDateKey(token, -daysFromMonday);
}

function startOfMonthDateKey(dateKey = '') {
  const token = cleanDateKey(dateKey);
  if (!token) return '';
  const [year, month] = token.split('-');
  return `${year}-${month}-01`;
}

async function resolveSessionDateRangeBounds({
  orgId = '',
  throughDate = '',
  rangeType = 'this_week',
  daysBeforeToday = null
} = {}) {
  const cutoff = cleanDateKey(throughDate);
  if (!cutoff) return { fromDate: '', throughDate: '' };

  const type = SESSION_DATE_RANGE_TYPES.includes(rangeType) ? rangeType : 'this_week';
  let fromDate = '';

  switch (type) {
    case 'this_week':
      fromDate = startOfWeekMondayDateKey(cutoff);
      break;
    case 'two_weeks':
      fromDate = sessionAttendanceEditAccessService.addDaysToDateKey(
        startOfWeekMondayDateKey(cutoff),
        -7
      );
      break;
    case 'this_month':
      fromDate = startOfMonthDateKey(cutoff);
      break;
    case 'timesheet_period': {
      const period = await sessionAttendanceEditAccessService.findTimesheetPeriodForSessionDate(orgId, cutoff);
      fromDate = cleanDateKey(period?.startDate) || startOfMonthDateKey(cutoff);
      break;
    }
    case 'days_before_today': {
      const days = Number(daysBeforeToday);
      if (!Number.isFinite(days) || days < 1) {
        fromDate = cutoff;
      } else {
        fromDate = sessionAttendanceEditAccessService.addDaysToDateKey(cutoff, -(days - 1));
      }
      break;
    }
    default:
      fromDate = startOfWeekMondayDateKey(cutoff);
  }

  return { fromDate, throughDate: cutoff };
}

function describeSessionDateRange(sessionDateRange = {}) {
  const type = cleanText(sessionDateRange?.type) || 'this_week';
  const labels = {
    this_week: 'this week',
    two_weeks: 'the last two weeks',
    this_month: 'this month',
    timesheet_period: 'the current timesheet period',
    days_before_today: `the last ${sessionDateRange?.daysBeforeToday || '?'} day(s)`
  };
  return labels[type] || type;
}

function buildSessionManagerPath(classData = {}, session = {}) {
  const classId = cleanText(classData?.id);
  const sessionId = cleanText(session?.sessionId || session?.id);
  if (!classId || !sessionId) return '';
  return `/school/classes/${encodeURIComponent(classId)}/sessions/${encodeURIComponent(sessionId)}`;
}

function buildSessionListText(entries = [], { baseUrl = '' } = {}) {
  const origin = cleanText(baseUrl).replace(/\/$/, '');
  return (Array.isArray(entries) ? entries : []).map((entry) => {
    const classData = entry?.classData || {};
    const session = entry?.session || {};
    const className = cleanText(classData?.title || classData?.name || classData?.id);
    const sessionLabel = buildSessionName(session);
    const relativePath = buildSessionManagerPath(classData, session);
    const sessionUrl = relativePath
      ? (origin ? `${origin}${relativePath}` : relativePath)
      : '';
    const lines = [`- ${className} — ${sessionLabel}`];
    if (sessionUrl) lines.push(`  ${sessionUrl}`);
    return lines.join('\n');
  }).join('\n');
}

function groupSessionsByTeacher(entries = []) {
  const grouped = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const session = entry?.session || {};
    const teacherIds = listSessionEditorIds(session);
    teacherIds.forEach((teacherId) => {
      const key = cleanText(teacherId);
      if (!key) return;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(entry);
    });
  });
  return grouped;
}

function buildDigestContext({
  teacher = {},
  sessions = [],
  orgName = '',
  baseUrl = ''
} = {}) {
  const entries = Array.isArray(sessions) ? sessions : [];
  const first = entries[0] || {};
  const classData = first.classData || {};
  const session = first.session || {};
  const classId = cleanText(classData?.id);
  const sessionId = cleanText(session?.sessionId || session?.id);
  const baseContext = {
    className: cleanText(classData?.title || classData?.name || classId),
    classId,
    sessionName: buildSessionName(session),
    sessionId,
    sessionDate: cleanText(session?.date),
    sessionTime: [cleanText(session?.startTime).slice(0, 5), cleanText(session?.endTime).slice(0, 5)].filter(Boolean).join(' - '),
    teacherName: schoolPersonAccessService.formatPersonName
      ? schoolPersonAccessService.formatPersonName(teacher)
      : cleanText(teacher?.displayName || teacher?.name),
    orgName: cleanText(orgName),
    sessionManagerUrl: classId && sessionId
      ? `/school/classes/${encodeURIComponent(classId)}/sessions/${encodeURIComponent(sessionId)}`
      : ''
  };
  const sessionList = buildSessionListText(entries, { baseUrl });
  return {
    ...baseContext,
    sessionCount: String(entries.length),
    sessionList
  };
}

async function listUncompletedSessionsForOrg(orgId, {
  fromDate = '',
  throughDate = '',
  statusMap = null
} = {}) {
  const orgKey = cleanText(orgId);
  const cutoff = cleanDateKey(throughDate);
  if (!orgKey || !cutoff) return [];
  const start = cleanDateKey(fromDate) || cutoff;

  const resolvedStatusMap = statusMap || await sessionStatusPolicyService.getStatusMap(orgId, { includeInactive: true });
  const classes = await classModel.getAllClasses();
  const results = [];

  (Array.isArray(classes) ? classes : [])
    .filter((row) => cleanText(row?.orgId) === orgKey)
    .forEach((classData) => {
      const sessions = Array.isArray(classData?.sessions) ? classData.sessions : [];
      sessions.forEach((session) => {
        if (!isSessionWithinDateRange(session, start, cutoff)) return;
        if (!isSessionUncompleted({ session, statusMap: resolvedStatusMap })) return;
        results.push({ classData, session });
      });
    });

  results.sort((left, right) => {
    const dateCompare = compareDateKeys(left?.session?.date, right?.session?.date);
    if (dateCompare !== 0) return dateCompare;
    const classCompare = cleanText(left?.classData?.title || left?.classData?.name)
      .localeCompare(cleanText(right?.classData?.title || right?.classData?.name));
    if (classCompare !== 0) return classCompare;
    return cleanText(left?.session?.startTime).localeCompare(cleanText(right?.session?.startTime));
  });

  return results;
}

function listUncompletedSessionsForTeacher(allEntries = [], teacherId = '') {
  const targetTeacherId = cleanText(teacherId);
  if (!targetTeacherId) return [];
  return (Array.isArray(allEntries) ? allEntries : []).filter((entry) => {
    const session = entry?.session || {};
    return listSessionEditorIds(session).includes(targetTeacherId);
  });
}

function buildSampleSessionsForTeacher(orgId = '') {
  const orgKey = cleanText(orgId) || 'ORG-SAMPLE';
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const sampleDate = `${yyyy}-${mm}-${dd}`;
  return [
    {
      classData: {
        id: 'SAMPLE-CLASS-1',
        orgId: orgKey,
        title: '[SAMPLE] Algebra I'
      },
      session: {
        sessionId: 'SAMPLE-SESSION-1',
        date: sampleDate,
        startTime: '09:00',
        endTime: '10:00',
        room: 'Room A',
        teacherId: 'SAMPLE-TEACHER'
      }
    },
    {
      classData: {
        id: 'SAMPLE-CLASS-2',
        orgId: orgKey,
        title: '[SAMPLE] Biology'
      },
      session: {
        sessionId: 'SAMPLE-SESSION-2',
        date: sampleDate,
        startTime: '11:00',
        endTime: '12:00',
        room: 'Lab 2',
        teacherId: 'SAMPLE-TEACHER'
      }
    }
  ];
}

async function resolveTeacherSessionsForDigest({
  orgId = '',
  teacherId = '',
  fromDate = '',
  throughDate = '',
  statusMap = null
} = {}) {
  const allEntries = await listUncompletedSessionsForOrg(orgId, { fromDate, throughDate, statusMap });
  const teacherSessions = listUncompletedSessionsForTeacher(allEntries, teacherId);
  if (teacherSessions.length) {
    return { sessions: teacherSessions, usedSampleData: false };
  }
  return {
    sessions: buildSampleSessionsForTeacher(orgId),
    usedSampleData: true
  };
}

module.exports = {
  compareDateKeys,
  isSessionUncompleted,
  isSessionOnOrBeforeDate,
  isSessionOnOrAfterDate,
  isSessionWithinDateRange,
  startOfWeekMondayDateKey,
  startOfMonthDateKey,
  resolveSessionDateRangeBounds,
  describeSessionDateRange,
  buildSessionManagerPath,
  buildSessionListText,
  groupSessionsByTeacher,
  buildDigestContext,
  listUncompletedSessionsForOrg,
  listUncompletedSessionsForTeacher,
  buildSampleSessionsForTeacher,
  resolveTeacherSessionsForDigest
};
