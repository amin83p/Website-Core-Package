const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('session manager Reports nav includes count badge markup', () => {
  const source = read('packages/school/MVC/views/school/class/sessionManager.ejs');
  assert.match(source, /data-session-panel="assignments"/);
  assert.match(source, /id="sessionReportsNavBadge"/);
  assert.match(source, /session-reports-nav-badge/);
});

test('session manager syncs Reports nav badge from report instance state', () => {
  const source = read('packages/school/MVC/views/school/class/sessionManager.ejs');
  assert.match(source, /function syncSessionReportsNavBadge\(\)/);
  assert.match(source, /getUnsubmittedSessionReports\(\)\.length/);
  assert.match(source, /bg-danger/);
  assert.match(source, /bg-success/);
  assert.match(source, /function syncPendingReportsHint\(\) \{\s*syncSessionReportsNavBadge\(\);/);
  assert.match(source, /renderSessionReportInstances\(\)[\s\S]*syncPendingReportsHint\(\)/);
});
