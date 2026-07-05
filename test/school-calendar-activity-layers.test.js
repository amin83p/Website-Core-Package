const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const schoolCalendarService = require(path.join(
  __dirname,
  '../packages/school/MVC/services/school/schoolCalendarService'
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
