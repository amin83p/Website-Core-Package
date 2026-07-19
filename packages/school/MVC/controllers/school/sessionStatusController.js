const schoolDataService = require('../../services/school/schoolDataService');
const sessionStatusPolicyService = require('../../services/school/sessionStatusPolicyService');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const settingService = requireCoreModule('MVC/services/settingService');
const { isAjax, buildDataServiceQuery, inferSearchableFields } = requireCoreModule('MVC/utils/generalTools');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const adminChekersService = requireCoreModule('MVC/services/adminChekersService');
const { respondSchoolDeleteError } = require('../../utils/schoolDeleteErrorResponse');

function getActiveOrgIdOrThrow(reqUser) {
  const activeOrgId = reqUser?.activeOrgId ? String(reqUser.activeOrgId) : '';
  if (!activeOrgId) throw new Error('<b>Security Violation</b><br>No active organization context found.');
  return activeOrgId;
}

function assertStatusOrgAccess(statusRow, activeOrgId, reqUser) {
  if (!statusRow) return;
  if (adminChekersService.isSuperAdmin(reqUser)) return;
  if (!idsEqual(statusRow.orgId, activeOrgId)) {
    throw new Error('<b>Security Violation</b><br>Unauthorized organization access.');
  }
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return Boolean(fallback);
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return Boolean(fallback);
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
      const redirectTo = String(payload.redirectTo || '').trim();
      if (redirectTo) {
        res.redirect(redirectTo);
      } else {
        res.redirect('/school/session-statuses');
      }
    }
    return true;
  }
  return false;
}

function buildPayload(reqBody, { activeOrgId, userId }) {
  return {
    orgId: activeOrgId,
    code: String(reqBody.code || '').trim(),
    label: String(reqBody.label || '').trim(),
    description: String(reqBody.description || '').trim(),
    timesheetFormula: String(reqBody.timesheetFormula || '').trim(),
    isFinal: toBoolean(reqBody.isFinal, false),
    makeUpRequired: toBoolean(reqBody.makeUpRequired, false),
    makeupDurationPercent: Number(reqBody.makeupDurationPercent || 100),
    excludeFromAttendance: toBoolean(reqBody.excludeFromAttendance, false),
    excludeFromTeacherIndex: toBoolean(reqBody.excludeFromTeacherIndex, false),
    excludeFromStudentIndex: toBoolean(reqBody.excludeFromStudentIndex, false),
    active: toBoolean(reqBody.active, true),
    sortOrder: Number(reqBody.sortOrder || 0),
    colorBg: String(reqBody.colorBg || '').trim(),
    colorText: String(reqBody.colorText || '').trim(),
    colorBorder: String(reqBody.colorBorder || '').trim(),
    audit: {
      createUser: String(userId || ''),
      lastUpdateUser: String(userId || '')
    }
  };
}

async function ensureOrgDefaults(activeOrgId, userId) {
  await sessionStatusPolicyService.ensureOrgDefaultSessionStatuses(activeOrgId, userId);
  sessionStatusPolicyService.clearStatusCache(activeOrgId);
}

exports.listSessionStatuses = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const query = await buildDataServiceQuery(req.query, { allowedExactKeys: null });
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query.q = '';

    await ensureOrgDefaults(activeOrgId, req.user?.id || 'SYSTEM');

    const rows = await schoolDataService.fetchData('sessionStatuses', query, req.user);
    const dataRows = (rows || [])
      .filter((row) => idsEqual(row?.orgId, activeOrgId))
      .sort((a, b) => {
        const orderA = Number(a?.sortOrder || 0);
        const orderB = Number(b?.sortOrder || 0);
        if (orderA !== orderB) return orderA - orderB;
        return String(a?.label || a?.code || '').localeCompare(String(b?.label || b?.code || ''));
      });

    const searchableFields = await inferSearchableFields(dataRows, { exclude: ['audit'] });
    const { data, pagination } = paginate(dataRows, query.page, query.limit);

    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });

    return res.render('school/sessionStatus/sessionStatusList', {
      title: 'Session Status Definitions',
      tableName: 'Session_Status_Definitions',
      data,
      searchableFields,
      newUrl: 'school/session-statuses',
      newLabel: 'New Status',
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: false,
      print: true,
      pagination,
      filters: req.query,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.showCreateForm = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    await ensureOrgDefaults(activeOrgId, req.user?.id || 'SYSTEM');

    return res.render('school/sessionStatus/sessionStatusForm', {
      title: 'New Session Status',
      statusItem: null,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.showEditForm = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const row = await schoolDataService.getDataById('sessionStatuses', req.params.id, req.user);
    if (!row) throw new Error('Session status not found.');
    assertStatusOrgAccess(row, activeOrgId, req.user);

    return res.render('school/sessionStatus/sessionStatusForm', {
      title: 'Edit Session Status',
      statusItem: row,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.saveSessionStatus = async (req, res) => {
  let guardKey = '';
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const id = String(req.params.id || '').trim();
    guardKey = idempotencyGuardService.createGuardKey([
      'session_status_save',
      String(activeOrgId || '').trim(),
      id,
      req.body || {}
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 90000,
      replayTtlMs: 12000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Session status save is already in progress. Please wait.')) return;

    const payload = buildPayload(req.body, { activeOrgId, userId: req.user?.id || 'SYSTEM' });

    if (id) {
      const existing = await schoolDataService.getDataById('sessionStatuses', id, req.user);
      if (!existing) throw new Error('Session status not found.');
      assertStatusOrgAccess(existing, activeOrgId, req.user);
      await schoolDataService.updateData('sessionStatuses', id, payload, req.user);
    } else {
      await schoolDataService.addData('sessionStatuses', payload, req.user);
    }

    sessionStatusPolicyService.clearStatusCache(activeOrgId);
    const message = id ? 'Session status updated successfully.' : 'Session status created successfully.';
    const payloadOut = {
      status: 'success',
      message,
      redirectTo: '/school/session-statuses'
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    if (isAjax(req)) return res.json(payloadOut);
    return res.redirect('/school/session-statuses');
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.deleteSessionStatus = async (req, res) => {
  let guardKey = '';
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const id = String(req.params.id || '').trim();
    guardKey = idempotencyGuardService.createGuardKey([
      'session_status_delete',
      String(activeOrgId || '').trim(),
      id
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 90000,
      replayTtlMs: 12000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Session status delete is already in progress. Please wait.')) return;

    const existing = await schoolDataService.getDataById('sessionStatuses', id, req.user);
    if (!existing) throw new Error('Session status not found.');
    assertStatusOrgAccess(existing, activeOrgId, req.user);
    await schoolDataService.deleteData('sessionStatuses', id, req.user);
    sessionStatusPolicyService.clearStatusCache(activeOrgId);

    const payloadOut = {
      status: 'success',
      message: 'Session status deleted successfully.',
      redirectTo: '/school/session-statuses'
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    if (isAjax(req)) return res.json(payloadOut);
    return res.redirect('/school/session-statuses');
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    return respondSchoolDeleteError(req, res, error, { user: req.user });
  }
};
