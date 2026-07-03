const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
const reportAssignmentBulkRowService = require('../packages/school/MVC/services/school/reportAssignmentBulkRowService');
const reportIntegrityService = require('../packages/school/MVC/services/school/reportIntegrityService');
const reportController = require('../packages/school/MVC/controllers/school/reportController');

const ROOT_DIR = path.resolve(__dirname, '..');
const { SCHEDULE_PRESETS } = reportAssignmentBulkRowService;

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function withPatched(target, replacements, callback) {
  const originals = {};
  Object.entries(replacements).forEach(([key, value]) => {
    originals[key] = target[key];
    target[key] = value;
  });
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      Object.entries(originals).forEach(([key, value]) => {
        target[key] = value;
      });
    });
}

const sampleSessions = [
  { sessionId: 'S1', date: '2026-01-08', startTime: '09:00', endTime: '10:00', delivery: { deliveredBy: 'T1' } },
  { sessionId: 'S2', date: '2026-01-15', startTime: '09:00', endTime: '10:00', delivery: { deliveredBy: 'T1' } },
  { sessionId: 'S3', date: '2026-01-22', startTime: '09:00', endTime: '10:00', delivery: { deliveredBy: 'T2' } },
  { sessionId: 'S4', date: '2026-01-29', startTime: '09:00', endTime: '10:00', delivery: { deliveredBy: 'T1' } },
  { sessionId: 'S5', date: '2026-02-05', startTime: '09:00', endTime: '10:00', delivery: { deliveredBy: 'T1' } },
  { sessionId: 'S6', date: '2026-02-12', startTime: '14:00', endTime: '15:00', delivery: { deliveredBy: 'T2' } },
  { sessionId: 'S7', date: '2026-02-12', startTime: '09:00', endTime: '10:00', delivery: { deliveredBy: 'T1' } }
];

test('month preset picks last session in each month', () => {
  const anchors = reportAssignmentBulkRowService.buildScheduleAnchors({
    preset: SCHEDULE_PRESETS.END_OF_MONTH,
    startDate: '2026-01-01',
    endDate: '2026-02-28',
    sessions: sampleSessions
  });
  assert.deepEqual(anchors.map((row) => row.date), ['2026-01-29', '2026-02-12']);
});

test('week preset picks last session in each ISO week', () => {
  const anchors = reportAssignmentBulkRowService.buildScheduleAnchors({
    preset: SCHEDULE_PRESETS.END_OF_WEEK,
    startDate: '2026-01-01',
    endDate: '2026-02-28',
    sessions: sampleSessions
  });
  assert.ok(anchors.length >= 5);
  const weekOfJan22 = anchors.find((row) => row.date === '2026-01-22');
  assert.ok(weekOfJan22);
  const weekOfFeb12 = anchors.find((row) => row.date === '2026-02-12');
  assert.ok(weekOfFeb12);
});

test('day preset emits one row per session', () => {
  const anchors = reportAssignmentBulkRowService.buildScheduleAnchors({
    preset: SCHEDULE_PRESETS.END_OF_EACH_DAY,
    startDate: '2026-01-01',
    endDate: '2026-02-28',
    sessions: sampleSessions
  });
  assert.equal(anchors.length, sampleSessions.length);
  assert.equal(anchors.filter((row) => row.type === 'session').length, sampleSessions.length);
});

test('semi-monthly produces 15th and month-end anchors', () => {
  const anchors = reportAssignmentBulkRowService.buildScheduleAnchors({
    preset: SCHEDULE_PRESETS.SEMI_MONTHLY,
    startDate: '2026-01-01',
    endDate: '2026-02-28',
    sessions: sampleSessions
  });
  const dates = anchors.map((row) => row.date);
  assert.ok(dates.includes('2026-01-15'));
  assert.ok(dates.includes('2026-01-31'));
  assert.ok(dates.includes('2026-02-15'));
  assert.ok(dates.includes('2026-02-28'));
});

test('closest-session tie-breaking prefers on-or-after anchor then later end time', () => {
  const sessions = [
    { sessionId: 'BEFORE', date: '2026-02-10', startTime: '09:00', endTime: '10:00' },
    { sessionId: 'AFTER_EARLY', date: '2026-02-12', startTime: '09:00', endTime: '10:00' },
    { sessionId: 'AFTER_LATE', date: '2026-02-12', startTime: '14:00', endTime: '15:00' }
  ];
  const closest = reportAssignmentBulkRowService.findClosestSessionForDate(sessions, '2026-02-11');
  assert.equal(closest.sessionId, 'AFTER_LATE');
});

test('linked session rows prefer bulk default task times over session times', () => {
  const rows = reportAssignmentBulkRowService.buildTargetRowsFromSchedule({
    anchors: [{ type: 'date', date: '2026-01-15' }],
    sessions: [{ sessionId: 'S1', date: '2026-01-15', startTime: '14:00', endTime: '15:00' }],
    linkSessions: true,
    defaults: { teacherId: 'T1', taskStartTime: '09:00', taskEndTime: '10:00', status: 'active' }
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].taskStartTime, '09:00');
  assert.equal(rows[0].taskEndTime, '10:00');
});

test('dedupe skips duplicate sessionId and dueDate+teacher pairs', () => {
  const existing = [{
    targetType: 'session',
    sessionId: 'S1',
    teacherId: 'T1'
  }, {
    targetType: 'date',
    dueDate: '2026-02-15',
    teacherId: 'T2'
  }];
  const candidates = [{
    targetType: 'session',
    sessionId: 'S1',
    teacherId: 'T1'
  }, {
    targetType: 'date',
    dueDate: '2026-02-15',
    teacherId: 'T2'
  }, {
    targetType: 'session',
    sessionId: 'S9',
    teacherId: 'T1'
  }];
  const { accepted, skipped } = reportAssignmentBulkRowService.dedupeTargetRows(existing, candidates);
  assert.equal(accepted.length, 1);
  assert.equal(skipped.length, 2);
  assert.equal(accepted[0].sessionId, 'S9');
});

test('assignment form contains bulk modal and button wiring', () => {
  const html = read('packages/school/MVC/views/school/report/assignmentForm.ejs');
  assert.match(html, /id="btnAddMultipleTargetRows"/);
  assert.match(html, /id="bulkTargetRowsModal"/);
  assert.match(html, /id="btnBulkPreviewRows"/);
  assert.match(html, /id="btnBulkAddRows"/);
  assert.match(html, /id="bulkPreviewSelectAll"/);
  assert.match(html, /js-bulk-preview-row-select/);
  assert.match(html, /Add Selected Rows to Assignment/);
  assert.match(html, /showLoading\(/);
  assert.match(html, /generate-target-rows/);
  assert.match(html, /preview-target-rows/);
});

test('bulk assignment routes keep action state alive for helper POSTs', () => {
  const routes = read('packages/school/MVC/routes/reportRoutes.js');
  assert.match(routes, /reportAssignmentBulkActionState/);
  assert.match(routes, /requireToken:\s*false[\s\S]*keepActive:\s*true/);
  assert.match(routes, /generate-target-rows[\s\S]*reportAssignmentBulkActionState/);
  assert.match(routes, /preview-target-rows[\s\S]*reportAssignmentBulkActionState/);
});

test('previewAssignmentTargetRows returns row-level validation results', async () => {
  const classRow = { id: 'CLASS-1', orgId: '900000' };
  const sessions = [
    { sessionId: 'S1', date: '2026-06-10', startTime: '09:00', endTime: '10:00' }
  ];
  const targetRows = [{
    rowId: 'row_1',
    targetType: 'session',
    sessionId: 'S1',
    sessionDate: '2026-06-10',
    reportStartDate: '2026-06-10',
    reportDueDate: '2026-06-10',
    taskStartTime: '09:00',
    taskEndTime: '10:00',
    conflictPermitted: true,
    timesheetReflection: false,
    allocatedHours: 0,
    teacherId: 'TEACHER-1',
    status: 'active'
  }, {
    rowId: 'row_2',
    targetType: 'date',
    dueDate: '2026-06-10',
    reportStartDate: '2026-06-10',
    reportDueDate: '2026-06-10',
    taskStartTime: '',
    taskEndTime: '',
    conflictPermitted: false,
    timesheetReflection: false,
    allocatedHours: 0,
    teacherId: '',
    status: 'active'
  }];

  await withPatched(schoolDataService, {
    getDataById: async (entityType, id) => (entityType === 'classes' && id === 'CLASS-1' ? classRow : null),
    getClassSessions: async () => sessions
  }, async () => {
  await withPatched(reportIntegrityService, {
    previewAssignmentTargetRows: reportIntegrityService.previewAssignmentTargetRows
  }, async () => {
    const payload = await reportIntegrityService.previewAssignmentTargetRows({
      classId: 'CLASS-1',
      targetRows,
      reqUser: { id: 'USER-1', activeOrgId: '900000' }
    });
    assert.equal(payload.rows.length, 2);
    assert.equal(payload.rows[0].valid, true);
    assert.equal(payload.rows[1].valid, false);
    assert.ok(payload.rows[1].errors.length > 0);
  });
  });
});

test('generateAssignmentTargetRows controller returns generated rows', async () => {
  const sessions = [
    { sessionId: 'S1', date: '2026-06-10', startTime: '09:00', endTime: '10:00', delivery: { deliveredBy: 'T1' } },
    { sessionId: 'S2', date: '2026-06-20', startTime: '09:00', endTime: '10:00', delivery: { deliveredBy: 'T1' } }
  ];
  let responseBody = null;
  const res = {
    json(payload) {
      responseBody = payload;
      return payload;
    },
    status() { return this; }
  };

  await withPatched(schoolDataService, {
    getClassSessions: async () => sessions
  }, async () => {
    await reportController.generateAssignmentTargetRows({
      body: {
        classId: 'CLASS-1',
        preset: SCHEDULE_PRESETS.END_OF_EACH_DAY,
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        linkSessions: true,
        defaults: {
          teacherId: 'T1',
          taskStartTime: '09:00',
          taskEndTime: '10:00',
          status: 'active'
        }
      },
      user: { id: 'USER-1' }
    }, res);
  });

  assert.equal(responseBody?.status, 'success');
  assert.equal(responseBody?.rows?.length, 2);
  assert.equal(responseBody?.rows?.[0]?.targetType, 'session');
});
