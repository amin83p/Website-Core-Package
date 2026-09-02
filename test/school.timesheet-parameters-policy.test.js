'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const timesheetParametersPolicyService = require('../packages/school/MVC/services/school/timesheetParametersPolicyService');
const studentLabelService = require('../packages/school/MVC/services/school/timesheetSessionStudentLabelService');
const classEnrollmentReadService = require('../packages/school/MVC/services/school/classEnrollmentReadService');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

const {
  EMPTY_ENROLLMENT_SESSION_MODES,
  applyEmptyEnrollmentSessionsPolicy,
  hasBlockingIncompleteClassSource,
  resolvePolicy,
  validatePolicyInput
} = timesheetParametersPolicyService;

test('timesheet parameters catalog and settings UI are wired', () => {
  const catalog = require('../packages/school/MVC/config/schoolSettingsCatalog');
  const entry = catalog.listSchoolSettingsGroups().find((row) => row.key === 'timesheet-parameters');
  assert.ok(entry);
  assert.equal(entry.title, 'Timesheet Parameters');
  assert.equal(entry.icon, 'bi-calendar2-week');

  const routes = read('packages/school/MVC/routes/schoolSettingsRoutes.js');
  const controller = read('packages/school/MVC/controllers/school/schoolSettingsController.js');
  const view = read('packages/school/MVC/views/school/settings/index.ejs');
  const timesheetController = read('packages/school/MVC/controllers/school/timesheetController.js');

  assert.match(routes, /saveTimesheetParametersPolicy/);
  assert.match(controller, /timesheetParametersPolicyModel\.getPolicyForOrg/);
  assert.match(controller, /saveTimesheetParametersPolicy/);
  assert.match(view, /id="timesheet-parameters"/);
  assert.match(view, /emptyEnrollmentShowWithHours/);
  assert.match(view, /emptyEnrollmentShowWithoutHours/);
  assert.match(view, /emptyEnrollmentHide/);
  assert.match(view, /statutoryHolidayPayEnabled/);
  assert.match(timesheetController, /applyEmptyEnrollmentSessionsPolicy/);
  assert.match(timesheetController, /emptyEnrollmentHoursSuppressed/);
});

test('timesheet parameters policy defaults to hide and rejects invalid form values', () => {
  const policy = resolvePolicy({});
  assert.equal(policy.emptyEnrollmentSessions, EMPTY_ENROLLMENT_SESSION_MODES.HIDE);

  assert.equal(
    resolvePolicy({ emptyEnrollmentSessions: 'show_with_hours' }).emptyEnrollmentSessions,
    'show_with_hours'
  );
  assert.equal(
    resolvePolicy({ emptyEnrollmentSessions: 'unknown-mode' }).emptyEnrollmentSessions,
    'hide'
  );

  const saved = validatePolicyInput({ emptyEnrollmentSessions: 'show_without_hours' });
  assert.equal(saved.emptyEnrollmentSessions, 'show_without_hours');
  assert.equal(saved.statutoryHolidayPay.enabled, true);
  assert.equal(saved.statutoryHolidayPay.minWorkdays, 30);

  assert.throws(
    () => validatePolicyInput({ emptyEnrollmentSessions: 'not-a-mode' }),
    /no student enrollment/i
  );
});

test('empty-enrollment policy hides, zeros hours, or keeps hours on class sessions', () => {
  const emptySession = {
    sessionId: 'SES-EMPTY',
    classId: 'CLASS-1',
    enrolledStudentCount: 0,
    hours: 2,
    timesheetHours: 2,
    durationHours: 2,
    isFinalStatus: true
  };
  const enrolledSession = {
    sessionId: 'SES-ENROLLED',
    classId: 'CLASS-1',
    enrolledStudentCount: 2,
    hours: 3,
    timesheetHours: 3,
    durationHours: 3,
    isFinalStatus: true
  };
  const activitySession = {
    sessionId: 'act-1',
    isSchoolActivity: true,
    enrolledStudentCount: 0,
    hours: 1,
    timesheetHours: 1
  };

  const hidden = applyEmptyEnrollmentSessionsPolicy(
    [emptySession, enrolledSession, activitySession],
    { emptyEnrollmentSessions: 'hide' }
  );
  assert.deepEqual(hidden.map((row) => row.sessionId), ['SES-ENROLLED', 'act-1']);

  const withoutHours = applyEmptyEnrollmentSessionsPolicy(
    [emptySession, enrolledSession],
    { emptyEnrollmentSessions: 'show_without_hours' }
  );
  assert.equal(withoutHours.length, 2);
  assert.equal(withoutHours[0].timesheetHours, 0);
  assert.equal(withoutHours[0].hours, 0);
  assert.equal(withoutHours[0].durationHours, 2);
  assert.equal(withoutHours[0].emptyEnrollmentHoursSuppressed, true);
  assert.equal(withoutHours[1].timesheetHours, 3);

  const withHours = applyEmptyEnrollmentSessionsPolicy(
    [emptySession],
    { emptyEnrollmentSessions: 'show_with_hours' }
  );
  assert.equal(withHours[0].timesheetHours, 2);
  assert.equal(withHours[0].emptyEnrollmentHoursSuppressed, undefined);
});

test('hiding empty-enrollment incomplete class sessions does not leave a submit blocker', () => {
  const incompleteEmpty = {
    sessionId: 'SES-EMPTY',
    sessionType: 'class',
    enrolledStudentCount: 0,
    isFinalStatus: false,
    isProvisional: false
  };
  const incompleteEnrolled = {
    sessionId: 'SES-ENROLLED',
    sessionType: 'class',
    enrolledStudentCount: 1,
    isFinalStatus: false,
    isProvisional: false
  };

  const hidden = applyEmptyEnrollmentSessionsPolicy(
    [incompleteEmpty, incompleteEnrolled],
    { emptyEnrollmentSessions: 'hide' }
  );
  assert.deepEqual(hidden.map((row) => row.sessionId), ['SES-ENROLLED']);
  assert.equal(hasBlockingIncompleteClassSource(hidden), true);

  const onlyEmptyHidden = applyEmptyEnrollmentSessionsPolicy(
    [incompleteEmpty],
    { emptyEnrollmentSessions: 'hide' }
  );
  assert.deepEqual(onlyEmptyHidden, []);
  assert.equal(hasBlockingIncompleteClassSource(onlyEmptyHidden), false);
});

test('live session enrichment stamps enrolledStudentCount from active enrollments on the session date', async () => {
  const original = classEnrollmentReadService.listActiveStudentIdsForClass;
  const calls = [];
  classEnrollmentReadService.listActiveStudentIdsForClass = async (args) => {
    calls.push(args);
    return {
      studentIds: args.classId === 'CLASS-EMPTY' ? new Set() : new Set(['STU-1'])
    };
  };

  try {
    const enriched = await studentLabelService.enrichClassLiveSessions({
      classRows: [
        { id: 'CLASS-EMPTY', registrationMode: 'term_based' },
        { id: 'CLASS-ONE', registrationMode: 'term_based' }
      ],
      liveSessionBuilders: [
        {
          classId: 'CLASS-EMPTY',
          sessionRow: {
            sessionId: 'SES-EMPTY',
            status: 'completed',
            date: '2026-07-08',
            roster: []
          },
          payload: {
            sessionId: 'SES-EMPTY',
            classId: 'CLASS-EMPTY',
            date: '2026-07-08',
            timesheetHours: 2,
            durationHours: 2
          }
        },
        {
          classId: 'CLASS-ONE',
          sessionRow: {
            sessionId: 'SES-ONE',
            status: 'completed',
            date: '2026-07-08',
            roster: [{ personId: 'PER-1', attendance: 'present' }]
          },
          payload: {
            sessionId: 'SES-ONE',
            classId: 'CLASS-ONE',
            date: '2026-07-08',
            timesheetHours: 2,
            durationHours: 2
          }
        }
      ],
      students: [{ id: 'STU-1', personId: 'PER-1' }],
      persons: [{ id: 'PER-1', name: { first: 'Ada', last: 'Lovelace' } }],
      departments: [],
      statusMap: new Map([['completed', { code: 'completed', makeUpRequired: false }]]),
      periodStartDate: '2026-07-01',
      periodEndDate: '2026-07-15',
      activeOrgId: 'ORG-1',
      reqUser: { id: 'USER-1' }
    });

    assert.equal(enriched.find((row) => row.sessionId === 'SES-EMPTY')?.enrolledStudentCount, 0);
    assert.equal(enriched.find((row) => row.sessionId === 'SES-ONE')?.enrolledStudentCount, 1);
    assert.ok(calls.every((call) => call.startDate === '2026-07-08' && call.canonicalStatuses.includes('active')));

    const hidden = applyEmptyEnrollmentSessionsPolicy(enriched, { emptyEnrollmentSessions: 'hide' });
    assert.deepEqual(hidden.map((row) => row.sessionId), ['SES-ONE']);
  } finally {
    classEnrollmentReadService.listActiveStudentIdsForClass = original;
  }
});
