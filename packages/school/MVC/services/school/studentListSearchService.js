const studentModel = require('../../models/school/studentModel');

const STUDENT_LIST_EXTRA_DB_SEARCH_FIELDS = Object.freeze([
  'claimNumbers.number',
  'claimNumbers.label'
]);

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

function normalizeSearchType(type) {
  return String(type || 'contains').trim().toLowerCase().replace(/_/g, '');
}

function valueMatchesQuery(rawValue, qLower, normalizedType) {
  const value = String(rawValue ?? '').trim().toLowerCase();
  if (!value) return false;
  if (normalizedType === 'exactmatch') return value === qLower;
  if (normalizedType === 'startswith') return value.startsWith(qLower);
  return value.includes(qLower);
}

function readStudentSearchFieldValues(student, fieldToken) {
  const field = String(fieldToken || '').trim();
  if (!field) return [];
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
  const qLower = String(q || '').trim().toLowerCase();
  if (!qLower) return true;

  const normalizedType = normalizeSearchType(type);
  const fieldToken = String(searchFields || '').trim().split(',')[0].trim();
  const useAll = !fieldToken || fieldToken === 'all';

  if (useAll) {
    return buildStudentListSearchHaystack(student).includes(qLower);
  }

  const values = readStudentSearchFieldValues(student, fieldToken);
  return values.some((raw) => valueMatchesQuery(raw, qLower, normalizedType));
}

function mergeStudentListSearchableFields(inferredFields = []) {
  const base = Array.isArray(inferredFields) ? inferredFields : [];
  return [...new Set([...base, ...STUDENT_LIST_EXTRA_DB_SEARCH_FIELDS])];
}

module.exports = {
  STUDENT_LIST_EXTRA_DB_SEARCH_FIELDS,
  buildStudentListSearchHaystack,
  studentMatchesListSearch,
  mergeStudentListSearchableFields
};
