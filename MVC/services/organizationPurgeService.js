const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const organizationRepository = require('../repositories/organizationRepository');
const personRepository = require('../repositories/personRepository');
const userRepository = require('../repositories/userRepository');
const contractRepository = require('../repositories/contractRepository');
const orgPolicyRepository = require('../repositories/orgPolicyRepository');
const subscriptionGroupRepository = require('../repositories/subscriptionGroupRepository');
const userMembershipRepository = require('../repositories/userMembershipRepository');
const activityQuotaLedgerService = require('./activityQuotaLedgerService');
const pathResolver = require('../utils/pathResolver');
const { toPublicId, idsEqual } = require('../utils/idAdapter');

const ALL_MASTER_DEFINITIONS = Object.freeze({
  classes: true,
  programs: true,
  terms: true,
  subjects: true,
  departments: true,
  reportTemplates: true,
  timesheetPeriods: true,
  activityCategories: true,
  examDefinitions: true,
  schoolAccounts: true
});

const PTE_REPO_MODULES = Object.freeze([
  ['pteAttemptLedgerEvent', '../../packages/pte/MVC/repositories/pteAttemptLedgerEventRepository'],
  ['pteAttemptArtifact', '../../packages/pte/MVC/repositories/pteAttemptArtifactRepository'],
  ['pteAttemptItem', '../../packages/pte/MVC/repositories/pteAttemptItemRepository'],
  ['pteAttemptSession', '../../packages/pte/MVC/repositories/pteAttemptSessionRepository'],
  ['pteAiTokenUsage', '../../packages/pte/MVC/repositories/pteAiTokenUsageRepository'],
  ['pteAiScoringSetting', '../../packages/pte/MVC/repositories/pteAiScoringSettingRepository'],
  ['pteAiProvider', '../../packages/pte/MVC/repositories/pteAiProviderRepository'],
  ['pteQuestionTypeScoringProfileHistory', '../../packages/pte/MVC/repositories/pteQuestionTypeScoringProfileHistoryRepository'],
  ['pteQuestionTypeScoringProfile', '../../packages/pte/MVC/repositories/pteQuestionTypeScoringProfileRepository'],
  ['pteQuestionVersion', '../../packages/pte/MVC/repositories/pteQuestionVersionRepository'],
  ['pteTestVersion', '../../packages/pte/MVC/repositories/pteTestVersionRepository'],
  ['pteCourse', '../../packages/pte/MVC/repositories/pteCourseRepository'],
  ['pteApplicantPackageAssignment', '../../packages/pte/MVC/repositories/pteApplicantPackageAssignmentRepository'],
  ['pteApplicant', '../../packages/pte/MVC/repositories/pteApplicantRepository'],
  ['pteTeacher', '../../packages/pte/MVC/repositories/pteTeacherRepository'],
  ['ptePublicPageSetting', '../../packages/pte/MVC/repositories/ptePublicPageSettingRepository']
]);

const EXTRA_SCHOOL_MASTER_KEYS = Object.freeze([
  'students',
  'teachers',
  'staff',
  'funders',
  'holidays',
  'payRates',
  'sessionStatuses',
  'transactionDefinitions'
]);

function tryRequire(modulePath) {
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    return require(modulePath);
  } catch (_) {
    return null;
  }
}

function resolveOrgDisplayName(org = {}) {
  return String(
    org?.identity?.displayName
    || org?.identity?.legalName
    || org?.name
    || org?.id
    || ''
  ).trim();
}

function membershipOrgIds(entity = {}) {
  const rows = Array.isArray(entity?.organizations) ? entity.organizations : [];
  return rows
    .map((row) => toPublicId(row?.orgId || row?.id || ''))
    .filter(Boolean);
}

function personBelongsOnlyToOrg(person, orgId) {
  const ids = new Set(membershipOrgIds(person));
  return ids.size === 1 && ids.has(toPublicId(orgId));
}

function stripOrgMembership(entity, orgId) {
  const target = toPublicId(orgId);
  const rows = Array.isArray(entity?.organizations) ? entity.organizations : [];
  return rows.filter((row) => !idsEqual(row?.orgId || row?.id, target));
}

function category(key, label, count, samples = [], extras = {}) {
  const safeCount = Math.max(0, Number(count) || 0);
  const sampleRows = (Array.isArray(samples) ? samples : [])
    .slice(0, 8)
    .map((row) => ({
      id: String(row?.id || row || '').trim(),
      label: String(row?.label || row?.name || row?.id || row || '').trim()
    }))
    .filter((row) => row.id);
  return {
    key,
    label,
    count: safeCount,
    samples: sampleRows,
    ...extras
  };
}

async function countOrgScopedRepository(repository, orgId) {
  if (!repository || typeof repository.list !== 'function') {
    return { count: 0, samples: [] };
  }
  const rows = await repository.list({
    query: { orgId__eq: orgId },
    scope: { canViewAll: true }
  });
  const list = Array.isArray(rows) ? rows : [];
  return {
    count: list.length,
    samples: list.slice(0, 8).map((row) => ({
      id: toPublicId(row?.id) || String(row?.id || ''),
      label: String(row?.name || row?.title || row?.policyName || row?.id || '')
    }))
  };
}

async function purgeOrgScopedRepository(repository, orgId, { removeWithOrgId = false } = {}) {
  if (!repository || typeof repository.list !== 'function' || typeof repository.remove !== 'function') {
    return { removed: 0, remaining: 0, errors: [] };
  }
  const rows = await repository.list({
    query: { orgId__eq: orgId },
    scope: { canViewAll: true }
  });
  const matches = Array.isArray(rows) ? rows : [];
  let removed = 0;
  const errors = [];
  for (const row of matches) {
    const rowId = toPublicId(row?.id);
    if (!rowId) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      if (removeWithOrgId) await repository.remove(rowId, orgId);
      else await repository.remove(rowId);
      removed += 1;
    } catch (err) {
      errors.push(`${rowId}: ${String(err?.message || err)}`);
    }
  }
  const remainingRows = await repository.list({
    query: { orgId__eq: orgId },
    scope: { canViewAll: true }
  });
  return {
    removed,
    remaining: Array.isArray(remainingRows) ? remainingRows.length : 0,
    errors
  };
}

async function inventoryUploadRoot(orgId) {
  const root = pathResolver.getRootPath(orgId);
  try {
    const stat = await fsp.stat(root);
    if (!stat.isDirectory()) {
      return category('files.uploadRoot', 'Organization upload folder', 0);
    }
    // Count top-level entries as a lightweight signal
    const entries = await fsp.readdir(root);
    return category('files.uploadRoot', 'Organization upload folder', Math.max(1, entries.length), [], {
      note: root,
      path: root
    });
  } catch (_) {
    return category('files.uploadRoot', 'Organization upload folder', 0);
  }
}

async function deleteUploadRoot(orgId) {
  const root = pathResolver.getRootPath(orgId);
  const uploadRoot = path.dirname(root);
  if (!root.startsWith(uploadRoot) || path.basename(root) !== `ORG_${orgId}`) {
    throw new Error('Refusing to delete upload path outside organization scope.');
  }
  if (!fs.existsSync(root)) {
    return { removed: false, path: root };
  }
  await fsp.rm(root, { recursive: true, force: true });
  return { removed: true, path: root };
}

function loadSchoolSampleDataService() {
  return tryRequire('../../packages/school/MVC/services/school/schoolSampleDataService');
}

function loadSchoolRepositories() {
  return tryRequire('../../packages/school/MVC/repositories/school');
}

async function classifyPeople(orgId) {
  const persons = await personRepository.findByOrganizationId(orgId, {
    enrichment: { includeSchoolRoles: false }
  });
  const list = Array.isArray(persons) ? persons : [];
  const deletePersons = [];
  const unlinkPersons = [];

  for (const person of list) {
    if (personBelongsOnlyToOrg(person, orgId)) deletePersons.push(person);
    else unlinkPersons.push(person);
  }

  const deleteUsers = [];
  const unlinkUsers = [];
  const seenUserIds = new Set();

  async function collectUsersForPerson(person, bucketDelete, bucketUnlink, personIsOrgOnly) {
    const users = await userRepository.findByPersonId(person?.id);
    const userRows = Array.isArray(users) ? users : [];
    for (const user of userRows) {
      const uid = toPublicId(user?.id);
      if (!uid || seenUserIds.has(uid)) continue;
      seenUserIds.add(uid);
      const userOrgOnly = personIsOrgOnly && membershipOrgIds(user).every((id) => idsEqual(id, orgId) || !id);
      if (userOrgOnly || (personIsOrgOnly && membershipOrgIds(user).length <= 1)) {
        bucketDelete.push(user);
      } else {
        bucketUnlink.push(user);
      }
    }
  }

  for (const person of deletePersons) {
    // eslint-disable-next-line no-await-in-loop
    await collectUsersForPerson(person, deleteUsers, unlinkUsers, true);
  }
  for (const person of unlinkPersons) {
    // eslint-disable-next-line no-await-in-loop
    await collectUsersForPerson(person, deleteUsers, unlinkUsers, false);
  }

  return {
    deletePersons,
    unlinkPersons,
    deleteUsers,
    unlinkUsers
  };
}

async function buildOrganizationPurgePlan(orgId, requestingUser = null) {
  void requestingUser;
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('Organization id is required.');
  if (targetOrgId === 'SYSTEM' || targetOrgId === 'GLOBAL') {
    throw new Error('SYSTEM/GLOBAL organizations cannot be purged.');
  }

  const org = await organizationRepository.getById(targetOrgId);
  if (!org) throw new Error(`Organization not found: ${targetOrgId}`);

  const categories = [];
  const schoolService = loadSchoolSampleDataService();
  if (schoolService?.buildOrgWorkspaceResetPreview) {
    try {
      const schoolPreview = await schoolService.buildOrgWorkspaceResetPreview({
        orgId: targetOrgId,
        includeAcademicSnapshots: true,
        masterDefinitions: ALL_MASTER_DEFINITIONS
      });
      const schoolGroups = [
        ...(schoolPreview?.transactional?.groups || []),
        ...(schoolPreview?.masters?.groups || [])
      ];
      schoolGroups.forEach((group) => {
        if (!group || group.skipped) return;
        const count = Number(group.count || 0);
        if (count <= 0) return;
        categories.push(category(
          `school.${group.key}`,
          `School: ${group.label}`,
          count,
          group.rows || [],
          { note: group.note || '' }
        ));
      });
    } catch (err) {
      categories.push(category('school.previewError', 'School inventory (error)', 0, [], {
        note: String(err?.message || err)
      }));
    }
  }

  const schoolRepos = loadSchoolRepositories();
  if (schoolRepos) {
    for (const key of EXTRA_SCHOOL_MASTER_KEYS) {
      const repo = schoolRepos[key];
      if (!repo) continue;
      // eslint-disable-next-line no-await-in-loop
      const result = await countOrgScopedRepository(repo, targetOrgId);
      if (result.count > 0) {
        categories.push(category(`school.${key}`, `School: ${key}`, result.count, result.samples));
      }
    }
  }

  const coreRepos = [
    ['contracts', 'Contracts', contractRepository],
    ['orgPolicies', 'Organization policies', orgPolicyRepository],
    ['subscriptionGroups', 'Subscription groups', subscriptionGroupRepository],
    ['userMemberships', 'User memberships', userMembershipRepository]
  ];
  for (const [key, label, repo] of coreRepos) {
    // eslint-disable-next-line no-await-in-loop
    const result = await countOrgScopedRepository(repo, targetOrgId);
    if (result.count > 0) {
      categories.push(category(`core.${key}`, label, result.count, result.samples));
    }
  }

  try {
    const [ledgerRows, lotRows, snapshotRows] = await Promise.all([
      countOrgScopedRepository(require('../repositories/activityQuotaLedgerRepository'), targetOrgId),
      countOrgScopedRepository(require('../repositories/quotaCreditLotRepository'), targetOrgId),
      countOrgScopedRepository(require('../repositories/quotaBalanceSnapshotRepository'), targetOrgId)
    ]);
    if (ledgerRows.count) categories.push(category('activityQuota.ledger', 'Activity quota ledger', ledgerRows.count, ledgerRows.samples));
    if (lotRows.count) categories.push(category('activityQuota.lots', 'Activity quota credit lots', lotRows.count, lotRows.samples));
    if (snapshotRows.count) categories.push(category('activityQuota.snapshots', 'Activity quota balance snapshots', snapshotRows.count, snapshotRows.samples));
  } catch (_) {
    // optional
  }

  for (const [key, modulePath] of PTE_REPO_MODULES) {
    const repo = tryRequire(modulePath);
    if (!repo) continue;
    // eslint-disable-next-line no-await-in-loop
    const result = await countOrgScopedRepository(repo, targetOrgId);
    if (result.count > 0) {
      categories.push(category(`pte.${key}`, `PTE: ${key}`, result.count, result.samples));
    }
  }

  const uploadCategory = await inventoryUploadRoot(targetOrgId);
  if (uploadCategory.count > 0) categories.push(uploadCategory);

  const people = await classifyPeople(targetOrgId);
  if (people.deletePersons.length) {
    categories.push(category(
      'people.deletePersons',
      'Persons to delete (org-only)',
      people.deletePersons.length,
      people.deletePersons.map((p) => ({
        id: p.id,
        label: `${p?.name?.first || ''} ${p?.name?.last || ''}`.trim() || p.id
      }))
    ));
  }
  if (people.unlinkPersons.length) {
    categories.push(category(
      'people.unlinkPersons',
      'Persons to unlink (multi-org)',
      people.unlinkPersons.length,
      people.unlinkPersons.map((p) => ({
        id: p.id,
        label: `${p?.name?.first || ''} ${p?.name?.last || ''}`.trim() || p.id
      }))
    ));
  }
  if (people.deleteUsers.length) {
    categories.push(category(
      'people.deleteUsers',
      'Users to delete (org-only)',
      people.deleteUsers.length,
      people.deleteUsers.map((u) => ({
        id: u.id,
        label: u.username || u.email || u.id
      }))
    ));
  }
  if (people.unlinkUsers.length) {
    categories.push(category(
      'people.unlinkUsers',
      'Users to unlink (multi-org)',
      people.unlinkUsers.length,
      people.unlinkUsers.map((u) => ({
        id: u.id,
        label: u.username || u.email || u.id
      }))
    ));
  }

  categories.push(category('core.organization', 'Organization record', 1, [{
    id: targetOrgId,
    label: resolveOrgDisplayName(org)
  }]));

  const totals = {
    categories: categories.length,
    records: categories.reduce((sum, row) => sum + Number(row.count || 0), 0)
  };

  return {
    org: {
      id: targetOrgId,
      name: resolveOrgDisplayName(org)
    },
    categories,
    totals,
    people: {
      deletePersons: people.deletePersons.length,
      unlinkPersons: people.unlinkPersons.length,
      deleteUsers: people.deleteUsers.length,
      unlinkUsers: people.unlinkUsers.length
    },
    generatedAt: new Date().toISOString()
  };
}

async function processPeopleStage(orgId) {
  const people = await classifyPeople(orgId);
  const errors = [];
  let deletedUsers = 0;
  let unlinkedUsers = 0;
  let deletedPersons = 0;
  let unlinkedPersons = 0;

  // Users first (integrity often requires user before person delete)
  for (const user of people.deleteUsers) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await userRepository.remove(user.id);
      deletedUsers += 1;
    } catch (err) {
      errors.push(`user ${user.id}: ${String(err?.message || err)}`);
    }
  }

  for (const user of people.unlinkUsers) {
    try {
      const nextOrgs = stripOrgMembership(user, orgId);
      const patch = { organizations: nextOrgs };
      if (idsEqual(user?.activeOrgId, orgId) || idsEqual(user?.primaryOrgId, orgId)) {
        patch.activeOrgId = nextOrgs[0]?.orgId || '';
        patch.primaryOrgId = nextOrgs[0]?.orgId || '';
      }
      // eslint-disable-next-line no-await-in-loop
      await userRepository.update(user.id, patch);
      unlinkedUsers += 1;
    } catch (err) {
      errors.push(`user unlink ${user.id}: ${String(err?.message || err)}`);
    }
  }

  for (const person of people.deletePersons) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await personRepository.remove(person.id);
      deletedPersons += 1;
    } catch (err) {
      errors.push(`person ${person.id}: ${String(err?.message || err)}`);
    }
  }

  for (const person of people.unlinkPersons) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await personRepository.update(person.id, {
        organizations: stripOrgMembership(person, orgId)
      });
      unlinkedPersons += 1;
    } catch (err) {
      errors.push(`person unlink ${person.id}: ${String(err?.message || err)}`);
    }
  }

  return {
    deletedUsers,
    unlinkedUsers,
    deletedPersons,
    unlinkedPersons,
    errors
  };
}

async function executeOrganizationPurge(orgId, requestingUser = null, { confirmName = '' } = {}) {
  void requestingUser;
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('Organization id is required.');
  if (targetOrgId === 'SYSTEM' || targetOrgId === 'GLOBAL') {
    throw new Error('SYSTEM/GLOBAL organizations cannot be purged.');
  }

  const org = await organizationRepository.getById(targetOrgId);
  if (!org) throw new Error(`Organization not found: ${targetOrgId}`);

  const expectedName = resolveOrgDisplayName(org);
  if (String(confirmName || '').trim() !== expectedName) {
    const error = new Error('Confirmation name does not match the organization display name.');
    error.code = 'CONFIRM_MISMATCH';
    throw error;
  }

  const stages = [];
  const pushStage = (key, label, status, detail = {}) => {
    stages.push({
      key,
      label,
      status,
      ...detail,
      finishedAt: new Date().toISOString()
    });
  };

  // 1) School
  const schoolService = loadSchoolSampleDataService();
  const schoolRepos = loadSchoolRepositories();
  if (schoolService?.clearSampleTransactionalData) {
    try {
      const schoolResult = await schoolService.clearSampleTransactionalData({
        orgId: targetOrgId,
        includeAcademicSnapshots: true,
        masterDefinitions: ALL_MASTER_DEFINITIONS
      });
      if (schoolRepos) {
        for (const key of EXTRA_SCHOOL_MASTER_KEYS) {
          const repo = schoolRepos[key];
          if (!repo) continue;
          // eslint-disable-next-line no-await-in-loop
          await schoolRepos.purgeOrgScopedRepositoryRows(repo, targetOrgId);
        }
        // Force-remove any remaining school accounts (including head accounts)
        if (schoolRepos.schoolAccounts?.list && schoolRepos.schoolAccounts?.purgeById) {
          const remainingAccounts = await schoolRepos.schoolAccounts.list({
            query: { orgId__eq: targetOrgId },
            scope: { canViewAll: true }
          });
          for (const row of (Array.isArray(remainingAccounts) ? remainingAccounts : [])) {
            const rowId = toPublicId(row?.id);
            if (!rowId) continue;
            try {
              // eslint-disable-next-line no-await-in-loop
              await schoolRepos.schoolAccounts.purgeById(rowId);
            } catch (_) {
              // continue
            }
          }
        } else {
          await schoolRepos.purgeOrgScopedRepositoryRows(schoolRepos.schoolAccounts, targetOrgId);
        }
      }
      pushStage('school', 'School workspace & masters', 'success', {
        summary: schoolResult?.summary || null,
        warnings: schoolResult?.warnings || []
      });
    } catch (err) {
      pushStage('school', 'School workspace & masters', 'error', {
        message: String(err?.message || err)
      });
    }
  } else {
    pushStage('school', 'School workspace & masters', 'skipped', {
      message: 'School package not available.'
    });
  }

  // 2) PTE
  const pteSummary = { removed: 0, errors: [] };
  for (const [key, modulePath] of PTE_REPO_MODULES) {
    const repo = tryRequire(modulePath);
    if (!repo) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await purgeOrgScopedRepository(repo, targetOrgId);
      pteSummary.removed += Number(result.removed || 0);
      if (result.errors?.length) pteSummary.errors.push(...result.errors.map((e) => `${key}: ${e}`));
    } catch (err) {
      pteSummary.errors.push(`${key}: ${String(err?.message || err)}`);
    }
  }
  pushStage('pte', 'PTE package data', pteSummary.errors.length ? 'warning' : 'success', pteSummary);

  // 3) Core business + quotas
  try {
    const quotaResult = await activityQuotaLedgerService.clearByOrg(targetOrgId);
    const contracts = await purgeOrgScopedRepository(contractRepository, targetOrgId);
    const policies = await purgeOrgScopedRepository(orgPolicyRepository, targetOrgId);
    const groups = await purgeOrgScopedRepository(subscriptionGroupRepository, targetOrgId, { removeWithOrgId: true });
    const memberships = await purgeOrgScopedRepository(userMembershipRepository, targetOrgId);
    pushStage('core', 'Core contracts, policies, quotas', 'success', {
      quota: quotaResult,
      contracts,
      policies,
      subscriptionGroups: groups,
      userMemberships: memberships
    });
  } catch (err) {
    pushStage('core', 'Core contracts, policies, quotas', 'error', {
      message: String(err?.message || err)
    });
  }

  // 4) Upload tree
  try {
    const filesResult = await deleteUploadRoot(targetOrgId);
    pushStage('files', 'Organization upload files', 'success', filesResult);
  } catch (err) {
    pushStage('files', 'Organization upload files', 'error', {
      message: String(err?.message || err)
    });
  }

  // 5) People
  try {
    const peopleResult = await processPeopleStage(targetOrgId);
    pushStage(
      'people',
      'Persons & users',
      peopleResult.errors.length ? 'warning' : 'success',
      peopleResult
    );
  } catch (err) {
    pushStage('people', 'Persons & users', 'error', {
      message: String(err?.message || err)
    });
  }

  // 6) Organization row (bypass person integrity — people already handled)
  try {
    const stillLinked = await personRepository.countByOrganizationId(targetOrgId);
    if (stillLinked > 0) {
      // Final unlink pass for any stragglers
      await processPeopleStage(targetOrgId);
    }
    await organizationRepository.remove(targetOrgId);
    pushStage('organization', 'Organization record', 'success', { removed: true });
  } catch (err) {
    pushStage('organization', 'Organization record', 'error', {
      message: String(err?.message || err)
    });
    return {
      status: 'error',
      orgId: targetOrgId,
      stages,
      message: String(err?.message || err)
    };
  }

  const failed = stages.some((stage) => stage.status === 'error');
  return {
    status: failed ? 'partial' : 'success',
    orgId: targetOrgId,
    orgName: expectedName,
    stages,
    message: failed
      ? 'Organization purge finished with one or more stage errors.'
      : 'Organization and related data deleted successfully.'
  };
}

module.exports = {
  ALL_MASTER_DEFINITIONS,
  buildOrganizationPurgePlan,
  executeOrganizationPurge,
  resolveOrgDisplayName
};
