'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const personSimilarityEngineService = requireCoreModule('MVC/services/person/personSimilarityEngineService');
const schoolPersonAccessService = require('./schoolPersonAccessService');

const ROLE_LABELS = {
  school_student: 'Student',
  school_teacher: 'Teacher',
  school_staff: 'Staff',
  school_funder: 'Funder'
};

function getActiveOrgId(reqUser = {}) {
  return String(reqUser?.activeOrgId || reqUser?.orgId || reqUser?.organizationId || '').trim();
}

function mapRoleLabels(roles = []) {
  return (Array.isArray(roles) ? roles : [])
    .map((role) => ROLE_LABELS[String(role || '').trim().toLowerCase()] || String(role || '').trim())
    .filter(Boolean);
}

function enrichMatchRow(row = {}, person = {}, activeOrgId = '') {
  const picker = schoolPersonAccessService.toPickerRow(person);
  const schoolRoles = Array.isArray(person?.schoolRoles)
    ? person.schoolRoles
    : (Array.isArray(person?.roles) ? person.roles : []);

  return {
    personId: picker.personId,
    displayName: picker.displayName,
    firstName: picker.firstName,
    lastName: picker.lastName,
    email: picker.email,
    score: Number(row.score || 0),
    matchType: row.matchType || 'similar',
    reasons: Array.isArray(row.reasons) ? row.reasons : [],
    schoolRoles,
    roleLabels: mapRoleLabels(schoolRoles)
  };
}

async function findSimilarPersonMatches({
  reqUser = null,
  candidate = {},
  minScore = personSimilarityEngineService.DEFAULT_MIN_SCORE,
  limit = personSimilarityEngineService.DEFAULT_MATCH_LIMIT
} = {}) {
  const activeOrgId = getActiveOrgId(reqUser);
  const persons = await schoolPersonAccessService.listActiveOrgPersons({
    reqUser,
    q: '',
    query: { limit: 5000 },
    requireSchoolRole: false
  });

  const ranked = personSimilarityEngineService.rankSimilarPersons(candidate, persons, {
    minScore,
    limit,
    excludePersonId: candidate.excludePersonId || ''
  });

  const personById = new Map(
    (Array.isArray(persons) ? persons : [])
      .map((person) => [String(schoolPersonAccessService.toPickerRow(person).personId || ''), person])
      .filter(([personId]) => personId)
  );

  return ranked.map((row) => enrichMatchRow(row, personById.get(String(row.personId || '')) || {}, activeOrgId));
}

async function findExactNamePersonMatches({
  reqUser = null,
  firstName = '',
  lastName = '',
  limit = personSimilarityEngineService.DEFAULT_MATCH_LIMIT
} = {}) {
  const matches = await findSimilarPersonMatches({
    reqUser,
    candidate: { firstName, lastName },
    minScore: personSimilarityEngineService.EXACT_MATCH_SCORE,
    limit
  });
  return matches.filter((row) => row.matchType === 'exact');
}

async function buildNameMatchApiPayload({
  reqUser = null,
  firstName = '',
  lastName = '',
  middleName = '',
  preferredName = '',
  email = '',
  dateOfBirth = '',
  phone = '',
  excludePersonId = '',
  minScore = personSimilarityEngineService.DEFAULT_MIN_SCORE,
  limit = personSimilarityEngineService.DEFAULT_MATCH_LIMIT
} = {}) {
  const similarMatches = await findSimilarPersonMatches({
    reqUser,
    candidate: {
      firstName,
      lastName,
      middleName,
      preferredName,
      email,
      dateOfBirth,
      phone,
      excludePersonId
    },
    minScore,
    limit
  });
  const exactMatches = similarMatches.filter((row) => row.matchType === 'exact');
  return {
    exactMatches,
    similarMatches,
    matches: exactMatches
  };
}

module.exports = {
  ROLE_LABELS,
  findSimilarPersonMatches,
  findExactNamePersonMatches,
  buildNameMatchApiPayload,
  enrichMatchRow,
  mapRoleLabels
};
