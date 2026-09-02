const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const VIEW_PATH = path.join(ROOT, 'packages/school/MVC/views/school/activity/workSessionExplorerList.ejs');

test('work session explorer view wires filters, table columns, and quick actions', () => {
  const source = fs.readFileSync(VIEW_PATH, 'utf8');

  assert.match(source, /Filter Work Sessions/);
  assert.match(source, /filter_startDate/);
  assert.match(source, /filter_evaluationType/);
  assert.match(source, /filter_status/);
  assert.match(source, /workSessionsBody/);
  assert.match(source, /\/school\/work-sessions\/api\/data/);
  assert.match(source, /btn-quick-complete/);
  assert.match(source, /btn-quick-pending/);
  assert.match(source, /btn-row-actions-toggle/);
  assert.match(source, /row-actions-menu/);
  assert.match(source, /bi-three-dots-vertical/);
  assert.match(source, /showMessageModal/);
  assert.match(source, /Open Manage/);
  assert.match(source, /\/school\/activities/);
  assert.match(source, /workSessionExplorerAccess/);
});
