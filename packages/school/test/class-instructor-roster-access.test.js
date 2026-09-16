const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const { SCOPE_MODES } = require('../MVC/services/school/schoolDataScopeBuilder');
const schoolRecordAccessService = require('../MVC/services/school/schoolRecordAccessService');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

const personRon = 'PERSON_RON';
const personTaylor = 'PERSON_TAYLOR';

test('isClassAccessible grants assignment access for active class instructor roster only', () => {
  const access = {
    scopeMode: SCOPE_MODES.ASSIGNMENT,
    personId: personRon,
    userId: '',
    denyAll: false,
    canViewAll: false
  };
  const onRoster = {
    id: 'CLS_1',
    instructors: [{ personId: personRon, name: 'Ron', status: 'active' }],
    sessions: []
  };
  const sessionOnly = {
    id: 'CLS_2',
    instructors: [{ personId: personTaylor, name: 'Taylor', status: 'active' }],
    sessions: [{ sessionId: 'S1', delivery: { deliveredBy: personRon } }]
  };

  assert.equal(schoolRecordAccessService.isClassAccessible(onRoster, access), true);
  assert.equal(schoolRecordAccessService.isClassAccessible(sessionOnly, access), false);
});

test('isClassAccessible ignores inactive roster rows for assignment scope', () => {
  const access = {
    scopeMode: SCOPE_MODES.ASSIGNMENT,
    personId: personRon,
    userId: '',
    denyAll: false,
    canViewAll: false
  };
  const inactiveRow = {
    id: 'CLS_3',
    instructors: [{ personId: personRon, name: 'Ron', status: 'inactive' }],
    sessions: []
  };
  assert.equal(schoolRecordAccessService.isClassAccessible(inactiveRow, access), false);
});

test('class form exposes add instructor control and roster helper', () => {
  const form = read('MVC/views/school/class/classForm.ejs');
  assert.match(form, /id="btn_addAdditionalInstructor"/);
  assert.match(form, /function addAdditionalInstructorFromPicker/);
  assert.match(form, /setupPicker\('btn_addAdditionalInstructor'/);
  assert.match(form, /class-picker access/i);
});

test('repository class assignment scope uses instructor roster only', () => {
  const repo = read('MVC/repositories/school/index.js');
  const fnStart = repo.indexOf('function buildAssignmentScopeFilter');
  const fnEnd = repo.indexOf('function buildOwnerScopeFilter', fnStart);
  const block = repo.slice(fnStart, fnEnd);
  assert.match(block, /\$elemMatch/);
  assert.doesNotMatch(block, /sessions\.delivery\.deliveredBy/);
  assert.doesNotMatch(block, /coTeachers\.personId/);
});

test('schoolRecordAccessService class accessibility no longer uses session delivery at class level', () => {
  const source = read('MVC/services/school/schoolRecordAccessService.js');
  const fnBlock = source.slice(
    source.indexOf('function isClassAccessible'),
    source.indexOf('function isSessionAccessible')
  );
  assert.doesNotMatch(fnBlock, /classHasSessionDeliveredByPerson/);
});
