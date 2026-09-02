const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const studentLabelService = require('../packages/school/MVC/services/school/timesheetSessionStudentLabelService');
const classEnrollmentReadService = require('../packages/school/MVC/services/school/classEnrollmentReadService');
const timesheetModel = require('../packages/school/MVC/models/school/timesheetModel');

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

test('period student context qualifies exactly one unique student across the whole period', () => {
  const maps = {
    studentToPersonMap: new Map([
      ['STU-1', 'PER-1'],
      ['STU-2', 'PER-2']
    ]),
    personNameMap: new Map([
      ['PER-1', 'Ada Lovelace'],
      ['PER-2', 'Grace Hopper']
    ])
  };
  const one = studentLabelService.buildPeriodStudentContext(new Set(['STU-1']), maps);
  assert.equal(one.isOneOnOne, true);
  assert.equal(one.singleStudentId, 'STU-1');
  assert.equal(one.singleStudentPersonId, 'PER-1');
  assert.equal(one.singleStudentName, 'Ada Lovelace');

  const sequentialStudents = studentLabelService.buildPeriodStudentContext(new Set(['STU-1', 'STU-2']), maps);
  assert.equal(sequentialStudents.isOneOnOne, false);
  assert.equal(sequentialStudents.singleStudentId, '');
  assert.equal(studentLabelService.buildPeriodStudentContext(new Set(), maps).isOneOnOne, false);
});

test('period class context uses the full timesheet window for term and rolling classes', async () => {
  const original = classEnrollmentReadService.listActiveStudentIdsForClass;
  const calls = [];
  classEnrollmentReadService.listActiveStudentIdsForClass = async (options) => {
    calls.push(options);
    return {
      studentIds: options.classId === 'CLASS-TERM'
        ? new Set(['STU-1'])
        : new Set(['STU-2', 'STU-3'])
    };
  };

  try {
    const result = await studentLabelService.buildPeriodClassStudentContextById([
      { id: 'CLASS-TERM', registrationMode: 'term_based' },
      { id: 'CLASS-ROLL', registrationMode: 'rolling' }
    ], {
      periodStartDate: '2026-07-01',
      periodEndDate: '2026-07-15',
      activeOrgId: 'ORG-1',
      studentToPersonMap: new Map([['STU-1', 'PER-1']]),
      personNameMap: new Map([['PER-1', 'Ada Lovelace']]),
      reqUser: { id: 'USER-1' }
    });

    assert.equal(result.get('CLASS-TERM').isOneOnOne, true);
    assert.equal(result.get('CLASS-ROLL').isOneOnOne, false);
    assert.equal(calls.length, 2);
    calls.forEach((call) => {
      assert.equal(call.startDate, '2026-07-01');
      assert.equal(call.endDate, '2026-07-15');
      assert.ok(call.canonicalStatuses.includes('completed'));
      assert.ok(call.canonicalStatuses.includes('withdrawn'));
    });
  } finally {
    classEnrollmentReadService.listActiveStudentIdsForClass = original;
  }
});

test('live session enrichment applies department, whole-period one-on-one, attendance, and Optional metadata', async () => {
  const original = classEnrollmentReadService.listActiveStudentIdsForClass;
  classEnrollmentReadService.listActiveStudentIdsForClass = async ({ classId }) => ({
    studentIds: classId === 'CLASS-ONE'
      ? new Set(['STU-1'])
      : new Set(['STU-2', 'STU-3'])
  });

  try {
    const classes = [
      { id: 'CLASS-ONE', registrationMode: 'term_based', deliveryDepartmentId: 'DEP-1' },
      { id: 'CLASS-MULTI', registrationMode: 'rolling', deliveryDepartmentId: 'DEP-2' }
    ];
    const enriched = await studentLabelService.enrichClassLiveSessions({
      classRows: classes,
      liveSessionBuilders: [
        {
          classId: 'CLASS-ONE',
          sessionRow: {
            sessionId: 'SES-ABSENT',
            status: 'completed',
            roster: [{ personId: 'PER-1', attendance: 'absent' }]
          },
          payload: { sessionId: 'SES-ABSENT', classId: 'CLASS-ONE', hours: 0 }
        },
        {
          classId: 'CLASS-ONE',
          sessionRow: {
            sessionId: 'SES-EXCUSED',
            status: 'completed',
            roster: [{ personId: 'PER-1', attendance: 'excused' }]
          },
          payload: { sessionId: 'SES-EXCUSED', classId: 'CLASS-ONE', hours: 0 }
        },
        {
          classId: 'CLASS-ONE',
          sessionRow: {
            sessionId: 'SES-ACF',
            status: 'completed',
            roster: [{ personId: 'PER-1', attendance: 'acf' }]
          },
          payload: { sessionId: 'SES-ACF', classId: 'CLASS-ONE', hours: 0 }
        },
        {
          classId: 'CLASS-ONE',
          sessionRow: {
            sessionId: 'SES-MAKEUP',
            status: 'missed',
            roster: [{ personId: 'PER-1', attendance: 'not_applicable' }]
          },
          payload: { sessionId: 'SES-MAKEUP', classId: 'CLASS-ONE', hours: 0 }
        },
        {
          classId: 'CLASS-MULTI',
          sessionRow: {
            sessionId: 'SES-MULTI',
            status: 'missed',
            roster: [{ personId: 'PER-2', attendance: 'absent' }]
          },
          payload: { sessionId: 'SES-MULTI', classId: 'CLASS-MULTI', hours: 0 }
        }
      ],
      students: [
        { id: 'STU-1', personId: 'PER-1' },
        { id: 'STU-2', personId: 'PER-2' },
        { id: 'STU-3', personId: 'PER-3' }
      ],
      persons: [
        { id: 'PER-1', name: { first: 'Ada', last: 'Lovelace' } },
        { id: 'PER-2', name: { first: 'Grace', last: 'Hopper' } },
        { id: 'PER-3', name: { first: 'Katherine', last: 'Johnson' } }
      ],
      departments: [
        { id: 'DEP-1', code: 'EAL' },
        { id: 'DEP-2', code: 'CMP' }
      ],
      statusMap: new Map([
        ['completed', { code: 'completed', makeUpRequired: false }],
        ['missed', { code: 'missed', makeUpRequired: true }]
      ]),
      periodStartDate: '2026-07-01',
      periodEndDate: '2026-07-15',
      activeOrgId: 'ORG-1',
      reqUser: { id: 'USER-1' }
    });

    assert.deepEqual(enriched.map((row) => ({
      id: row.sessionId,
      departmentCode: row.deliveryDepartmentCode,
      oneOnOne: row.isOneOnOne,
      attendance: row.singleStudentAttendance,
      optional: row.showOptionalBadge
    })), [
      { id: 'SES-ABSENT', departmentCode: 'EAL', oneOnOne: true, attendance: 'absent', optional: true },
      { id: 'SES-EXCUSED', departmentCode: 'EAL', oneOnOne: true, attendance: 'excused', optional: true },
      { id: 'SES-ACF', departmentCode: 'EAL', oneOnOne: true, attendance: 'acf', optional: true },
      { id: 'SES-MAKEUP', departmentCode: 'EAL', oneOnOne: true, attendance: 'not_applicable', optional: true },
      { id: 'SES-MULTI', departmentCode: 'CMP', oneOnOne: false, attendance: '', optional: false }
    ]);
  } finally {
    classEnrollmentReadService.listActiveStudentIdsForClass = original;
  }
});

test('Optional badge metadata is informational for absent-like and makeup-required one-on-one sessions', () => {
  ['absent', 'excused', 'acf', 'Absent Camera Off'].forEach((attendance) => {
    assert.equal(studentLabelService.shouldShowOptionalBadge({
      isOneOnOne: true,
      attendance,
      makeUpRequired: false,
      hours: 0
    }), true);
  });
  assert.equal(studentLabelService.shouldShowOptionalBadge({
    isOneOnOne: true,
    attendance: 'present',
    makeUpRequired: true,
    hours: 0
  }), true);
  ['present', 'late', '', 'not_applicable'].forEach((attendance) => {
    assert.equal(studentLabelService.shouldShowOptionalBadge({
      isOneOnOne: true,
      attendance,
      makeUpRequired: false
    }), false);
  });
  assert.equal(studentLabelService.shouldShowOptionalBadge({
    isOneOnOne: false,
    attendance: 'absent',
    makeUpRequired: true
  }), false);
});

test('department code and sole-student attendance resolve from canonical identifiers', () => {
  const departmentMap = studentLabelService.buildDepartmentCodeMap([
    { id: 'DEP-1', code: 'EAL', name: 'English as an Additional Language' }
  ]);
  assert.equal(studentLabelService.resolveDepartmentCode({ deliveryDepartmentId: 'DEP-1' }, departmentMap), 'EAL');
  assert.equal(studentLabelService.resolveDepartmentCode({ deliveryDepartmentId: 'DEP-MISSING' }, departmentMap), '');
  assert.equal(studentLabelService.resolveSingleStudentAttendance({
    roster: [{ personId: 'PER-1', attendance: 'Absent' }]
  }, {
    isOneOnOne: true,
    singleStudentId: 'STU-1',
    singleStudentPersonId: 'PER-1'
  }), 'absent');
});

test('timesheet sanitizers retain trusted class display metadata in entries and snapshots', () => {
  const entry = {
    sessionId: 'SES-1',
    date: '2026-07-02',
    classId: 'CLASS-1',
    className: 'Legacy class label',
    hours: 0,
    status: 'missed',
    isManual: false,
    deliveryDepartmentId: 'DEP-1',
    deliveryDepartmentName: 'English as an Additional Language',
    deliveryDepartmentCode: 'EAL',
    isOneOnOne: true,
    singleStudentId: 'STU-1',
    singleStudentPersonId: 'PER-1',
    singleStudentName: 'Ada Lovelace',
    singleStudentAttendance: 'not_applicable',
    makeUpRequired: true,
    showOptionalBadge: true
  };
  const snapshot = timesheetModel.sanitizeSnapshotEntry(entry);
  assert.equal(snapshot.deliveryDepartmentCode, 'EAL');
  assert.equal(snapshot.isOneOnOne, true);
  assert.equal(snapshot.singleStudentName, 'Ada Lovelace');
  assert.equal(snapshot.makeUpRequired, true);
  assert.equal(snapshot.showOptionalBadge, true);

  const payload = timesheetModel.sanitizeTimesheetPayload({
    orgId: 'ORG-1',
    periodId: 'PERIOD-1',
    teacherId: 'TEACHER-1',
    status: 'draft',
    entries: [entry]
  });
  assert.equal(payload.entries[0].deliveryDepartmentCode, 'EAL');
  assert.equal(payload.entries[0].showOptionalBadge, true);
  assert.equal(payload.totalHours, 0);

  const paidOptional = timesheetModel.sanitizeTimesheetPayload({
    orgId: 'ORG-1',
    periodId: 'PERIOD-1',
    teacherId: 'TEACHER-1',
    status: 'draft',
    entries: [{ ...entry, hours: 1.5, showOptionalBadge: true }]
  });
  const paidWithoutBadge = timesheetModel.sanitizeTimesheetPayload({
    orgId: 'ORG-1',
    periodId: 'PERIOD-1',
    teacherId: 'TEACHER-1',
    status: 'draft',
    entries: [{ ...entry, hours: 1.5, showOptionalBadge: false }]
  });
  assert.equal(paidOptional.totalHours, 1.5);
  assert.equal(paidOptional.totalHours, paidWithoutBadge.totalHours);
});

test('timesheet editor exposes student column, date add action, date formatter, and department totals', () => {
  const editor = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');
  const controller = read('packages/school/MVC/controllers/school/timesheetController.js');

  assert.match(editor, /Student Name/);
  assert.match(editor, /singleStudentName/);
  assert.match(editor, /Hours\/Time \(Hrs\)/);
  assert.match(editor, /buildClassDescriptionCellHtml/);
  assert.match(editor, /buildRegularHoursTimeCellHtml/);
  assert.match(editor, /buildSessionScheduleLabelHtml/);
  assert.match(editor, /buildOptionalHoursCellHtml/);
  assert.match(editor, /ts-col-hours-optional/);
  assert.doesNotMatch(editor, /buildHoursTimeCellHtml/);
  assert.doesNotMatch(editor, /<th class="text-end" style="width: 90px;">Hours<\/th>/);
  assert.match(editor, /formatTimesheetDateLabel/);
  assert.match(editor, /ts-date-add-btn/);
  assert.match(editor, /openManualModal/);
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

test('timesheet editor uses compact centered status and action columns', () => {
  const editor = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');

  assert.match(editor, /#tsTable th\.ts-col-status,[\s\S]*?vertical-align: middle !important;/);
  assert.match(editor, /#tsTable thead th \{[\s\S]*?text-align: center !important;[\s\S]*?vertical-align: middle !important;/);
  assert.match(editor, /<th class="ts-col-status" rowspan="2">Status<\/th>/);
  assert.match(editor, /#tsTable th\.ts-col-actions,[\s\S]*?width: 88px;/);
  assert.match(editor, /<th class="ts-col-actions" rowspan="2">Act<\/th>/);
  assert.match(editor, /<th class="ts-col-hours-regular">Regular<\/th>/);
  assert.match(editor, /<th class="ts-col-hours-optional">Optional<\/th>/);
  assert.match(editor, /class="ts-action-stack"/);
  assert.match(editor, /flex-wrap: wrap;/);
  assert.doesNotMatch(editor, /<th class="text-center" style="width: 120px;">Act<\/th>/);
});

test('timesheet statutory holiday status chip opens calculation modal with step details', () => {
  const editor = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');

  assert.match(editor, /id="statHolidayCalcModal"/);
  assert.match(editor, /id="statHolidayCalcSummary"/);
  assert.match(editor, /id="statHolidayCalcSteps"/);
  assert.match(editor, /id="statHolidayCalcFallback"/);
  assert.match(editor, /id="statHolidayCalcOverride"/);
  assert.match(editor, /ts-status-chip--interactive ts-stat-holiday-status-trigger/);
  assert.match(editor, /aria-controls="statHolidayCalcModal"/);
  assert.match(editor, /function buildStatHolidayCalculationStepsHtml\(entry\)/);
  assert.match(editor, /Step 1: Minimum workdays check/);
  assert.match(editor, /Step 7: Average-hours formula/);
  assert.match(editor, /Calculation details are not available for this statutory holiday entry\./);
  assert.match(editor, /window\.openStatHolidayCalculationModal = function\(sessionId\)/);
  assert.match(editor, /event\.target\.closest\('\.ts-stat-holiday-status-trigger'\)/);
  assert.match(editor, /interactive = false, sessionId = ''/);
  assert.match(editor, /if \(isStatutoryHolidayEntry\(entry\)\) \{[\s\S]*?interactive: true,[\s\S]*?sessionId: String\(entry\?\.sessionId \|\| ''\)/);
});

test('timesheet identity is grouped under the title and Date cells avoid repeated weekdays', () => {
  const editor = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');

  assert.match(editor, /<h1[^>]*>[^<]*<i[^>]*><\/i>Timesheet<\/h1>\s*<div class="ts-timesheet-summary"/);
  assert.match(editor, /aria-label="Timesheet details"/);
  assert.match(editor, /<div class="ts-period-name"><%= period\.name %><\/div>/);
  assert.match(editor, /<span class="ts-person-name"><%= personDisplayName %><\/span>/);
  assert.match(editor, /class="ts-meta-card ts-meta-card--period"/);
  assert.match(editor, /class="ts-meta-card ts-meta-card--deadline"/);
  assert.match(editor, /<span class="ts-meta-card__label">Period<\/span>/);
  assert.match(editor, /<time datetime="<%= period\.startDate %>"><%= period\.startDate %><\/time>/);
  assert.match(editor, /<time datetime="<%= period\.endDate %>"><%= period\.endDate %><\/time>/);
  assert.match(editor, /<span class="ts-meta-card__label">Submission Deadline<\/span>/);
  assert.match(editor, /<time class="ts-meta-card__value" datetime="<%= deadlineDate === '-' \? '' : deadlineLabel %>"><%= deadlineLabel %><\/time>/);
  assert.match(editor, /bi-calendar-range/);
  assert.match(editor, /bi-alarm/);
  assert.doesNotMatch(editor, /ts-meta-separator/);
  assert.match(editor, /\.ts-timesheet-summary \{/);
  assert.match(editor, /grid-template-columns: repeat\(2, minmax\(230px, 1fr\)\)/);
  assert.match(editor, /@media \(max-width: 767\.98px\)/);

  assert.match(editor, /function formatTimesheetDatePart\(dateStr, options\)/);
  assert.match(editor, /\.ts-date-label,\s*\.ts-day-name \{\s*font-size: 1rem;\s*font-weight: 700;\s*letter-spacing: 0\.02em;\s*color: #212529;/);
  assert.match(editor, /dayName: formatTimesheetDatePart\(dateStr, \{ weekday: 'long' \}\)/);
  assert.match(editor, /class="ts-day-name \$\{dayClass\}">\$\{dayName\}<\/div>\s*<div class="ts-date-label">\$\{formatTimesheetDatePart\(dateStr, \{ month: 'long', day: 'numeric' \}\)\}<\/div>/);
  assert.doesNotMatch(editor, /class="ts-date-label">\$\{formatTimesheetDateLabel\(dateStr\)\}/);
  assert.match(editor, /new Intl\.DateTimeFormat\(undefined, options\)\.format/);

  const helperStart = editor.indexOf('function formatTimesheetDatePart(dateStr, options)');
  const helperEnd = editor.indexOf('function dateKeyWeekday(dateStr)');
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helperSource = editor.slice(helperStart, helperEnd);
  const formatDatePart = new Function('Intl', 'Date', `${helperSource}; return formatTimesheetDatePart;`)( // eslint-disable-line no-new-func
    {
      DateTimeFormat: function DateTimeFormat(_locale, options) {
        return { format: () => (options?.weekday ? 'Wednesday' : 'July 15') };
      }
    },
    Date
  );
  assert.equal(formatDatePart('2026-07-15', { weekday: 'long' }), 'Wednesday');
  assert.equal(formatDatePart('2026-07-15', { month: 'long', day: 'numeric' }), 'July 15');
});

test('timesheet sessions are ordered chronologically within each day', () => {
  const editor = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');
  const helperStart = editor.indexOf('function normalizeClock(value)');
  const helperEnd = editor.indexOf('function calculateHoursFromRange(startTime, endTime)');
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helperSource = editor.slice(helperStart, helperEnd);
  const sortEntries = new Function(`${helperSource}; return sortTimesheetEntriesBySchedule;`)(); // eslint-disable-line no-new-func

  const entries = [
    { id: 'untimed-first', startTime: '', endTime: '23:00' },
    { id: 'late', startTime: '11:00', endTime: '13:00' },
    { id: 'early-long', startTime: '8:00', endTime: '10:00' },
    { id: 'early-short', startTime: '08:00', endTime: '09:00' },
    { id: 'middle', startTime: '09:30', endTime: '10:30' },
    { id: 'invalid-time', startTime: 'not-a-time', endTime: '00:15' },
    { id: 'untimed-last', endTime: '01:00' }
  ];
  const sorted = sortEntries(entries);

  assert.deepEqual(sorted.map((entry) => entry.id), [
    'early-short',
    'early-long',
    'middle',
    'late',
    'untimed-first',
    'invalid-time',
    'untimed-last'
  ]);
  assert.deepEqual(entries.map((entry) => entry.id), [
    'untimed-first',
    'late',
    'early-long',
    'early-short',
    'middle',
    'invalid-time',
    'untimed-last'
  ]);
  assert.match(editor, /const dayEntries = sortTimesheetEntriesBySchedule\([\s\S]*?activeEntries\.filter\(e => e\.date === dateStr\)/);
});

test('Hours by Department splits group and one-on-one hours by capacity or single-student enrollment', () => {
  const editor = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');

  assert.match(editor, />Group Hours</);
  assert.match(editor, />One-on-One Hours</);
  assert.match(editor, />One-on-One Optional</);
  assert.match(editor, /max capacity of 1 or only one student is enrolled/);
  assert.match(editor, /colspan="6" class="text-center text-muted py-3">No department hours yet\./);
  assert.match(editor, /function resolveDepartmentOptionalHours\(entry\)/);
  assert.match(editor, /showOptionalBadge !== true/);
  assert.match(editor, /oneOnOneOptionalHours/);
  assert.match(editor, /function resolveOptionalReportingHours\(entry\)/);
  assert.doesNotMatch(editor, /Total Optional Hours/);
  assert.doesNotMatch(editor, /const optionalRow = `<tr class="table-info-subtle">/);

  const helperStart = editor.indexOf('function resolveOptionalScheduledBaseHours(entry)');
  const helperEnd = editor.indexOf('function isDepartmentOneOnOneEntry(entry)');
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helperSource = editor.slice(helperStart, helperEnd);
  const resolveOptionalHours = new Function(
    'calculateHoursFromRange',
    'resolveEntryHours',
    `${helperSource}; return resolveOptionalReportingHours;`
  )(
    (startTime, endTime) => (startTime === '09:00' && endTime === '10:30' ? 1.5 : 0),
    (entry) => Number(entry?.timesheetHours || 0)
  );

  assert.equal(resolveOptionalHours({ showOptionalBadge: true, durationHours: 2, timesheetHours: 0 }), 2);
  assert.equal(resolveOptionalHours({ showOptionalBadge: true, startTime: '09:00', endTime: '10:30', timesheetHours: 0 }), 1.5);
  assert.equal(resolveOptionalHours({ showOptionalBadge: true, timesheetHours: 0.75 }), 0.75);
  assert.equal(resolveOptionalHours({ showOptionalBadge: false, durationHours: 2 }), 0);
  assert.equal(resolveOptionalHours({
    showOptionalBadge: true,
    durationHours: 3,
    makeUpRequired: true,
    makeupDurationPercent: 50,
    allowedDurationHours: 1.5
  }), 1.5);
});

test('timesheet Class and Description items expose badges, manager links, and operational tooltips', () => {
  const editor = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');

  assert.match(editor, /ts-one-on-one-badge/);
  assert.match(editor, /badge rounded-pill ts-one-on-one-badge">One on One/);
  assert.doesNotMatch(editor, /ts-one-on-one-label/);

  assert.match(editor, /function buildTimesheetEntryManagerHref\(entry\)/);
  assert.match(editor, /\/school\/activities\/\$\{encodeURIComponent\(activityId\)\}\/work-sessions\/\$\{encodeURIComponent\(activityEntryId\)\}\/manage/);
  assert.match(editor, /\/school\/classes\/\$\{encodeURIComponent\(classId\)\}\/sessions\/\$\{encodeURIComponent\(managedSessionId\)\}/);
  assert.match(editor, /entry\.isManual === true[\s\S]*?entry\.materializedSessionId/);
  assert.match(editor, /entry\.isPriorPeriodAdjustment === true \|\| entry\.isReportReflection === true/);
  assert.match(editor, /class="ts-class-primary-link ts-tooltip-trigger"/);
  assert.match(editor, /target="_blank" rel="noopener noreferrer"/);

  assert.match(editor, /function buildTimesheetEntryTooltip\(entry\)/);
  assert.match(editor, /addDetail\(isActivity \? 'Activity' : 'Class', name\)/);
  assert.match(editor, /addDetail\('Department', department\)/);
  assert.match(editor, /addDetail\('Date', date \? formatTimesheetDateLabel\(date\) : ''\)/);
  assert.match(editor, /addDetail\('Time', time\)/);
  assert.match(editor, /addDetail\('Student', studentName\)/);
  assert.match(editor, /addDetail\('Attendance', attendance \? formatTooltipDetailLabel\(attendance\) : ''\)/);
  assert.match(editor, /addDetail\('Status', status\)/);
  assert.match(editor, /addDetail\('Room', room\)/);
  assert.match(editor, /addDetail\('Role', role\)/);
  assert.match(editor, /data-tip="\$\{escapeHtml\(tooltip\)\}" data-tip-variant="details"/);
  assert.match(editor, /closest\('\.ts-tooltip-trigger'\)/);
  assert.match(editor, /aria-describedby/);
});

test('timesheet manager-link helper resolves class, activity, and materialized rows safely', () => {
  const editor = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');
  const start = editor.indexOf('function isTimesheetActivityEntry(entry)');
  const end = editor.indexOf('function normalizeTooltipDetailValue(value)');
  assert.ok(start >= 0 && end > start);
  const helperSource = editor.slice(start, end);
  const buildHref = new Function(`${helperSource}; return buildTimesheetEntryManagerHref;`)(); // eslint-disable-line no-new-func

  assert.equal(
    buildHref({ classId: 'CLASS/1', sessionId: 'SESSION 1' }),
    '/school/classes/CLASS%2F1/sessions/SESSION%201'
  );
  assert.equal(
    buildHref({ activityId: 'ACT/1', activityEntryId: 'ENTRY 1', sessionId: 'act-1' }),
    '/school/activities/ACT%2F1/work-sessions/ENTRY%201/manage'
  );
  assert.equal(
    buildHref({ isManual: true, classId: 'CLASS-2', sessionId: 'MAN-1', materializedSessionId: 'SESSION-2' }),
    '/school/classes/CLASS-2/sessions/SESSION-2'
  );
  assert.equal(buildHref({ isManual: true, classId: 'CLASS-2', sessionId: 'MAN-1' }), '');
  assert.equal(buildHref({ isSchoolActivity: true, activityId: 'ACT-1', sessionId: 'act-1' }), '');
  assert.equal(buildHref({ isReportReflection: true, classId: 'CLASS-2', sessionId: 'rptref-1' }), '');
  assert.equal(buildHref({ isPriorPeriodAdjustment: true, classId: 'CLASS-2', sessionId: 'adj-1' }), '');
});

test('timesheet operational tooltip includes available details and omits missing fields', () => {
  const editor = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');
  const activityStart = editor.indexOf('function isTimesheetActivityEntry(entry)');
  const activityEnd = editor.indexOf('function buildTimesheetEntryManagerHref(entry)');
  const tooltipStart = editor.indexOf('function normalizeTooltipDetailValue(value)');
  const tooltipEnd = editor.indexOf('function buildClassDescriptionCellHtml(entry)');
  assert.ok(activityStart >= 0 && activityEnd > activityStart);
  assert.ok(tooltipStart >= 0 && tooltipEnd > tooltipStart);
  const helperSource = `${editor.slice(activityStart, activityEnd)}\n${editor.slice(tooltipStart, tooltipEnd)}`;
  const buildTooltip = new Function(
    'isPendingApprovalEntry',
    'isRejectedApprovalEntry',
    'isUnpaidApprovalEntry',
    'resolveStatusLabel',
    'formatTimesheetDateLabel',
    `${helperSource}; return buildTimesheetEntryTooltip;`
  )(
    (entry) => entry?.approvalStatus === 'pending_approval',
    (entry) => entry?.approvalStatus === 'rejected',
    (entry) => entry?.approvalStatus === 'unpaid',
    (status) => String(status).replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()),
    (date) => `Formatted ${date}`
  );

  const classTip = buildTooltip({
    className: 'IELTS Preparation',
    deliveryDepartmentCode: 'EAL',
    deliveryDepartmentName: 'English Language',
    date: '2026-07-15',
    startTime: '09:00',
    endTime: '10:30',
    singleStudentName: 'Ada Lovelace',
    singleStudentAttendance: 'absent',
    status: 'completed',
    room: 'Room 4',
    personRole: 'teacher'
  });
  assert.equal(classTip, [
    'Class: IELTS Preparation',
    'Department: EAL · English Language',
    'Date: Formatted 2026-07-15',
    'Time: 09:00 – 10:30',
    'Student: Ada Lovelace',
    'Attendance: Absent',
    'Status: Completed',
    'Room: Room 4',
    'Role: Teacher'
  ].join('\n'));

  const activityTip = buildTooltip({
    activityId: 'ACT-1',
    activityName: 'Staff Meeting',
    categoryName: 'Administration',
    approvalStatus: 'approved',
    isManual: true,
    singleStudentName: 'Hidden for activities'
  });
  assert.match(activityTip, /^Activity: Staff Meeting/m);
  assert.match(activityTip, /^Category: Administration/m);
  assert.match(activityTip, /^Status: Approved/m);
  assert.doesNotMatch(activityTip, /Student:|Attendance:|undefined|null/);
});

test('timesheet editor template compiles after interaction polish', () => {
  const viewPath = path.join(ROOT_DIR, 'packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');
  const editor = fs.readFileSync(viewPath, 'utf8');
  assert.doesNotThrow(() => ejs.compile(editor, { filename: viewPath }));

  const scripts = Array.from(editor.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g), (match) => match[1]);
  assert.ok(scripts.length > 0);
  scripts.forEach((script) => {
    const parseableScript = script
      .replace(/<%-[\s\S]*?%>/g, 'null')
      .replace(/<%=[\s\S]*?%>/g, 'false');
    assert.doesNotThrow(() => new Function(parseableScript)); // eslint-disable-line no-new-func
  });
});

test('timesheet guidance uses a stepped modal with header launcher', () => {
  const editor = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');

  assert.match(editor, /id="timesheetGuidanceModal"/);
  assert.match(editor, /id="btnTimesheetGuidance"/);
  assert.match(editor, /id="btnPrintTimesheet"/);
  assert.match(editor, /btnPrintTimesheet[\s\S]*btnTimesheetGuidance|btnTimesheetGuidance[\s\S]*btnPrintTimesheet/);
  assert.match(editor, /btn btn-filled btn-edit btn-md mb-2 ts-guidance-launcher/);
  assert.match(editor, /id="timesheetGuidanceBadge"/);
  assert.match(editor, /function buildTimesheetGuidanceSteps\(/);
  assert.match(editor, /function buildGuidanceSessionSummaryTableHtml\(/);
  assert.match(editor, /Incomplete Sessions<\/strong> panel on the page for the full list and links/);
  assert.match(editor, /function initializeTimesheetGuidance\(/);
  assert.match(editor, /function renderTimesheetGuidanceLauncher\(/);
  assert.match(editor, /TIMESHEET_GUIDANCE_BOOT/);
  assert.match(editor, /id="incompleteSessionsPanel"/);
  assert.doesNotMatch(editor, /class="ts-notice-hub"/);
  assert.doesNotMatch(editor, /id="provisionalSessionsSummary"/);
  assert.doesNotMatch(editor, /showIncompleteSessionWarningOnLoad/);
  assert.match(editor, /initializeTimesheetGuidance\(\)/);
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
