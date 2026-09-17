const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildStudentListSearchHaystack,
  buildSessionStudentCaseRosterEntries,
  studentMatchesListSearch,
  mergeStudentListSearchableFields,
  STUDENT_LIST_EXTRA_DB_SEARCH_FIELDS,
  CANONICAL_STUDENT_PICKER_SEARCH_FIELDS,
  LEGACY_STUDENT_PICKER_SEARCH_FIELDS,
  isLegacyStudentPickerSearchFields
} = require('../packages/school/MVC/services/school/studentListSearchService');

const CONFIG_FIELDS = require('../packages/school/config/studentPickerSearchFields');

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

test('buildSessionStudentCaseRosterEntries adds searchText with claim and customStudentId', () => {
  const roster = [{ personId: 'PER-1', name: 'Jane Doe' }];
  const students = [baseStudent({
    personId: 'PER-1',
    customStudentId: 'CUST-ROSTER',
    claimNumbers: [{ id: 'c1', number: 'CLM-ROSTER-1', label: 'Primary', isPrimary: true }]
  })];
  const entries = buildSessionStudentCaseRosterEntries(roster, { students, persons: [] });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].personId, 'PER-1');
  assert.equal(entries[0].customStudentId, 'CUST-ROSTER');
  assert.match(entries[0].searchText, /clm-roster-1/);
  assert.match(entries[0].searchText, /cust-roster/);
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

test('studentMatchesListSearch matches generic picker multi-field searchFields by name', () => {
  const student = baseStudent({ firstName: 'Aisling', lastName: 'Murphy', id: 'STU-999' });
  const pickerFields = 'id,firstName,lastName,name.first,name.last,studentNumber,personId';
  assert.equal(studentMatchesListSearch(student, { q: 'aisling', searchFields: pickerFields }), true);
  assert.equal(studentMatchesListSearch(student, { q: 'murphy', searchFields: pickerFields }), true);
  assert.equal(studentMatchesListSearch(student, { q: 'stu-999', searchFields: pickerFields }), true);
});

test('canonical picker searchFields match config and support name, id, customStudentId, and claim number', () => {
  assert.equal(CANONICAL_STUDENT_PICKER_SEARCH_FIELDS, CONFIG_FIELDS.CANONICAL_STUDENT_PICKER_SEARCH_FIELDS);
  const student = baseStudent({
    id: 'STU-42',
    customStudentId: 'EXT-42',
    firstName: 'Sam',
    lastName: 'Patel',
    name: 'Sam Patel',
    claimNumbers: [{ id: 'c1', number: 'CLM-777', label: 'Primary', isPrimary: true }]
  });
  const fields = CANONICAL_STUDENT_PICKER_SEARCH_FIELDS;
  assert.equal(studentMatchesListSearch(student, { q: 'sam', searchFields: fields }), true);
  assert.equal(studentMatchesListSearch(student, { q: 'patel', searchFields: fields }), true);
  assert.equal(studentMatchesListSearch(student, { q: 'sam patel', searchFields: fields }), true);
  assert.equal(studentMatchesListSearch(student, { q: 'stu-42', searchFields: fields }), true);
  assert.equal(studentMatchesListSearch(student, { q: 'ext-42', searchFields: fields }), true);
  assert.equal(studentMatchesListSearch(student, { q: 'clm-777', searchFields: fields }), true);
});

test('empty searchFields uses haystack including claims (student directory all-fields mode)', () => {
  const student = baseStudent({
    claimNumbers: [{ id: 'c1', number: 'HAY-001', label: 'X', isPrimary: true }]
  });
  assert.equal(studentMatchesListSearch(student, { q: 'hay-001' }), true);
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

test('isLegacyStudentPickerSearchFields detects legacy picker field lists', () => {
  assert.equal(isLegacyStudentPickerSearchFields(LEGACY_STUDENT_PICKER_SEARCH_FIELDS), true);
  assert.equal(isLegacyStudentPickerSearchFields(CANONICAL_STUDENT_PICKER_SEARCH_FIELDS), false);
  assert.equal(isLegacyStudentPickerSearchFields(''), false);
});

test('genericPickerPresets student preset uses canonical searchFields', () => {
  const presetSource = read('public/scripts/genericPickerPresets.js');
  assert.match(presetSource, /CANONICAL_STUDENT_PICKER_SEARCH_FIELDS/);
  assert.match(presetSource, new RegExp(`searchFields:\\s*CANONICAL_STUDENT_PICKER_SEARCH_FIELDS`));
  assert.match(presetSource, /warnLegacyStudentPickerSearchFields/);
});

test('listStudents warns on legacy student picker searchFields', () => {
  const controller = read('packages/school/MVC/controllers/school/studentController.js');
  assert.match(controller, /isLegacyStudentPickerSearchFields/);
  assert.match(controller, /Legacy student picker searchFields/);
});
