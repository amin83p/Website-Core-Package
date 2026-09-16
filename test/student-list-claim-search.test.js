const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildStudentListSearchHaystack,
  studentMatchesListSearch,
  mergeStudentListSearchableFields,
  STUDENT_LIST_EXTRA_DB_SEARCH_FIELDS
} = require('../packages/school/MVC/services/school/studentListSearchService');

const ROOT_DIR = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function baseStudent(overrides = {}) {
  return {
    id: 'STU-1',
    customStudentId: 'CUST-1',
    personId: 'PER-1',
    firstName: 'Jane',
    lastName: 'Doe',
    name: 'Jane Doe',
    email: 'jane@example.com',
    phone: '555-0100',
    feeCategory: 'Domestic',
    studentAccountId: 'ACC-1',
    claimNumbers: [],
    ...overrides
  };
}

test('buildStudentListSearchHaystack includes claim number, label, and notes', () => {
  const haystack = buildStudentListSearchHaystack(baseStudent({
    claimNumbers: [{
      id: 'claim_1',
      number: 'CLM-9001',
      label: 'IRCC Primary',
      notes: 'Winter intake',
      isPrimary: true
    }]
  }));
  assert.match(haystack, /clm-9001/);
  assert.match(haystack, /ircc primary/);
  assert.match(haystack, /winter intake/);
});

test('studentMatchesListSearch matches all-fields and field-specific claim number', () => {
  const student = baseStudent({
    claimNumbers: [{ id: 'c1', number: 'ENROLL-42', label: 'Main', isPrimary: true }]
  });
  assert.equal(studentMatchesListSearch(student, { q: 'enroll-42' }), true);
  assert.equal(studentMatchesListSearch(student, {
    q: 'ENROLL-42',
    type: 'exact_match',
    searchFields: 'claimNumbers.number'
  }), true);
  assert.equal(studentMatchesListSearch(student, {
    q: 'enroll',
    type: 'starts_with',
    searchFields: 'claimNumbers.number'
  }), true);
  assert.equal(studentMatchesListSearch(student, {
    q: 'zzz',
    searchFields: 'claimNumbers.number'
  }), false);
});

test('studentMatchesListSearch matches claim label field', () => {
  const student = baseStudent({
    claimNumbers: [{ id: 'c1', number: 'N-1', label: 'Secondary Claim', isPrimary: true }]
  });
  assert.equal(studentMatchesListSearch(student, {
    q: 'secondary',
    searchFields: 'claimNumbers.label'
  }), true);
});

test('mergeStudentListSearchableFields always includes claim DB search fields', () => {
  const merged = mergeStudentListSearchableFields(['id', 'customStudentId']);
  assert.deepEqual(STUDENT_LIST_EXTRA_DB_SEARCH_FIELDS, ['claimNumbers.number', 'claimNumbers.label']);
  assert.equal(merged.includes('claimNumbers.number'), true);
  assert.equal(merged.includes('claimNumbers.label'), true);
});

test('listStudents wires student list claim search helper', () => {
  const controller = read('packages/school/MVC/controllers/school/studentController.js');
  assert.match(controller, /studentListSearchService/);
  assert.match(controller, /studentMatchesListSearch/);
  assert.match(controller, /mergeStudentListSearchableFields/);
});

test('students repository defaultSearchFields include claim number paths', () => {
  const repo = read('packages/school/MVC/repositories/school/index.js');
  assert.match(repo, /students: createSchoolRepository\([\s\S]*claimNumbers\.number[\s\S]*claimNumbers\.label/);
});
