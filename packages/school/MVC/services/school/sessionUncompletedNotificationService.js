'use strict';

const sessionStatusPolicyService = require('./sessionStatusPolicyService');
const sessionDeliveryTeamService = require('./sessionDeliveryTeamService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const sessionAttendanceEditAccessService = require('./sessionAttendanceEditAccessService');
const schoolDataService = require('./schoolDataService');
const teacherIdentityService = require('./teacherIdentityService');
const { SESSION_DATE_RANGE_TYPES } = require('./sessionAccessPolicyService');
const { requireCoreModule } = require('./schoolCoreContracts');

function resolveAppDisplayName() {
  try {
    const appBrandingService = requireCoreModule('MVC/services/appBrandingService');
    const brand = appBrandingService.getBrand?.() || {};
    return cleanText(brand.appName || brand.appShortName) || 'School Portal';
  } catch (_) {
    return 'School Portal';
  }
}

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

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const EMAIL_ICONS = Object.freeze({
  header: '&#128203;',
  greeting: '&#128075;',
  class: '&#127979;',
  session: '&#128197;',
  link: '&#128279;',
  clock: '&#9200;',
  action: '&#9989;',
  footer: '&#127891;'
});

function buildEmailIcon(iconKey = '') {
  const entity = EMAIL_ICONS[iconKey] || '';
  return entity
    ? `<span style="font-size:1.1em;line-height:1;margin-right:6px;" aria-hidden="true">${entity}</span>`
    : '';
}

function resolveAbsoluteSessionUrl(classData = {}, session = {}, baseUrl = '') {
  const origin = cleanText(baseUrl).replace(/\/$/, '');
  const relativePath = buildSessionManagerPath(classData, session);
  if (!relativePath) return '';
  return origin ? `${origin}${relativePath}` : relativePath;
}

function buildSessionBulletLabel(session = {}, entryTitle = '') {
  const custom = cleanText(entryTitle);
  if (custom) return custom;
  return buildSessionName(session);
}

function groupEntriesByClassTitle(entries = []) {
  const map = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const classData = entry?.classData || {};
    const className = cleanText(classData?.title || classData?.name || classData?.id) || 'General';
    if (!map.has(className)) map.set(className, []);
    map.get(className).push(entry);
  });
  return [...map.entries()].sort((left, right) => left[0].localeCompare(right[0]));
}

function formatDurationMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0 minutes';
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  if (hours < 48) {
    if (remMin === 0) return hours === 1 ? '1 hour' : `${hours} hours`;
    return `${hours}h ${remMin}m`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (remHours === 0) return days === 1 ? '1 day' : `${days} days`;
  return `${days}d ${remHours}h`;
}

async function resolveSessionCompletionTiming({
  orgId = '',
  session = {},
  orgTimeZone = 'UTC',
  now = new Date(),
  policy = null
} = {}) {
  const orgKey = cleanText(orgId);
  if (!orgKey) {
    return { timingLabel: 'Please review and complete this session when you are able.' };
  }
  const { requireCoreModule } = require('./schoolCoreContracts');
  const { zonedWallClockToUtcMs, normalizeTimezoneToken } = requireCoreModule('MVC/utils/timezoneUtils');
  const sessionAccessPolicyModel = require('../../models/school/sessionAccessPolicyModel');
  const resolvedPolicy = policy || await sessionAccessPolicyModel.getPolicyForOrg(orgKey);
  const tz = normalizeTimezoneToken(orgTimeZone, 'UTC');
  const sessionDate = cleanDateKey(session?.date);
  const endTime = cleanText(session?.endTime || session?.startTime || '23:59').slice(0, 5);
  const sessionEndMs = sessionDate ? zonedWallClockToUtcMs(sessionDate, endTime, tz) : NaN;
  const nowMs = now.getTime();
  const period = await sessionAttendanceEditAccessService.findTimesheetPeriodForSessionDate(orgKey, sessionDate);
  const deadlineDateKey = sessionAttendanceEditAccessService.resolveDeadlineDateKey({
    policy: resolvedPolicy,
    session,
    orgId: orgKey,
    timesheetPeriod: period,
    policyKey: 'completedSessionAttendanceEdit'
  });
  const deadlineAt = sessionAttendanceEditAccessService.resolveDeadlineInstant({
    deadlineDateKey,
    timeZone: tz
  });
  const deadlineMs = deadlineAt ? deadlineAt.getTime() : null;

  let timingLabel = 'Please review and complete this session when you are able.';
  if (Number.isFinite(sessionEndMs) && nowMs < sessionEndMs) {
    timingLabel = `Session ends in ${formatDurationMs(sessionEndMs - nowMs)} (${sessionDate} ${endTime}) — complete it after the session finishes.`;
  } else if (deadlineMs && nowMs <= deadlineMs) {
    timingLabel = `Time remaining to complete (per your organization's session edit settings): ${formatDurationMs(deadlineMs - nowMs)} (through ${deadlineDateKey}).`;
  } else if (deadlineDateKey) {
    timingLabel = `The configured edit window ended on ${deadlineDateKey}. Please review and complete this session as soon as possible.`;
  } else if (Number.isFinite(sessionEndMs) && nowMs >= sessionEndMs) {
    timingLabel = 'This session has ended — please open it and mark it complete.';
  }

  return { timingLabel, deadlineDateKey, deadlineMs, sessionEndMs };
}

async function buildSessionTimingMap(entries = [], { orgId = '', orgTimeZone = 'UTC', now = new Date() } = {}) {
  const map = new Map();
  const list = Array.isArray(entries) ? entries : [];
  for (const entry of list) {
    const session = entry?.session || {};
    const key = cleanText(session?.sessionId || session?.id);
    if (!key || map.has(key)) continue;
    // eslint-disable-next-line no-await-in-loop
    map.set(key, await resolveSessionCompletionTiming({ orgId, session, orgTimeZone, now }));
  }
  return map;
}

function buildSessionListText(entries = [], { baseUrl = '', sessionTimingByKey = null } = {}) {
  const timingMap = sessionTimingByKey instanceof Map ? sessionTimingByKey : null;
  const groups = groupEntriesByClassTitle(entries);
  if (!groups.length) return '';
  return groups.map(([className, classEntries]) => {
    const lines = [className];
    classEntries.forEach((entry) => {
      const session = entry?.session || {};
      const sessionKey = cleanText(session?.sessionId || session?.id);
      const label = buildSessionBulletLabel(session, entry?.title);
      const sessionUrl = resolveAbsoluteSessionUrl(entry?.classData || {}, session, baseUrl);
      const timing = timingMap?.get(sessionKey)?.timingLabel || '';
      if (sessionUrl) {
        lines.push(`  • ${label}`);
        lines.push(`    ${sessionUrl}`);
      } else {
        lines.push(`  • ${label}`);
      }
      if (timing) lines.push(`    ${timing}`);
    });
    return lines.join('\n');
  }).join('\n\n');
}

function buildSessionListHtml(entries = [], { baseUrl = '', sessionTimingByKey = null, formal = false } = {}) {
  const timingMap = sessionTimingByKey instanceof Map ? sessionTimingByKey : null;
  const groups = groupEntriesByClassTitle(entries);
  if (!groups.length) {
    return '<p style="margin:0;color:#6c757d;">No sessions listed.</p>';
  }
  const blocks = groups.map(([className, classEntries]) => {
    const rows = classEntries.map((entry) => {
      const session = entry?.session || {};
      const sessionKey = cleanText(session?.sessionId || session?.id);
      const label = escapeHtml(buildSessionBulletLabel(session, entry?.title));
      const sessionUrl = resolveAbsoluteSessionUrl(entry?.classData || {}, session, baseUrl);
      const timing = escapeHtml(timingMap?.get(sessionKey)?.timingLabel || '');
      const linkCell = sessionUrl
        ? `<a href="${escapeHtml(sessionUrl)}" style="color:#1a4480;text-decoration:underline;font-weight:600;">${formal ? label : `${buildEmailIcon('link')}${label}`}</a>`
        : `${formal ? label : `${buildEmailIcon('session')}${label}`}`;
      return [
        '<tr>',
        `<td style="padding:10px 14px;border-bottom:1px solid #e9ecef;vertical-align:top;width:20px;color:#495057;font-weight:600;">&#8226;</td>`,
        `<td style="padding:10px 14px;border-bottom:1px solid #e9ecef;vertical-align:top;">`,
        `<div style="font-size:14px;line-height:1.5;color:#212529;">${linkCell}</div>`,
        timing ? `<div style="font-size:13px;line-height:1.45;color:#5c6770;margin-top:6px;font-style:italic;">${formal ? timing : `${buildEmailIcon('clock')}${timing}`}</div>` : '',
        '</td>',
        '</tr>'
      ].join('');
    }).join('');
    return [
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px;border:1px solid #ced4da;background:#ffffff;">`,
      '<tr>',
      `<td style="padding:10px 14px;background:#eef2f7;border-bottom:1px solid #ced4da;">`,
      `<p style="margin:0;font-size:15px;font-weight:700;color:#1b1b1b;letter-spacing:0.01em;">${formal ? escapeHtml(className) : `${buildEmailIcon('class')}${escapeHtml(className)}`}</p>`,
      '</td>',
      '</tr>',
      '<tr>',
      '<td style="padding:0;">',
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">${rows}</table>`,
      '</td>',
      '</tr>',
      '</table>'
    ].join('');
  }).join('');
  return blocks;
}

async function buildTeacherReviewEmailContent({
  teacherName = '',
  orgName = '',
  entries = [],
  baseUrl = '',
  orgId = '',
  orgTimeZone = 'UTC',
  now = new Date()
} = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const sessionCount = list.length;
  const timingMap = orgId
    ? await buildSessionTimingMap(list, { orgId, orgTimeZone, now })
    : null;
  const listText = buildSessionListText(list, { baseUrl, sessionTimingByKey: timingMap });
  const listHtml = buildSessionListHtml(list, { baseUrl, sessionTimingByKey: timingMap, formal: true });
  const name = cleanText(teacherName) || 'Colleague';
  const org = cleanText(orgName) || 'School Administration';
  const appName = resolveAppDisplayName();
  const plainText = [
    `Dear ${name},`,
    '',
    `This message is to inform you that ${sessionCount} session(s) under your responsibility require review and completion.`,
    'Please open each session listed below, verify the details, and mark the session complete when appropriate.',
    '',
    listText,
    '',
    'Thank you for your prompt attention to this matter.',
    '',
    'Sincerely,',
    org,
    '',
    appName
  ].join('\n');
  const htmlBody = [
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#eceff3;padding:28px 16px;">',
    '<tr><td align="center">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;background:#ffffff;border:1px solid #ced4da;">',
    '<tr>',
    '<td style="padding:22px 28px;background:#1a4480;border-bottom:3px solid #0f2f5c;">',
    '<p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#c9d7ef;">Official notice</p>',
    '<h1 style="margin:0;font-size:20px;font-weight:700;line-height:1.35;color:#ffffff;font-family:Georgia,\'Times New Roman\',serif;">Session completion reminder</h1>',
    '</td>',
    '</tr>',
    '<tr>',
    '<td style="padding:28px;font-family:Georgia,\'Times New Roman\',Times,serif;font-size:15px;line-height:1.65;color:#1b1b1b;">',
    `<p style="margin:0 0 18px;">Dear ${escapeHtml(name)},</p>`,
    `<p style="margin:0 0 16px;">This message is to inform you that <strong>${sessionCount}</strong> session(s) under your responsibility require review and completion. Please review the classes and sessions listed below and use the provided links to open each session in the system.</p>`,
    `<p style="margin:0 0 22px;">When you have verified attendance and related requirements, please mark each session complete in accordance with your organization&rsquo;s procedures.</p>`,
    listHtml,
    `<p style="margin:24px 0 0;">Thank you for your prompt attention to this matter.</p>`,
    `<p style="margin:18px 0 0;">Sincerely,<br><strong>${escapeHtml(org)}</strong></p>`,
    '</td>',
    '</tr>',
    '<tr>',
    `<td style="padding:14px 28px;background:#f8f9fa;border-top:1px solid #dee2e6;text-align:center;font-family:Arial,Helvetica,sans-serif;">`,
    `<p style="margin:0;font-size:12px;color:#5c6770;letter-spacing:0.03em;">This notification was sent by <strong style="color:#1b1b1b;">${escapeHtml(appName)}</strong></p>`,
    '</td>',
    '</tr>',
    '</table>',
    '</td></tr></table>'
  ].join('');
  return { plainText, htmlBody, sessionCount, listText, listHtml };
}

function groupSessionsByTeacher(entries = [], { teacherPersonMap = null } = {}) {
  const grouped = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const session = entry?.session || {};
    const seenPersonIds = new Set();
    listSessionEditorIds(session).forEach((rawId) => {
      const personId = teacherPersonMap instanceof Map
        ? teacherIdentityService.resolveTeacherPersonId(rawId, teacherPersonMap) || rawId
        : rawId;
      const key = cleanText(personId);
      if (!key || seenPersonIds.has(key)) return;
      seenPersonIds.add(key);
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
    teacherEmail: schoolPersonAccessService.readPersonEmail
      ? schoolPersonAccessService.readPersonEmail(teacher)
      : cleanText(teacher?.contact?.email || teacher?.email),
    orgName: cleanText(orgName),
    sessionManagerUrl: classId && sessionId
      ? `/school/classes/${encodeURIComponent(classId)}/sessions/${encodeURIComponent(sessionId)}`
      : ''
  };
  const sessionList = buildSessionListText(entries, { baseUrl });
  const sessionListHtml = buildSessionListHtml(entries, { baseUrl });
  return {
    ...baseContext,
    sessionCount: String(entries.length),
    sessionList,
    sessionListHtml
  };
}

async function loadTeacherPersonMap(orgId = '', reqUser = null) {
  const orgKey = cleanText(orgId);
  if (!orgKey) return new Map();
  const scopedUser = reqUser && typeof reqUser === 'object'
    ? reqUser
    : { activeOrgId: orgKey };
  const teachers = await schoolDataService.fetchAllData('teachers', {}, scopedUser).catch(() => []);
  return teacherIdentityService.buildTeacherPersonMap(teachers);
}

async function listOrgClasses(orgId = '', reqUser = null) {
  const orgKey = cleanText(orgId);
  if (!orgKey) return [];
  const scopedUser = reqUser && typeof reqUser === 'object'
    ? reqUser
    : { activeOrgId: orgKey };
  const classes = await schoolDataService.fetchAllData('classes', {}, scopedUser).catch(() => []);
  return Array.isArray(classes) ? classes : [];
}

async function listClassSessions(classData = {}, reqUser = null) {
  const embedded = Array.isArray(classData?.sessions) ? classData.sessions : [];
  if (embedded.length) return embedded;
  const classId = cleanText(classData?.id);
  if (!classId) return [];
  const scopedUser = reqUser && typeof reqUser === 'object'
    ? reqUser
    : { activeOrgId: cleanText(classData?.orgId) };
  return schoolDataService.getClassSessions(classId, scopedUser).catch(() => []);
}

async function listUncompletedSessionsForOrg(orgId, {
  fromDate = '',
  throughDate = '',
  statusMap = null,
  reqUser = null
} = {}) {
  const orgKey = cleanText(orgId);
  const cutoff = cleanDateKey(throughDate);
  if (!orgKey || !cutoff) return [];
  const start = cleanDateKey(fromDate) || cutoff;

  const resolvedStatusMap = statusMap || await sessionStatusPolicyService.getStatusMap(orgId, { includeInactive: true });
  const scopedUser = reqUser && typeof reqUser === 'object'
    ? reqUser
    : { activeOrgId: orgKey };
  const classes = await listOrgClasses(orgKey, scopedUser);
  const results = [];

  for (const classData of classes) {
    if (cleanText(classData?.orgId) !== orgKey) continue;
    // eslint-disable-next-line no-await-in-loop
    const sessions = await listClassSessions(classData, scopedUser);
    sessions.forEach((session) => {
      if (!isSessionWithinDateRange(session, start, cutoff)) return;
      if (!isSessionUncompleted({ session, statusMap: resolvedStatusMap })) return;
      results.push({ classData, session });
    });
  }

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

function listUncompletedSessionsForTeacher(allEntries = [], teacherId = '', { teacherPersonMap = null } = {}) {
  const targetTeacherId = cleanText(teacherId);
  if (!targetTeacherId) return [];
  const entries = Array.isArray(allEntries) ? allEntries : [];
  const matched = entries.filter((entry) => sessionDeliveryTeamService.isPersonSessionEditor(
    entry?.session || {},
    targetTeacherId,
    teacherPersonMap
  ));

  return matched;
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
  statusMap = null,
  reqUser = null
} = {}) {
  const scopedUser = reqUser && typeof reqUser === 'object'
    ? reqUser
    : { activeOrgId: cleanText(orgId) };
  const teacherPersonMap = await loadTeacherPersonMap(orgId, scopedUser);
  const allEntries = await listUncompletedSessionsForOrg(orgId, {
    fromDate,
    throughDate,
    statusMap,
    reqUser: scopedUser
  });
  const teacherSessions = listUncompletedSessionsForTeacher(allEntries, teacherId, { teacherPersonMap });

  if (teacherSessions.length) {
    return { sessions: teacherSessions, usedSampleData: false };
  }
  return {
    sessions: buildSampleSessionsForTeacher(orgId),
    usedSampleData: true
  };
}

module.exports = {
  listSessionEditorIds,
  buildSessionName,
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
  buildSessionListHtml,
  buildTeacherReviewEmailContent,
  resolveSessionCompletionTiming,
  groupEntriesByClassTitle,
  groupSessionsByTeacher,
  buildDigestContext,
  loadTeacherPersonMap,
  listOrgClasses,
  listClassSessions,
  listUncompletedSessionsForOrg,
  listUncompletedSessionsForTeacher,
  buildSampleSessionsForTeacher,
  resolveTeacherSessionsForDigest
};
