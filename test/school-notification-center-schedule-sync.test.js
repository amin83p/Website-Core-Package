const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

const taskSync = require('../packages/school/MVC/services/school/notificationCenterTaskSyncService');
const ruleModel = require('../packages/school/MVC/models/school/notificationRuleModel');

test('isScheduleActive requires enabled rule, schedule toggle, weekdays, and HH:mm time', () => {
  assert.equal(taskSync.isScheduleActive({
    enabled: true,
    schedule: { scheduleEnabled: true, runAtTime: '09:30', daysOfWeek: [1, 3] }
  }), true);
  assert.equal(taskSync.isScheduleActive({
    enabled: true,
    schedule: { scheduleEnabled: true, runAtTime: '09:30', daysOfWeek: [] }
  }), false);
  assert.equal(taskSync.isScheduleActive({
    enabled: true,
    schedule: { scheduleEnabled: true, runAtTime: '09:30' }
  }), true);
  assert.equal(taskSync.isScheduleActive({
    enabled: false,
    schedule: { scheduleEnabled: true, runAtTime: '09:30' }
  }), false);
  assert.equal(taskSync.isScheduleActive({
    enabled: true,
    schedule: { scheduleEnabled: false, runAtTime: '09:30' }
  }), false);
  assert.equal(taskSync.buildRuleSourceRef('RULE-1'), 'rule:RULE-1');
});

test('prepareScheduledRule and handler are preview-only', () => {
  const delivery = fs.readFileSync(
    path.join(ROOT, 'packages/school/MVC/services/school/notificationCenterDeliveryService.js'),
    'utf8'
  );
  assert.match(delivery, /queueDelivery:\s*false/);
  assert.match(delivery, /outside_activity_window/);

  const reg = fs.readFileSync(
    path.join(ROOT, 'packages/school/MVC/services/school/schoolScheduledTaskRegistration.js'),
    'utf8'
  );
  assert.match(reg, /prepareScheduledRule/);
  assert.doesNotMatch(reg, /manual runs only/i);
});

test('task sync module exports rule scheduling helpers', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'packages/school/MVC/services/school/notificationCenterTaskSyncService.js'),
    'utf8'
  );
  assert.match(source, /syncRuleScheduledTasks/);
  assert.match(source, /syncAllRulesForOrg/);
  assert.match(source, /buildRuleSourceRef\(ruleId\)/);
  assert.match(source, /scheduleType:\s*'weekly'/);
  assert.match(source, /resolveOrgTimeZone/);
  assert.match(source, /resolveOrganizationTimezoneFromRow/);
  assert.doesNotMatch(source, /schedule\.timezone/);
});

test('notification rule schedule stores daysOfWeek not timezone', () => {
  const ruleModelSource = fs.readFileSync(
    path.join(ROOT, 'packages/school/MVC/models/school/notificationRuleModel.js'),
    'utf8'
  );
  assert.match(ruleModelSource, /daysOfWeek/);
  assert.match(ruleModelSource, /normalizeDaysOfWeek/);
  assert.match(ruleModelSource, /activityDateWindow/);
});

test('activity date window helpers gate scheduled evaluation by org calendar date', () => {
  const baseRule = {
    enabled: true,
    schedule: { scheduleEnabled: true, runAtTime: '09:00', daysOfWeek: [1] },
    activityDateWindow: { enabled: true, startDate: '2026-09-10', endDate: '2026-09-20' }
  };
  assert.equal(ruleModel.isDateWithinActivityWindow(baseRule.activityDateWindow, '2026-09-15'), true);
  assert.equal(ruleModel.isDateWithinActivityWindow(baseRule.activityDateWindow, '2026-09-09'), false);
  assert.equal(ruleModel.isDateWithinActivityWindow(baseRule.activityDateWindow, '2026-09-21'), false);
  assert.equal(ruleModel.isRuleScheduledEvaluationAllowed(baseRule, '2026-09-15'), true);
  assert.equal(ruleModel.isRuleScheduledEvaluationAllowed(baseRule, '2026-09-21'), false);
  assert.equal(ruleModel.isRuleScheduledEvaluationAllowed({
    ...baseRule,
    activityDateWindow: { enabled: false, startDate: '', endDate: '' }
  }, '2026-09-21'), true);
});

test('normalizeActivityDateWindow validates enabled ranges', () => {
  assert.deepEqual(ruleModel.normalizeActivityDateWindow({ enabled: false }), {
    enabled: false,
    startDate: '',
    endDate: ''
  });
  assert.throws(() => ruleModel.normalizeActivityDateWindow({
    enabled: true,
    startDate: '2026-09-20',
    endDate: '2026-09-10'
  }), /start date must be on or before end date/i);
});
