'use strict';

function normalizeId(value) {
  return String(value || '').trim();
}

function idsEqual(left, right) {
  const a = normalizeId(left);
  const b = normalizeId(right);
  return Boolean(a) && Boolean(b) && a === b;
}

function isReportScheduleEvent(event) {
  return String(event?.eventType || '').trim().toLowerCase() === 'report_task'
    || Boolean(normalizeId(event?.assignmentId));
}

function isClassSessionScheduleEvent(event) {
  if (!event) return false;
  const eventType = String(event?.eventType || event?.targetType || '').trim().toLowerCase();
  if (eventType === 'report_task' || eventType === 'leave_request') return false;
  if (eventType && eventType !== 'class_session' && eventType !== 'session') return false;
  return Boolean(normalizeId(event?.classId) && normalizeId(event?.sessionId) && normalizeId(event?.date));
}

function reportEventKey(report) {
  return normalizeId(report?.id)
    || `${normalizeId(report?.assignmentId)}|${normalizeId(report?.date)}|${normalizeId(report?.start)}|${normalizeId(report?.sourceSessionId)}`;
}

function canEmbedReportInSession(report, session) {
  if (!isReportScheduleEvent(report) || !isClassSessionScheduleEvent(session)) return false;
  if (String(report?.targetType || '').trim().toLowerCase() !== 'session') return false;
  if (!idsEqual(report?.sourceSessionId, session?.sessionId)) return false;
  if (!idsEqual(report?.date, session?.date)) return false;
  if (!idsEqual(report?.classId, session?.classId)) return false;
  return true;
}

function embedSessionReportsForTimeline(dayEvents = []) {
  const events = (Array.isArray(dayEvents) ? dayEvents : []).map((row) => ({ ...row }));
  const sessions = events.filter(isClassSessionScheduleEvent);
  const reports = events.filter(isReportScheduleEvent);
  const embeddedKeys = new Set();

  sessions.forEach((session) => {
    const embedded = [];
    reports.forEach((report) => {
      if (!canEmbedReportInSession(report, session)) return;
      const key = reportEventKey(report);
      if (!key || embeddedKeys.has(key)) return;
      embeddedKeys.add(key);
      embedded.push({ ...report });
    });
    if (embedded.length) {
      session.embeddedReports = embedded;
    }
  });

  return events.filter((event) => {
    if (!isReportScheduleEvent(event)) return true;
    const key = reportEventKey(event);
    return !key || !embeddedKeys.has(key);
  });
}

function prepareEventsByDateForTimelineGrid(eventsByDate = {}) {
  const output = {};
  Object.keys(eventsByDate && typeof eventsByDate === 'object' ? eventsByDate : {}).forEach((date) => {
    output[date] = embedSessionReportsForTimeline(eventsByDate[date]);
  });
  return output;
}

const api = {
  normalizeId,
  idsEqual,
  isReportScheduleEvent,
  isClassSessionScheduleEvent,
  reportEventKey,
  canEmbedReportInSession,
  embedSessionReportsForTimeline,
  prepareEventsByDateForTimelineGrid
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.ScheduleEmbeddedReportUtils = api;
}
