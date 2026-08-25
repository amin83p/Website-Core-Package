const { requireCoreModule } = require('./schoolCoreContracts');
const personSimilarityEngineService = requireCoreModule('MVC/services/person/personSimilarityEngineService');
const schoolPersonSimilarityService = require('./schoolPersonSimilarityService');

const NAME_DUPLICATE_WARNING_CODE = 'NAME_DUPLICATE_WARNING';
const DEFAULT_MATCH_LIMIT = personSimilarityEngineService.DEFAULT_MATCH_LIMIT;

function normalizeNamePart(value) {
  return personSimilarityEngineService.normalizeNamePart(value);
}

function isNameDuplicateAcknowledged(body = {}) {
  const value = body?.acknowledgeNameDuplicate;
  if (value === true || value === 1) return true;
  const text = String(value ?? '').trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'yes';
}

function collectExactNameMatches(persons = [], firstName = '', lastName = '', limit = DEFAULT_MATCH_LIMIT) {
  return personSimilarityEngineService.collectExactNameMatches(persons, firstName, lastName, limit);
}

async function findExactNamePersonMatches({
  reqUser = null,
  firstName = '',
  lastName = '',
  limit = DEFAULT_MATCH_LIMIT
} = {}) {
  return schoolPersonSimilarityService.findExactNamePersonMatches({
    reqUser,
    firstName,
    lastName,
    limit
  });
}

async function findSimilarPersonMatches({
  reqUser = null,
  candidate = {},
  minScore = personSimilarityEngineService.DEFAULT_MIN_SCORE,
  limit = DEFAULT_MATCH_LIMIT
} = {}) {
  return schoolPersonSimilarityService.findSimilarPersonMatches({
    reqUser,
    candidate,
    minScore,
    limit
  });
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
  findSimilarPersonMatches,
  buildNameDuplicateWarningError,
  assertNoExactNameDuplicateOrThrow
};
