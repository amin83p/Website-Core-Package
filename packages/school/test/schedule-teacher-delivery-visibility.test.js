const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('person schedule scan falls back to org scope for teacher-index and merge-linked classes', () => {
  const controller = read('MVC/controllers/school/scheduleController.js');
  assert.match(controller, /getClassRowForScheduleScan/);
  assert.match(controller, /getClassSessionsForScheduleScan/);
  assert.match(controller, /SCHEDULE_ORG_SCAN_ACCESS_CONTEXT/);
  assert.match(controller, /teacherIndexClassIds/);
  assert.match(controller, /mergeLinkedClassIds/);
  assert.match(controller, /allowOrgScopeFallback: orgScopeFallbackClassIds\.has\(classId\)/);
});
