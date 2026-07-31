const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const controllerPath = 'packages/school/MVC/controllers/school/attendanceController.js';
const source = fs.readFileSync(controllerPath, 'utf8');

test('attendance matrix reads classes with route access context', () => {
  assert.match(source, /function buildAttendanceRouteAccessContext\(req\)/);
  assert.match(source, /async function getAttendanceClassOrThrow\(req, classId\)/);
  assert.match(
    source,
    /buildAttendanceMatrixPayload[\s\S]*getAttendanceClassOrThrow\(req, classId\)/
  );
  assert.match(
    source,
    /getClassSessions\(classId, req\.user, routeAccessContext\)/
  );
});

test('attendance mutations save sessions with route access context', () => {
  assert.match(
    source,
    /addAttendanceComment[\s\S]*getAttendanceClassOrThrow\(req, classId\)[\s\S]*saveClassSessions\(classId, sessions, req\.user, accessContext\)/
  );
  assert.match(
    source,
    /updateAttendanceRosterCell[\s\S]*getAttendanceClassOrThrow\(req, classId\)[\s\S]*saveClassSessions\(classId, sessions, req\.user, routeAccessContext\)/
  );
  assert.match(
    source,
    /uploadAttendanceFile[\s\S]*getAttendanceClassOrThrow\(req, classId\)/
  );
});

test('attendance active class list uses route access context', () => {
  assert.match(
    source,
    /listActiveAttendanceClasses[\s\S]*fetchData\('classes', \{\}, req\.user, routeAccessContext\)/
  );
});
