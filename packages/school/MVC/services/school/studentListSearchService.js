const studentModel = require('../../models/school/studentModel');
const { requireCoreModule } = require('./schoolCoreContracts');
const {
  recordMatchesMultiFieldSearch
} = requireCoreModule('MVC/utils/multiFieldSearch');
const {
  CANONICAL_STUDENT_PICKER_SEARCH_FIELDS,
  LEGACY_STUDENT_PICKER_SEARCH_FIELDS
} = require('../../../config/studentPickerSearchFields');

const STUDENT_LIST_EXTRA_DB_SEARCH_FIELDS = Object.freeze([
  'claimNumbers.number',
  'claimNumbers.label'
]);

function normalizeSearchFieldsToken(searchFields) {
  return String(searchFields || '')
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
    .join(',');
}

function isLegacyStudentPickerSearchFields(searchFields) {
  const raw = String(searchFields || '').trim();
  if (!raw) return false;
  const normalized = normalizeSearchFieldsToken(raw);
  if (normalized === normalizeSearchFieldsToken(LEGACY_STUDENT_PICKER_SEARCH_FIELDS)) {
    return true;
  }
  const tokens = normalized.split(',').filter(Boolean);
  if (!tokens.length) return false;
  return !tokens.includes('customstudentid');
}

function safeClaimEntries(student) {
  try {
    return studentModel.cleanClaimNumbers(student?.claimNumbers);
  } catch {
    const raw = Array.isArray(student?.claimNumbers) ? student.claimNumbers : [];
    return raw
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        number: String(entry.number || '').trim(),
        label: String(entry.label || '').trim(),
        notes: String(entry.notes || '').trim()
      }))
      .filter((entry) => entry.number || entry.label || entry.notes);
  }
}

function collectClaimSearchTokens(student) {
  const entries = safeClaimEntries(student);
  const tokens = [];
  entries.forEach((entry) => {
    if (entry.number) tokens.push(entry.number);
    if (entry.label) tokens.push(entry.label);
    if (entry.notes) tokens.push(entry.notes);
  });
  return tokens;
}

function buildStudentListSearchHaystack(student) {
  const firstName = String(student?.firstName || '').trim();
  const lastName = String(student?.lastName || '').trim();
  const fullName = `${firstName} ${lastName}`.trim();
  const reverseName = `${lastName} ${firstName}`.trim();
  return [
    student?.id,
    student?.customStudentId,
    student?.personId,
    firstName,
    lastName,
    student?.name,
    fullName,
    reverseName,
    student?.email,
    student?.phone,
    student?.feeCategory,
    student?.studentAccountId,
    ...collectClaimSearchTokens(student)
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
}

function readStudentSearchFieldValues(student, fieldToken) {
  const field = String(fieldToken || '').trim();
  if (!field) return [];
  if (field === 'name.first') {
    return [student?.firstName, student?.name?.first].filter((v) => v !== undefined && v !== null && String(v).trim());
  }
  if (field === 'name.last') {
    return [student?.lastName, student?.name?.last].filter((v) => v !== undefined && v !== null && String(v).trim());
  }
  if (field === 'studentNumber') {
    return [student?.studentNumber, student?.customStudentId].filter((v) => v !== undefined && v !== null && String(v).trim());
  }
  if (field === 'claimNumbers.number') {
    return safeClaimEntries(student).map((entry) => entry.number).filter(Boolean);
  }
  if (field === 'claimNumbers.label') {
    return safeClaimEntries(student).map((entry) => entry.label).filter(Boolean);
  }
  if (field === 'claimNumbers.notes') {
    return safeClaimEntries(student).map((entry) => entry.notes).filter(Boolean);
  }
  if (field === 'claimNumbers') {
    return collectClaimSearchTokens(student);
  }
  if (Object.prototype.hasOwnProperty.call(student || {}, field)) {
    return [student[field]];
  }
  return [];
}

function studentMatchesListSearch(student, { q, type, searchFields } = {}) {
  return recordMatchesMultiFieldSearch(student, { q, type, searchFields }, {
    getHaystack: (row) => buildStudentListSearchHaystack(row),
    readFieldValues: readStudentSearchFieldValues
  });
}

function mergeStudentListSearchableFields(inferredFields = []) {
  const base = Array.isArray(inferredFields) ? inferredFields : [];
  return [...new Set([...base, ...STUDENT_LIST_EXTRA_DB_SEARCH_FIELDS])];
}

function buildSessionStudentCaseRosterEntries(rosterRows = [], { students = [], persons = [] } = {}) {
  const studentById = new Map(
    (Array.isArray(students) ? students : [])
      .map((row) => [String(row?.id || '').trim(), row])
      .filter(([id]) => id)
  );
  const personById = new Map(
    (Array.isArray(persons) ? persons : [])
      .map((row) => [String(row?.id || '').trim(), row])
      .filter(([id]) => id)
  );
  const studentByPersonId = new Map();
  (Array.isArray(students) ? students : []).forEach((row) => {
    const personId = String(row?.personId || '').trim();
    if (personId && !studentByPersonId.has(personId)) {
      studentByPersonId.set(personId, row);
    }
  });

  return (Array.isArray(rosterRows) ? rosterRows : [])
    .map((row) => {
      const personId = String(row?.personId || '').trim();
      if (!personId) return null;
      const person = personById.get(personId) || null;
      const studentRecord = studentByPersonId.get(personId)
        || studentById.get(String(row?.studentRecordId || '').trim())
        || null;
      const firstName = String(
        person?.name?.first || person?.firstName || row?.firstName || ''
      ).trim();
      const lastName = String(
        person?.name?.last || person?.lastName || row?.lastName || ''
      ).trim();
      const name = String(
        row?.name || row?.studentName || `${firstName} ${lastName}`.trim() || personId
      ).trim();
      const searchText = buildStudentListSearchHaystack({
        ...(studentRecord && typeof studentRecord === 'object' ? studentRecord : {}),
        id: String(studentRecord?.id || row?.studentRecordId || '').trim(),
        personId,
        firstName,
        lastName,
        name,
        customStudentId: String(studentRecord?.customStudentId || row?.customStudentId || '').trim(),
        claimNumbers: Array.isArray(studentRecord?.claimNumbers) ? studentRecord.claimNumbers : []
      });
      return {
        personId,
        name,
        studentRecordId: String(studentRecord?.id || row?.studentRecordId || '').trim(),
        customStudentId: String(studentRecord?.customStudentId || '').trim(),
        searchText
      };
    })
    .filter(Boolean);
}

module.exports = {
  CANONICAL_STUDENT_PICKER_SEARCH_FIELDS,
  LEGACY_STUDENT_PICKER_SEARCH_FIELDS,
  isLegacyStudentPickerSearchFields,
  STUDENT_LIST_EXTRA_DB_SEARCH_FIELDS,
  buildStudentListSearchHaystack,
  buildSessionStudentCaseRosterEntries,
  studentMatchesListSearch,
  mergeStudentListSearchableFields
};
