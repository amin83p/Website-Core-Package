const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const sessionNotificationPrepareService = require('../packages/school/MVC/services/school/sessionNotificationPrepareService');
const sessionAccessPolicyTaskSyncService = require('../packages/school/MVC/services/school/sessionAccessPolicyTaskSyncService');
const sessionAccessPolicyService = require('../packages/school/MVC/services/school/sessionAccessPolicyService');
const sessionNotificationDeliveryService = require('../packages/school/MVC/services/school/sessionNotificationDeliveryService');
const sessionUncompletedNotificationService = require('../packages/school/MVC/services/school/sessionUncompletedNotificationService');
const sessionNotificationLedgerModel = require('../packages/school/MVC/models/school/sessionNotificationLedgerModel');
const sessionStatusPolicyService = require('../packages/school/MVC/services/school/sessionStatusPolicyService');
const schoolPersonAccessService = require('../packages/school/MVC/services/school/schoolPersonAccessService');
const emailOutboxService = require('../MVC/services/emailOutboxService');
const smsOutboxService = require('../MVC/services/smsOutboxService');
const smsProviderService = require('../MVC/services/sms/smsProviderService');
const emailOutboxDispatchService = require('../MVC/services/emailOutboxDispatchService');

const originalResolvePayload = sessionNotificationDeliveryService.resolveEmailDeliveryPayload;
const originalResolveSmsPayload = sessionNotificationDeliveryService.resolveSmsDeliveryPayload;
const originalListSessions = sessionUncompletedNotificationService.listUncompletedSessionsForOrg;
const originalResolveDateRange = sessionUncompletedNotificationService.resolveSessionDateRangeBounds;
const originalLoadTeachers = sessionUncompletedNotificationService.loadTeacherPersonMap;
const originalGroupSessions = sessionUncompletedNotificationService.groupSessionsByTeacher;
const originalBuildDigest = sessionUncompletedNotificationService.buildDigestContext;
const originalListClasses = sessionUncompletedNotificationService.listOrgClasses;
const originalListClassSessions = sessionUncompletedNotificationService.listClassSessions;
const originalHasSent = sessionNotificationLedgerModel.hasSentEntry;
const originalAppend = sessionNotificationLedgerModel.appendEntry;
const originalReadAllEntries = sessionNotificationLedgerModel.readAllEntries;
const originalGetStatusMap = sessionStatusPolicyService.getStatusMap;
const originalGetPerson = schoolPersonAccessService.getPersonById;
const originalEnqueue = emailOutboxService.enqueue;
const originalHasActiveEntry = emailOutboxService.hasActiveEntry;
const originalSmsEnqueue = smsOutboxService.enqueue;
const originalMessagingConfigured = smsProviderService.isMessagingConfigured;
const originalListDue = emailOutboxService.listDue;

test.after(() => {
  sessionNotificationDeliveryService.resolveEmailDeliveryPayload = originalResolvePayload;
  sessionNotificationDeliveryService.resolveSmsDeliveryPayload = originalResolveSmsPayload;
  sessionUncompletedNotificationService.listUncompletedSessionsForOrg = originalListSessions;
  sessionUncompletedNotificationService.resolveSessionDateRangeBounds = originalResolveDateRange;
  sessionUncompletedNotificationService.loadTeacherPersonMap = originalLoadTeachers;
  sessionUncompletedNotificationService.groupSessionsByTeacher = originalGroupSessions;
  sessionUncompletedNotificationService.buildDigestContext = originalBuildDigest;
  sessionUncompletedNotificationService.listOrgClasses = originalListClasses;
  sessionUncompletedNotificationService.listClassSessions = originalListClassSessions;
  sessionNotificationLedgerModel.hasSentEntry = originalHasSent;
  sessionNotificationLedgerModel.appendEntry = originalAppend;
  sessionNotificationLedgerModel.readAllEntries = originalReadAllEntries;
  sessionStatusPolicyService.getStatusMap = originalGetStatusMap;
  schoolPersonAccessService.getPersonById = originalGetPerson;
  emailOutboxService.enqueue = originalEnqueue;
  emailOutboxService.hasActiveEntry = originalHasActiveEntry;
  smsOutboxService.enqueue = originalSmsEnqueue;
  smsProviderService.isMessagingConfigured = originalMessagingConfigured;
  emailOutboxService.listDue = originalListDue;
});

test('buildSendAtIso uses same cycle date when send is later on the clock', () => {
  const sendAt = sessionNotificationPrepareService.buildSendAtIso({
    cycleDate: '2026-08-30',
    prepareAtTime: '02:00',
    sendAtTime: '08:00',
    timeZone: 'America/New_York'
  });
  assert.ok(sendAt);
  assert.match(sendAt, /2026-08-30T12:00:00\.000Z/);
});

test('buildSendAtIso rolls send date to next day for cross-midnight schedules', () => {
  const sendAt = sessionNotificationPrepareService.buildSendAtIso({
    cycleDate: '2026-08-30',
    prepareAtTime: '22:20',
    sendAtTime: '01:00',
    timeZone: 'America/New_York'
  });
  assert.ok(sendAt);
  assert.match(sendAt, /2026-08-31T05:00:00\.000Z/);
});

test('validatePolicyInput accepts cross-midnight prepare and send times', () => {
  const normalized = sessionAccessPolicyService.validatePolicyInput({
    uncompletedSessionNotification: {
      enabled: true,
      channels: {
        email: {
          enabled: true,
          emailTemplateId: 'TPL_1',
          prepareAtTime: '22:20',
          sendAtTime: '01:00'
        }
      }
    }
  });
  assert.equal(normalized.uncompletedSessionNotification.channels.email.prepareAtTime, '22:20');
  assert.equal(normalized.uncompletedSessionNotification.channels.email.sendAtTime, '01:00');
});

test('validatePolicyInput accepts short cross-midnight gap when at least 10 minutes apart', () => {
  sessionAccessPolicyService.validatePolicyInput({
    uncompletedSessionNotification: {
      enabled: true,
      channels: {
        email: {
          enabled: true,
          emailTemplateId: 'TPL_1',
          prepareAtTime: '23:55',
          sendAtTime: '00:06'
        }
      }
    }
  });
});

test('validatePolicyInput rejects prepare and send times less than 10 minutes apart', () => {
  assert.throws(() => {
    sessionAccessPolicyService.validatePolicyInput({
      uncompletedSessionNotification: {
        enabled: true,
        channels: {
          email: {
            enabled: true,
            emailTemplateId: 'TPL_1',
            prepareAtTime: '08:00',
            sendAtTime: '08:05'
          }
        }
      }
    });
  }, /at least 10 minutes apart/i);
});

test('prepareUncompletedSessionEmailsForOrg enqueues outbox rows instead of sending', async () => {
  const teacherId = 'TEA_1';
  sessionUncompletedNotificationService.listUncompletedSessionsForOrg = async () => ([
    { sessionId: 'SES_1', teacherId }
  ]);
  sessionUncompletedNotificationService.resolveSessionDateRangeBounds = async () => ({
    fromDate: '2026-08-25',
    throughDate: '2026-08-30'
  });
  sessionStatusPolicyService.getStatusMap = async () => ({});
  sessionUncompletedNotificationService.loadTeacherPersonMap = async () => new Map([[teacherId, { id: teacherId }]]);
  sessionUncompletedNotificationService.groupSessionsByTeacher = () => new Map([[teacherId, [{ sessionId: 'SES_1' }]]]);
  sessionUncompletedNotificationService.buildDigestContext = () => ({
    teacherName: 'Teacher One',
    sessionCount: 1,
    sessions: [{ name: 'Session 1' }]
  });
  schoolPersonAccessService.getPersonById = async () => ({
    id: teacherId,
    email: 'teacher@example.com',
    name: 'Teacher One'
  });
  sessionNotificationLedgerModel.hasSentEntry = async () => false;
  sessionNotificationLedgerModel.appendEntry = async () => ({});
  sessionNotificationDeliveryService.resolveEmailDeliveryPayload = async () => ({
    status: 'ready',
    recipient: 'teacher@example.com',
    subject: 'Uncompleted sessions',
    text: 'Please complete sessions',
    payload: {
      to: 'teacher@example.com',
      subject: 'Uncompleted sessions',
      text: 'Please complete sessions',
      html: '<p>Please complete sessions</p>'
    }
  });

  let enqueued = null;
  emailOutboxService.enqueue = async (entry) => {
    enqueued = entry;
    return { id: 'OUT_1', ...entry };
  };

  const metrics = await sessionNotificationPrepareService.prepareUncompletedSessionEmailsForOrg({
    orgId: 'ORG_SCHOOL',
    now: new Date('2026-08-30T06:00:00.000Z'),
    policy: {
      uncompletedSessionNotification: {
        enabled: true,
        channels: {
          email: {
            enabled: true,
            sendWhen: 'daily_all',
            prepareAtTime: '02:00',
            sendAtTime: '08:00',
            sessionDateRange: { type: 'this_week' }
          }
        }
      }
    }
  });

  assert.equal(metrics.prepared, 1);
  assert.ok(enqueued);
  assert.equal(enqueued.to, 'teacher@example.com');
  assert.equal(enqueued.meta.cycleDate, metrics.cycleDate);
  assert.ok(enqueued.sendAt);
  assert.ok(enqueued.dedupeKey);
});

test('prepareUncompletedSessionEmailsForOrg supports same_day mode', async () => {
  const teacherId = 'TEA_2';
  sessionUncompletedNotificationService.listOrgClasses = async () => ([{ id: 'CLS_1', orgId: 'ORG_SCHOOL' }]);
  sessionUncompletedNotificationService.listClassSessions = async () => ([{
    id: 'SES_2',
    sessionId: 'SES_2',
    date: '2026-08-30',
    locked: false
  }]);
  sessionStatusPolicyService.getStatusMap = async () => ({});
  sessionNotificationDeliveryService.listSessionEditorIds = () => [teacherId];
  schoolPersonAccessService.getPersonById = async () => ({
    id: teacherId,
    email: 'teacher2@example.com'
  });
  sessionNotificationLedgerModel.hasSentEntry = async () => false;
  sessionNotificationLedgerModel.appendEntry = async () => ({});
  sessionNotificationDeliveryService.resolveEmailDeliveryPayload = async () => ({
    status: 'ready',
    recipient: 'teacher2@example.com',
    subject: 'Session reminder',
    text: 'Complete session',
    payload: { to: 'teacher2@example.com', subject: 'Session reminder', text: 'Complete session' }
  });

  let enqueued = null;
  emailOutboxService.enqueue = async (entry) => {
    enqueued = entry;
    return { id: 'OUT_2', ...entry };
  };

  const metrics = await sessionNotificationPrepareService.prepareUncompletedSessionEmailsForOrg({
    orgId: 'ORG_SCHOOL',
    now: new Date('2026-08-30T06:00:00.000Z'),
    policy: {
      uncompletedSessionNotification: {
        enabled: true,
        channels: {
          email: {
            enabled: true,
            sendWhen: 'same_day',
            prepareAtTime: '02:00',
            sendAtTime: '08:00'
          }
        }
      }
    }
  });

  assert.equal(metrics.prepared, 1);
  assert.equal(enqueued.meta.sendWhen, 'same_day');
  assert.equal(enqueued.meta.cycleDate, '2026-08-30');
});

test('prepareUncompletedSessionEmailsForOrg does not skip when ledger is queued but outbox is inactive', async () => {
  const teacherId = 'TEA_LEDGER';
  const dedupeKey = sessionNotificationLedgerModel.buildDedupeKey({
    orgId: 'ORG_SCHOOL',
    sessionId: sessionAccessPolicyService.DAILY_DIGEST_SESSION_ID,
    teacherId,
    channel: 'email',
    sendWhenDate: '2026-08-30'
  });

  sessionUncompletedNotificationService.listUncompletedSessionsForOrg = async () => ([
    { sessionId: 'SES_1', teacherId }
  ]);
  sessionUncompletedNotificationService.resolveSessionDateRangeBounds = async () => ({
    fromDate: '2026-08-25',
    throughDate: '2026-08-30'
  });
  sessionStatusPolicyService.getStatusMap = async () => ({});
  sessionUncompletedNotificationService.loadTeacherPersonMap = async () => new Map([[teacherId, { id: teacherId }]]);
  sessionUncompletedNotificationService.groupSessionsByTeacher = () => new Map([[teacherId, [{ sessionId: 'SES_1' }]]]);
  sessionUncompletedNotificationService.buildDigestContext = () => ({
    teacherName: 'Teacher Ledger',
    sessionCount: 1,
    sessions: [{ name: 'Session 1' }]
  });
  schoolPersonAccessService.getPersonById = async () => ({
    id: teacherId,
    email: 'ledger@example.com',
    name: 'Teacher Ledger'
  });
  sessionNotificationLedgerModel.readAllEntries = async () => ([{
    dedupeKey,
    status: 'queued'
  }]);
  sessionNotificationLedgerModel.appendEntry = async () => ({});
  sessionNotificationDeliveryService.resolveEmailDeliveryPayload = async () => ({
    status: 'ready',
    recipient: 'ledger@example.com',
    subject: 'Uncompleted sessions',
    text: 'Please complete sessions',
    payload: {
      to: 'ledger@example.com',
      subject: 'Uncompleted sessions',
      text: 'Please complete sessions',
      html: '<p>Please complete sessions</p>'
    }
  });
  emailOutboxService.hasActiveEntry = async () => false;

  let enqueued = null;
  emailOutboxService.enqueue = async (entry) => {
    enqueued = entry;
    return { id: 'OUT_LEDGER', ...entry };
  };

  const metrics = await sessionNotificationPrepareService.prepareUncompletedSessionEmailsForOrg({
    orgId: 'ORG_SCHOOL',
    now: new Date('2026-08-30T06:00:00.000Z'),
    policy: {
      uncompletedSessionNotification: {
        enabled: true,
        channels: {
          email: {
            enabled: true,
            sendWhen: 'daily_all',
            prepareAtTime: '02:00',
            sendAtTime: '08:00',
            sessionDateRange: { type: 'this_week' }
          }
        }
      }
    }
  });

  assert.equal(metrics.prepared, 1);
  assert.ok(enqueued);
});

test('prepareUncompletedSessionEmailsForOrg additive mode creates unique outbox dedupe keys per run', async () => {
  const teacherId = 'TEA_ADD';
  sessionUncompletedNotificationService.listUncompletedSessionsForOrg = async () => ([
    { sessionId: 'SES_1', teacherId }
  ]);
  sessionUncompletedNotificationService.resolveSessionDateRangeBounds = async () => ({
    fromDate: '2026-08-25',
    throughDate: '2026-08-30'
  });
  sessionStatusPolicyService.getStatusMap = async () => ({});
  sessionUncompletedNotificationService.loadTeacherPersonMap = async () => new Map([[teacherId, { id: teacherId }]]);
  sessionUncompletedNotificationService.groupSessionsByTeacher = () => new Map([[teacherId, [{ sessionId: 'SES_1' }]]]);
  sessionUncompletedNotificationService.buildDigestContext = () => ({
    teacherName: 'Teacher Add',
    sessionCount: 1,
    sessions: [{ name: 'Session 1' }]
  });
  schoolPersonAccessService.getPersonById = async () => ({
    id: teacherId,
    email: 'add@example.com',
    name: 'Teacher Add'
  });
  sessionNotificationLedgerModel.readAllEntries = async () => ([]);
  sessionNotificationLedgerModel.appendEntry = async () => ({});
  sessionNotificationDeliveryService.resolveEmailDeliveryPayload = async () => ({
    status: 'ready',
    recipient: 'add@example.com',
    subject: 'Uncompleted sessions',
    text: 'Please complete sessions',
    payload: {
      to: 'add@example.com',
      subject: 'Uncompleted sessions',
      text: 'Please complete sessions',
      html: '<p>Please complete sessions</p>'
    }
  });

  const enqueued = [];
  emailOutboxService.enqueue = async (entry) => {
    enqueued.push(entry);
    return { id: `OUT_${enqueued.length}`, ...entry };
  };
  emailOutboxService.cancelActiveNotificationEntries = async () => ({ succeeded: [], failed: [], total: 0 });

  const policy = {
    uncompletedSessionNotification: {
      enabled: true,
      channels: {
        email: {
          enabled: true,
          sendWhen: 'daily_all',
          prepareAtTime: '02:00',
          sendAtTime: '08:00',
          sessionDateRange: { type: 'this_week' }
        }
      }
    }
  };

  await sessionNotificationPrepareService.prepareUncompletedSessionEmailsForOrg({
    orgId: 'ORG_SCHOOL',
    now: new Date('2026-08-30T06:00:00.000Z'),
    policy,
    prepareMode: 'additive',
    prepareRunId: 'RUN_A'
  });
  await sessionNotificationPrepareService.prepareUncompletedSessionEmailsForOrg({
    orgId: 'ORG_SCHOOL',
    now: new Date('2026-08-30T06:00:00.000Z'),
    policy,
    prepareMode: 'additive',
    prepareRunId: 'RUN_B'
  });

  assert.equal(enqueued.length, 2);
  assert.notEqual(enqueued[0].dedupeKey, enqueued[1].dedupeKey);
  assert.match(enqueued[0].dedupeKey, /::RUN_A$/);
  assert.match(enqueued[1].dedupeKey, /::RUN_B$/);
});

test('syncSessionAccessPolicyTasks upserts prepare and dispatch definitions for email and SMS', async () => {
  const scheduledTaskDefinitionService = require('../MVC/services/scheduledTaskDefinitionService');
  const scheduledTaskDefinitionRepository = require('../MVC/repositories/scheduledTaskDefinitionRepository');
  const originalUpsert = scheduledTaskDefinitionService.upsertDefinition;
  const originalList = scheduledTaskDefinitionRepository.list;
  let captured = [];
  scheduledTaskDefinitionService.upsertDefinition = async (payload) => {
    captured.push(payload);
    return { id: `STD_${captured.length}`, ...payload };
  };
  scheduledTaskDefinitionRepository.list = async () => [];

  try {
    await sessionAccessPolicyTaskSyncService.syncSessionAccessPolicyTasks('ORG_SCHOOL', {
      uncompletedSessionNotification: {
        enabled: true,
        channels: {
          email: {
            enabled: true,
            sendWhen: 'daily_all',
            prepareAtTime: '02:00',
            sendAtTime: '08:00'
          },
          sms: {
            enabled: true,
            sendWhen: 'same_day',
            prepareAtTime: '02:15',
            sendAtTime: '08:30'
          }
        }
      }
    });

    assert.equal(captured.length, 4);
    const emailPrepare = captured.find((row) => row.taskKey === 'school.uncompletedSessionEmail.prepare');
    const emailDispatch = captured.find((row) => row.taskKey === 'school.uncompletedSessionEmail.dispatch');
    const smsPrepare = captured.find((row) => row.taskKey === 'school.uncompletedSessionSms.prepare');
    const smsDispatch = captured.find((row) => row.taskKey === 'school.uncompletedSessionSms.dispatch');
    assert.ok(emailPrepare);
    assert.ok(emailDispatch);
    assert.ok(smsPrepare);
    assert.ok(smsDispatch);
    assert.equal(emailPrepare.runAtTime, '02:00');
    assert.equal(emailDispatch.runAtTime, '08:00');
    assert.equal(emailPrepare.enabled, true);
    assert.equal(emailDispatch.input.sendWhen, 'daily_all');
    assert.equal(smsPrepare.runAtTime, '02:15');
    assert.equal(smsDispatch.runAtTime, '08:30');
  } finally {
    scheduledTaskDefinitionService.upsertDefinition = originalUpsert;
    scheduledTaskDefinitionRepository.list = originalList;
  }
});

test('emailOutboxDispatchService filters by orgId when provided', async () => {
  let capturedOrgId = null;
  emailOutboxService.listDue = async (_now, { orgId } = {}) => {
    capturedOrgId = orgId;
    return [];
  };
  await emailOutboxDispatchService.dispatchDue({ orgId: 'ORG_SCHOOL' });
  assert.equal(capturedOrgId, 'ORG_SCHOOL');
});

test('app wiring starts core scheduler and registers handlers', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const schoolRouteSource = fs.readFileSync(
    path.join(__dirname, '..', 'packages', 'school', 'MVC', 'routes', 'schoolMainRoute.js'),
    'utf8'
  );

  assert.match(appSource, /registerCoreScheduledTasks\(\)/);
  assert.match(appSource, /scheduledTaskSchedulerService\.start/);
  assert.doesNotMatch(appSource, /sessionNotificationSchedulerService\.start/);
  assert.match(appSource, /app\.use\('\/scheduled-tasks', scheduledTaskRoutes\)/);
  assert.match(schoolRouteSource, /registerSchoolScheduledTasks\(\)/);
  assert.match(schoolRouteSource, /syncAllSessionAccessPolicyTasks/);
});

test('school settings UI includes prepareAtTime fields and schedule gap warnings', () => {
  const settingsView = fs.readFileSync(
    path.join(__dirname, '..', 'packages', 'school', 'MVC', 'views', 'school', 'settings', 'index.ejs'),
    'utf8'
  );
  assert.match(settingsView, /sessionNotificationEmailPrepareAtTime/);
  assert.match(settingsView, /sessionNotificationSmsPrepareAtTime/);
  assert.match(settingsView, /sessionNotificationEmailScheduleWarning/);
  assert.match(settingsView, /isSessionAccessScheduleValid/);
  assert.match(settingsView, /at least 10 minutes apart/i);
  assert.doesNotMatch(settingsView, /later than Prepare.*on the same day/i);
});
