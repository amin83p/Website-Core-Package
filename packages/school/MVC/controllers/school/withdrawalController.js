// MVC/controllers/school/withdrawalController.js

const schoolDataService = require('../../services/school/schoolDataService');
const schoolRepositories = require('../../repositories/school');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');
const {
  withdrawalPolicyService,
  classWithdrawalService,
  termWithdrawalService,
  programWithdrawalService,
  withdrawalSettlementService,
  withdrawalWorkflowService
} = require('../../services/school/withdrawal');
const withdrawalRepository = require('../../repositories/school/withdrawalRepository');

const PENDING_STATUSES = new Set(['draft', 'submitted', 'pending_approval', 'pending_program_admin_approval']);

function getActiveOrgId(req) {
  return req.user?.activeOrganization?.id || req.user?.activeOrgId || '';
}

function sendGuardedResponse(res, guardResult, duplicateMessage, duplicateStatus = 409) {
  if (!guardResult || guardResult.status === 'acquired') return false;
  if (guardResult.status === 'busy') {
    return res.status(duplicateStatus).json({
      status: 'warning',
      message: duplicateMessage,
      idempotency: {
        state: 'busy',
        retryAfterMs: Number(guardResult.retryAfterMs || 0)
      }
    });
  }
  if (guardResult.status === 'replay') {
    const payload = guardResult.payload && typeof guardResult.payload === 'object'
      ? { ...guardResult.payload }
      : { status: 'success' };
    payload.idempotency = { state: 'replayed' };
    return res.json(payload);
  }
  return false;
}

function sendApiError(res, error, status = 400) {
  return res.status(status).json({
    status: 'error',
    message: error?.message || 'Request failed.',
    code: String(error?.code || '').trim() || undefined,
    details: error?.details || undefined
  });
}

function isManagePermissionError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('only administrators, superusers, or the assigned program administrator');
}

async function showDashboard(req, res) {
  try {
    const orgId = getActiveOrgId(req);
    const withdrawals = await withdrawalRepository.getWithdrawalsByOrg(orgId, {});
    
    const recentWithdrawals = withdrawals
      .sort((a, b) => new Date(b.audit?.createDateTime || 0) - new Date(a.audit?.createDateTime || 0))
      .slice(0, 10);

    const stats = {
      total: withdrawals.length,
      pending: withdrawals.filter(w => ['draft', 'submitted', 'pending_approval', 'pending_program_admin_approval'].includes(w.status)).length,
      completed: withdrawals.filter(w => w.status === 'completed').length,
      byType: {
        class: withdrawals.filter(w => w.type === 'class').length,
        term: withdrawals.filter(w => w.type === 'term').length,
        program: withdrawals.filter(w => w.type === 'program').length
      }
    };

    res.render('school/withdrawal/dashboard', {
      title: 'Withdrawal Management',
      withdrawals: recentWithdrawals,
      stats,
      reasons: withdrawalPolicyService.getWithdrawalReasons(),
      user: req.user
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function showWithdrawalList(req, res) {
  try {
    const orgId = getActiveOrgId(req);
    const { type, status, studentId } = req.query;
    
    const filters = {};
    if (type) filters.type = type;
    if (status) filters.status = status;
    if (studentId) filters.studentId = studentId;

    const withdrawals = await withdrawalRepository.getWithdrawalsByOrg(orgId, filters);

    res.render('school/withdrawal/list', {
      title: 'Withdrawal Records',
      withdrawals: withdrawals.sort((a, b) => 
        new Date(b.audit?.createDateTime || 0) - new Date(a.audit?.createDateTime || 0)
      ),
      filters,
      reasons: withdrawalRepository.WITHDRAWAL_REASON_LABELS,
      user: req.user
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function showWithdrawalDetail(req, res) {
  try {
    const { id } = req.params;
    const orgId = getActiveOrgId(req);
    const withdrawal = await withdrawalRepository.getWithdrawalById(id);

    if (!withdrawal) {
      return res.status(404).render('error', { title: 'Not Found', message: 'Withdrawal not found', user: req.user });
    }

    if (String(withdrawal.orgId) !== String(orgId)) {
      return res.status(403).render('error', { title: 'Access Denied', message: 'You do not have access to this withdrawal record.', user: req.user });
    }

    const student = await schoolDataService.getDataById('students', withdrawal.studentId, req.user);
    
    let childWithdrawals = [];
    if (withdrawal.childWithdrawals?.length) {
      for (const childId of withdrawal.childWithdrawals) {
        const child = await withdrawalRepository.getWithdrawalById(childId);
        if (child && String(child.orgId) === String(orgId)) childWithdrawals.push(child);
      }
    }

    const isPendingRequest = PENDING_STATUSES.has(String(withdrawal.status || '').toLowerCase());
    let canManagePendingRequest = false;
    if (isPendingRequest) {
      const access = await withdrawalWorkflowService.canManagePendingWithdrawal(withdrawal, req.user);
      canManagePendingRequest = Boolean(access?.canManage);
    }

    res.render('school/withdrawal/detail', {
      title: 'Withdrawal Details',
      withdrawal,
      student,
      childWithdrawals,
      canManagePendingRequest,
      reasonLabels: withdrawalRepository.WITHDRAWAL_REASON_LABELS,
      actionStateId: req.actionStateId,
      user: req.user
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function showNewWithdrawalWizard(req, res) {
  try {
    res.render('school/withdrawal/wizard', {
      title: 'New Withdrawal',
      reasons: withdrawalPolicyService.getWithdrawalReasons(),
      orgToday: req.orgToday || req.user?.orgToday || '',
      actionStateId: req.actionStateId,
      user: req.user
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function apiGetStudentStatus(req, res) {
  try {
    const { studentId } = req.params;
    const orgId = getActiveOrgId(req);

    const status = await programWithdrawalService.getStudentWithdrawalStatus(studentId, orgId, req.user);
    if (!status) {
      return res.status(404).json({ status: 'error', message: 'Student not found' });
    }

    res.json({ status: 'success', result: status });
  } catch (error) {
    sendApiError(res, error, 500);
  }
}

async function showProgramFinalizeForm(req, res) {
  try {
    const { id } = req.params;
    const orgId = getActiveOrgId(req);
    const withdrawal = await withdrawalRepository.getWithdrawalById(id);

    if (!withdrawal) {
      return res.status(404).render('error', { title: 'Not Found', message: 'Withdrawal request not found.', user: req.user });
    }
    if (String(withdrawal.orgId) !== String(orgId)) {
      return res.status(403).render('error', { title: 'Access Denied', message: 'You do not have access to this withdrawal request.', user: req.user });
    }
    if (String(withdrawal.type || '').toLowerCase() !== 'program') {
      return res.status(400).render('error', { title: 'Invalid Request', message: 'Only program withdrawal requests use this finalization form.', user: req.user });
    }
    if (!PENDING_STATUSES.has(String(withdrawal.status || '').toLowerCase())) {
      return res.status(400).render('error', { title: 'Invalid Request', message: 'Only pending requests can be finalized.', user: req.user });
    }

    const manageAccess = await withdrawalWorkflowService.canManagePendingWithdrawal(withdrawal, req.user);
    if (!manageAccess?.canManage) {
      return res.status(403).render('error', {
        title: 'Access Denied',
        message: 'Only administrators, superusers, or the assigned program administrator can manage this request.',
        user: req.user
      });
    }

    const student = await schoolDataService.getDataById('students', withdrawal.studentId, req.user);
    const programRegistration = withdrawal.programRegistrationId
      ? await schoolRepositories.studentProgramRegistrations.getById(withdrawal.programRegistrationId)
      : null;
    const sourceTxIds = withdrawalSettlementService.asIdArray(programRegistration?.transactionSummary?.transactionIds);
    const sourceTransactions = [];
    for (const txId of sourceTxIds) {
      const tx = await schoolRepositories.globalTransactions.getById(txId);
      if (!tx) continue;
      if (String(tx.orgId || '') !== String(orgId)) continue;
      sourceTransactions.push(tx);
    }

    sourceTransactions.sort((a, b) => {
      const aDate = String(a.effectiveDate || a.postedAt || '');
      const bDate = String(b.effectiveDate || b.postedAt || '');
      return aDate.localeCompare(bDate);
    });

    res.render('school/withdrawal/programFinalize', {
      title: 'Finalize Program Withdrawal',
      withdrawal,
      student,
      programRegistration,
      sourceTransactions,
      actionStateId: req.actionStateId,
      user: req.user
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function apiPreviewClassWithdrawal(req, res) {
  try {
    const { classId, studentId, termRegistrationId, reason, effectiveDate } = req.body;

    const preview = await classWithdrawalService.previewClassWithdrawal({
      classId,
      studentId,
      termRegistrationId,
      reason,
      effectiveDate,
      reqUser: req.user
    });

    res.json({ status: 'success', result: preview });
  } catch (error) {
    sendApiError(res, error);
  }
}

async function apiExecuteClassWithdrawal(req, res) {
  let guardKey = '';
  try {
    const { classId, studentId, termRegistrationId, reason, reasonDetail, effectiveDate } = req.body;
    const orgId = String(getActiveOrgId(req) || '').trim();
    guardKey = idempotencyGuardService.createGuardKey([
      'withdrawal_class_execute',
      orgId,
      String(classId || '').trim(),
      String(studentId || '').trim(),
      String(termRegistrationId || '').trim(),
      String(effectiveDate || '').trim(),
      String(reason || '').trim()
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 120000,
      replayTtlMs: 15000
    });
    if (sendGuardedResponse(res, guardResult, 'Class withdrawal execution is already in progress. Please wait.')) return;

    const result = await withdrawalWorkflowService.submitOrExecuteClass({
      classId,
      studentId,
      termRegistrationId,
      reason,
      reasonDetail,
      effectiveDate
    }, req.user);

    const message = result.queued
      ? (result.message || 'Withdrawal request submitted for review.')
      : (result.errors?.join(', ') || result.message || '');
    const payloadOut = { status: result.success ? 'success' : 'error', result, message };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    sendApiError(res, error);
  }
}

async function apiPreviewTermWithdrawal(req, res) {
  try {
    const { termRegistrationId, reason, effectiveDate } = req.body;

    const preview = await termWithdrawalService.previewTermWithdrawal({
      termRegistrationId,
      reason,
      effectiveDate,
      reqUser: req.user
    });

    res.json({ status: 'success', result: preview });
  } catch (error) {
    sendApiError(res, error);
  }
}

async function apiExecuteTermWithdrawal(req, res) {
  let guardKey = '';
  try {
    const { termRegistrationId, reason, reasonDetail, effectiveDate, withdrawClasses = true } = req.body;
    const orgId = String(getActiveOrgId(req) || '').trim();
    guardKey = idempotencyGuardService.createGuardKey([
      'withdrawal_term_execute',
      orgId,
      String(termRegistrationId || '').trim(),
      String(effectiveDate || '').trim(),
      String(reason || '').trim(),
      Boolean(withdrawClasses)
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 120000,
      replayTtlMs: 15000
    });
    if (sendGuardedResponse(res, guardResult, 'Term withdrawal execution is already in progress. Please wait.')) return;

    const result = await withdrawalWorkflowService.submitOrExecuteTerm({
      termRegistrationId,
      reason,
      reasonDetail,
      effectiveDate,
      withdrawClasses
    }, req.user);

    const message = result.queued
      ? (result.message || 'Withdrawal request submitted for review.')
      : (result.errors?.join(', ') || result.message || '');
    const payloadOut = { status: result.success ? 'success' : 'error', result, message };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    sendApiError(res, error);
  }
}

async function apiPreviewProgramWithdrawal(req, res) {
  try {
    const { programRegistrationId, reason, effectiveDate } = req.body;

    const preview = await programWithdrawalService.previewProgramWithdrawal({
      programRegistrationId,
      reason,
      effectiveDate,
      reqUser: req.user
    });

    res.json({ status: 'success', result: preview });
  } catch (error) {
    sendApiError(res, error);
  }
}

async function apiExecuteProgramWithdrawal(req, res) {
  let guardKey = '';
  try {
    const { 
      programRegistrationId, 
      reason, 
      reasonDetail, 
      effectiveDate, 
      withdrawTerms = true, 
      withdrawClasses = true 
    } = req.body;
    const orgId = String(getActiveOrgId(req) || '').trim();
    guardKey = idempotencyGuardService.createGuardKey([
      'withdrawal_program_execute',
      orgId,
      String(programRegistrationId || '').trim(),
      String(effectiveDate || '').trim(),
      String(reason || '').trim(),
      Boolean(withdrawTerms),
      Boolean(withdrawClasses)
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 120000,
      replayTtlMs: 15000
    });
    if (sendGuardedResponse(res, guardResult, 'Program withdrawal execution is already in progress. Please wait.')) return;

    const result = await withdrawalWorkflowService.submitOrExecuteProgram({
      programRegistrationId,
      reason,
      reasonDetail,
      effectiveDate,
      withdrawTerms,
      withdrawClasses
    }, req.user);

    const message = result.queued
      ? (result.message || 'Withdrawal request submitted for review.')
      : (result.errors?.join(', ') || result.message || '');
    const payloadOut = { status: result.success ? 'success' : 'error', result, message };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    sendApiError(res, error);
  }
}

async function apiFinalizeWithdrawal(req, res) {
  let guardKey = '';
  try {
    const orgId = String(getActiveOrgId(req) || '').trim();
    const withdrawalId = String(req.params.id || '').trim();
    guardKey = idempotencyGuardService.createGuardKey([
      'withdrawal_finalize',
      orgId,
      withdrawalId,
      req.body || {}
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 120000,
      replayTtlMs: 15000
    });
    if (sendGuardedResponse(res, guardResult, 'Withdrawal finalization is already in progress. Please wait.')) return;

    const result = await withdrawalWorkflowService.finalizePendingWithdrawal(req.params.id, req.body || {}, req.user);
    const payloadOut = {
      status: result.success ? 'success' : 'error',
      result,
      message: result.errors?.join(', ') || result.message || ''
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    sendApiError(res, error, isManagePermissionError(error) ? 403 : 400);
  }
}

async function apiRejectWithdrawal(req, res) {
  let guardKey = '';
  try {
    const orgId = String(getActiveOrgId(req) || '').trim();
    const withdrawalId = String(req.params.id || '').trim();
    guardKey = idempotencyGuardService.createGuardKey([
      'withdrawal_reject',
      orgId,
      withdrawalId,
      req.body || {}
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 120000,
      replayTtlMs: 15000
    });
    if (sendGuardedResponse(res, guardResult, 'Withdrawal rejection is already in progress. Please wait.')) return;

    const result = await withdrawalWorkflowService.rejectPendingWithdrawal(req.params.id, req.body || {}, req.user);
    const payloadOut = {
      status: 'success',
      result,
      message: 'Withdrawal request rejected.'
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    sendApiError(res, error, isManagePermissionError(error) ? 403 : 400);
  }
}

async function apiGetWithdrawalReasons(req, res) {
  try {
    res.json({
      status: 'success',
      reasons: withdrawalPolicyService.getWithdrawalReasons(),
      refundPolicies: withdrawalPolicyService.getRefundPolicies(),
      gradeOptions: withdrawalPolicyService.getGradeOptions()
    });
  } catch (error) {
    sendApiError(res, error, 500);
  }
}

async function apiGetStudentEnrollments(req, res) {
  try {
    const { studentId } = req.params;
    const orgId = getActiveOrgId(req);
    const statusSnapshot = await programWithdrawalService.getStudentWithdrawalStatus(studentId, orgId, req.user);
    if (!statusSnapshot) {
      return res.status(404).json({ status: 'error', message: 'Student not found' });
    }

    res.json({
      status: 'success',
      result: {
      classes: statusSnapshot.classes || [],
      terms: statusSnapshot.terms || [],
      programs: statusSnapshot.programs || [],
      warnings: statusSnapshot.warnings || [],
      reviewRequired: Boolean(statusSnapshot.reviewRequired),
      orphanClassEnrollments: statusSnapshot.orphanClassEnrollments || []
      }
    });
  } catch (error) {
    sendApiError(res, error, 500);
  }
}

module.exports = {
  showDashboard,
  showWithdrawalList,
  showWithdrawalDetail,
  showProgramFinalizeForm,
  showNewWithdrawalWizard,
  apiGetStudentStatus,
  apiPreviewClassWithdrawal,
  apiExecuteClassWithdrawal,
  apiPreviewTermWithdrawal,
  apiExecuteTermWithdrawal,
  apiPreviewProgramWithdrawal,
  apiExecuteProgramWithdrawal,
  apiFinalizeWithdrawal,
  apiRejectWithdrawal,
  apiGetWithdrawalReasons,
  apiGetStudentEnrollments
};
