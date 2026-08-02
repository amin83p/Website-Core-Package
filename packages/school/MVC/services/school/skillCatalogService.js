'use strict';

const schoolRepositories = require('../../repositories/school');
const { generateSkillId } = require('../../models/school/skillModel');
const {
  DEFAULT_SKILL_DEFINITIONS,
  CLB_SKILL_CODES,
  normalizeSkillCode
} = require('../../../config/skillDefinitions');

const REPO_SCOPE = Object.freeze({ canViewAll: true });

function isRealOrganizationId(orgId) {
  const normalized = String(orgId || '').trim().toUpperCase();
  return Boolean(normalized) && normalized !== 'SYSTEM';
}

function compareSkills(a, b) {
  const orderA = Number(a?.sortOrder || 0);
  const orderB = Number(b?.sortOrder || 0);
  if (orderA !== orderB) return orderA - orderB;
  return String(a?.label || a?.code || '').localeCompare(String(b?.label || b?.code || ''));
}

function buildFallbackSkills(orgId = 'SYSTEM') {
  return DEFAULT_SKILL_DEFINITIONS.map((definition, index) => ({
    id: `SKILL_DEFAULT_${String(definition.code || index).toUpperCase()}`,
    orgId: String(orgId || 'SYSTEM'),
    ...definition,
    active: true,
    audit: {
      createUser: 'SYSTEM',
      createDateTime: '',
      lastUpdateUser: 'SYSTEM',
      lastUpdateDateTime: ''
    }
  }));
}

async function listOrgSkills(orgId, options = {}) {
  const org = String(orgId || '').trim();
  if (!org) throw new Error('Organization is required.');
  const rows = await schoolRepositories.skills.list({
    query: { orgId__eq: org },
    scope: REPO_SCOPE
  });
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => String(row?.orgId || '') === org)
    .filter((row) => options?.includeInactive === true || row?.active !== false)
    .sort(compareSkills);
}

async function ensureOrgDefaultSkills(orgId, userId = 'SYSTEM') {
  const org = String(orgId || '').trim();
  if (!org) throw new Error('Organization is required.');
  if (!isRealOrganizationId(org)) return [];
  const existing = await listOrgSkills(org, { includeInactive: true });
  const existingCodes = new Set(existing.map((row) => normalizeSkillCode(row?.code)).filter(Boolean));
  for (const definition of DEFAULT_SKILL_DEFINITIONS) {
    if (existingCodes.has(definition.code)) continue;
    // eslint-disable-next-line no-await-in-loop
    await schoolRepositories.skills.create({
      id: generateSkillId(),
      orgId: org,
      ...definition,
      active: true,
      audit: {
        createUser: String(userId || 'SYSTEM'),
        lastUpdateUser: String(userId || 'SYSTEM')
      }
    }, { scope: REPO_SCOPE });
  }
  return listOrgSkills(org, { includeInactive: true });
}

async function getOrgSkillByCode(orgId, code, options = {}) {
  const normalized = normalizeSkillCode(code);
  if (!normalized) return null;
  const rows = await listOrgSkills(orgId, { includeInactive: options?.includeInactive === true });
  return rows.find((row) => normalizeSkillCode(row?.code) === normalized) || null;
}

function normalizeSkillIdsAgainstCatalog(input, catalog = [], options = {}) {
  const source = Array.isArray(input) ? input : (input ? [input] : []);
  const includeInactive = options?.includeInactive === true;
  const allowed = new Set(
    (Array.isArray(catalog) ? catalog : [])
      .filter((row) => includeInactive || row?.active !== false)
      .map((row) => normalizeSkillCode(row?.code || row?.id))
      .filter(Boolean)
  );
  const seen = new Set();
  const output = [];
  source.forEach((value) => {
    const code = normalizeSkillCode(value);
    if (!code || !allowed.has(code) || seen.has(code)) return;
    seen.add(code);
    output.push(code);
  });
  return output;
}

function toGradebookSkillCatalog(catalog = []) {
  return (Array.isArray(catalog) ? catalog : [])
    .slice()
    .sort(compareSkills)
    .map((row) => ({
      id: normalizeSkillCode(row?.code),
      label: String(row?.label || row?.code || '').trim(),
      kind: String(row?.kind || 'general').trim(),
      supportsTeachingOutline: row?.supportsTeachingOutline === true,
      active: row?.active !== false,
      sortOrder: Number(row?.sortOrder || 0)
    }))
    .filter((row) => row.id && row.label);
}

async function loadOrgSkillCatalog(orgId, userId = 'SYSTEM', options = {}) {
  if (!isRealOrganizationId(orgId)) return [];
  try {
    const rows = await ensureOrgDefaultSkills(orgId, userId);
    return rows.filter((row) => options?.includeInactive === true || row?.active !== false);
  } catch (error) {
    if (options?.allowFallback === false) throw error;
    return buildFallbackSkills(orgId)
      .filter((row) => options?.includeInactive === true || row.active !== false);
  }
}

module.exports = {
  CLB_SKILL_CODES,
  DEFAULT_SKILL_DEFINITIONS,
  isRealOrganizationId,
  buildFallbackSkills,
  compareSkills,
  listOrgSkills,
  ensureOrgDefaultSkills,
  getOrgSkillByCode,
  normalizeSkillIdsAgainstCatalog,
  toGradebookSkillCatalog,
  loadOrgSkillCatalog
};
