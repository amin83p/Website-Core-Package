const schoolDataService = require('./schoolDataService');
const schoolRepositories = require('../../repositories/school');
const withdrawalRepository = require('../../repositories/school/withdrawalRepository');
const classDeleteCascadeService = require('./classDeleteCascadeService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { getActiveDataBackendMode } = requireCoreModule('MVC/infrastructure/runtime/dataBackendRuntime');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const {
  getCatalogEntry,
  listCatalogEntries,
  listCatalogGroups,
  resolveRowLabel,
  resolveListFields,
  DELETE_STRATEGIES
} = require('../../config/schoolDataMaintenanceCatalog');

const MAINTENANCE_LIST_SCOPE = Object.freeze({ canViewAll: true });

function normalizeIdList(input) {
  const rows = Array.isArray(input) ? input : (input === undefined || input === null ? [] : [input]);
  const out = [];
  const seen = new Set();
  rows.forEach((row) => {
    const id = toPublicId(row);
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  });
  return out;
}

function isHeadSchoolAccount(row = {}) {
  const headCategory = String(row?.headCategory || 'none').trim().toLowerCase();
  return headCategory !== 'none';
}

function isRowInOrg(row, orgId) {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) return false;
  return idsEqual(row?.orgId, targetOrgId);
}

function resolveRepository(entityType, catalogEntry) {
  if (catalogEntry?.externalRepository === 'withdrawals') return withdrawalRepository;
  const repo = schoolRepositories[entityType];
  return repo || null;
}

async function listOrgRows(entityType, orgId, reqUser, query = {}) {
  const catalogEntry = getCatalogEntry(entityType);
  if (!catalogEntry) throw new Error(`Unknown maintenance collection: ${entityType}`);

  if (catalogEntry.externalRepository === 'withdrawals') {
    return withdrawalRepository.list({
      query: {
        orgId__eq: toPublicId(orgId),
        page: query.page || 1,
        limit: query.limit || 50,
        ...(query.search ? { search: query.search } : {})
      },
      scope: MAINTENANCE_LIST_SCOPE
    });
  }

  return schoolDataService.fetchData(entityType, {
    orgId__eq: toPublicId(orgId),
    page: query.page || 1,
    limit: query.limit || 50,
    ...(query.search ? { search: query.search } : {})
  }, reqUser);
}

async function countOrgRows(entityType, orgId, reqUser) {
  const catalogEntry = getCatalogEntry(entityType);
  if (!catalogEntry) return 0;

  const repository = resolveRepository(entityType, catalogEntry);
  if (repository && typeof repository.count === 'function') {
    return repository.count({
      query: { orgId__eq: toPublicId(orgId) },
      scope: MAINTENANCE_LIST_SCOPE
    });
  }

  const rows = await listOrgRows(entityType, orgId, reqUser, { page: 1, limit: 10000 });
  return Array.isArray(rows) ? rows.length : 0;
}

function normalizeTableRow(entityType, row = {}, catalogEntry = null) {
  const entry = catalogEntry || getCatalogEntry(entityType);
  const fields = resolveListFields(entityType);
  const output = {
    id: toPublicId(row?.id),
    label: resolveRowLabel(entityType, row),
    status: String(row?.status || '').trim(),
    orgId: toPublicId(row?.orgId),
    updatedAt: String(row?.updatedAt || row?.audit?.lastUpdateDateTime || row?.audit?.createDateTime || '').trim(),
    protected: false,
    protectionReason: '',
    deletable: entry?.deleteStrategy !== DELETE_STRATEGIES.UNSUPPORTED
  };

  fields.forEach((field) => {
    if (field === 'id' || field === 'status' || field === 'orgId' || field === 'updatedAt') return;
    const value = row?.[field];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      output[field] = value;
    }
  });

  if (entry?.protectHeadAccounts && isHeadSchoolAccount(row)) {
    output.protected = true;
    output.deletable = false;
    output.protectionReason = 'Head account is protected.';
  }

  if (entry?.listOnly) {
    output.deletable = false;
    output.protectionReason = 'Delete is not supported for this collection.';
  }

  return output;
}

async function buildCollectionSummaries(orgId, reqUser) {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('Active organization is required.');

  const entries = listCatalogEntries();
  const summaries = await Promise.all(entries.map(async (entry) => {
    let count = 0;
    try {
      count = await countOrgRows(entry.entityType, targetOrgId, reqUser);
    } catch (_error) {
      count = 0;
    }
    return {
      entityType: entry.entityType,
      label: entry.label,
      group: entry.group,
      collectionName: entry.collectionName,
      count,
      deleteStrategy: entry.deleteStrategy,
      supportsClearAll: entry.supportsClearAll === true,
      listOnly: entry.listOnly === true
    };
  }));

  return {
    orgId: targetOrgId,
    backendMode: getActiveDataBackendMode(),
    groups: listCatalogGroups(),
    collections: summaries
  };
}

async function listCollectionRows({ entityType, orgId, reqUser, page = 1, limit = 50, search = '' } = {}) {
  const catalogEntry = getCatalogEntry(entityType);
  if (!catalogEntry) throw new Error(`Unknown maintenance collection: ${entityType}`);

  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('Active organization is required.');

  const normalizedPage = Math.max(1, Number.parseInt(String(page || 1), 10) || 1);
  const normalizedLimit = Math.min(200, Math.max(1, Number.parseInt(String(limit || 50), 10) || 50));
  const normalizedSearch = String(search || '').trim();

  const rows = await listOrgRows(entityType, targetOrgId, reqUser, {
    page: normalizedPage,
    limit: normalizedLimit,
    search: normalizedSearch || undefined
  });

  const normalizedRows = (Array.isArray(rows) ? rows : [])
    .filter((row) => isRowInOrg(row, targetOrgId))
    .map((row) => normalizeTableRow(entityType, row, catalogEntry));

  const total = await countOrgRows(entityType, targetOrgId, reqUser);

  return {
    entityType,
    orgId: targetOrgId,
    page: normalizedPage,
    limit: normalizedLimit,
    search: normalizedSearch,
    total,
    rows: normalizedRows,
    catalog: {
      label: catalogEntry.label,
      group: catalogEntry.group,
      collectionName: catalogEntry.collectionName,
      deleteStrategy: catalogEntry.deleteStrategy,
      supportsClearAll: catalogEntry.supportsClearAll === true,
      listOnly: catalogEntry.listOnly === true
    }
  };
}

async function getRowForMaintenance(entityType, id, orgId, reqUser) {
  const catalogEntry = getCatalogEntry(entityType);
  if (!catalogEntry) throw new Error(`Unknown maintenance collection: ${entityType}`);

  const targetOrgId = toPublicId(orgId);
  const targetId = toPublicId(id);
  if (!targetOrgId) throw new Error('Active organization is required.');
  if (!targetId) throw new Error('Record id is required.');

  let row = null;
  if (catalogEntry.externalRepository === 'withdrawals') {
    row = await withdrawalRepository.getById(targetId, { scope: MAINTENANCE_LIST_SCOPE });
  } else {
    row = await schoolDataService.getDataById(entityType, targetId, reqUser);
  }

  if (!row) return null;
  if (!isRowInOrg(row, targetOrgId)) return null;
  return row;
}

function classifyRowForDelete(entityType, row, catalogEntry = null) {
  const entry = catalogEntry || getCatalogEntry(entityType);
  if (!entry) return { canDelete: false, reason: 'Unknown collection.' };
  if (entry.deleteStrategy === DELETE_STRATEGIES.UNSUPPORTED || entry.listOnly) {
    return { canDelete: false, reason: 'Delete is not supported for this collection.' };
  }
  if (entry.protectHeadAccounts && isHeadSchoolAccount(row)) {
    return { canDelete: false, reason: 'Head account is protected.' };
  }
  return { canDelete: true, reason: '' };
}

async function buildDeletePreview({ entityType, orgId, ids, reqUser }) {
  const catalogEntry = getCatalogEntry(entityType);
  if (!catalogEntry) throw new Error(`Unknown maintenance collection: ${entityType}`);

  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('Active organization is required.');

  const normalizedIds = normalizeIdList(ids);
  const items = [];

  for (const id of normalizedIds) {
    // eslint-disable-next-line no-await-in-loop
    const row = await getRowForMaintenance(entityType, id, targetOrgId, reqUser);
    if (!row) {
      items.push({ id, status: 'missing', label: '', reason: 'Record not found in active organization.' });
      continue;
    }
    const classification = classifyRowForDelete(entityType, row, catalogEntry);
    items.push({
      id,
      status: classification.canDelete ? 'ready' : 'skipped',
      label: resolveRowLabel(entityType, row),
      reason: classification.reason || ''
    });
  }

  return {
    entityType,
    orgId: targetOrgId,
    catalogLabel: catalogEntry.label,
    deleteStrategy: catalogEntry.deleteStrategy,
    items,
    readyCount: items.filter((item) => item.status === 'ready').length,
    skippedCount: items.filter((item) => item.status !== 'ready').length
  };
}

async function maintenanceDeleteRow(entityType, id, orgId, reqUser, catalogEntry) {
  const entry = catalogEntry || getCatalogEntry(entityType);
  if (!entry) throw new Error(`Unknown maintenance collection: ${entityType}`);

  const repository = resolveRepository(entityType, entry);
  if (!repository) throw new Error(`Repository not found for ${entityType}.`);

  const options = { scope: MAINTENANCE_LIST_SCOPE };

  if (entry.cascadeClassSessionAssets) {
    await classDeleteCascadeService.cascadeDeleteClassSessionAssets(id, reqUser, orgId);
  }

  if (entry.deleteStrategy === DELETE_STRATEGIES.PURGE) {
    if (typeof repository.purgeById !== 'function') {
      throw new Error(`Purge is not supported for ${entityType}.`);
    }
    return repository.purgeById(id, options);
  }

  if (entry.deleteStrategy === DELETE_STRATEGIES.MAINTENANCE_PURGE) {
    if (typeof repository.maintenancePurgeById !== 'function') {
      throw new Error(`Maintenance purge is not supported for ${entityType}.`);
    }
    return repository.maintenancePurgeById(id, options);
  }

  if (entry.externalRepository === 'withdrawals') {
    return repository.remove(id, options);
  }

  return repository.remove(id, options);
}

async function deleteSelectedRows({ entityType, orgId, ids, reqUser }) {
  const catalogEntry = getCatalogEntry(entityType);
  if (!catalogEntry) throw new Error(`Unknown maintenance collection: ${entityType}`);

  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('Active organization is required.');

  const normalizedIds = normalizeIdList(ids);
  const results = [];

  for (const id of normalizedIds) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const row = await getRowForMaintenance(entityType, id, targetOrgId, reqUser);
      if (!row) {
        results.push({ id, status: 'error', message: 'Record not found in active organization.' });
        continue;
      }

      const classification = classifyRowForDelete(entityType, row, catalogEntry);
      if (!classification.canDelete) {
        results.push({ id, status: 'skipped', message: classification.reason || 'Delete skipped.' });
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      await maintenanceDeleteRow(entityType, id, targetOrgId, reqUser, catalogEntry);
      results.push({ id, status: 'success', message: 'Deleted.' });
    } catch (error) {
      results.push({
        id,
        status: 'error',
        message: String(error?.message || error || 'Delete failed.')
      });
    }
  }

  const summary = {
    requested: normalizedIds.length,
    success: results.filter((row) => row.status === 'success').length,
    skipped: results.filter((row) => row.status === 'skipped').length,
    error: results.filter((row) => row.status === 'error').length
  };

  return {
    entityType,
    orgId: targetOrgId,
    catalogLabel: catalogEntry.label,
    results,
    summary
  };
}

function resolveClearAllHandler(entityType, catalogEntry) {
  const repository = resolveRepository(entityType, catalogEntry);
  if (!repository) return null;

  if (catalogEntry.externalRepository === 'withdrawals' && typeof repository.clearWithdrawalsByOrg === 'function') {
    return (orgId, options) => repository.clearWithdrawalsByOrg(orgId, options);
  }

  if (typeof repository.clearByOrg === 'function') {
    return (orgId, options) => repository.clearByOrg(orgId, options);
  }

  return null;
}

async function clearCollectionForOrg({ entityType, orgId }) {
  const catalogEntry = getCatalogEntry(entityType);
  if (!catalogEntry) throw new Error(`Unknown maintenance collection: ${entityType}`);
  if (catalogEntry.supportsClearAll !== true) {
    throw new Error(`Clear all is not supported for ${catalogEntry.label}.`);
  }

  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('Active organization is required.');

  const clearHandler = resolveClearAllHandler(entityType, catalogEntry);
  if (!clearHandler) {
    throw new Error(`Clear all handler is not available for ${catalogEntry.label}.`);
  }

  const result = await clearHandler(targetOrgId, { scope: MAINTENANCE_LIST_SCOPE });
  return {
    entityType,
    orgId: targetOrgId,
    catalogLabel: catalogEntry.label,
    result
  };
}

module.exports = {
  buildCollectionSummaries,
  listCollectionRows,
  buildDeletePreview,
  deleteSelectedRows,
  clearCollectionForOrg,
  normalizeIdList,
  classifyRowForDelete,
  isHeadSchoolAccount
};
