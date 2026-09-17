'use strict';

/**
 * Single source of truth for GenericPicker student preset and listStudents in-memory search.
 * Browser copy: public/scripts/genericPickerPresets.js (kept in sync via test/student-picker-search-audit.test.js).
 */

const STUDENT_PICKER_IDENTITY_SEARCH_FIELDS = Object.freeze([
  'id',
  'customStudentId',
  'firstName',
  'lastName',
  'name',
  'name.first',
  'name.last',
  'studentNumber',
  'personId'
]);

const STUDENT_PICKER_CLAIM_SEARCH_FIELDS = Object.freeze([
  'claimNumbers.number',
  'claimNumbers.label'
]);

const CANONICAL_STUDENT_PICKER_SEARCH_FIELDS = [
  ...STUDENT_PICKER_IDENTITY_SEARCH_FIELDS,
  ...STUDENT_PICKER_CLAIM_SEARCH_FIELDS
].join(',');

const LEGACY_STUDENT_PICKER_SEARCH_FIELDS = 'id,firstName,lastName,name.first,name.last,studentNumber,personId';

module.exports = {
  STUDENT_PICKER_IDENTITY_SEARCH_FIELDS,
  STUDENT_PICKER_CLAIM_SEARCH_FIELDS,
  CANONICAL_STUDENT_PICKER_SEARCH_FIELDS,
  LEGACY_STUDENT_PICKER_SEARCH_FIELDS
};
