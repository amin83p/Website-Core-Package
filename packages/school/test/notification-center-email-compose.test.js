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
const personDisplayNameService = require('../MVC/services/school/personDisplayNameService');
const composeService = require('../MVC/services/school/notificationCenterEmailComposeService');
const registry = require('../MVC/services/school/notificationCenterEvaluatorRegistry');

const sampleSessionItem = {
  title: 'Period 1',
  payload: {
    classData: { id: 'C1', title: 'Algebra I' },
    session: { sessionId: 'S1', date: '2026-09-01', startTime: '09:00', endTime: '10:00' }
  }
};

let originalResolveName;

test.before(() => {
  originalResolveName = personDisplayNameService.resolvePersonDisplayName;
  personDisplayNameService.resolvePersonDisplayName = async (id) => `Teacher ${id}`;
});

test.after(() => {
  personDisplayNameService.resolvePersonDisplayName = originalResolveName;
});

test('renderTemplate leaves unknown placeholders literal', () => {
  const out = composeService.renderTemplate('Hi {{TEACHER_NAME}} {{UNKNOWN_TOKEN}}', {
    TEACHER_NAME: 'Ada'
  });
  assert.equal(out, 'Hi Ada {{UNKNOWN_TOKEN}}');
});

test('session_without_book_report default mentions book covering not session completion', async () => {
  const preview = await composeService.buildEmailPreview({
    rule: { ruleType: 'session_without_book_report', label: 'Book reports' },
    recipientPersonId: 'T1',
    items: [sampleSessionItem],
    orgName: 'Demo School',
    baseUrl: 'https://school.example'
  });
  assert.match(preview.plainText, /book covering/i);
  assert.match(preview.plainText, /Add Book Report/i);
  assert.doesNotMatch(preview.plainText, /require review and completion/i);
  assert.match(preview.htmlBody, /Book covering reminder/);
});

test('session_not_final default uses uncompleted session completion copy', async () => {
  const preview = await composeService.buildEmailPreview({
    rule: { ruleType: 'session_not_final', label: 'Complete sessions' },
    recipientPersonId: 'T1',
    items: [sampleSessionItem],
    orgName: 'Demo School',
    baseUrl: 'https://school.example'
  });
  assert.match(preview.plainText, /require review and completion/i);
  assert.match(preview.htmlBody, /Session completion reminder/);
});

test('custom bodyTextTemplate renders teacher and session list placeholders', async () => {
  const preview = await composeService.buildEmailPreview({
    rule: {
      ruleType: 'session_without_notes',
      label: 'Notes',
      channels: {
        email: {
          bodyTextTemplate: 'Hello {{TEACHER_NAME}}:\n{{SESSION_LIST}}\n— {{ORG_NAME}}'
        }
      }
    },
    recipientPersonId: 'T9',
    items: [sampleSessionItem],
    orgName: 'Demo School',
    baseUrl: 'https://school.example'
  });
  assert.match(preview.plainText, /^Hello Teacher T9:/);
  assert.match(preview.plainText, /Algebra I/);
  assert.match(preview.plainText, /— Demo School/);
});

test('sanitizeRuleInput persists email template fields on channels.email', () => {
  const sanitized = notificationRuleModel.sanitizeRuleInput({
    orgId: 'ORG1',
    label: 'Test',
    ruleType: 'session_without_book_report',
    channels: {
      email: {
        enabled: true,
        subjectTemplate: '{{RULE_LABEL}}',
        bodyTextTemplate: 'Plain {{ITEM_COUNT}}',
        bodyHtmlTemplate: '<p>{{ITEM_COUNT}}</p>'
      }
    }
  });
  assert.equal(sanitized.channels.email.subjectTemplate, '{{RULE_LABEL}}');
  assert.equal(sanitized.channels.email.bodyTextTemplate, 'Plain {{ITEM_COUNT}}');
  assert.equal(sanitized.channels.email.bodyHtmlTemplate, '<p>{{ITEM_COUNT}}</p>');
});

test('buildBatchPreview delegates to compose service for book report rules', async () => {
  const preview = await registry.buildBatchPreview({
    recipientPersonId: 'T1',
    items: [sampleSessionItem],
    rule: { ruleType: 'session_without_book_report', label: 'Book' },
    orgName: 'Demo School',
    baseUrl: 'https://school.example'
  });
  assert.match(preview.plainText, /submitted book covering report/i);
});

test('rule form includes email template fields', () => {
  const ruleFormPath = path.join(__dirname, '../MVC/views/school/notificationCenter/ruleForm.ejs');
  const html = fs.readFileSync(ruleFormPath, 'utf8');
  assert.match(html, /subjectTemplate/);
  assert.match(html, /bodyTextTemplate/);
  assert.match(html, /bodyHtmlTemplate/);
  assert.match(html, /emailComposePlaceholders/);
});
