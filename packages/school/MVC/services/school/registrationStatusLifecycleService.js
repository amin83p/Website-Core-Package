const schoolRepositories = require('../../repositories/school');
const classEnrollmentReadService = require('./classEnrollmentReadService');
const registrationFinanceLifecycleService = require('./registrationFinanceLifecycleService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const { resolveOrgTodayFromContext } = requireCoreModule('MVC/utils/timezoneUtils');

const TERMINAL_STATUSES = new Set(['withdrawn', 'cancelled', 'completed', 'archived', 'rolled_back', 'void']);
const OPEN_CLASS_STATUSES = new Set(['active', 'planned']);

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function todayISO(orgToday = '', options = {}) {
  return resolveOrgTodayFromContext({
    orgToday: orgToday || options.orgToday || options.requestingUser?.orgToday,
    user: options.requestingUser
  });
}

function actorId(options = {}) {
  const user = options.requestingUser || options.reqUser || {};
  return toPublicId(user.id || user.personId) || String(user.username || 'system').trim() || 'system';
}

function repositoryFor(registrationType) {
  if (registrationType === 'program') return schoolRepositories.studentProgramRegistrations;
  if (registrationType === 'term') return schoolRepositories.studentTermRegistrations;
  if (registrationType === 'class') return schoolRepositories.classEnrollmentPeriods;
  throw new Error('Registration type must be program, term, or class.');
}

function registrationHref(type, id, classId = '') {
  if (type === 'program') return `/school/programs/registrations/${encodeURIComponent(id)}`;
  if (type === 'term') return `/school/programs/term-registrations/${encodeURIComponent(id)}`;
  return classId
    ? `/school/classes/${encodeURIComponent(classId)}/rolling-enrollment`
    : '';
}

function currentCycle(summary = {}) {
  const cycles = Array.isArray(summary.postingCycles) ? summary.postingCycles : [];
  return cycles.find((row) => row.cycleNo === summary.activePostingCycleNo) || cycles[cycles.length - 1] || null;
}

function currentPostedTransactionIds(summary = {}) {
  const cycle = currentCycle(summary);
  if (cycle && normalizeStatus(cycle.status) === 'posted') {
    return Array.from(new Set((cycle.transactionIds || []).map(toPublicId).filter(Boolean)));
  }
  return Array.from(new Set((summary.postedTransactionIds || summary.transactionIds || []).map(toPublicId).filter(Boolean)));
}

function hasUnresolvedFinance(summary = {}) {
  return Boolean(
    (summary.unresolvedTransactionIds || []).length ||
    (summary.reconciliationIssues || []).length ||
    (summary.postingCycles || []).some((row) => ['error', 'reversal_error', 'reversing'].includes(normalizeStatus(row.status)))
  );
}

async function loadRegistration(type, registrationId, orgId, options = {}) {
  const repository = repositoryFor(type);
  const registration = await repository.getById(registrationId, options);
  if (!registration) throw new Error('Registration was not found.');
  if (!orgId || !idsEqual(registration.orgId, orgId)) {
    throw new Error('Registration is outside the active organization.');
  }
  return registration;
}

async function buildChildBlockers(type, registration, options = {}) {
  const blockers = [];
  if (type === 'program') {
    const terms = await schoolRepositories.studentTermRegistrations.list({
      ...options,
      query: { programRegistrationId__eq: registration.id, page: 1 },
      scope: { canViewAll: true }
    });
    (Array.isArray(terms) ? terms : [])
      .filter((row) => !TERMINAL_STATUSES.has(normalizeStatus(row.status)))
      .forEach((row) => blockers.push({
        registrationType: 'term',
        registrationId: toPublicId(row.id),
        status: normalizeStatus(row.status),
        href: registrationHref('term', row.id)
      }));

    const periods = await schoolRepositories.classEnrollmentPeriods.findByStudentId(registration.studentId, options);
    (Array.isArray(periods) ? periods : [])
      .filter((row) => idsEqual(row.orgId, registration.orgId))
      .filter((row) => idsEqual(row.programId, registration.programId))
      .filter((row) => OPEN_CLASS_STATUSES.has(normalizeStatus(row.status)))
      .forEach((row) => blockers.push({
        registrationType: 'class',
        registrationId: toPublicId(row.id),
        status: normalizeStatus(row.status),
        href: registrationHref('class', row.id, row.classId)
      }));
  }

  if (type === 'term') {
    const discovered = await classEnrollmentReadService.discoverClassEnrollmentRowsByRegistrationId({
      registrationId: registration.id,
      reqUser: options.requestingUser,
      activeOrgId: registration.orgId
    });
    const ids = new Set([
      ...((registration.classEnrollmentSummary?.rows || registration.rosterSummary?.rows || [])
        .map((row) => toPublicId(row?.enrollmentId || row?.id))
        .filter(Boolean)),
      ...((discovered.rows || []).map((row) => toPublicId(row?.enrollmentId)).filter(Boolean))
    ]);
    for (const enrollmentId of ids) {
      // eslint-disable-next-line no-await-in-loop
      const row = await schoolRepositories.classEnrollmentPeriods.getById(enrollmentId, options);
      if (!row || !OPEN_CLASS_STATUSES.has(normalizeStatus(row.status))) continue;
      blockers.push({
        registrationType: 'class',
        registrationId: toPublicId(row.id),
        status: normalizeStatus(row.status),
        href: registrationHref('class', row.id, row.classId)
      });
    }
  }

  const seen = new Set();
  return blockers.filter((row) => {
    const key = `${row.registrationType}:${row.registrationId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function assertTransitionAllowed(type, fromStatus, toStatus) {
  if (fromStatus === toStatus) return;
  if (TERMINAL_STATUSES.has(fromStatus)) {
    if (!(type === 'class' && toStatus === 'archived' && ['completed', 'withdrawn', 'cancelled'].includes(fromStatus))) {
      throw new Error('Terminal registrations cannot be reactivated or changed. Create a new registration for a returning student.');
    }
  }
  if (toStatus === 'withdrawn') {
    throw new Error('Withdrawal must use the withdrawal request and approval workflow.');
  }
  if (['draft', 'registered', 'active', 'planned'].includes(toStatus)) {
    throw new Error('Drafting and approval must use the registration draft/approval workflow.');
  }
  if (toStatus === 'archived' && type !== 'class') {
    throw new Error('Archival applies only to class enrollment periods.');
  }
  if (!['cancelled', 'completed', 'archived'].includes(toStatus)) {
    throw new Error('Unsupported registration status transition.');
  }
  if (['cancelled', 'completed'].includes(toStatus)) {
    const allowedSourceStatuses = type === 'class' ? ['active', 'planned'] : ['registered'];
    if (!allowedSourceStatuses.includes(fromStatus)) {
      throw new Error('Only an active posted registration can be cancelled or completed.');
    }
  }
}

async function loadSourceTransactions(transactionIds, options = {}) {
  const rows = [];
  for (const transactionId of transactionIds) {
    // eslint-disable-next-line no-await-in-loop
    const row = await schoolRepositories.globalTransactions.getById(transactionId, options);
    if (!row) throw new Error(`Registration transaction ${transactionId} was not found.`);
    rows.push({
      id: toPublicId(row.id),
      status: normalizeStatus(row.status),
      effectiveDate: String(row.effectiveDate || '').trim(),
      amount: Number(row.amount?.value || 0),
      currency: String(row.amount?.currency || '').trim().toUpperCase(),
      accountId: toPublicId(row.metadata?.accountId),
      memo: String(row.memo || '').trim()
    });
  }
  return rows;
}

async function previewTransition(input = {}, options = {}) {
  const registrationType = normalizeStatus(input.registrationType);
  const registrationId = toPublicId(input.registrationId);
  const targetStatus = normalizeStatus(input.targetStatus);
  const orgId = toPublicId(input.orgId);
  if (!registrationId) throw new Error('Registration id is required.');
  const registration = await loadRegistration(registrationType, registrationId, orgId, options);
  const currentStatus = normalizeStatus(registration.status);
  assertTransitionAllowed(registrationType, currentStatus, targetStatus);
  const transactionSummary = registrationFinanceLifecycleService.normalizeTransactionSummary(
    registration.transactionSummary,
    { registrationType, registrationId }
  );
  const blockers = ['cancelled', 'completed'].includes(targetStatus)
    ? await buildChildBlockers(registrationType, registration, options)
    : [];
  const transactionIds = currentPostedTransactionIds(transactionSummary);
  const sourceTransactions = targetStatus === 'cancelled'
    ? await loadSourceTransactions(transactionIds, options)
    : [];
  return {
    registrationType,
    registrationId,
    currentStatus,
    targetStatus,
    alreadyApplied: currentStatus === targetStatus,
    effectiveDate: String(input.effectiveDate || todayISO(input.orgToday, options)).trim(),
    reason: String(input.reason || '').trim(),
    blockers,
    canApply: blockers.length === 0 && !hasUnresolvedFinance(transactionSummary),
    unresolvedFinancialOperations: hasUnresolvedFinance(transactionSummary),
    sourceTransactions,
    adjustmentTotal: Number(sourceTransactions.reduce((sum, row) => sum + Number(row.amount || 0), 0).toFixed(2)),
    resultingChargeEffect: targetStatus === 'cancelled' ? 0 : null
  };
}

function appendLifecycleHistory(summary, transition, options = {}) {
  const rows = Array.isArray(summary.lifecycleStatusHistory) ? summary.lifecycleStatusHistory : [];
  return {
    ...summary,
    lifecycleStatusHistory: [...rows, {
      actor: actorId(options),
      timestamp: new Date().toISOString(),
      reason: transition.reason,
      oldStatus: transition.currentStatus,
      newStatus: transition.targetStatus,
      effectiveDate: transition.effectiveDate,
      postingCycle: Number(summary.activePostingCycleNo || 0),
      financialSnapshot: {
        transactionIds: currentPostedTransactionIds(summary),
        reversalIds: Array.isArray(summary.reversalIds) ? summary.reversalIds : [],
        total: Number(transition.adjustmentTotal || 0)
      }
    }].slice(-100)
  };
}

async function applyTransition(input = {}, options = {}) {
  const reason = String(input.reason || '').trim();
  const effectiveDate = String(input.effectiveDate || '').trim();
  if (!reason) throw new Error('A reason is required to change registration status.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) throw new Error('Effective date is required in YYYY-MM-DD format.');
  const preview = await previewTransition({ ...input, reason, effectiveDate }, options);
  if (preview.alreadyApplied) {
    const registration = await loadRegistration(preview.registrationType, preview.registrationId, input.orgId, options);
    return { ...preview, canApply: true, registration, transactionSummary: registration.transactionSummary || {} };
  }
  if (!preview.canApply) {
    const message = preview.blockers.length
      ? 'Resolve the listed child registrations before changing this registration status.'
      : 'Resolve the registration financial reconciliation issues before changing status.';
    const error = new Error(message);
    error.preview = preview;
    throw error;
  }

  const repository = repositoryFor(preview.registrationType);
  const registration = await loadRegistration(preview.registrationType, preview.registrationId, input.orgId, options);
  let summary = registrationFinanceLifecycleService.normalizeTransactionSummary(
    registration.transactionSummary,
    { registrationType: preview.registrationType, registrationId: preview.registrationId }
  );
  const pendingTransition = {
    fromStatus: preview.currentStatus,
    toStatus: preview.targetStatus,
    effectiveDate,
    reason,
    requestedAt: new Date().toISOString(),
    requestedBy: actorId(options),
    status: 'applying',
    issues: []
  };
  summary = { ...summary, pendingTransition };

  if (preview.targetStatus === 'cancelled') {
    const transactionIds = currentPostedTransactionIds(summary);
    const reconciliation = await registrationFinanceLifecycleService.reconcileTransactions({
      transactionIds,
      registrationType: preview.registrationType,
      registrationId: preview.registrationId,
      orgId: registration.orgId,
      transactionSummary: summary,
      effectiveDate,
      reason,
      createMissing: true,
      options
    });
    const cycle = currentCycle(summary);
    if (cycle) {
      summary = registrationFinanceLifecycleService.updatePostingCycle(summary, cycle.cycleNo, {
        ...cycle,
        status: reconciliation.issues.length ? 'reversal_error' : 'reversed',
        reversedAt: reconciliation.issues.length ? '' : new Date().toISOString(),
        reversalIds: reconciliation.reversalIds,
        unresolvedTransactionIds: reconciliation.unresolvedTransactionIds,
        issues: reconciliation.issues
      }, { registrationType: preview.registrationType, registrationId: preview.registrationId });
    }
    if (reconciliation.issues.length) {
      summary = {
        ...summary,
        pendingTransition: { ...pendingTransition, status: 'error', issues: reconciliation.issues },
        reconciliationIssues: reconciliation.issues,
        unresolvedTransactionIds: reconciliation.unresolvedTransactionIds
      };
      await repository.update(preview.registrationId, { ...registration, transactionSummary: summary }, options);
      const error = new Error(`Cancellation reconciliation failed: ${reconciliation.issues.join(' | ')}`);
      error.preview = preview;
      throw error;
    }
  }

  summary = appendLifecycleHistory({
    ...summary,
    pendingTransition: null,
    reconciliationIssues: [],
    unresolvedTransactionIds: []
  }, preview, options);
  const patch = {
    ...registration,
    status: preview.targetStatus,
    transactionSummary: summary,
    note: [registration.note, `${preview.targetStatus} effective ${effectiveDate}: ${reason}`].filter(Boolean).join(' | ')
  };
  if (preview.registrationType === 'class') {
    if (preview.targetStatus !== 'archived') patch.endDate = effectiveDate;
    patch.reasonEnd = reason;
  }
  const updated = await repository.update(preview.registrationId, patch, options);
  return { ...preview, canApply: true, registration: updated, transactionSummary: summary };
}

module.exports = {
  TERMINAL_STATUSES,
  previewTransition,
  applyTransition,
  currentPostedTransactionIds,
  buildChildBlockers
};
