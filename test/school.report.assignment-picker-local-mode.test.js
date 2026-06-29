const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('generic picker supports local source mode', () => {
  const pickerView = read('MVC/views/partials/modal_GenericPicker.ejs');

  assert.match(pickerView, /function isLocalSourceMode\(\)/);
  assert.match(pickerView, /function getLocalItemsPage\(queryTerm, forceShowAll, requestedPage\)/);
  assert.match(pickerView, /if \(isLocalSourceMode\(\)\)/);
  assert.match(pickerView, /Error filtering local data\./);
});

test('report assignment session and student pickers use local data mode', () => {
  const assignmentView = read('packages/school/MVC/views/school/report/assignmentForm.ejs');

  assert.match(assignmentView, /const localSessionItems = \(allSessions \|\| \[\]\)\.map/);
  assert.match(assignmentView, /sourceMode:\s*'local'/);
  assert.match(assignmentView, /localItems:\s*localSessionItems/);
  assert.match(assignmentView, /searchFields:\s*'id,sessionId,date,startTime,endTime,className,teacherId,teacherName,title'/);

  assert.match(assignmentView, /const localStudentItems = \(allStudents \|\| \[\]\)\.map/);
  assert.match(assignmentView, /localItems:\s*localStudentItems/);
  assert.match(assignmentView, /searchFields:\s*'id,name,title'/);

  assert.doesNotMatch(assignmentView, /apiEndpoint:\s*['"`]\/persons['"`]/);
  assert.doesNotMatch(assignmentView, /apiEndpoint:\s*['"`]\/school\/sessions\/api\/data/);
});
