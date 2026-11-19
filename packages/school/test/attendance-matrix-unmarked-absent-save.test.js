const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const controllerSource = fs.readFileSync(
  path.join(__dirname, '../MVC/controllers/school/attendanceController.js'),
  'utf8'
);

test('matrix cell save keeps explicit absent when prior status was unmarked', () => {
  const block = controllerSource.slice(controllerSource.indexOf('async function updateAttendanceRosterCell'));
  assert.match(
    block,
    /if \(explicitUnmark \|\| \(priorUnmarked && !attendanceProvided\)\)/
  );
  assert.doesNotMatch(
    block,
    /if \(priorUnmarked \|\| explicitUnmark\)/
  );
});