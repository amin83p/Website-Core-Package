'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const notificationRuleModel = require('../packages/school/MVC/models/school/notificationRuleModel');
const notificationCenterManagerSummaryService = require('../packages/school/MVC/services/school/notificationCenterManagerSummaryService');
const notificationSendLedgerModel = require('../packages/school/MVC/models/school/notificationSendLedgerModel');

const ROOT = path.resolve(__dirname, '..');

function readText(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('normalizeManagerSummary requires recipients when enabled', () => {
  assert.throws(
    () => notificationRuleModel.normalizeManagerSummary({ enabled: true, recipientPersonIds: [] }),
    /at least one manager recipient/i
  );
  const normalized = notificationRuleModel.normalizeManagerSummary({
    enabled: true,
    recipientPersonIds: ['PER_1', 'PER_1', 'PER_2']
  });
  assert.equal(normalized.enabled, true);
  assert.deepEqual(normalized.recipientPersonIds, ['PER_1', 'PER_2']);
});

test('sanitizeRuleInput persists managerSummary on rule', () => {
  const sanitized = notificationRuleModel.sanitizeRuleInput({
    orgId: 'ORG_1',
    label: 'Test',
    ruleType: 'session_not_final',
    managerSummary: {
      enabled: false,
      recipientPersonIds: ['PER_M']
    }
  });
  assert.equal(sanitized.managerSummary.enabled, false);
  assert.deepEqual(sanitized.managerSummary.recipientPersonIds, ['PER_M']);
});

test('buildManagerSummaryRows sorts teachers and counts items', () => {
  const rows = notificationCenterManagerSummaryService.buildManagerSummaryRows({
    batches: [
      { recipientPersonId: 'PER_B', recipientName: 'Zoe', itemCount: 2, items: [{ id: '1' }, { id: '2' }] },
      { recipientPersonId: 'PER_A', recipientName: 'Alex', items: [{ id: '3' }] }
    ]
  });
  assert.deepEqual(rows.map((row) => row.name), ['Alex', 'Zoe']);
  assert.equal(rows[0].itemCount, 1);
  assert.equal(rows[1].itemCount, 2);
});

test('buildManagerSummaryPreview renders teacher table placeholders', async () => {
  const preview = await notificationCenterManagerSummaryService.buildManagerSummaryPreview({
    orgId: '',
    managerPersonId: 'PER_M',
    managerName: 'Manager One',
    rule: { label: 'Weekly reminders', managerSummary: { enabled: true, recipientPersonIds: ['PER_M'] } },
    run: {
      asOfDate: '2026-06-15',
      batches: [
        { recipientPersonId: 'PER_T', recipientName: 'Teacher A', itemCount: 4, items: [] }
      ]
    }
  });
  assert.match(preview.subject, /Weekly reminders/i);
  assert.match(preview.plainText, /Teacher A/);
  assert.match(preview.plainText, /4/);
  assert.match(preview.htmlBody, /Teacher A/);
});

test('manager summary dedupe key includes run id channel', () => {
  const key = notificationSendLedgerModel.buildDedupeKey({
    orgId: 'ORG_1',
    ruleId: 'RULE_1',
    recipientPersonId: 'PER_M',
    channel: 'manager_summary_email',
    cycleDate: '2026-06-15',
    semanticKey: 'RUN_1'
  });
  assert.match(key, /manager_summary_email/);
  assert.match(key, /RUN_1/);
});

test('notification centre routes and views wire manager summary', () => {
  const routes = readText('packages/school/MVC/routes/notificationCenterRoutes.js');
  const ruleForm = readText('packages/school/MVC/views/school/notificationCenter/ruleForm.ejs');
  const runDetail = readText('packages/school/MVC/views/school/notificationCenter/runDetail.ejs');
  const delivery = readText('packages/school/MVC/services/school/notificationCenterDeliveryService.js');

  assert.match(routes, /schedule-manager-summary/);
  assert.match(ruleForm, /tab-nc-managers/);
  assert.match(ruleForm, /modal_GenericPicker/);
  assert.match(ruleForm, /managerSummary\]\[recipientPersonIds\]/);
  assert.match(runDetail, /ncOpenManagerSummaryModalBtn/);
  assert.match(runDetail, /ncManagerSummaryCollapse/);
  assert.match(runDetail, /managerSummaryScheduleModal/);
  assert.match(runDetail, /nc-manager-summary-table/);
  const managerModal = readText('packages/school/MVC/views/school/notificationCenter/partials/managerSummaryScheduleModal.ejs');
  assert.match(managerModal, /ncManagerScheduleModal/);
  assert.match(managerModal, /ncManagerSummaryPreviewFrame/);
  assert.match(managerModal, /ncScheduleManagerSummarySubmit/);
  assert.match(delivery, /queueManagerSummaryForRun/);
});
