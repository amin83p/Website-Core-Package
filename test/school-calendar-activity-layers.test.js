const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const schoolCalendarService = require(path.join(
  __dirname,
  '../packages/school/MVC/services/school/schoolCalendarService'
));
const activityService = require(path.join(
  __dirname,
  '../packages/school/MVC/services/school/activityService'
));

test('buildAssignedActivityTitle prefixes category and appends entry title', () => {
  assert.equal(
    schoolCalendarService.buildAssignedActivityTitle(
      { title: 'Faculty Meeting', categoryName: 'Professional Development' },
      { title: 'Morning Session' }
    ),
    'Professional Development · Faculty Meeting · Morning Session'
  );
});

test('buildAssignedActivityTitle omits duplicate entry title', () => {
  assert.equal(
    schoolCalendarService.buildAssignedActivityTitle(
      { title: 'Faculty Meeting', categoryName: 'Professional Development' },
      { title: 'Faculty Meeting' }
    ),
    'Professional Development · Faculty Meeting'
  );
});

test('buildAssignedActivityTitle works without category', () => {
  assert.equal(
    schoolCalendarService.buildAssignedActivityTitle(
      { title: 'Open House' },
      {}
    ),
    'Open House'
  );
});

test('LAYER_KEYS includes public and assigned activity layers', () => {
  assert.equal(schoolCalendarService.LAYER_KEYS.SCHOOL_PUBLIC_ACTIVITIES, 'school_public_activities');
  assert.equal(schoolCalendarService.LAYER_KEYS.MY_ASSIGNED_ACTIVITIES, 'my_assigned_activities');
});

test('statutory holiday activity entries respect showInTimesheetActivities on school calendar', () => {
  const statActivity = { title: 'STATUTORY HOLIDAY PAY', showInTimesheetActivities: false };
  const statEntry = { date: '2026-07-01', statHolidayId: 'H1' };
  assert.equal(activityService.shouldIncludeActivityEntryOnSchoolCalendar(statActivity, statEntry), false);

  const visibleStat = { ...statActivity, showInTimesheetActivities: true };
  assert.equal(activityService.shouldIncludeActivityEntryOnSchoolCalendar(visibleStat, statEntry), true);

  const regular = { title: 'Staff meeting', showInTimesheetActivities: false };
  assert.equal(activityService.shouldIncludeActivityEntryOnSchoolCalendar(regular, { date: '2026-07-02' }), true);
});

test('school calendar filters statutory holiday activities by timesheet visibility flag', () => {
  const source = require('fs').readFileSync(path.join(
    __dirname,
    '../packages/school/MVC/services/school/schoolCalendarService.js'
  ), 'utf8');
  assert.match(source, /shouldIncludeActivityEntryOnSchoolCalendar/);
});
