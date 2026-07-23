// MVC/controllers/school/transactionDefinitionController.js
const dataService = require('../../services/school/schoolDataService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const settingService = requireCoreModule('MVC/services/settingService');
const { isAjax, buildDataServiceQuery, inferSearchableFields } = requireCoreModule('MVC/utils/generalTools');
const adminAuthorityService = requireCoreModule('MVC/services/adminAuthorityService');
const schoolRepositories = require('../../repositories/school');
const globalTransactionLedgerModel = require('../../models/school/globalTransactionLedgerModel');
const transactionDefinitionPreviewService = require('../../services/school/transactionDefinitionPreviewService');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const {
  TRANSACTION_DEFINITION_STATUSES
} = require('../../models/school/transactionDefinitionModel');
const {
  getActiveOrgIdOrThrow: getActiveOrgIdOrThrowShared,
  assertCreateOrgContextOrThrow: assertCreateOrgContextOrThrowShared,
  canCreateOrgScopedItem,
  assertOrgAccess: assertOrgAccessShared
} = requireCoreModule('MVC/utils/orgContextUtils');

function getActiveOrgIdOrThrow(reqUser) {
  return getActiveOrgIdOrThrowShared(reqUser);
}

async function assertCreateOrgContextOrThrow(reqUser) {
  return assertCreateOrgContextOrThrowShared(reqUser, { scopeLabel: 'transaction templates' });
}

function assertOrgAccess(record, activeOrgId, reqUser) {
  assertOrgAccessShared(record, activeOrgId, reqUser, { orgField: 'orgId', allowSystemBypass: true });
}

function buildPayload(body, activeOrgId) {
  return transactionDefinitionPreviewService.buildTransactionDefinitionPayload(body, activeOrgId);
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
      res.redirect('/school/transactionTemplates');
    }
    return true;
  }
  return false;
}

async function fetchAccountsForOrg(orgId, reqUser) {
  const scopeOrgId = toPublicId(orgId || reqUser?.activeOrgId);
  if (!scopeOrgId) return [];

  const isSystemScopedSuperAdmin = adminAuthorityService.isSuperAdmin(reqUser)
    && String(toPublicId(reqUser?.activeOrgId)).toUpperCase() === 'SYSTEM';

  if (isSystemScopedSuperAdmin) {
    return await schoolRepositories.schoolAccounts.list({
      query: {},
      scope: {
        canViewAll: true,
        activeOrgId: scopeOrgId,
        allowSystemFallback: false
      }
    });
  }

  return await schoolRepositories.schoolAccounts.list({
    query: {},
    scope: {
      denyAll: false,
      canViewAll: false,
      activeOrgId: scopeOrgId,
      allowSystemFallback: true
    }
  });
}

exports.listTransactionDefinitions = async (req, res) => {
  try {
    const query = await buildDataServiceQuery(req.query);
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query.q = '';
    const canCreateTransactionDefinitions = await canCreateOrgScopedItem(req.user, { scopeLabel: 'transaction templates' });

    const all = await dataService.fetchData('transactionTemplates', query, req.user);
    const searchableFields = await inferSearchableFields(all, { exclude: ['audit', 'metadata'] });
    const { data, pagination } = paginate(all, query);

    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });

    res.render('school/transactionDefinition/transactionDefinitionList', {
      title: 'Transaction Templates',
      tableName: 'Transaction_Definitions',
      newUrl: 'school/transactionTemplates',
      newLabel: canCreateTransactionDefinitions ? 'New Transaction Template' : null,
      data,
      searchableFields,
      includeModal: true,
      includeModal_Table: true,
      print: true,
      pagination,
      filters: req.query,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', error, message: error.message });
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

async function renderTransactionDefinitionFormView(req, res, viewName, titleOverride) {
  try {
    const isEdit = !!req.params.id;
    const activeOrgId = isEdit
      ? getActiveOrgIdOrThrow(req.user)
      : await assertCreateOrgContextOrThrow(req.user);
    let transactionDefinition = {};

    if (isEdit) {
      transactionDefinition = await dataService.getDataById('transactionTemplates', req.params.id, req.user);
      if (!transactionDefinition) throw new Error('Transaction template not found.');
      assertOrgAccess(transactionDefinition, activeOrgId, req.user);
    }

    const allAccounts = await fetchAccountsForOrg(transactionDefinition.orgId || activeOrgId, req.user);
    const postingAccounts = transactionDefinitionPreviewService.filterPostingAccountsForForm(
      allAccounts,
      activeOrgId,
      adminAuthorityService.isSuperAdmin(req.user)
    );

    res.render(viewName, {
      title: titleOverride || (isEdit ? `Edit Transaction Template: ${transactionDefinition.code || transactionDefinition.id}` : 'Create Transaction Template'),
      transactionDefinition,
      definitionStatuses: TRANSACTION_DEFINITION_STATUSES,
      postingAccounts,
      partyRoleOptions: globalTransactionLedgerModel.TRANSACTION_PARTY_ROLES,
      memoCommonPlaceholders: globalTransactionLedgerModel.COMMON_MEMO_PLACEHOLDERS,
      memoPlaceholdersByRole: globalTransactionLedgerModel.MEMO_PLACEHOLDERS_BY_ROLE,
      user: req.user,
      includeModal: true,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
}

exports.showForm = async (req, res) => {
  return renderTransactionDefinitionFormView(req, res, 'school/transactionDefinition/transactionDefinitionForm');
};

exports.showAddWizardForm = async (req, res) => {
  return renderTransactionDefinitionFormView(req, res, 'school/transactionDefinition/transactionDefinitionWizardForm', 'Transaction Template Wizard');
};

exports.showEditWizardForm = async (req, res) => {
  return renderTransactionDefinitionFormView(req, res, 'school/transactionDefinition/transactionDefinitionWizardForm', 'Transaction Template Wizard');
};

exports.saveTransactionDefinition = async (req, res) => {
  let guardKey = '';
  try {
    const { id } = req.params;
    const activeOrgId = id
      ? getActiveOrgIdOrThrow(req.user)
      : await assertCreateOrgContextOrThrow(req.user);
    guardKey = idempotencyGuardService.createGuardKey([
      'transaction_template_save',
      String(activeOrgId || '').trim(),
      String(id || '').trim(),
      req.body || {}
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 120000,
      replayTtlMs: 15000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Transaction template save is already in progress. Please wait.')) return;

    let existing = null;
    if (id) {
      existing = await dataService.getDataById('transactionTemplates', id, req.user);
      if (!existing) throw new Error('Transaction template not found.');
      assertOrgAccess(existing, activeOrgId, req.user);
    }

    const payload = buildPayload(req.body, existing?.orgId || activeOrgId);
    if (!id && req.body.transactionDefinitionId) payload.id = String(req.body.transactionDefinitionId).trim();

    if (id) {
      await dataService.updateData('transactionTemplates', id, payload, req.user);
    } else {
      await dataService.addData('transactionTemplates', payload, req.user);
    }

    const payloadOut = { status: 'success', message: 'Transaction template saved successfully.' };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    if (isAjax(req)) return res.json(payloadOut);
    res.redirect('/school/transactionTemplates');
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.deleteTransactionDefinition = async (req, res) => {
  let guardKey = '';
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    guardKey = idempotencyGuardService.createGuardKey([
      'transaction_template_delete',
      String(activeOrgId || '').trim(),
      String(req.params.id || '').trim()
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 90000,
      replayTtlMs: 12000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Transaction template delete is already in progress. Please wait.')) return;

    const existing = await dataService.getDataById('transactionTemplates', req.params.id, req.user);
    if (!existing) throw new Error('Transaction template not found.');
    assertOrgAccess(existing, activeOrgId, req.user);

    await dataService.deleteData('transactionTemplates', req.params.id, req.user);
    const payloadOut = {
      status: 'success',
      message: 'Transaction template deleted successfully.',
      redirectTo: '/school/transactionTemplates'
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    if (isAjax(req)) return res.json(payloadOut);
    res.redirect('/school/transactionTemplates');
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.previewOrApplyTransactionDefinition = async (req, res) => {
  let guardKey = '';
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const definition = await dataService.getDataById('transactionTemplates', req.params.id, req.user);
    if (!definition) throw new Error('Transaction template not found.');
    assertOrgAccess(definition, activeOrgId, req.user);

    const orgId = toPublicId(definition.orgId || activeOrgId);
    const allAccounts = await fetchAccountsForOrg(definition.orgId || activeOrgId, req.user);
    const partyContext = { ...(req.body || {}) };
    const studentIdForContext = toPublicId(req.body?.studentId);
    if (studentIdForContext && !partyContext.studentAccountId) {
      const contextStudent = await dataService.getDataById('students', studentIdForContext, req.user);
      if (contextStudent && idsEqual(contextStudent.orgId, orgId)) {
        partyContext.studentAccountId = toPublicId(contextStudent.studentAccountId);
      }
    }

    const approve = String(req.body.approve || '').toLowerCase() === 'true';
    if (approve) {
      guardKey = idempotencyGuardService.createGuardKey([
        'transaction_template_apply',
        String(activeOrgId || '').trim(),
        String(definition.id || '').trim(),
        req.body || {}
      ]);
      const guardResult = idempotencyGuardService.beginGuard({
        key: guardKey,
        runningTtlMs: 90000,
        replayTtlMs: 12000
      });
      if (sendGuardedResponse(req, res, guardResult, 'Transaction template apply is already in progress. Please wait.')) return;
    }

    const previewRows = transactionDefinitionPreviewService.buildPreviewRows(definition, allAccounts, orgId, partyContext);
    if (!approve) {
      return res.json({
        status: 'preview',
        message: 'Preview generated. Send approve=true to post these template transactions.',
        preview: previewRows
      });
    }

    const items = transactionDefinitionPreviewService.buildPostingItemsFromPreview({
      definition,
      previewRows,
      orgId,
      requestBody: req.body || {},
      reqUser: req.user
    });

    const created = await dataService.addData('globalTransactions', items, req.user);
    const payloadOut = {
      status: 'success',
      message: 'Transaction template posted successfully.',
      result: {
        createdTransactionCount: created.length,
        createdDoubleEntries: Math.floor(created.length / 2)
      }
    };
    if (guardKey) idempotencyGuardService.completeGuard(guardKey, payloadOut);
    return res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};
