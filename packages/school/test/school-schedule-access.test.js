/**
 * Master Schedule access hardening and lighter page loading.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('scheduleAccessService centralizes admin and scope capability checks', () => {
  const service = read('MVC/services/school/scheduleAccessService.js');
  assert.match(service, /buildScheduleCapabilities/);
  assert.match(service, /assertCanViewPersonSchedule/);
  assert.match(service, /adminAuthorityService\.isAdminForRequest/);
  assert.match(service, /accessService\.evaluateAccess/);
  assert.match(service, /buildSchoolListScope/);
  assert.match(service, /canSelectAnyPerson = isOperationAdmin/);
});

test('schedule controller uses scheduleAccessService and scoped repository reads', () => {
  const controller = read('MVC/controllers/school/scheduleController.js');
  assert.match(controller, /scheduleAccessService/);
  assert.match(controller, /buildScheduleCapabilities/);
  assert.match(controller, /assertCanViewPersonSchedule/);
  assert.match(controller, /resolveListScope\(reqUser, accessContext\)/);
  assert.match(controller, /scope: listScope/);
  assert.doesNotMatch(controller, /scope: \{ canViewAll: true \}/);
});

test('person schedule view conditionally loads admin-only assets', () => {
  const view = read('MVC/views/school/schedule/personSchedule.ejs');
  assert.match(view, /scheduleCapabilities/);
  assert.match(view, /canDragCreateSessions/);
  assert.match(view, /if \(canDragCreateSessions\)/);
  assert.match(view, /if \(canSelectAnyPerson\)/);
  assert.match(view, /if \(canLoadAllSchedules\)/);
});

test('self-only schedule page does not always include admin modals in template branches', () => {
  const view = read('MVC/views/school/schedule/personSchedule.ejs');
  assert.match(view, /if \(canDragCreateSessions\) \{ %>\s*<%- include\('school\/partials\/sessionEnrollmentCalendarModal'\) %>/);
  assert.match(view, /if \(canSelectAnyPerson\) \{ %>\s*<%- include\('partials\/modal_GenericPicker'\) %>/);
});

test('enrollment period lookup respects caller scope in mongo repository', () => {
  const repo = read('MVC/repositories/school/index.js');
  assert.match(repo, /findByStudentId = async \(studentId, options = \{\}\)/);
  assert.match(repo, /const scope = options\?\.scope/);
});

test('schedule APIs pass route access context into scoped data reads', () => {
  const controller = read('MVC/controllers/school/scheduleController.js');
  assert.match(controller, /resolvePersonScheduleRequest[\s\S]*assertCanViewPersonSchedule/);
  assert.match(controller, /getPersonSchedule[\s\S]*buildRouteAccessContext\(req\)/);
  assert.match(controller, /pickerSchoolSchedulePersons[\s\S]*buildRouteAccessContext\(req\)/);
  assert.match(controller, /listActiveTeacherSchedulePersons[\s\S]*buildRouteAccessContext\(req\)/);
  assert.match(controller, /buildSchoolSchedulePersonPickerRows[\s\S]*accessContext/);
});

test('division-scoped READ_ALL users remain self-only in capability matrix', () => {
  const service = read('MVC/services/school/scheduleAccessService.js');
  assert.match(service, /canSelectAnyPerson = isOperationAdmin/);
  assert.doesNotMatch(service, /canSelectAnyPerson = canReadAll/);
  assert.match(service, /if \(normalizedTarget && !idsEqual\(normalizedTarget, lockedPersonId\)\)/);
});
