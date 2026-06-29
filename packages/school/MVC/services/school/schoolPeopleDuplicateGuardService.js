const dataService = require('./schoolDataService');

const ENTITY_CONFIG = Object.freeze({
  students: {
    label: 'Student',
    statusField: 'academicStatus',
    editUrl: (id) => `/school/students/edit/${encodeURIComponent(String(id || ''))}`,
    recoveryUrl: '/school/students/archived'
  },
  teachers: {
    label: 'Teacher',
    statusField: 'status',
    editUrl: (id) => `/school/teachers/edit/${encodeURIComponent(String(id || ''))}`,
    recoveryUrl: '/school/teachers/archived'
  },
  staff: {
    label: 'Staff',
    statusField: 'status',
    editUrl: (id) => `/school/staff/edit/${encodeURIComponent(String(id || ''))}`,
    recoveryUrl: '/school/staff/archived'
  }
});

function cleanId(value) {
  return String(value || '').trim();
}

function idsEqual(a, b) {
  return cleanId(a) === cleanId(b);
}

function getEntityConfig(entityType) {
  const key = cleanId(entityType);
  const config = ENTITY_CONFIG[key];
  if (!config) throw new Error(`Unsupported School people entity type "${entityType}".`);
  return config;
}

function normalizeStatus(row, config) {
  return cleanId(row?.[config.statusField] || row?.status || row?.academicStatus || '').toLowerCase();
}

function isHardDeleted(row) {
  const status = normalizeStatus(row, { statusField: 'status' });
  return row?.deleted === true
    || row?.isDeleted === true
    || !!row?.deletedAt
    || status === 'deleted'
    || status === 'hard_deleted'
    || status === 'hard-deleted';
}

function isArchived(row, config) {
  return normalizeStatus(row, config) === 'archived';
}

function buildDuplicateSummary(row, config) {
  const id = cleanId(row?.id);
  const status = cleanId(row?.[config.statusField] || row?.status || row?.academicStatus || 'Active') || 'Active';
  const archived = isArchived(row, config);
  return {
    id,
    status,
    archived,
    editUrl: archived ? '' : config.editUrl(id),
    recoveryUrl: archived ? config.recoveryUrl : ''
  };
}

async function findExistingPersonAccount({ entityType, orgId, personId, excludeId = '', requestingUser = null } = {}) {
  const config = getEntityConfig(entityType);
  const targetOrgId = cleanId(orgId);
  const targetPersonId = cleanId(personId);
  const currentId = cleanId(excludeId);
  if (!targetOrgId || !targetPersonId) return null;

  let rows = [];
  try {
    rows = await dataService.fetchData(entityType, {
      orgId__eq: targetOrgId,
      personId__eq: targetPersonId
    }, requestingUser);
  } catch (_) {
    rows = await dataService.fetchData(entityType, {}, requestingUser);
  }

  return (Array.isArray(rows) ? rows : []).find((row) => {
    if (!row || typeof row !== 'object') return false;
    if (isHardDeleted(row)) return false;
    if (currentId && idsEqual(row.id, currentId)) return false;
    return idsEqual(row.orgId, targetOrgId) && idsEqual(row.personId, targetPersonId);
  }) || null;
}

function buildDuplicateError({ entityType, duplicate, personId } = {}) {
  const config = getEntityConfig(entityType);
  const summary = buildDuplicateSummary(duplicate, config);
  const recordTarget = summary.archived
    ? `Recover Archived ${config.label}`
    : `Open Existing ${config.label}`;
  const actionUrl = summary.archived ? summary.recoveryUrl : summary.editUrl;
  const message = `${config.label} account already exists for the selected person in this organization. ${recordTarget} instead of creating another ${config.label.toLowerCase()} account.`;
  const error = new Error(message);
  error.name = 'SchoolPeopleDuplicateAccountError';
  error.code = 'SCHOOL_PERSON_ACCOUNT_EXISTS';
  error.statusCode = 409;
  error.details = {
    entityType,
    personId: cleanId(personId),
    existing: summary,
    actionUrl,
    actionLabel: recordTarget
  };
  return error;
}

async function assertNoDuplicatePersonAccount(options = {}) {
  const duplicate = await findExistingPersonAccount(options);
  if (!duplicate) return null;
  throw buildDuplicateError({ ...options, duplicate });
}

async function enrichPersonPickerRowsWithAccountState(rows = [], { entityType, orgId, requestingUser = null } = {}) {
  const config = getEntityConfig(entityType);
  const targetOrgId = cleanId(orgId);
  const list = Array.isArray(rows) ? rows : [];
  if (!targetOrgId || list.length === 0) return list;

  let accounts = [];
  try {
    accounts = await dataService.fetchData(entityType, { orgId__eq: targetOrgId }, requestingUser);
  } catch (_) {
    accounts = await dataService.fetchData(entityType, {}, requestingUser);
  }

  const accountByPersonId = new Map();
  (Array.isArray(accounts) ? accounts : []).forEach((row) => {
    if (!row || typeof row !== 'object' || isHardDeleted(row) || !idsEqual(row.orgId, targetOrgId)) return;
    const personId = cleanId(row.personId);
    if (!personId || accountByPersonId.has(personId)) return;
    accountByPersonId.set(personId, row);
  });

  return list.map((row) => {
    const personId = cleanId(row?.personId || row?.id);
    const account = accountByPersonId.get(personId);
    if (!account) return row;
    const summary = buildDuplicateSummary(account, config);
    const statusLabel = summary.archived ? 'archived' : summary.status;
    return {
      ...row,
      alreadyHasSchoolAccount: true,
      linkedSchoolAccount: {
        entityType,
        label: config.label,
        ...summary
      },
      summary: `Already has a ${config.label} account in this organization (${statusLabel}).`,
      description: `Already has a ${config.label} account in this organization (${statusLabel}).`
    };
  });
}

module.exports = {
  assertNoDuplicatePersonAccount,
  enrichPersonPickerRowsWithAccountState,
  findExistingPersonAccount
};
