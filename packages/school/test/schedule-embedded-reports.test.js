const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const {
  canEmbedReportInSession,
  embedSessionReportsForTimeline,
  prepareEventsByDateForTimelineGrid
} = require('../MVC/utils/scheduleEmbeddedReportUtils');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function session(overrides = {}) {
  return {
    eventType: 'class_session',
    date: '2026-09-15',
    classId: 'class-1',
    sessionId: 'session-1',
    start: '09:00',
    end: '10:00',
    ...overrides
  };
}

function report(overrides = {}) {
  return {
    eventType: 'report_task',
    assignmentId: 'assign-1',
    date: '2026-09-15',
    classId: 'class-1',
    sourceSessionId: 'session-1',
    targetType: 'session',
    start: '09:00',
    end: '10:00',
    reportTemplateTitle: 'Weekly Progress',
    detailsUrl: '/reports/1',
    ...overrides
  };
}

test('canEmbedReportInSession matches session-scoped reports on same day/class/session', () => {
  assert.equal(canEmbedReportInSession(report(), session()), true);
});

test('canEmbedReportInSession rejects date-target reports', () => {
  assert.equal(canEmbedReportInSession(report({ targetType: 'date', sourceSessionId: '' }), session()), false);
});

test('canEmbedReportInSession rejects mismatched session, class, or date', () => {
  assert.equal(canEmbedReportInSession(report({ sourceSessionId: 'other-session' }), session()), false);
  assert.equal(canEmbedReportInSession(report({ classId: 'other-class' }), session()), false);
  assert.equal(canEmbedReportInSession(report({ date: '2026-09-16' }), session()), false);
});

test('embedSessionReportsForTimeline attaches reports to parent session and removes standalone blocks', () => {
  const embeddedReport = report({ assignmentId: 'assign-embed' });
  const orphanReport = report({
    assignmentId: 'assign-orphan',
    sourceSessionId: 'missing-session'
  });
  const dayEvents = [session(), embeddedReport, orphanReport];
  const result = embedSessionReportsForTimeline(dayEvents);

  const parent = result.find((event) => event.sessionId === 'session-1');
  assert.ok(parent);
  assert.equal(parent.embeddedReports.length, 1);
  assert.equal(parent.embeddedReports[0].assignmentId, 'assign-embed');

  const remainingReports = result.filter((event) => event.eventType === 'report_task');
  assert.equal(remainingReports.length, 1);
  assert.equal(remainingReports[0].assignmentId, 'assign-orphan');
});

test('embedSessionReportsForTimeline supports multiple reports on one session', () => {
  const first = report({ assignmentId: 'assign-a', id: 'report-a' });
  const second = report({ assignmentId: 'assign-b', id: 'report-b' });
  const result = embedSessionReportsForTimeline([session(), first, second]);
  const parent = result.find((event) => event.sessionId === 'session-1');
  assert.equal(parent.embeddedReports.length, 2);
  assert.equal(result.filter((event) => event.eventType === 'report_task').length, 0);
});

test('prepareEventsByDateForTimelineGrid embeds per day without cross-day leakage', () => {
  const eventsByDate = {
    '2026-09-15': [session(), report()],
    '2026-09-16': [report({ date: '2026-09-16', sourceSessionId: 'session-2' })]
  };
  const prepared = prepareEventsByDateForTimelineGrid(eventsByDate);

  assert.equal(prepared['2026-09-15'].length, 1);
  assert.equal(prepared['2026-09-15'][0].embeddedReports.length, 1);
  assert.equal(prepared['2026-09-16'].length, 1);
  assert.equal(prepared['2026-09-16'][0].eventType, 'report_task');
});

test('personSchedule wires embedded report preprocessing and badge rendering', () => {
  const source = read('MVC/views/school/schedule/personSchedule.ejs');
  assert.match(source, /scheduleEmbeddedReportUtils\.js/);
  assert.match(source, /function prepareEventsByDateForTimelineGrid/);
  assert.match(source, /function buildEmbeddedReportBadgesHtml/);
  assert.match(source, /prepareEventsByDateForTimelineGrid\(eventsByDate\)/);
  assert.match(source, /buildEmbeddedReportBadgesHtml\(ev\?\.embeddedReports\)/);
  assert.match(source, /getEmbeddedReportTooltipLine/);
  assert.match(source, /\.schedule-embedded-reports/);
  assert.match(source, /\.schedule-embedded-report-badge/);
  assert.match(source, /buildScheduleEmbeddedReportsClass/);
  assert.match(source, /\.has-embedded-reports/);
});
