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

const sessionAccessPolicyService = require('../MVC/services/school/sessionAccessPolicyService');
const notificationRuleModel = require('../MVC/models/school/notificationRuleModel');
const {
  buildRuleFromLegacyNotification
} = require('../MVC/services/school/uncompletedSessionNotificationMigrationService');

test('buildRuleFromLegacyNotification maps daily digest schedule and timing', () => {
  const rule = buildRuleFromLegacyNotification('ORG1', {
    enabled: true,
    channels: {
      email: {
        enabled: true,
        sendWhen: 'daily_all',
        prepareAtTime: '07:30',
        sendAtTime: '09:15',
        sessionDateRange: { type: 'two_weeks', daysBeforeToday: null },
        bodyTemplate: '<p>Hi</p>'
      },
      sms: { enabled: false, sendWhen: 'daily_all' }
    }
  });
  assert.equal(rule.criteria.notificationTiming.mode, 'daily_digest');
  assert.equal(rule.schedule.scheduleEnabled, true);
  assert.equal(rule.schedule.autoQueueOnSchedule, true);
  assert.equal(rule.schedule.runAtTime, '07:30');
  assert.equal(rule.channels.email.sendAtTime, '09:15');
  assert.equal(rule.channels.email.emailBodyMode, 'html');
});

test('buildRuleFromLegacyNotification maps same_day without scheduled evaluation', () => {
  const rule = buildRuleFromLegacyNotification('ORG1', {
    enabled: true,
    channels: {
      email: {
        enabled: true,
        sendWhen: 'same_day',
        sendAtTime: '18:00',
        sessionDateRange: { type: 'this_week' }
      },
      sms: { enabled: true, sendWhen: 'same_day', sendAtTime: '17:00' }
    }
  });
  assert.equal(rule.criteria.notificationTiming.mode, 'same_day');
  assert.equal(rule.schedule.scheduleEnabled, false);
  assert.equal(rule.channels.email.sendWhen, 'same_day');
  assert.equal(rule.channels.sms.enabled, true);
});

test('validatePolicyInput accepts attendance-only payload without notification block', () => {
  const normalized = sessionAccessPolicyService.validatePolicyInput({
    completedSessionAttendanceEdit: {
      enabled: true,
      windowType: 'timesheet_period',
      daysAfterSession: ''
    },
    naAttendanceVisibility: {
      teacherNa: true,
      onHoldNa: false
    }
  });
  assert.equal(normalized.completedSessionAttendanceEdit.enabled, true);
  assert.equal(normalized.uncompletedSessionNotification.enabled, false);
});

test('rule form criteria includes session timing controls', () => {
  const ruleFormPath = path.join(__dirname, '../MVC/views/school/notificationCenter/ruleForm.ejs');
  const html = fs.readFileSync(ruleFormPath, 'utf8');
  assert.match(html, /notificationTiming\]\[mode\]/);
  assert.match(html, /daily_digest/);
  assert.match(html, /ncTimingDigestFields/);
});

test('settings session access panel links to notification centre', () => {
  const settingsPath = path.join(__dirname, '../MVC/views/school/settings/index.ejs');
  const html = fs.readFileSync(settingsPath, 'utf8');
  assert.doesNotMatch(html, /id="cardSessionNotification"/);
  assert.match(html, /notification-center/);
});
