'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

const sessionAccessPolicyService = require('../packages/school/MVC/services/school/sessionAccessPolicyService');
const sessionAttendanceEditAccessService = require('../packages/school/MVC/services/school/sessionAttendanceEditAccessService');
const sessionStatusPolicyService = require('../packages/school/MVC/services/school/sessionStatusPolicyService');
const sessionNotificationJob = require('../packages/school/MVC/services/school/sessionNotificationJob');
const sessionNotificationLedgerModel = require('../packages/school/MVC/models/school/sessionNotificationLedgerModel');

test('session access settings catalog includes session-access group', () => {
  const catalog = require('../packages/school/MVC/config/schoolSettingsCatalog');
  const entry = catalog.listSchoolSettingsGroups().find((row) => row.key === 'session-access');
  assert.ok(entry);
  assert.equal(entry.title, 'Session Access & Edit');
  assert.equal(entry.icon, 'bi-shield-lock');
});

test('session access policy service normalizes defaults and validates templates', () => {
  const policy = sessionAccessPolicyService.resolvePolicy({});
  assert.equal(policy.uncompletedSessionNotification.enabled, false);
  assert.equal(policy.uncompletedSessionNotification.sendWhen, 'same_day');
  assert.equal(policy.uncompletedSessionNotification.sendAtTime, '18:00');
  assert.equal(policy.completedSessionAttendanceEdit.enabled, true);
  assert.equal(policy.completedSessionAttendanceEdit.windowType, 'timesheet_period');

  const normalized = sessionAccessPolicyService.validatePolicyInput({
    uncompletedSessionNotification: {
      enabled: true,
      sendWhen: 'next_day',
      sendAtTime: '07:30',
      channels: {
        email: {
          enabled: true,
          subjectTemplate: 'Hello {{className}}',
          bodyTemplate: 'Session {{sessionId}} on {{sessionDate}}'
        },
        sms: {
          enabled: true,
          bodyTemplate: 'Reminder {{teacherName}}'
        }
      }
    },
    completedSessionAttendanceEdit: {
      enabled: true,
      windowType: 'days_after_session',
      daysAfterSession: 4
    }
  });
  assert.equal(normalized.uncompletedSessionNotification.sendWhen, 'next_day');
  assert.equal(normalized.completedSessionAttendanceEdit.daysAfterSession, 4);

  assert.throws(
    () => sessionAccessPolicyService.validatePolicyInput({
      completedSessionAttendanceEdit: {
        enabled: true,
        windowType: 'days_after_session',
        daysAfterSession: null
      }
    }),
    /Days after session is required/
  );

  assert.throws(
    () => sessionAccessPolicyService.validatePolicyInput({
      uncompletedSessionNotification: {
        channels: {
          email: { subjectTemplate: 'Bad {{unknownToken}}' }
        }
      }
    }),
    /Unknown template placeholder/
  );
});

test('session access policy service renders supported template placeholders', () => {
  const rendered = sessionAccessPolicyService.renderTemplate(
    'Class {{className}} ({{classId}}) — {{sessionName}} on {{sessionDate}} {{sessionTime}} for {{teacherName}} at {{orgName}}: {{sessionManagerUrl}}',
    {
      className: 'Algebra I',
      classId: 'CLS-1',
      sessionName: '2026-01-15 09:00-10:00 Room A',
      sessionId: 'SES-1',
      sessionDate: '2026-01-15',
      sessionTime: '09:00 - 10:00',
      teacherName: 'Taylor Smith',
      orgName: 'Example School',
      sessionManagerUrl: '/school/classes/CLS-1/sessions/SES-1'
    }
  );
  assert.match(rendered, /Algebra I/);
  assert.match(rendered, /CLS-1/);
  assert.match(rendered, /Taylor Smith/);
  assert.match(rendered, /\/school\/classes\/CLS-1\/sessions\/SES-1/);
});

test('attendance edit deadline resolver handles week, month, timesheet, and days windows', () => {
  const basePolicy = sessionAccessPolicyService.resolvePolicy({
    completedSessionAttendanceEdit: { enabled: true, windowType: 'end_of_week', daysAfterSession: null }
  });
  assert.equal(
    sessionAttendanceEditAccessService.resolveDeadlineDateKey({
      policy: basePolicy,
      session: { date: '2026-01-15', completedAt: '2026-01-15T16:00:00.000Z' }
    }),
    '2026-01-18'
  );

  const monthPolicy = sessionAccessPolicyService.resolvePolicy({
    completedSessionAttendanceEdit: { enabled: true, windowType: 'end_of_month', daysAfterSession: null }
  });
  assert.equal(
    sessionAttendanceEditAccessService.resolveDeadlineDateKey({
      policy: monthPolicy,
      session: { date: '2026-01-15', completedAt: '2026-01-15T16:00:00.000Z' }
    }),
    '2026-01-31'
  );

  const timesheetPolicy = sessionAccessPolicyService.resolvePolicy({
    completedSessionAttendanceEdit: { enabled: true, windowType: 'timesheet_period', daysAfterSession: null }
  });
  assert.equal(
    sessionAttendanceEditAccessService.resolveDeadlineDateKey({
      policy: timesheetPolicy,
      session: { date: '2026-01-15', completedAt: '2026-01-15T16:00:00.000Z' },
      timesheetPeriod: { endDate: '2026-01-20' }
    }),
    '2026-01-20'
  );

  const daysPolicy = sessionAccessPolicyService.resolvePolicy({
    completedSessionAttendanceEdit: { enabled: true, windowType: 'days_after_session', daysAfterSession: 3 }
  });
  assert.equal(
    sessionAttendanceEditAccessService.resolveDeadlineDateKey({
      policy: daysPolicy,
      session: { date: '2026-01-15', completedAt: '2026-01-15T16:00:00.000Z' }
    }),
    '2026-01-18'
  );
});

test('attendance edit enforcement blocks expired windows and allows admin override', async () => {
  const disabledPolicy = sessionAccessPolicyService.resolvePolicy({
    completedSessionAttendanceEdit: { enabled: false, windowType: 'timesheet_period', daysAfterSession: null }
  });
  const session = {
    status: 'completed',
    date: '2020-01-10',
    completedAt: '2020-01-10T18:00:00.000Z'
  };

  const originalGetStatusMap = sessionStatusPolicyService.getStatusMap;
  const originalIsCompletion = sessionStatusPolicyService.isSessionCompletionStatusByMap;
  sessionStatusPolicyService.getStatusMap = async () => ({ completed: { isFinal: true } });
  sessionStatusPolicyService.isSessionCompletionStatusByMap = () => true;

  try {
    const override = await sessionAttendanceEditAccessService.assertSessionAttendanceEditable({
      orgId: 'ORG-1',
      session,
      policy: disabledPolicy,
      orgTimeZone: 'UTC',
      now: new Date('2020-01-12T00:00:00.000Z'),
      canOverride: true
    });
    assert.equal(override.reason, 'admin_override');

    await assert.rejects(
      () => sessionAttendanceEditAccessService.assertSessionAttendanceEditable({
        orgId: 'ORG-1',
        session,
        policy: disabledPolicy,
        orgTimeZone: 'UTC',
        now: new Date('2020-01-12T00:00:00.000Z'),
        canOverride: false
      }),
      (error) => error.code === 'SESSION_ATTENDANCE_EDIT_WINDOW_EXPIRED'
    );
  } finally {
    sessionStatusPolicyService.getStatusMap = originalGetStatusMap;
    sessionStatusPolicyService.isSessionCompletionStatusByMap = originalIsCompletion;
  }
});

test('notification scheduler resolves same-day and next-day session dates', () => {
  const sameDayPolicy = sessionAccessPolicyService.resolvePolicy({
    uncompletedSessionNotification: { enabled: true, sendWhen: 'same_day', sendAtTime: '18:00' }
  });
  const nextDayPolicy = sessionAccessPolicyService.resolvePolicy({
    uncompletedSessionNotification: { enabled: true, sendWhen: 'next_day', sendAtTime: '18:00' }
  });
  const now = new Date('2026-02-10T18:00:00.000Z');
  assert.equal(
    sessionNotificationJob.resolveTargetSessionDate(sameDayPolicy, 'UTC', now),
    '2026-02-10'
  );
  assert.equal(
    sessionNotificationJob.resolveTargetSessionDate(nextDayPolicy, 'UTC', now),
    '2026-02-09'
  );
  assert.equal(sessionNotificationJob.shouldRunForOrgNow(sameDayPolicy, 'UTC', now), true);
  assert.equal(
    sessionNotificationJob.shouldRunForOrgNow(sameDayPolicy, 'UTC', new Date('2026-02-10T17:59:00.000Z')),
    false
  );
});

test('notification ledger dedupe keys are stable per org, session, teacher, channel, and send date', () => {
  const key = sessionNotificationLedgerModel.buildDedupeKey({
    orgId: 'ORG-1',
    sessionId: 'SES-1',
    teacherId: 'TEA-1',
    channel: 'email',
    sendWhenDate: '2026-02-10'
  });
  assert.equal(key, 'ORG-1::SES-1::TEA-1::email::2026-02-10');
});

test('session access settings routes, controller, and session manager enforcement are wired', () => {
  const routes = read('packages/school/MVC/routes/schoolSettingsRoutes.js');
  const controller = read('packages/school/MVC/controllers/school/schoolSettingsController.js');
  const classController = read('packages/school/MVC/controllers/school/classController.js');
  const attendanceController = read('packages/school/MVC/controllers/school/attendanceController.js');
  const sessionView = read('packages/school/MVC/views/school/class/sessionManager.ejs');
  const settingsView = read('packages/school/MVC/views/school/settings/index.ejs');
  const appSource = read('app.js');

  assert.match(routes, /router\.post\('\/session-access'/);
  assert.match(controller, /saveSessionAccessPolicy/);
  assert.match(controller, /sessionAccessPolicyModel\.getPolicyForOrg/);
  assert.match(classController, /sessionAttendanceEditAccessService/);
  assert.match(classController, /originalSession\.completedAt/);
  assert.match(classController, /attendanceEditLocked/);
  assert.match(attendanceController, /assertSessionAttendanceEditable/);
  assert.match(sessionView, /Attendance Edit Window Closed/);
  assert.match(settingsView, /id="session-access"/);
  assert.match(settingsView, /\/school\/settings\/session-access/);
  assert.match(appSource, /sessionNotificationSchedulerService\.start/);
});
