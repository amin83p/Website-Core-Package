const schoolPersonAccessService = require('./schoolPersonAccessService');

const NAME_DUPLICATE_WARNING_CODE = 'NAME_DUPLICATE_WARNING';
const DEFAULT_MATCH_LIMIT = 10;

function normalizeNamePart(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function isNameDuplicateAcknowledged(body = {}) {
  const value = body?.acknowledgeNameDuplicate;
  if (value === true || value === 1) return true;
  const text = String(value ?? '').trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'yes';
}

function collectExactNameMatches(persons = [], firstName = '', lastName = '', limit = DEFAULT_MATCH_LIMIT) {
  const firstNorm = normalizeNamePart(firstName);
  const lastNorm = normalizeNamePart(lastName);
  if (!firstNorm || !lastNorm) return [];

  const max = Math.max(1, Number(limit) || DEFAULT_MATCH_LIMIT);
  const matches = [];
  for (const person of Array.isArray(persons) ? persons : []) {
    const row = schoolPersonAccessService.toPickerRow(person);
    if (normalizeNamePart(row.firstName) !== firstNorm) continue;
    if (normalizeNamePart(row.lastName) !== lastNorm) continue;
    matches.push({
      personId: row.personId,
      displayName: row.displayName,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email
    });
    if (matches.length >= max) break;
  }
  return matches;
}

async function findExactNamePersonMatches({
  reqUser = null,
  firstName = '',
  lastName = '',
  limit = DEFAULT_MATCH_LIMIT
} = {}) {
  const firstNorm = normalizeNamePart(firstName);
  const lastNorm = normalizeNamePart(lastName);
  if (!firstNorm || !lastNorm) return [];

  const persons = await schoolPersonAccessService.listActiveOrgPersons({
    reqUser,
    q: '',
    query: { limit: 5000 },
    requireSchoolRole: false
  });
  return collectExactNameMatches(persons, firstName, lastName, limit);
}

function buildNameDuplicateWarningError(matches = []) {
  const list = Array.isArray(matches) ? matches : [];
  const error = new Error(
    list.length === 1
      ? 'A person with this exact first and last name already exists. Confirm to create another record.'
      : `${list.length} people with this exact first and last name already exist. Confirm to create another record.`
  );
  error.statusCode = 409;
  error.code = NAME_DUPLICATE_WARNING_CODE;
  error.details = { matches: list };
  return error;
}

async function assertNoExactNameDuplicateOrThrow({
  reqUser = null,
  firstName = '',
  lastName = '',
  acknowledged = false,
  limit = DEFAULT_MATCH_LIMIT
} = {}) {
  if (acknowledged) return [];
  const matches = await findExactNamePersonMatches({ reqUser, firstName, lastName, limit });
  if (matches.length) throw buildNameDuplicateWarningError(matches);
  return matches;
}

module.exports = {
  NAME_DUPLICATE_WARNING_CODE,
  normalizeNamePart,
  isNameDuplicateAcknowledged,
  collectExactNameMatches,
  findExactNamePersonMatches,
  buildNameDuplicateWarningError,
  assertNoExactNameDuplicateOrThrow
};
