const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('schedule routes expose active teachers endpoint with schedule read-all access', () => {
  const routeSource = read('packages/school/MVC/routes/scheduleRoutes.js');

  assert.match(routeSource, /router\.get\('\/api\/active-teachers'/);
  assert.match(routeSource, /requireAccess\(SECTIONS\.SCHOOL_SCHEDULES,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(routeSource, /trackActionState\(SECTIONS\.SCHOOL_SCHEDULES,\s*OPERATIONS\.READ_ALL\)/);
  assert.match(routeSource, /ctrl\.listActiveTeacherSchedulePersons/);
});

test('active teachers endpoint filters archived identity rows and returns teacher tab rows', () => {
  const controllerSource = read('packages/school/MVC/controllers/school/scheduleController.js');

  assert.match(controllerSource, /async function listActiveTeacherSchedulePersons\(req,\s*res\)/);
  assert.match(controllerSource, /schoolDataService\.fetchData\('teachers'/);
  assert.match(controllerSource, /dataService\.fetchData\('persons'/);
  assert.match(controllerSource, /!rowBelongsToActiveOrg\(teacher,\s*activeOrgId\)\s*\|\|\s*!isActiveSchoolIdentityRow\(teacher\)/);
  assert.match(controllerSource, /seenPersonIds\.has\(personId\)/);
  assert.match(controllerSource, /availableRoles\s*=\s*\[\{\s*key:\s*'teacher',\s*label:\s*'Teacher'/);
  assert.match(controllerSource, /selectedRole:\s*'teacher'/);
  assert.match(controllerSource, /listActiveTeacherSchedulePersons,/);
});

test('master academia schedule workspace has all-active-teacher button and bulk load client flow', () => {
  const viewSource = read('packages/school/MVC/views/school/masterAcademiaHub.ejs');

  assert.match(viewSource, /id="hubScheduleAddPeople"[^>]*>[\s\S]*Select People/);
  assert.match(viewSource, /id="hubScheduleAllActiveTeachers"[^>]*>[\s\S]*All Active Teacher/);
  assert.match(viewSource, /async function loadAllActiveHubScheduleTeachers\(\)/);
  assert.match(viewSource, /fetch\('\/school\/schedules\/api\/active-teachers'/);
  assert.match(viewSource, /hubScheduleState\.persons\s*=\s*rows\.map/);
  assert.match(viewSource, /selectedRole:\s*'teacher'/);
  assert.match(viewSource, /await loadAllHubSchedulePeople\(\)/);
  assert.match(viewSource, /activeTeachersBtn\.addEventListener\('click',\s*loadAllActiveHubScheduleTeachers\)/);
});

test('schedule calendar date clicks load the day automatically and supports vertical, horizontal, and month switching', () => {
  const viewSource = read('packages/school/MVC/views/school/masterAcademiaHub.ejs');

  assert.match(viewSource, /data-hub-schedule-date/);
  assert.match(viewSource, /hubScheduleState\.loadedPersonIds\.clear\(\);[\s\S]*?loadActiveHubSchedulePerson\(\);/);
  assert.match(viewSource, /function renderHubScheduleVerticalTimelineView/);
  assert.match(viewSource, /mode = 'verticalTimeline'[\s\S]*?renderHubScheduleVerticalTimelineView/);
  assert.match(viewSource, /data-hub-schedule-view-vertical/);
  assert.match(viewSource, /data-hub-schedule-view-timeline/);
  assert.match(viewSource, /data-hub-schedule-view-month/);
  assert.match(viewSource, /hubScheduleState.viewMode = 'verticalTimeline'/);
  assert.ok(viewSource.includes("hubScheduleState.viewMode = verticalButton ? 'verticalTimeline' : (timelineButton ? 'timeline' : 'calendar');"));
  assert.match(viewSource, /id="hubScheduleDayWidth"/);
  assert.match(viewSource, /schoolMasterHub\.scheduleDayWidth/);
  assert.match(viewSource, /data-hub-schedule-tip/);
  assert.match(viewSource, /data-tip-bg/);
  assert.match(viewSource, /function hubScheduleStatusTipStyle/);
  assert.match(viewSource, /function buildHubScheduleEventTooltip/);
  assert.match(viewSource, /function syncHubScheduleTooltipTriggers/);
  assert.match(viewSource, /sch-tip-line/);
  assert.match(viewSource, /sch-tip-sub/);
  assert.match(viewSource, /sch-tip-date/);
  assert.match(viewSource, /detailParts\.join\('\\n'\)/);
  assert.doesNotMatch(viewSource, /Open item details/);
  assert.doesNotMatch(viewSource, /addDetail\('Class ID'/);
  assert.doesNotMatch(viewSource, /addDetail\('Session ID'/);
  assert.match(viewSource, /hub-schedule-tip\.is-below/);
  assert.match(viewSource, /white-space:\s*normal/);
  assert.doesNotMatch(viewSource, /hub-schedule-event-title text-truncate/);
  assert.match(viewSource, /id="hubScheduleLegendModal"/);
  assert.match(viewSource, /data-hub-schedule-open-legend/);
  assert.match(viewSource, /function sortHubSchedulePersons/);
  assert.match(viewSource, /hubSchedulePersonTabStyle/);
  assert.match(viewSource, /min-height: 4\.25rem/);
});
