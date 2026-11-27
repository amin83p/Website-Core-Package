'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const filter = require('../MVC/services/school/wordOfDayReviewFilter');
const ROOT = path.resolve(__dirname, '..', '..', '..');

test('date range matches create OR last modified', () => {
  const row = {
    audit: {
      createDateTime: '2026-01-10T12:00:00.000Z',
      lastUpdateDateTime: '2026-03-02T08:00:00.000Z'
    }
  };
  assert.equal(filter.rowMatchesDateRange(row, '2026-01-01', '2026-01-31'), true);
  assert.equal(filter.rowMatchesDateRange(row, '2026-03-01', '2026-03-31'), true);
  assert.equal(filter.rowMatchesDateRange(row, '2025-12-01', '2025-12-31'), false);
});

test('author filter matches authorUserId or createdBy', () => {
  const row = { authorUserId: 'U9', audit: { createdBy: 'U1' } };
  assert.equal(filter.rowMatchesAuthorIds(row, ['U9']), true);
  assert.equal(filter.rowMatchesAuthorIds(row, ['U1']), true);
  assert.equal(filter.rowMatchesAuthorIds(row, ['U2']), false);
  assert.equal(filter.rowMatchesAuthorIds(row, []), true);
});

test('status and text filters', () => {
  const row = { status: 'submitted', word: 'Ephemeral', meaning: 'short-lived' };
  assert.equal(filter.rowMatchesStatuses(row, ['submitted']), true);
  assert.equal(filter.rowMatchesStatuses(row, ['approved']), false);
  assert.equal(filter.rowMatchesText(row, 'ephem'), true);
  assert.equal(filter.rowMatchesText(row, 'zzz'), false);
});

test('routes declare review-search API', () => {
  const routes = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/routes/wordOfDayRoutes.js'), 'utf8');
  assert.match(routes, /\/api\/review-search/);
  assert.match(routes, /\/api\/:id\/review-detail/);
  assert.match(routes, /\/api\/:id\/detail/);
});

test('list view wires review modal and button', () => {
  const list = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/views/school/wordOfDay/list.ejs'), 'utf8');
  assert.match(list, /btnWordOfDayReview/);
  assert.match(list, /wordOfDayReviewModal/);
  assert.match(list, /wordOfDayReviewModal\.js/);
  assert.match(list, /wordOfDayRejectionReasonModal/);
  assert.match(list, /rejectionReasonModal/);
  assert.match(list, /partials\/entryModal/);
  assert.match(list, /btn-row-actions-toggle/);
  assert.match(list, /partials\/pagination|pagination,/);
  assert.match(list, /School_Word_Of_The_Day/);
});

test('list controller follows list page guide', () => {
  const ctrl = fs.readFileSync(path.join(ROOT, 'packages/school/MVC/controllers/school/wordOfDayController.js'), 'utf8');
  assert.match(ctrl, /buildDataServiceQuery/);
  assert.match(ctrl, /applyGenericFilter/);
  assert.match(ctrl, /includeModal_Table:\s*true/);
  assert.match(ctrl, /Word of the Day/);
});

test('workflow client exports showConfirm and avoids native alert fallback', () => {
  const workflow = fs.readFileSync(
    path.join(ROOT, 'packages/school/public/scripts/wordOfDayWorkflowClient.js'),
    'utf8'
  );
  assert.match(workflow, /showConfirm/);
  assert.doesNotMatch(workflow, /global\.alert/);
  assert.doesNotMatch(workflow, /global\.confirm/);
});

test('word of day service loads Mongo rows with org scope', () => {
  const service = fs.readFileSync(
    path.join(ROOT, 'packages/school/MVC/services/school/wordOfDayService.js'),
    'utf8'
  );
  assert.match(service, /buildWordOfDayRepositoryListScope/);
  assert.match(service, /scope:\s*buildWordOfDayRepositoryListScope/);
  assert.match(service, /SCOPE_MODES\.ORG_WIDE/);
  assert.doesNotMatch(service, /wordOfDay\.list\(\{\s*orgId/);
});