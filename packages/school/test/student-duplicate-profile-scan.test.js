const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

const studentDuplicateProfileService = require('../MVC/services/school/studentDuplicateProfileService');

const ORG = 'ORG-900';

test('buildDuplicateStudentProfileGroups finds same personId duplicates in org', () => {
  const students = [
    { id: 'STU-1', orgId: ORG, personId: 'PER-1', academicStatus: 'Active' },
    { id: 'STU-2', orgId: ORG, personId: 'PER-1', academicStatus: 'Active' },
    { id: 'STU-3', orgId: ORG, personId: 'PER-2', academicStatus: 'Active' }
  ];
  const groups = studentDuplicateProfileService.buildDuplicateStudentProfileGroups(students, ORG);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].personId, 'PER-1');
  assert.equal(groups[0].students.length, 2);
});

test('buildDuplicateStudentProfileGroups ignores different orgs and hard-deleted rows', () => {
  const students = [
    { id: 'STU-1', orgId: ORG, personId: 'PER-1' },
    { id: 'STU-2', orgId: 'ORG-OTHER', personId: 'PER-1' },
    { id: 'STU-3', orgId: ORG, personId: 'PER-1', deleted: true }
  ];
  const groups = studentDuplicateProfileService.buildDuplicateStudentProfileGroups(students, ORG);
  assert.equal(groups.length, 0);
});

test('groupMatchesSearchQuery filters by person name and student id', () => {
  const group = {
    personId: 'PER-9',
    students: [
      { studentId: 'STU-A', customStudentId: 'C-100' },
      { studentId: 'STU-B', customStudentId: '' }
    ]
  };
  assert.equal(
    studentDuplicateProfileService.groupMatchesSearchQuery(group, 'sam student', 'Sam Student'),
    true
  );
  assert.equal(
    studentDuplicateProfileService.groupMatchesSearchQuery(group, 'stu-b', 'Sam Student'),
    true
  );
  assert.equal(
    studentDuplicateProfileService.groupMatchesSearchQuery(group, 'nomatch', 'Sam Student'),
    false
  );
});

test('school settings catalog includes duplicate student registrations group', () => {
  const catalog = read('MVC/config/schoolSettingsCatalog.js');
  assert.match(catalog, /duplicate-student-registrations/);
  assert.match(catalog, /Duplicate Student Profiles/);
});

test('school settings routes expose duplicate student scan endpoint', () => {
  const routes = read('MVC/routes/schoolSettingsRoutes.js');
  assert.match(routes, /\/duplicate-student-registrations\/scan/);
  assert.match(routes, /SECTIONS\.SCHOOL_SETTINGS,\s*OPERATIONS\.READ_ALL/);
  assert.match(routes, /scanDuplicateStudentProfilesApi/);
});

test('school settings index includes duplicate student scan UI', () => {
  const view = read('MVC/views/school/settings/index.ejs');
  assert.match(view, /id="duplicate-student-registrations"/);
  assert.match(view, /duplicate-student-registrations\/scan/);
  assert.match(view, /btnScanDuplicateStudentRegistrations/);
});
