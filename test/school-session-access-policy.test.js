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
const sessionUncompletedNotificationService = require('../packages/school/MVC/services/school/sessionUncompletedNotificationService');

const TEST_EMAIL_TEMPLATE_ID = 'EMTPL_TEST_TEMPLATE';

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
  assert.equal(policy.uncompletedSessionNotification.channels.email.sendWhen, 'daily_all');
  assert.equal(policy.uncompletedSessionNotification.channels.email.sendAtTime, '18:00');
  assert.equal(policy.uncompletedSessionNotification.channels.email.sessionDateRange.type, 'this_week');
  assert.equal(policy.uncompletedSessionNotification.channels.email.emailTemplateId, '');
  assert.equal(policy.uncompletedSessionNotification.channels.sms.sendWhen, 'same_day');
  assert.equal(policy.completedSessionAttendanceEdit.enabled, true);
  assert.equal(policy.completedSessionAttendanceEdit.windowType, 'timesheet_period');

  const normalized = sessionAccessPolicyService.validatePolicyInput({
    uncompletedSessionNotification: {
      enabled: true,
      channels: {
        email: {
          enabled: true,
          emailTemplateId: TEST_EMAIL_TEMPLATE_ID,
          sendWhen: 'next_day',
          sendAtTime: '07:30',
          sessionDateRange: { type: 'this_month', daysBeforeToday: null }
        },
        sms: {
          enabled: true,
          sendWhen: 'daily_all',
          sendAtTime: '08:00',
          sessionDateRange: { type: 'days_before_today', daysBeforeToday: 5 },
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
  assert.equal(normalized.uncompletedSessionNotification.channels.email.sendWhen, 'next_day');
  assert.equal(normalized.uncompletedSessionNotification.channels.sms.sessionDateRange.daysBeforeToday, 5);
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
          sms: {
            sessionDateRange: { type: 'days_before_today', daysBeforeToday: null },
            bodyTemplate: 'SMS'
          }
        }
      }
    }),
    /Days before today is required for sms/
  );

  assert.throws(
    () => sessionAccessPolicyService.validatePolicyInput({
      uncompletedSessionNotification: {
        enabled: true,
        channels: {
          email: { enabled: true }
        }
      },
      completedSessionAttendanceEdit: {
        enabled: true,
        windowType: 'timesheet_period',
        daysAfterSession: null
      }
    }),
    /email template is required/i
  );

  assert.throws(
    () => sessionAccessPolicyService.validatePolicyInput({
      uncompletedSessionNotification: {
        channels: {
          email: { enabled: false },
          sms: { bodyTemplate: 'Bad {{unknownToken}}' }
        }
      },
      completedSessionAttendanceEdit: {
        enabled: true,
        windowType: 'timesheet_period',
        daysAfterSession: null
      }
    }),
    /Unknown template placeholder/
  );
});

test('session access policy service parses JSON policy field from form body', () => {
  const normalized = sessionAccessPolicyService.validatePolicyInput({
    policy: JSON.stringify({
      uncompletedSessionNotification: {
        enabled: true,
        sendWhen: 'next_day',
        sendAtTime: '17:30',
        channels: {
          email: {
            enabled: true,
            emailTemplateId: TEST_EMAIL_TEMPLATE_ID,
            fromEmail: 'school@example.com',
            subjectTemplate: 'Custom subject',
            bodyTemplate: 'Custom body for {{className}}'
          },
          sms: { enabled: false, bodyTemplate: 'SMS body' }
        }
      },
      completedSessionAttendanceEdit: {
        enabled: true,
        windowType: 'timesheet_period',
        daysAfterSession: null
      }
    })
  });
  assert.equal(normalized.uncompletedSessionNotification.enabled, true);
  assert.equal(normalized.uncompletedSessionNotification.channels.email.sendWhen, 'next_day');
  assert.equal(normalized.uncompletedSessionNotification.channels.email.bodyTemplate, 'Custom body for {{className}}');
});

test('session access policy service accepts JSON policy field when already parsed as object', () => {
  const normalized = sessionAccessPolicyService.validatePolicyInput({
    policy: {
      uncompletedSessionNotification: {
        enabled: true,
        channels: {
          email: {
            enabled: true,
            emailTemplateId: TEST_EMAIL_TEMPLATE_ID,
            fromEmail: 'school@example.com',
            subjectTemplate: 'Custom subject',
            bodyTemplate: 'Custom body for {{className}}'
          },
          sms: { enabled: false, bodyTemplate: 'SMS body' }
        }
      },
      completedSessionAttendanceEdit: {
        enabled: true,
        windowType: 'timesheet_period',
        daysAfterSession: null
      }
    }
  });
  assert.equal(normalized.uncompletedSessionNotification.channels.email.fromEmail, 'school@example.com');
});

test('session access policy service accepts case-insensitive template placeholders', () => {
  const normalized = sessionAccessPolicyService.validatePolicyInput({
    uncompletedSessionNotification: {
      channels: {
        email: {
          emailTemplateId: TEST_EMAIL_TEMPLATE_ID,
          subjectTemplate: 'Hello {{ClassName}}',
          bodyTemplate: 'Session {{SESSIONID}} on {{SessionDate}}'
        },
        sms: { bodyTemplate: 'Reminder {{TeacherName}}' }
      }
    },
    completedSessionAttendanceEdit: {
      enabled: true,
      windowType: 'timesheet_period',
      daysAfterSession: null
    }
  });
  assert.match(normalized.uncompletedSessionNotification.channels.email.subjectTemplate, /{{ClassName}}/);
  const rendered = sessionAccessPolicyService.renderTemplate('Hi {{CLASSNAME}}', { className: 'Algebra' });
  assert.equal(rendered, 'Hi Algebra');
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

test('notification scheduler resolves same-day and next-day session dates per channel', () => {
  const policy = sessionAccessPolicyService.resolvePolicy({
    uncompletedSessionNotification: {
      enabled: true,
      channels: {
        email: { enabled: true, sendWhen: 'same_day', sendAtTime: '18:00' },
        sms: { enabled: true, sendWhen: 'next_day', sendAtTime: '18:00' }
      }
    }
  });
  const now = new Date('2026-02-10T18:00:00.000Z');
  assert.equal(
    sessionNotificationJob.resolveTargetSessionDate(policy.uncompletedSessionNotification.channels.email, 'UTC', now),
    '2026-02-10'
  );
  assert.equal(
    sessionNotificationJob.resolveTargetSessionDate(policy.uncompletedSessionNotification.channels.sms, 'UTC', now),
    '2026-02-09'
  );
  assert.equal(
    sessionNotificationJob.shouldRunChannelNow(policy.uncompletedSessionNotification.channels.email, 'UTC', now),
    true
  );
  assert.equal(
    sessionNotificationJob.shouldRunChannelNow(policy.uncompletedSessionNotification.channels.email, 'UTC', new Date('2026-02-10T17:59:00.000Z')),
    false
  );
});

test('legacy root sendWhen migrates into channel settings', () => {
  const policy = sessionAccessPolicyService.resolvePolicy({
    uncompletedSessionNotification: {
      enabled: true,
      sendWhen: 'next_day',
      sendAtTime: '09:15',
      channels: {
        email: { enabled: true },
        sms: { enabled: false }
      }
    }
  });
  assert.equal(policy.uncompletedSessionNotification.channels.email.sendWhen, 'next_day');
  assert.equal(policy.uncompletedSessionNotification.channels.email.sendAtTime, '09:15');
  assert.equal(policy.uncompletedSessionNotification.channels.sms.sendWhen, 'next_day');
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

test('session access policy service accepts daily_all sendWhen and digest placeholders', () => {
  const normalized = sessionAccessPolicyService.validatePolicyInput({
    uncompletedSessionNotification: {
      enabled: true,
      channels: {
        email: {
          sendWhen: 'daily_all',
          emailTemplateId: TEST_EMAIL_TEMPLATE_ID,
          sessionDateRange: { type: 'two_weeks', daysBeforeToday: null }
        },
        sms: { bodyTemplate: '{{sessionCount}} sessions need attention' }
      }
    },
    completedSessionAttendanceEdit: {
      enabled: true,
      windowType: 'timesheet_period',
      daysAfterSession: null
    }
  });
  assert.equal(normalized.uncompletedSessionNotification.channels.email.sendWhen, 'daily_all');
  assert.equal(normalized.uncompletedSessionNotification.channels.email.emailTemplateId, TEST_EMAIL_TEMPLATE_ID);
});

test('notification scheduler treats daily_all as non single-date mode', () => {
  const channelConfig = sessionAccessPolicyService.resolvePolicy({
    uncompletedSessionNotification: {
      enabled: true,
      channels: {
        email: { enabled: true, sendWhen: 'daily_all', sendAtTime: '18:00' }
      }
    }
  }).uncompletedSessionNotification.channels.email;
  const now = new Date('2026-02-10T18:00:00.000Z');
  assert.equal(sessionNotificationJob.resolveTargetSessionDate(channelConfig, 'UTC', now), null);
  assert.equal(sessionNotificationJob.shouldRunChannelNow(channelConfig, 'UTC', now), true);
});

test('session date range bounds resolve week, month, days, and timesheet period', async () => {
  const thisWeek = await sessionUncompletedNotificationService.resolveSessionDateRangeBounds({
    orgId: 'ORG-1',
    throughDate: '2026-02-11',
    rangeType: 'this_week'
  });
  assert.equal(thisWeek.fromDate, '2026-02-09');
  assert.equal(thisWeek.throughDate, '2026-02-11');

  const twoWeeks = await sessionUncompletedNotificationService.resolveSessionDateRangeBounds({
    orgId: 'ORG-1',
    throughDate: '2026-02-11',
    rangeType: 'two_weeks'
  });
  assert.equal(twoWeeks.fromDate, '2026-02-02');

  const thisMonth = await sessionUncompletedNotificationService.resolveSessionDateRangeBounds({
    orgId: 'ORG-1',
    throughDate: '2026-02-11',
    rangeType: 'this_month'
  });
  assert.equal(thisMonth.fromDate, '2026-02-01');

  const daysBefore = await sessionUncompletedNotificationService.resolveSessionDateRangeBounds({
    orgId: 'ORG-1',
    throughDate: '2026-02-11',
    rangeType: 'days_before_today',
    daysBeforeToday: 3
  });
  assert.equal(daysBefore.fromDate, '2026-02-09');
});

test('per-session notification context includes sessionCount and sessionList', () => {
  const sessionNotificationDeliveryService = require('../packages/school/MVC/services/school/sessionNotificationDeliveryService');
  const context = sessionNotificationDeliveryService.buildTemplateContext({
    classData: { id: 'CLS-1', title: 'Algebra I' },
    session: {
      sessionId: 'SES-1',
      date: '2026-01-15',
      startTime: '09:00',
      endTime: '10:00'
    },
    teacher: { displayName: 'Taylor Smith' },
    orgName: 'Example School',
    baseUrl: 'https://example.test'
  });
  assert.equal(context.sessionCount, '1');
  assert.match(context.sessionList, /Algebra I/);
  assert.match(context.sessionList, /SES-1/);
});

test('uncompleted notification digest helpers build session list and context', () => {
  const entries = [
    {
      classData: { id: 'CLS-1', title: 'Algebra I' },
      session: {
        sessionId: 'SES-1',
        date: '2026-01-15',
        startTime: '09:00',
        endTime: '10:00',
        room: 'Room A',
        teacherId: 'TEA-1'
      }
    },
    {
      classData: { id: 'CLS-2', title: 'Biology' },
      session: {
        sessionId: 'SES-2',
        date: '2026-01-14',
        startTime: '11:00',
        endTime: '12:00',
        room: 'Lab 2',
        teacherId: 'TEA-1'
      }
    }
  ];
  const sessionList = sessionUncompletedNotificationService.buildSessionListText(entries, {
    baseUrl: 'https://example.test'
  });
  assert.match(sessionList, /Algebra I/);
  assert.match(sessionList, /Biology/);
  assert.match(sessionList, /https:\/\/example\.test\/school\/classes\/CLS-1\/sessions\/SES-1/);
  assert.match(sessionList, /https:\/\/example\.test\/school\/classes\/CLS-2\/sessions\/SES-2/);

  const grouped = sessionUncompletedNotificationService.groupSessionsByTeacher(entries);
  assert.equal(grouped.get('TEA-1')?.length, 2);

  const context = sessionUncompletedNotificationService.buildDigestContext({
    teacher: { id: 'TEA-1', displayName: 'Taylor Smith' },
    sessions: entries,
    orgName: 'Example School',
    baseUrl: 'https://example.test'
  });
  assert.equal(context.sessionCount, '2');
  assert.match(context.sessionList, /Algebra I/);
  assert.equal(context.teacherName, 'Taylor Smith');
});

test('resolveTeacherSessionsForDigest falls back to sample sessions when none exist', async () => {
  const result = await sessionUncompletedNotificationService.resolveTeacherSessionsForDigest({
    orgId: 'ORG-TEST',
    teacherId: 'TEA-NONE',
    throughDate: '2099-01-01'
  });
  assert.equal(result.usedSampleData, true);
  assert.equal(result.sessions.length, 2);
  assert.match(result.sessions[0].classData.title, /\[SAMPLE\]/);
});

test('notification ledger supports daily digest dedupe key', () => {
  const key = sessionNotificationLedgerModel.buildDedupeKey({
    orgId: 'ORG-1',
    sessionId: sessionAccessPolicyService.DAILY_DIGEST_SESSION_ID,
    teacherId: 'TEA-1',
    channel: 'email',
    sendWhenDate: '2026-02-10'
  });
  assert.equal(key, `ORG-1::${sessionAccessPolicyService.DAILY_DIGEST_SESSION_ID}::TEA-1::email::2026-02-10`);
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
  assert.match(routes, /router\.post\('\/session-access\/test-notification'/);
  assert.match(controller, /saveSessionAccessPolicy/);
  assert.match(controller, /sendSessionAccessTestNotification/);
  assert.match(controller, /sessionAccessPolicyModel\.getPolicyForOrg/);
  assert.match(classController, /sessionAttendanceEditAccessService/);
  assert.match(classController, /originalSession\.completedAt/);
  assert.match(classController, /attendanceEditLocked/);
  assert.match(attendanceController, /assertSessionAttendanceEditable/);
  assert.match(sessionView, /Attendance Edit Window Closed/);
  assert.match(settingsView, /id="session-access"/);
  assert.match(settingsView, /\/school\/settings\/session-access/);
  assert.match(settingsView, /sessionNotificationEmailDailyAll/);
  assert.match(settingsView, /sessionNotificationSmsDailyAll/);
  assert.match(settingsView, /sessionNotificationEmailRangeType/);
  assert.match(settingsView, /sessionNotificationSmsRangeType/);
  assert.match(settingsView, /\/school\/settings\/session-access\/test-notification/);
  assert.match(settingsView, /btnSendSessionNotificationTestEmail/);
  assert.match(settingsView, /policy:\s*JSON\.stringify\(policyPayload\)/);
  assert.match(appSource, /sessionNotificationSchedulerService\.start/);
});
