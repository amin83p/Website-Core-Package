'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('timesheet editor honors persisted auto session tombstones for all viewers', () => {
  const editorSource = fs.readFileSync(
    path.join(__dirname, '../MVC/views/school/timesheet/timesheetEditor.ejs'),
    'utf8'
  );
  assert.doesNotMatch(
    editorSource,
    /if \(e\.isDeleted\) \{\s*if \(IS_ADMIN \|\| e\.isManual \|\| e\.isPriorPeriodAdjustment\)/s
  );
  assert.match(
    editorSource,
    /if \(e\.isDeleted\) \{\s*deletedAutoSessionIds\.push\(e\.sessionId\);/s
  );
});
