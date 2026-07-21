const schoolDataService = require('./schoolDataService');
const schoolRepositories = require('../../repositories/school');
const withdrawalRepository = require('../../repositories/school/withdrawalRepository');
const classDeleteCascadeService = require('./classDeleteCascadeService');
const attendanceMatrixPolicyModel = require('../../models/school/attendanceMatrixPolicyModel');
const conductRatingScalePolicyModel = require('../../models/school/conductRatingScalePolicyModel');
const { isVoidPolicy } = require('./schoolDeletionPolicyRegistry');
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
const CLASS_SESSION_ID_SEPARATOR = '::';

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

function resolvePolicyModel(catalogEntry) {
  if (catalogEntry?.policyModel === 'attendanceMatrix') return attendanceMatrixPolicyModel;
  if (catalogEntry?.policyModel === 'conductRatingScale') return conductRatingScalePolicyModel;
  return null;
}

function buildClassSessionCompositeId(classId, sessionId) {
  return `${toPublicId(classId)}${CLASS_SESSION_ID_SEPARATOR}${toPublicId(sessionId)}`;
}

function parseClassSessionCompositeId(compositeId) {
  const raw = toPublicId(compositeId);
  const separatorIndex = raw.indexOf(CLASS_SESSION_ID_SEPARATOR);
  if (separatorIndex <= 0) return null;
  const classId = raw.slice(0, separatorIndex).trim();
  const sessionId = raw.slice(separatorIndex + CLASS_SESSION_ID_SEPARATOR.length).trim();
  if (!classId || !sessionId) return null;
  return { classId, sessionId };
}

function sessionMatchesSearch(row, search) {
  const needle = String(search || '').trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    row?.id,
    row?.sessionId,
    row?.classId,
    row?.classTitle,
    row?.classCode,
    row?.date,
    row?.startTime,
    row?.endTime,
    row?.status,
    row?.delivery?.deliveredByName,
    row?.delivery?.deliveredBy
  ].map((value) => String(value || '').toLowerCase()).join(' ');
  return haystack.includes(needle);
}

function paginateRows(rows, query = {}) {
  const page = Math.max(1, Number.parseInt(String(query.page || 1), 10) || 1);
  const limit = Math.min(10000, Math.max(1, Number.parseInt(String(query.limit || 50), 10) || 50));
  const start = (page - 1) * limit;
  return rows.slice(start, start + limit);
}

async function listOrgClasses(orgId, reqUser) {
  const rows = await schoolDataService.fetchData('classes', {
    orgId__eq: toPublicId(orgId),
    page: 1,
    limit: 10000
  }, reqUser, { includeVoided: true });
  return (Array.isArray(rows) ? rows : []).filter((row) => isRowInOrg(row, orgId));
}

async function collectClassSessionRows(orgId, reqUser, { search = '' } = {}) {
  const targetOrgId = toPublicId(orgId);
  const classes = await listOrgClasses(targetOrgId, reqUser);
  const out = [];

  for (const classRow of classes) {
    const classId = toPublicId(classRow?.id);
    if (!classId) continue;
    // eslint-disable-next-line no-await-in-loop
    const sessions = await schoolDataService.getClassSessions(classId, reqUser);
    (Array.isArray(sessions) ? sessions : []).forEach((session) => {
      const sessionId = toPublicId(session?.sessionId || session?.id);
      if (!sessionId) return;
      const row = {
        ...session,
        id: buildClassSessionCompositeId(classId, sessionId),
        sessionId,
        classId,
        classTitle: String(classRow?.title || classRow?.name || '').trim(),
        classCode: String(classRow?.code || '').trim(),
        orgId: targetOrgId,
        status: String(session?.status || '').trim(),
        date: String(session?.date || '').trim(),
        startTime: String(session?.startTime || '').trim(),
        endTime: String(session?.endTime || '').trim(),
        updatedAt: String(
          session?.updatedAt
          || session?.audit?.lastUpdateDateTime
          || classRow?.audit?.lastUpdateDateTime
          || ''
        ).trim()
      };
      if (!sessionMatchesSearch(row, search)) return;
      out.push(row);
    });
  }

  out.sort((left, right) => {
    const dateCmp = String(left.date || '').localeCompare(String(right.date || ''));
    if (dateCmp !== 0) return dateCmp;
    const timeCmp = String(left.startTime || '').localeCompare(String(right.startTime || ''));
    if (timeCmp !== 0) return timeCmp;
    return String(left.id || '').localeCompare(String(right.id || ''));
  });

  return out;
}

async function getClassSessionRow(compositeId, orgId, reqUser) {
  const parsed = parseClassSessionCompositeId(compositeId);
  if (!parsed) return null;
  const classRow = await schoolDataService.getDataById('classes', parsed.classId, reqUser);
  if (!classRow || !isRowInOrg(classRow, orgId)) return null;
  const sessions = await schoolDataService.getClassSessions(parsed.classId, reqUser);
  const session = (Array.isArray(sessions) ? sessions : []).find((row) => (
    idsEqual(row?.sessionId || row?.id, parsed.sessionId)
  ));
  if (!session) return null;
  return {
    ...session,
    id: buildClassSessionCompositeId(parsed.classId, parsed.sessionId),
    sessionId: parsed.sessionId,
    classId: parsed.classId,
    classTitle: String(classRow?.title || classRow?.name || '').trim(),
    classCode: String(classRow?.code || '').trim(),
    orgId: toPublicId(orgId),
    status: String(session?.status || '').trim(),
    date: String(session?.date || '').trim(),
    startTime: String(session?.startTime || '').trim(),
    endTime: String(session?.endTime || '').trim()
  };
}

async function deleteClassSessionRow(compositeId, orgId, reqUser) {
  const parsed = parseClassSessionCompositeId(compositeId);
  if (!parsed) throw new Error('Invalid class session id.');
  const classRow = await schoolDataService.getDataById('classes', parsed.classId, reqUser);
  if (!classRow || !isRowInOrg(classRow, orgId)) throw new Error('Class session not found in active organization.');
  const sessions = await schoolDataService.getClassSessions(parsed.classId, reqUser);
  const nextSessions = (Array.isArray(sessions) ? sessions : []).filter((row) => (
    !idsEqual(row?.sessionId || row?.id, parsed.sessionId)
  ));
  if (nextSessions.length === (Array.isArray(sessions) ? sessions.length : 0)) {
    throw new Error('Class session not found.');
  }
  await schoolDataService.saveClassSessions(parsed.classId, nextSessions, reqUser);
  return { removed: 1, classId: parsed.classId, sessionId: parsed.sessionId };
}

async function clearAllClassSessionsForOrg(orgId, reqUser) {
  const classes = await listOrgClasses(orgId, reqUser);
  let clearedClasses = 0;
  let removedSessions = 0;
  for (const classRow of classes) {
    const classId = toPublicId(classRow?.id);
    if (!classId) continue;
    // eslint-disable-next-line no-await-in-loop
    const sessions = await schoolDataService.getClassSessions(classId, reqUser);
    const count = Array.isArray(sessions) ? sessions.length : 0;
    if (!count) continue;
    // eslint-disable-next-line no-await-in-loop
    await schoolDataService.saveClassSessions(classId, [], reqUser);
    clearedClasses += 1;
    removedSessions += count;
  }
  return { clearedClasses, removedSessions };
}

async function listOrgPolicyRows(entityType, orgId, query = {}) {
  const catalogEntry = getCatalogEntry(entityType);
  const policyModel = resolvePolicyModel(catalogEntry);
  if (!policyModel) return [];
  const row = await policyModel.getStoredPolicyRowForOrg(orgId);
  if (!row) return [];
  const search = String(query.search || '').trim().toLowerCase();
  if (search) {
    const haystack = `${row.id} ${row.orgId} ${row.status}`.toLowerCase();
    if (!haystack.includes(search)) return [];
  }
  return paginateRows([row], query);
}

async function listIndexRows(entityType, orgId, query = {}) {
  const catalogEntry = getCatalogEntry(entityType);
  const indexKey = String(catalogEntry?.indexKey || '').trim();
  const indexDoc = indexKey === 'teachers'
    ? await schoolDataService.getTeacherIndex()
    : await schoolDataService.getStudentIndex();
  const map = indexDoc && typeof indexDoc === 'object' && !Array.isArray(indexDoc) ? indexDoc : {};
  const search = String(query.search || '').trim().toLowerCase();
  const targetOrgId = toPublicId(orgId);
  const rows = Object.keys(map).sort().map((key) => ({
    id: key,
    key,
    orgId: targetOrgId,
    status: 'index',
    updatedAt: '',
    valueType: Array.isArray(map[key]) ? 'array' : typeof map[key]
  })).filter((row) => {
    if (!search) return true;
    return String(row.key || '').toLowerCase().includes(search);
  });
  return paginateRows(rows, query);
}

async function countIndexRows(entityType) {
  const catalogEntry = getCatalogEntry(entityType);
  const indexKey = String(catalogEntry?.indexKey || '').trim();
  const indexDoc = indexKey === 'teachers'
    ? await schoolDataService.getTeacherIndex()
    : await schoolDataService.getStudentIndex();
  const map = indexDoc && typeof indexDoc === 'object' && !Array.isArray(indexDoc) ? indexDoc : {};
  return Object.keys(map).length;
}

async function listOrgRows(entityType, orgId, reqUser, query = {}) {
  const catalogEntry = getCatalogEntry(entityType);
  if (!catalogEntry) throw new Error(`Unknown maintenance collection: ${entityType}`);

  if (catalogEntry.storage === 'classSessions') {
    const rows = await collectClassSessionRows(orgId, reqUser, { search: query.search || '' });
    return paginateRows(rows, query);
  }

  if (catalogEntry.storage === 'orgPolicy') {
    return listOrgPolicyRows(entityType, orgId, query);
  }

  if (catalogEntry.storage === 'index') {
    return listIndexRows(entityType, orgId, query);
  }

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
  }, reqUser, { includeVoided: true });
}

async function countOrgRows(entityType, orgId, reqUser) {
  const catalogEntry = getCatalogEntry(entityType);
  if (!catalogEntry) return 0;

  if (catalogEntry.storage === 'classSessions') {
    const rows = await collectClassSessionRows(orgId, reqUser);
    return rows.length;
  }

  if (catalogEntry.storage === 'orgPolicy') {
    const policyModel = resolvePolicyModel(catalogEntry);
    if (!policyModel) return 0;
    return (await policyModel.hasStoredPolicyForOrg(orgId)) ? 1 : 0;
  }

  if (catalogEntry.storage === 'index') {
    return countIndexRows(entityType);
  }

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

  const classification = classifyRowForDelete(entityType, row, entry);
  if (!classification.canDelete) {
    output.protected = true;
    output.deletable = false;
    output.protectionReason = classification.reason || 'Delete is not supported for this record.';
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

  if (catalogEntry.storage === 'classSessions') {
    return getClassSessionRow(targetId, targetOrgId, reqUser);
  }

  if (catalogEntry.storage === 'orgPolicy') {
    const policyModel = resolvePolicyModel(catalogEntry);
    if (!policyModel) return null;
    if (!idsEqual(targetId, targetOrgId) && !idsEqual(targetId, policyModel.orgKey(targetOrgId))) {
      return null;
    }
    return policyModel.getStoredPolicyRowForOrg(targetOrgId);
  }

  if (catalogEntry.storage === 'index') {
    const rows = await listIndexRows(entityType, targetOrgId, { page: 1, limit: 100000 });
    return rows.find((row) => idsEqual(row?.id, targetId)) || null;
  }

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

async function getCollectionRow({ entityType, id, orgId, reqUser } = {}) {
  const catalogEntry = getCatalogEntry(entityType);
  if (!catalogEntry) return null;
  const record = await getRowForMaintenance(entityType, id, orgId, reqUser);
  if (!record) return null;
  return {
    entityType,
    collectionLabel: catalogEntry.label,
    id: toPublicId(record.id),
    record
  };
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
  if (entityType === 'academicLedger' && String(row?.status || '').trim().toLowerCase() !== 'void') {
    return { canDelete: false, reason: 'Only void academic ledger entries can be permanently deleted. Void this entry first.' };
  }
  if (isVoidPolicy(entityType) && String(row?.status || '').trim().toLowerCase() !== 'void') {
    return { canDelete: false, reason: 'Only void records can be permanently purged. Void this record from its School screen first.' };
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

  if (entry.storage === 'classSessions') {
    return deleteClassSessionRow(id, orgId, reqUser);
  }

  if (entry.storage === 'orgPolicy') {
    const policyModel = resolvePolicyModel(entry);
    if (!policyModel) throw new Error(`Policy model not found for ${entityType}.`);
    return policyModel.removePolicyForOrg(orgId);
  }

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

function resolveClearAllHandler(entityType, catalogEntry, reqUser) {
  if (catalogEntry.storage === 'classSessions') {
    return (orgId) => clearAllClassSessionsForOrg(orgId, reqUser);
  }

  if (catalogEntry.storage === 'orgPolicy') {
    const policyModel = resolvePolicyModel(catalogEntry);
    if (!policyModel) return null;
    return (orgId) => policyModel.removePolicyForOrg(orgId);
  }

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

async function clearCollectionForOrg({ entityType, orgId, reqUser }) {
  const catalogEntry = getCatalogEntry(entityType);
  if (!catalogEntry) throw new Error(`Unknown maintenance collection: ${entityType}`);
  if (catalogEntry.supportsClearAll !== true) {
    throw new Error(`Clear all is not supported for ${catalogEntry.label}.`);
  }

  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('Active organization is required.');

  const clearHandler = resolveClearAllHandler(entityType, catalogEntry, reqUser);
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
  getCollectionRow,
  buildDeletePreview,
  deleteSelectedRows,
  clearCollectionForOrg,
  normalizeIdList,
  classifyRowForDelete,
  isHeadSchoolAccount,
  buildClassSessionCompositeId,
  parseClassSessionCompositeId
};
