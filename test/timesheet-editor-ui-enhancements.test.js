const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const studentLabelService = require('../packages/school/MVC/services/school/timesheetSessionStudentLabelService');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('resolveSingleStudentNameFromPersonIds returns name only when exactly one student applies', () => {
  const personNameMap = new Map([
    ['PER-1', 'Ada Lovelace'],
    ['PER-2', 'Grace Hopper']
  ]);
  assert.equal(studentLabelService.resolveSingleStudentNameFromPersonIds(new Set(['PER-1']), personNameMap), 'Ada Lovelace');
  assert.equal(studentLabelService.resolveSingleStudentNameFromPersonIds(new Set(['PER-1', 'PER-2']), personNameMap), '');
  assert.equal(studentLabelService.resolveSingleStudentNameFromPersonIds(new Set(), personNameMap), '');
});

test('resolveExpectedStudentPersonIdsForSession excludes makeup-forced sessions', () => {
  const statusMap = new Map([
    ['missed_informed24', { code: 'missed_informed24', makeUpRequired: true }]
  ]);
  const personIds = studentLabelService.resolveExpectedStudentPersonIdsForSession({
    classData: { registrationMode: 'term_based' },
    session: { status: 'missed_informed24', date: '2026-06-15' },
    studentToPersonMap: new Map(),
    statusMap,
    rollingApplicability: null,
    termEnrollmentPersonIds: new Set(['PER-1'])
  });
  assert.equal(personIds.size, 0);
});

test('resolveExpectedStudentPersonIdsForSession returns term enrollment students when expected', () => {
  const statusMap = new Map([
    ['completed', { code: 'completed', makeUpRequired: false }]
  ]);
  const personIds = studentLabelService.resolveExpectedStudentPersonIdsForSession({
    classData: { registrationMode: 'term_based' },
    session: { status: 'completed', date: '2026-06-15' },
    studentToPersonMap: new Map(),
    statusMap,
    rollingApplicability: null,
    termEnrollmentPersonIds: new Set(['PER-1', 'PER-2'])
  });
  assert.deepEqual(Array.from(personIds), ['PER-1', 'PER-2']);
});

test('resolveExpectedStudentPersonIdsForSession uses rolling expected state only', () => {
  const statusMap = new Map([
    ['completed', { code: 'completed', makeUpRequired: false }]
  ]);
  const stateByKey = new Map([
    ['PER-1::SES-1', { expected: true, reason: 'expected' }],
    ['PER-2::SES-1', { expected: false, reason: 'not_enrolled' }]
  ]);
  const personIds = studentLabelService.resolveExpectedStudentPersonIdsForSession({
    classData: { registrationMode: 'rolling' },
    session: { sessionId: 'SES-1', status: 'completed', date: '2026-06-15' },
    studentToPersonMap: new Map(),
    statusMap,
    rollingApplicability: {
      personIds: new Set(['PER-1', 'PER-2']),
      stateByKey
    },
    termEnrollmentPersonIds: new Set()
  });
  assert.deepEqual(Array.from(personIds), ['PER-1']);
});

test('timesheet editor exposes student column, day add row, date formatter, and department totals', () => {
  const editor = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');
  const controller = read('packages/school/MVC/controllers/school/timesheetController.js');

  assert.match(editor, /Student Name/);
  assert.match(editor, /singleStudentName/);
  assert.match(editor, /formatTimesheetDateLabel/);
  assert.match(editor, /ts-day-add-row/);
  assert.match(editor, /btn btn-outline-primary w-100/);
  assert.match(editor, /tsDepartmentTotals/);
  assert.match(editor, /renderDepartmentTotals/);
  assert.match(editor, /timesheetCommentModal/);
  assert.match(editor, /ts-comment-trigger/);
  assert.match(editor, /persistTimesheetCommentModal/);
  assert.match(editor, /releaseStrayModalShell/);
  assert.match(editor, /id="timesheetCommentModal"/);
  assert.doesNotMatch(editor, /id="timesheetCommentModal"[^>]*fade/);
  assert.doesNotMatch(editor, /class="form-control form-control-sm ts-comment/);
  assert.doesNotMatch(editor, /buildAddDayButton/);

  assert.match(controller, /timesheetSessionStudentLabelService/);
  assert.match(controller, /enrichClassLiveSessions/);
});

test('timesheet editor and controller expose makeup session status metadata', () => {
  const editor = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');
  const controller = read('packages/school/MVC/controllers/school/timesheetController.js');
  const model = read('packages/school/MVC/models/school/timesheetModel.js');

  assert.match(controller, /buildTimesheetMakeupMeta/);
  assert.match(controller, /isMakeupSession/);
  assert.match(controller, /makeupOriginalSessionId/);
  assert.match(controller, /makeupOriginalClassId/);
  assert.match(controller, /makeupOriginalDate/);
  assert.match(controller, /makeupOriginalStartTime/);

  assert.match(editor, /buildMakeupSessionStatusHtml/);
  assert.match(editor, /buildMakeupOriginalSessionLabel/);
  assert.match(editor, /isMakeupSession/);
  assert.match(editor, /makeupOriginalDate/);
  assert.match(editor, /makeupOriginalStartTime/);
  assert.match(editor, /makeupOriginalEndTime/);
  assert.match(editor, /\/school\/classes\/\$\{encodeURIComponent\(originalClassId\)\}\/sessions\/\$\{encodeURIComponent\(originalSessionId\)\}/);
  assert.match(editor, /bi-arrow-return-left/);

  assert.match(model, /isMakeupSession/);
  assert.match(model, /makeupOriginalSessionId/);
  assert.match(model, /makeupOriginalClassId/);
  assert.match(model, /makeupOriginalDate/);
  assert.match(model, /makeupOriginalStartTime/);
});
