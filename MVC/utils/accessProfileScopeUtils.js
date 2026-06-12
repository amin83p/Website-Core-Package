const { toPublicId } = require('./idAdapter');

const ACCESS_PROFILE_ORG_FIELDS = Object.freeze([
  'orgId',
  'organizationId',
  'scopeOrgId',
  'orgScopeId',
  'organizationScopeId',
  'targetOrgId',
  'scopeTargetOrgId'
]);

const ACCESS_PROFILE_SCOPE_ORG_FIELDS = Object.freeze([
  'scope.orgId',
  'scope.organizationId',
  'scope.targetOrgId',
  'scope.org.id',
  'scope.org.orgId'
]);

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getNestedValue(item, path) {
  if (!item || !path) return undefined;
  return String(path).split('.').reduce((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return current[key];
  }, item);
}

function isOrgScopeToken(value) {
  return /^(org|organization|organisation)$/i.test(String(value || '').trim());
}

function parseOrgIdFromScopeText(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/\b(?:org|organization|organisation)\D+([A-Za-z0-9_-]+)\b/i);
  return toPublicId(match?.[1] || '');
}

function resolveAccessProfileOrgId(profile = {}) {
  for (const field of ACCESS_PROFILE_ORG_FIELDS) {
    const value = toPublicId(profile?.[field]);
    if (value) return value;
  }

  for (const field of ACCESS_PROFILE_SCOPE_ORG_FIELDS) {
    const value = toPublicId(getNestedValue(profile, field));
    if (value) return value;
  }

  const scope = profile?.scope;
  if (scope && typeof scope === 'object' && !Array.isArray(scope)) {
    const scopeMode = scope.type || scope.mode || scope.kind || scope.scope || scope.name;
    if (isOrgScopeToken(scopeMode)) {
      const value = toPublicId(scope.id || scope.value || scope.scopeId);
      if (value) return value;
    }
  }

  if (typeof scope === 'string') {
    const parsed = parseOrgIdFromScopeText(scope);
    if (parsed) return parsed;
  }

  const topLevelScopeMode = profile?.scopeType || profile?.scopeMode || profile?.scopeName || '';
  if (isOrgScopeToken(topLevelScopeMode) || isOrgScopeToken(scope)) {
    const value = toPublicId(profile.scopeId || profile.scopeValue || profile.scopeTargetId);
    if (value) return value;
  }

  return '';
}

function normalizeAccessProfileScope(profile) {
  if (!profile || typeof profile !== 'object') return profile;
  const normalized = { ...profile };
  const orgId = resolveAccessProfileOrgId(profile);
  if (orgId) normalized.orgId = orgId;
  else if (!Object.prototype.hasOwnProperty.call(normalized, 'orgId')) normalized.orgId = null;
  return normalized;
}

function toTimestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasValidityWindow(profile = {}) {
  return Boolean(profile?.validity?.startDate || profile?.validity?.endDate);
}

function scoreAccessProfileCandidate(profile = {}) {
  const audit = profile?.audit || {};
  const lastUpdateScore = toTimestamp(audit.lastUpdateDateTime || profile.updatedAt || profile.modifiedAt);
  const createScore = toTimestamp(audit.createDateTime || profile.createdAt);
  const validityScore = hasValidityWindow(profile) ? 1 : 0;
  const sectionScore = Array.isArray(profile?.sections) ? profile.sections.length : 0;
  return [
    lastUpdateScore,
    validityScore,
    sectionScore,
    createScore
  ];
}

function compareAccessProfileCandidates(left = {}, right = {}) {
  const leftScore = scoreAccessProfileCandidate(left);
  const rightScore = scoreAccessProfileCandidate(right);
  for (let index = 0; index < leftScore.length; index += 1) {
    if (leftScore[index] > rightScore[index]) return 1;
    if (leftScore[index] < rightScore[index]) return -1;
  }
  return 0;
}

function choosePreferredAccessProfile(left, right) {
  if (!left) return right;
  if (!right) return left;
  return compareAccessProfileCandidates(right, left) > 0 ? right : left;
}

function dedupeAccessProfilesById(rows = []) {
  const output = [];
  const indexById = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const normalized = normalizeAccessProfileScope(row);
    if (!normalized || typeof normalized !== 'object') return;
    const id = toPublicId(normalized.id);
    if (!id) {
      output.push(normalized);
      return;
    }

    const existingIndex = indexById.get(id);
    if (existingIndex === undefined) {
      indexById.set(id, output.length);
      output.push(normalized);
      return;
    }

    output[existingIndex] = choosePreferredAccessProfile(output[existingIndex], normalized);
  });

  return output;
}

function buildOrgValueVariants(orgId) {
  const token = toPublicId(orgId);
  if (!token) return [];
  const values = [token];
  if (/^-?\d+$/.test(token)) values.push(Number(token));
  return Array.from(new Set(values));
}

function emptyFieldClause(field) {
  return {
    $or: [
      { [field]: { $exists: false } },
      { [field]: null },
      { [field]: '' }
    ]
  };
}

function buildMongoAccessOrgFilter(orgId) {
  const token = toPublicId(orgId);
  const values = buildOrgValueVariants(token);
  if (!token || values.length === 0) return {};
  const scopeModeFields = ['scope.type', 'scope.mode', 'scope.kind', 'scope.scope', 'scope.name'];
  const scopeValueFields = ['scope.id', 'scope.value', 'scope.scopeId'];
  const topLevelModeFields = ['scopeType', 'scopeMode', 'scopeName'];
  const topLevelValueFields = ['scopeId', 'scopeValue', 'scopeTargetId'];

  const clauses = [
    ...ACCESS_PROFILE_ORG_FIELDS.map((field) => ({ [field]: { $in: values } })),
    ...ACCESS_PROFILE_SCOPE_ORG_FIELDS.map((field) => ({ [field]: { $in: values } })),
    ...topLevelValueFields.map((field) => ({
      $and: [
        { scope: { $regex: /^(org|organization|organisation)$/i } },
        { [field]: { $in: values } }
      ]
    })),
    ...topLevelModeFields.flatMap((modeField) => topLevelValueFields.map((valueField) => ({
      $and: [
        { [modeField]: { $regex: /^(org|organization|organisation)$/i } },
        { [valueField]: { $in: values } }
      ]
    }))),
    ...scopeModeFields.flatMap((modeField) => scopeValueFields.map((valueField) => ({
      $and: [
        { [modeField]: { $regex: /^(org|organization|organisation)$/i } },
        { [valueField]: { $in: values } }
      ]
    }))),
    {
      scope: {
        $regex: new RegExp(`\\b(?:org|organization|organisation)\\D+${escapeRegex(token)}\\b`, 'i')
      }
    }
  ];

  return { $or: clauses };
}

function buildMongoGlobalAccessOrgFilter() {
  const nonOrgScopeModeClause = (field) => ({
    $or: [
      { [field]: { $exists: false } },
      { [field]: null },
      { [field]: '' },
      { [field]: { $not: /^(org|organization|organisation)$/i } }
    ]
  });

  return {
    $and: [
      ...ACCESS_PROFILE_ORG_FIELDS.map(emptyFieldClause),
      ...ACCESS_PROFILE_SCOPE_ORG_FIELDS.map(emptyFieldClause),
      nonOrgScopeModeClause('scopeType'),
      nonOrgScopeModeClause('scopeMode'),
      nonOrgScopeModeClause('scopeName'),
      nonOrgScopeModeClause('scope.type'),
      nonOrgScopeModeClause('scope.mode'),
      nonOrgScopeModeClause('scope.kind'),
      nonOrgScopeModeClause('scope.scope'),
      nonOrgScopeModeClause('scope.name'),
      {
        $or: [
          { scope: { $exists: false } },
          { scope: null },
          { scope: '' },
          { scope: { $not: /\b(?:org|organization|organisation)\D+[A-Za-z0-9_-]+\b/i } }
        ]
      }
    ]
  };
}

module.exports = {
  resolveAccessProfileOrgId,
  normalizeAccessProfileScope,
  choosePreferredAccessProfile,
  dedupeAccessProfilesById,
  buildOrgValueVariants,
  buildMongoAccessOrgFilter,
  buildMongoGlobalAccessOrgFilter
};
