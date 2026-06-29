const dataService = require('./dataService');
const { SYSTEM_CONTEXT } = require('../../config/constants');
const { idsEqual, toPublicId } = require('../utils/idAdapter');
const {
  buildOrganizationDisplayMap,
  canonicalizeMembershipOrganizationName,
  canonicalizeMembershipOrganizationNames,
  resolveCanonicalOrganizationName
} = require('../utils/organizationDisplay');

function normalizeOrgId(value) {
  return toPublicId(value);
}

function buildSingleOrganizationMap(organization = {}, fallbackOrgId = '') {
  const orgId = normalizeOrgId(organization?.id || organization?.orgId || fallbackOrgId);
  if (!orgId) return new Map();
  const canonicalName = resolveCanonicalOrganizationName(organization);
  return buildOrganizationDisplayMap([{ ...(organization || {}), id: orgId, orgId, name: canonicalName }]);
}

function hasMatchingOrgReference(row = {}, orgId = '') {
  const target = normalizeOrgId(orgId);
  if (!target) return false;
  return [
    row?.orgId,
    row?.organizationId,
    row?.activeOrgId,
    row?.primaryOrgId,
    row?.activeOrganization?.orgId,
    row?.activeOrganization?.organizationId,
    row?.activeOrganization?.id
  ].some((value) => idsEqual(value, target));
}

function canonicalizeOrganizationArray(value, organizationMap) {
  return canonicalizeMembershipOrganizationNames(value, organizationMap);
}

function canonicalizeOrganizationObject(value, organizationMap) {
  if (!value || typeof value !== 'object') return { value, changed: false, changedCount: 0 };
  const result = canonicalizeMembershipOrganizationName(value, organizationMap);
  return {
    value: result.value,
    changed: result.changed,
    changedCount: result.changed ? 1 : 0
  };
}

function patchTopLevelOrganizationName(row = {}, orgId = '', organizationMap = new Map()) {
  const target = normalizeOrgId(orgId);
  if (!target || !hasMatchingOrgReference(row, target)) {
    return { patch: {}, changed: false, changedCount: 0 };
  }

  const canonicalName = String(organizationMap.get(target)?.name || '').trim();
  if (!canonicalName) return { patch: {}, changed: false, changedCount: 0 };

  const patch = {};
  let changedCount = 0;
  ['orgName', 'organizationName'].forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(row, field) && String(row[field] || '') !== canonicalName) {
      patch[field] = canonicalName;
      changedCount += 1;
    }
  });

  return { patch, changed: changedCount > 0, changedCount };
}

function buildPersonPatch(row = {}, organizationMap = new Map()) {
  const organizations = canonicalizeOrganizationArray(row?.organizations, organizationMap);
  if (!organizations.changed) return { patch: {}, changed: false, changedCount: 0 };
  return {
    patch: { organizations: organizations.value },
    changed: true,
    changedCount: organizations.changedCount
  };
}

function buildUserPatch(row = {}, orgId = '', organizationMap = new Map()) {
  const patch = {};
  let changedCount = 0;

  const organizations = canonicalizeOrganizationArray(row?.organizations, organizationMap);
  if (organizations.changed) {
    patch.organizations = organizations.value;
    changedCount += organizations.changedCount;
  }

  const allowedOrgs = canonicalizeOrganizationArray(row?.allowedOrgs, organizationMap);
  if (allowedOrgs.changed) {
    patch.allowedOrgs = allowedOrgs.value;
    changedCount += allowedOrgs.changedCount;
  }

  const activeOrganization = canonicalizeOrganizationObject(row?.activeOrganization, organizationMap);
  if (activeOrganization.changed) {
    patch.activeOrganization = activeOrganization.value;
    changedCount += activeOrganization.changedCount;
  }

  const topLevel = patchTopLevelOrganizationName(row, orgId, organizationMap);
  if (topLevel.changed) {
    Object.assign(patch, topLevel.patch);
    changedCount += topLevel.changedCount;
  }

  return {
    patch,
    changed: changedCount > 0,
    changedCount
  };
}

async function syncEntitySnapshots(entityType, organization, options = {}) {
  const orgId = normalizeOrgId(options.orgId || organization?.id || organization?.orgId);
  const apply = options.apply !== false;
  const organizationMap = options.organizationMap || buildSingleOrganizationMap(organization, orgId);
  const rows = await dataService.fetchData(entityType, {}, SYSTEM_CONTEXT, options.repositoryOptions || {});
  const summary = {
    entityType,
    scanned: Array.isArray(rows) ? rows.length : 0,
    changed: 0,
    membershipsChanged: 0,
    errors: []
  };

  for (const row of Array.isArray(rows) ? rows : []) {
    const rowId = normalizeOrgId(row?.id || row?._id);
    if (!rowId) continue;

    const result = entityType === 'users'
      ? buildUserPatch(row, orgId, organizationMap)
      : buildPersonPatch(row, organizationMap);

    if (!result.changed) continue;
    summary.changed += 1;
    summary.membershipsChanged += Number(result.changedCount || 0);

    if (!apply) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await dataService.updateData(entityType, rowId, result.patch, SYSTEM_CONTEXT, options.repositoryOptions || {});
    } catch (error) {
      summary.errors.push({
        id: rowId,
        message: String(error?.message || error)
      });
    }
  }

  return summary;
}

function refreshRequestUserOrganizationSnapshots(req, organization, options = {}) {
  if (!req?.user) return { changed: false, changedCount: 0 };
  const orgId = normalizeOrgId(options.orgId || organization?.id || organization?.orgId);
  const organizationMap = options.organizationMap || buildSingleOrganizationMap(organization, orgId);
  let changedCount = 0;

  const allowedOrgs = canonicalizeOrganizationArray(req.user.allowedOrgs, organizationMap);
  if (allowedOrgs.changed) {
    req.user.allowedOrgs = allowedOrgs.value;
    changedCount += allowedOrgs.changedCount;
  }

  const activeOrganization = canonicalizeOrganizationObject(req.user.activeOrganization, organizationMap);
  if (activeOrganization.changed) {
    req.user.activeOrganization = activeOrganization.value;
    changedCount += activeOrganization.changedCount;
  }

  const topLevel = patchTopLevelOrganizationName(req.user, orgId, organizationMap);
  if (topLevel.changed) {
    Object.assign(req.user, topLevel.patch);
    changedCount += topLevel.changedCount;
  }

  return { changed: changedCount > 0, changedCount };
}

function formatSyncSummary(summary = {}) {
  const people = summary.persons || {};
  const users = summary.users || {};
  return [
    `persons=${Number(people.changed || 0)}`,
    `users=${Number(users.changed || 0)}`,
    `memberships=${Number(people.membershipsChanged || 0) + Number(users.membershipsChanged || 0)}`
  ].join(', ');
}

async function syncOrganizationNameSnapshots(options = {}) {
  const orgId = normalizeOrgId(options.orgId || options.organization?.id || options.organization?.orgId);
  let organization = options.organization || null;
  if (!organization && orgId) {
    organization = await dataService.getDataById('organizations', orgId, SYSTEM_CONTEXT, options.repositoryOptions || {});
  }
  if (!organization) throw new Error('Organization not found for name snapshot sync.');

  const canonicalName = resolveCanonicalOrganizationName(organization);
  const normalizedOrganization = {
    ...(organization || {}),
    id: orgId || organization.id,
    orgId: orgId || organization.orgId,
    name: canonicalName
  };
  const organizationMap = buildSingleOrganizationMap(normalizedOrganization, orgId);

  const [persons, users] = await Promise.all([
    syncEntitySnapshots('persons', normalizedOrganization, {
      ...options,
      orgId,
      organizationMap
    }),
    syncEntitySnapshots('users', normalizedOrganization, {
      ...options,
      orgId,
      organizationMap
    })
  ]);

  return {
    orgId,
    orgName: canonicalName,
    apply: options.apply !== false,
    persons,
    users,
    errors: [
      ...(persons.errors || []).map((error) => ({ entityType: 'persons', ...error })),
      ...(users.errors || []).map((error) => ({ entityType: 'users', ...error }))
    ]
  };
}

module.exports = {
  buildPersonPatch,
  buildUserPatch,
  formatSyncSummary,
  refreshRequestUserOrganizationSnapshots,
  syncOrganizationNameSnapshots
};
