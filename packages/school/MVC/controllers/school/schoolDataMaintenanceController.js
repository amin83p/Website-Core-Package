const schoolDataMaintenanceService = require('../../services/school/schoolDataMaintenanceService');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const { getActiveDataBackendMode } = requireCoreModule('MVC/infrastructure/runtime/dataBackendRuntime');

const {
  getActiveOrgIdOrThrow: getActiveOrgIdOrThrowShared,
  assertCreateOrgContextOrThrow: assertCreateOrgContextOrThrowShared
} = requireCoreModule('MVC/utils/orgContextUtils');
const { isAjax } = requireCoreModule('MVC/utils/generalTools');
const { listCatalogGroups } = require('../../config/schoolDataMaintenanceCatalog');

const DELETE_IDEMPOTENCY_VERSION = 'v1';
const CLEAR_ALL_IDEMPOTENCY_VERSION = 'v1';

function getActiveOrgIdOrThrow(reqUser) {
  return getActiveOrgIdOrThrowShared(reqUser);
}

async function assertMaintenanceOrgContextOrThrow(reqUser) {
  return assertCreateOrgContextOrThrowShared(reqUser, { scopeLabel: 'school data maintenance' });
}

function sendGuardedResponse(req, res, guardResult, duplicateMessage, duplicateStatus = 409) {
  if (!guardResult || guardResult.status === 'acquired') return false;
  if (guardResult.status === 'busy') {
    const payload = {
      status: 'warning',
      message: duplicateMessage,
      idempotency: {
        state: 'busy',
        retryAfterMs: Number(guardResult.retryAfterMs || 0)
      }
    };
    if (isAjax(req)) {
      res.status(duplicateStatus).json(payload);
    } else {
      res.status(duplicateStatus).render('error', { title: 'Error', message: payload.message, user: req.user });
    }
    return true;
  }
  if (guardResult.status === 'replay') {
    const payload = guardResult.payload && typeof guardResult.payload === 'object'
      ? { ...guardResult.payload }
      : { status: 'success' };
    payload.idempotency = { state: 'replayed' };
    if (isAjax(req)) {
      res.json(payload);
    } else {
      const message = String(payload.message || 'Operation already completed.');
      res.render('error', { title: 'Info', message, user: req.user });
    }
    return true;
  }
  return false;
}

function parseIdListFromBody(body = {}) {
  return schoolDataMaintenanceService.normalizeIdList(body.ids || body.selectedIds || []);
}

function resolveOrgMeta(req, activeOrgId) {
  const activeOrgMeta = (Array.isArray(req.user?.allowedOrgs) ? req.user.allowedOrgs : [])
    .find((o) => idsEqual(o?.orgId || '', activeOrgId));
  return {
    activeOrgId,
    activeOrgName: String(activeOrgMeta?.name || activeOrgMeta?.orgName || '').trim() || activeOrgId
  };
}

exports.showPage = async (req, res) => {
  try {
    const activeOrgId = await assertMaintenanceOrgContextOrThrow(req.user);
    const orgMeta = resolveOrgMeta(req, activeOrgId);

    res.render('school/dataMaintenance/index', {
      title: 'School Data Maintenance',
      user: req.user,
      actionStateId: req.actionStateId,
      activeOrgId: orgMeta.activeOrgId,
      activeOrgName: orgMeta.activeOrgName,
      backendMode: getActiveDataBackendMode(),
      catalogGroups: listCatalogGroups()
    });
  } catch (error) {
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.getSummary = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const summary = await schoolDataMaintenanceService.buildCollectionSummaries(activeOrgId, req.user);
    return res.json({ status: 'success', summary });
  } catch (error) {
    const message = String(error?.message || 'Could not load collection summary.');
    return res.status(400).json({ status: 'error', message });
  }
};

exports.listRows = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const entityType = String(req.params.entityType || '').trim();
    const page = req.query.page;
    const limit = req.query.limit;
    const search = req.query.search;
    const payload = await schoolDataMaintenanceService.listCollectionRows({
      entityType,
      orgId: activeOrgId,
      reqUser: req.user,
      page,
      limit,
      search
    });
    return res.json({ status: 'success', ...payload });
  } catch (error) {
    const message = String(error?.message || 'Could not list collection rows.');
    return res.status(400).json({ status: 'error', message });
  }
};

exports.previewDelete = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const entityType = String(req.params.entityType || '').trim();
    const ids = parseIdListFromBody(req.body);
    const preview = await schoolDataMaintenanceService.buildDeletePreview({
      entityType,
      orgId: activeOrgId,
      ids,
      reqUser: req.user
    });
    return res.json({ status: 'success', preview });
  } catch (error) {
    const message = String(error?.message || 'Could not build delete preview.');
    return res.status(400).json({ status: 'error', message });
  }
};

exports.deleteSelected = async (req, res) => {
  let guardKey = '';
  try {
    const activeOrgId = await assertMaintenanceOrgContextOrThrow(req.user);
    const entityType = String(req.params.entityType || '').trim();
    const ids = parseIdListFromBody(req.body);

    guardKey = idempotencyGuardService.createGuardKey([
      'school_data_maintenance_delete',
      DELETE_IDEMPOTENCY_VERSION,
      activeOrgId,
      entityType,
      ids
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 180000,
      replayTtlMs: 15000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Delete operation is already in progress. Please wait.')) return;

    const result = await schoolDataMaintenanceService.deleteSelectedRows({
      entityType,
      orgId: activeOrgId,
      ids,
      reqUser: req.user
    });

    const payloadOut = {
      status: 'success',
      message: `Deleted ${result.summary.success} of ${result.summary.requested} selected record(s).`,
      result
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    return res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    const message = String(error?.message || 'Delete failed.');
    return res.status(400).json({ status: 'error', message });
  }
};

exports.clearAll = async (req, res) => {
  let guardKey = '';
  try {
    const activeOrgId = await assertMaintenanceOrgContextOrThrow(req.user);
    const entityType = String(req.params.entityType || '').trim();

    guardKey = idempotencyGuardService.createGuardKey([
      'school_data_maintenance_clear_all',
      CLEAR_ALL_IDEMPOTENCY_VERSION,
      activeOrgId,
      entityType
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 180000,
      replayTtlMs: 15000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Clear-all operation is already in progress. Please wait.')) return;

    const result = await schoolDataMaintenanceService.clearCollectionForOrg({
      entityType,
      orgId: activeOrgId
    });

    const removed = Number(result?.result?.removed || 0);
    const payloadOut = {
      status: 'success',
      message: `Cleared ${removed} record(s) from ${result.catalogLabel}.`,
      result
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    return res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    const message = String(error?.message || 'Clear all failed.');
    return res.status(400).json({ status: 'error', message });
  }
};
