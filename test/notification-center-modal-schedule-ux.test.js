'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function readRoot(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function loadScheduleSendTimeApi() {
  const script = readRoot('public/scripts/notificationCenterScheduleSendTime.js');
  const context = { window: {}, console };
  vm.createContext(context);
  vm.runInContext(script, context);
  return context.window.NotificationCenterScheduleSendTime;
}

test('compose email modal uses footer schedule flow and device preview', () => {
  const modal = readRoot('packages/school/MVC/views/school/notificationCenter/partials/composeEmailModal.ejs');
  assert.doesNotMatch(modal, /scheduleSendTimePanel/);
  assert.match(modal, /scheduleSendTimeFields/);
  assert.doesNotMatch(modal, /ncComposeSchedulePanel/);
  assert.doesNotMatch(modal, /ncComposeScheduleSummary/);
  assert.match(modal, /ncScheduleEmailScheduleBtn/);
  assert.match(modal, /ncScheduleEmailSendNowFooter/);
  assert.doesNotMatch(modal, /ncScheduleEmailSubmit/);
  assert.match(modal, /nc-preview-device-mobile/);
  const formBody = modal.slice(modal.indexOf('id="ncScheduleEmailForm"'));
  assert.ok(formBody.indexOf('id="ncComposeSubject"') < formBody.indexOf('nc-compose-tabs mb-3'));
  const editPane = modal.slice(modal.indexOf('id="ncComposeEditPane"'), modal.indexOf('id="ncComposePreviewPane"'));
  assert.doesNotMatch(editPane, /type="datetime-local"/);
});

test('manager summary modal matches schedule and preview UX', () => {
  const modal = readRoot('packages/school/MVC/views/school/notificationCenter/partials/managerSummaryScheduleModal.ejs');
  assert.match(modal, /ncManagerSummaryScheduleBtn/);
  assert.doesNotMatch(modal, /ncScheduleManagerSummarySubmit/);
  assert.match(modal, /scheduleSendTimeFields/);
  const fields = readRoot('packages/school/MVC/views/school/notificationCenter/partials/scheduleSendTimeFields.ejs');
  assert.doesNotMatch(fields, /ScheduleTimeBlock/);
  assert.doesNotMatch(fields, /datetime-local/);
  assert.match(fields, /type="hidden".*sendAtLocal/s);
  assert.match(modal, /nc-preview-device-tablet/);
});

test('compose page uses hidden schedule fields not inline datetime UI', () => {
  const page = readRoot('packages/school/MVC/views/school/notificationCenter/composeEmail.ejs');
  assert.match(page, /scheduleSendTimeFields/);
  assert.doesNotMatch(page, /scheduleSendTimePanel/);
  assert.match(page, /ncPageScheduleBtn/);
  assert.doesNotMatch(page, /ncPageScheduleTimeBlock/);
});

test('schedule send time script builds message modal picker markup', () => {
  const api = loadScheduleSendTimeApi();
  const html = api.buildScheduleMessageModalHtml('America/Chicago', '2030-01-15T09:00');
  assert.match(html, /ncScheduleSendAtMessageModalPicker/);
  assert.match(html, /datetime-local/);
  assert.match(html, /America\/Chicago/);
  assert.equal(api.parseDateTimeLocalValue('2030-01-15T09:00')?.hour, 9);
});
