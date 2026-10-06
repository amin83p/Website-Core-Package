'use strict';

const assert = require('assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

process.env.MAIN_SECRET_KEY ||= '0123456789abcdef0123456789abcdef';
process.env.SESSION_SECRET ||= 'fedcba9876543210fedcba9876543210';
process.env.SESSION_ENCRYPTION_KEY ||= '00112233445566778899aabbccddeeff';
process.env.ACTION_STATE_KEY ||= 'ffeeddccbbaa99887766554433221100';
process.env.DATA_BACKEND = 'json';
process.env.DATA_BACKEND_STRICT = 'false';

const notificationRuleModel = require('../MVC/models/school/notificationRuleModel');
const deliveryService = require('../MVC/services/school/notificationCenterDeliveryService');

test('normalizeEmailBodyMode accepts plain or defaults to html', () => {
  assert.equal(notificationRuleModel.normalizeEmailBodyMode('plain'), 'plain');
  assert.equal(notificationRuleModel.normalizeEmailBodyMode('html'), 'html');
  assert.equal(notificationRuleModel.normalizeEmailBodyMode(''), 'html');
  assert.equal(notificationRuleModel.normalizeEmailBodyMode('invalid'), 'html');
});

test('sanitizeRuleInput persists delivery fields', () => {
  const sanitized = notificationRuleModel.sanitizeRuleInput({
    orgId: 'ORG1',
    label: 'Delivery test',
    ruleType: 'session_without_notes',
    schedule: { autoQueueOnSchedule: true, scheduleEnabled: false },
    channels: {
      email: {
        enabled: true,
        emailBodyMode: 'plain',
        sendAtTime: '09:30'
      },
      sms: {
        enabled: true,
        sendAtTime: '10:15'
      }
    }
  });
  assert.equal(sanitized.schedule.autoQueueOnSchedule, true);
  assert.equal(sanitized.channels.email.emailBodyMode, 'plain');
  assert.equal(sanitized.channels.email.sendAtTime, '09:30');
  assert.equal(sanitized.channels.sms.enabled, true);
  assert.equal(sanitized.channels.sms.sendAtTime, '10:15');
});

test('buildNcEmailOutboxBodies respects emailBodyMode', () => {
  const preview = { plainText: 'Plain body', htmlBody: '<p>Html body</p>' };
  const plainOnly = deliveryService.buildNcEmailOutboxBodies({
    preview,
    channelConfig: { emailBodyMode: 'plain' }
  });
  assert.equal(plainOnly.text, 'Plain body');
  assert.equal(plainOnly.html, '');

  const htmlOnly = deliveryService.buildNcEmailOutboxBodies({
    preview,
    channelConfig: { emailBodyMode: 'html' }
  });
  assert.equal(htmlOnly.text, '');
  assert.equal(htmlOnly.html, '<p>Html body</p>');
});

test('prepareScheduledRule passes queueDelivery when autoQueueOnSchedule is true', async () => {
  const originalRunService = require('../MVC/services/school/notificationCenterRunService');
  const originalRuleService = require('../MVC/services/school/notificationCenterRuleService');
  let capturedQueueDelivery = null;

  const mockRunService = {
    executeRun: async ({ queueDelivery }) => {
      capturedQueueDelivery = queueDelivery;
      return { id: 'RUN1', batchCount: 2, status: 'completed' };
    }
  };
  const mockRuleService = {
    getRule: async () => ({
      id: 'RULE1',
      enabled: true,
      schedule: {
        autoQueueOnSchedule: true,
        scheduleEnabled: true,
        runAtTime: '08:00',
        daysOfWeek: [2]
      },
      activityDateWindow: { enabled: false }
    })
  };

  require.cache[require.resolve('../MVC/services/school/notificationCenterRunService')].exports = mockRunService;
  require.cache[require.resolve('../MVC/services/school/notificationCenterRuleService')].exports = mockRuleService;

  try {
    const result = await deliveryService.prepareScheduledRule({
      orgId: 'ORG1',
      ruleId: 'RULE1',
      now: new Date('2026-09-15T12:00:00.000Z')
    });
    assert.equal(capturedQueueDelivery, true);
    assert.equal(result.mode, 'queued');
  } finally {
    require.cache[require.resolve('../MVC/services/school/notificationCenterRunService')].exports = originalRunService;
    require.cache[require.resolve('../MVC/services/school/notificationCenterRuleService')].exports = originalRuleService;
  }
});

test('rule form includes Delivery tab fields', () => {
  const ruleFormPath = path.join(__dirname, '../MVC/views/school/notificationCenter/ruleForm.ejs');
  const html = fs.readFileSync(ruleFormPath, 'utf8');
  assert.match(html, /tab-nc-delivery/);
  assert.match(html, /autoQueueOnSchedule/);
  assert.match(html, /emailBodyMode/);
  assert.match(html, /channels\]\[email\]\[sendAtTime\]/);
  assert.match(html, /channels\]\[sms\]\[enabled\]/);
});
