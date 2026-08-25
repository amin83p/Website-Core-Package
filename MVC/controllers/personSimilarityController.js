'use strict';

const dataService = require('../services/dataService');
const personSimilarityEngineService = require('../services/person/personSimilarityEngineService');
const { toPublicId } = require('../utils/idAdapter');

function extractRolesForOrg(person = {}, orgId = '') {
  const memberships = Array.isArray(person.organizations) ? person.organizations : [];
  const roles = new Set();
  memberships.forEach((entry) => {
    const entryOrgId = toPublicId(entry?.orgId || entry?.organizationId || entry?.id);
    if (orgId && entryOrgId && entryOrgId !== orgId) return;
    const rawRoles = Array.isArray(entry?.roles) ? entry.roles : (entry?.role ? [entry.role] : []);
    rawRoles.forEach((role) => {
      const token = String(role || '').trim();
      if (token) roles.add(token);
    });
  });
  return [...roles].sort();
}

function personBelongsToOrg(person = {}, orgId = '') {
  if (!orgId) return true;
  const memberships = Array.isArray(person.organizations) ? person.organizations : [];
  if (!memberships.length) return true;
  return memberships.some((entry) => toPublicId(entry?.orgId || entry?.organizationId || entry?.id) === orgId);
}

async function listSimilarMatches(req, res) {
  try {
    const firstName = String(req.query.firstName || req.query.first || '').trim();
    const lastName = String(req.query.lastName || req.query.last || '').trim();
    if (!firstName || !lastName) {
      return res.status(400).json({ status: 'error', message: 'firstName and lastName are required.' });
    }

    const candidate = {
      firstName,
      lastName,
      middleName: String(req.query.middleName || '').trim(),
      preferredName: String(req.query.preferredName || '').trim(),
      email: String(req.query.email || '').trim(),
      dateOfBirth: String(req.query.dateOfBirth || '').trim(),
      phone: String(req.query.phone || '').trim(),
      excludePersonId: toPublicId(req.query.excludePersonId || '')
    };

    const orgId = toPublicId(req.query.orgId || req.user?.activeOrgId || req.user?.orgId || '');
    const minScore = Number(req.query.minScore || personSimilarityEngineService.DEFAULT_MIN_SCORE);
    const limit = Number(req.query.limit || personSimilarityEngineService.DEFAULT_MATCH_LIMIT);

    const persons = await dataService.getAccessiblePersons(req.user);
    const scopedPersons = orgId
      ? (Array.isArray(persons) ? persons : []).filter((person) => personBelongsToOrg(person, orgId))
      : (Array.isArray(persons) ? persons : []);

    const matches = personSimilarityEngineService.rankSimilarPersons(candidate, scopedPersons, {
      minScore,
      limit,
      excludePersonId: candidate.excludePersonId
    }).map((row) => {
      const person = scopedPersons.find((entry) => toPublicId(entry?.id) === row.personId) || {};
      return {
        ...row,
        roles: extractRolesForOrg(person, orgId)
      };
    });

    return res.json({ status: 'success', matches });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

module.exports = {
  listSimilarMatches
};
