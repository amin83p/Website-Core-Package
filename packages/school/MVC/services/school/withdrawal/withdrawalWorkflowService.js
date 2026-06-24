const { requireCoreModule } = require('../schoolCoreContracts');
const schoolDataService = require('../schoolDataService');
const schoolRepositories = require('../../../repositories/school');
const withdrawalRepository = require('../../../repositories/school/withdrawalRepository');
const adminChekersService = requireCoreModule('MVC/services/adminChekersService');
const { SECTIONS, OPERATIONS } = requireCoreModule('config/accessConstants');
const classWithdrawalService = require('./classWithdrawalService');
const termWithdrawalService = require('./termWithdrawalService');
const programWithdrawalService = require('./programWithdrawalService');
const withdrawalPolicyService = require('./withdrawalPolicyService');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const PENDING_STATUSES = new Set(['draft', 'submitted', 'pending_approval', 'pending_program_admin_approval']);
const ACTIVE_REQUEST_STATUSES = new Set(['draft', 'submitted', 'pending_approval', 'pending_program_admin_approval', 'processing']);

function appendNotes(existing, addition) {
  const base = String(existing || '').trim();
  const next = String(addition || '').trim();
  if (!next) return base;
  if (!base) return next;
  return `${base}\n${next}`;
}

function isPrivilegedFinalizer(reqUser) {
  return adminChekersService.isAdminForRequest(reqUser, SECTIONS.SCHOOL_WITHDRAWAL, OPERATIONS.UPDATE, {
    orgId: reqUser?.activeOrgId,
    section: { id: SECTIONS.SCHOOL_WITHDRAWAL, category: 'SCHOOL' }
  });
}

async function resolveProgramAdministratorPersonIdFromWithdrawal(withdrawal) {
  const fromPlan = toPublicId(withdrawal?.resolutionPlan?.programAdministratorPersonId || '');
  if (fromPlan) return fromPlan;

  let programId = toPublicId(withdrawal?.programId || '');
  if (!programId) {
    const programRegistrationId = toPublicId(withdrawal?.programRegistrationId || '');
    if (programRegistrationId) {
      const programRegistration = await schoolRepositories.studentProgramRegistrations.getById(programRegistrationId);
      programId = toPublicId(programRegistration?.programId || '');
    }
  }
  if (!programId) {
    const termRegistrationId = toPublicId(withdrawal?.termRegistrationId || '');
    if (termRegistrationId) {
      const termRegistration = await schoolRepositories.studentTermRegistrations.getById(termRegistrationId);
      programId = toPublicId(termRegistration?.programId || '');
    }
  }
  if (!programId) return '';

  const program = await schoolRepositories.programs.getById(programId);
  return toPublicId(program?.programAdministratorPersonId || '');
}

async function canManagePendingWithdrawal(withdrawal, reqUser) {
  const privileged = isPrivilegedFinalizer(reqUser);
  if (privileged) {
    return {
      canManage: true,
      isPrivileged: true,
      isProgramAdministrator: false,
      programAdministratorPersonId: toPublicId(withdrawal?.resolutionPlan?.programAdministratorPersonId || '')
    };
  }

  const userPersonId = toPublicId(reqUser?.personId || '');
  const programAdministratorPersonId = await resolveProgramAdministratorPersonIdFromWithdrawal(withdrawal);
  const isProgramAdministrator = Boolean(
    userPersonId &&
    programAdministratorPersonId &&
    idsEqual(userPersonId, programAdministratorPersonId)
  );

  return {
    canManage: isProgramAdministrator,
    isPrivileged: false,
    isProgramAdministrator,
    programAdministratorPersonId
  };
}

function resolveInitiatorType(student, reqUser) {
  if (idsEqual(student?.personId, reqUser?.personId)) return 'student';
  return 'admin';
}

function buildDuplicateRequestError(type, existingId) {
  const scopeLabel = String(type || 'withdrawal').toLowerCase();
  const normalizedExistingId = String(existingId || '').trim();
  const err = new Error(`An active ${scopeLabel} withdrawal request already exists (${normalizedExistingId}). Please review/finalize/reject it before creating another request.`);
  err.code = 'DUPLICATE_ACTIVE_WITHDRAWAL_REQUEST';
  err.details = {
    type: scopeLabel,
    existingRequestId: normalizedExistingId,
    detailUrl: normalizedExistingId ? `/school/withdrawal/detail/${encodeURIComponent(normalizedExistingId)}` : '',
    listUrl: '/school/withdrawal/list'
  };
  return err;
}

async function findSimilarActiveRequest({
  type,
  orgId,
  studentId,
  classId,
  termRegistrationId,
  programRegistrationId,
  classEnrollmentId,
  excludeId = ''
}) {
  const normalizedOrgId = toPublicId(orgId || '');
  const normalizedStudentId = toPublicId(studentId || '');
  const normalizedType = String(type || '').trim().toLowerCase();
  if (!normalizedOrgId || !normalizedStudentId || !normalizedType) return null;

  const rows = await withdrawalRepository.getWithdrawalsByOrg(normalizedOrgId, {
    type: normalizedType,
    studentId: normalizedStudentId
  });

  const normalizedExcludeId = toPublicId(excludeId || '');
  const normalizedClassId = toPublicId(classId || '');
  const normalizedTermRegistrationId = toPublicId(termRegistrationId || '');
  const normalizedProgramRegistrationId = toPublicId(programRegistrationId || '');
  const normalizedClassEnrollmentId = toPublicId(classEnrollmentId || '');

  return (Array.isArray(rows) ? rows : []).find((row) => {
    if (!row) return false;
    if (normalizedExcludeId && idsEqual(row?.id, normalizedExcludeId)) return false;
    if (!ACTIVE_REQUEST_STATUSES.has(String(row.status || '').toLowerCase())) return false;

    if (normalizedType === 'program') {
      return normalizedProgramRegistrationId && idsEqual(row?.programRegistrationId, normalizedProgramRegistrationId);
    }
    if (normalizedType === 'term') {
      return normalizedTermRegistrationId && idsEqual(row?.termRegistrationId, normalizedTermRegistrationId);
    }
    if (normalizedType === 'class') {
      if (normalizedClassEnrollmentId && idsEqual(row?.classEnrollmentId, normalizedClassEnrollmentId)) return true;
      if (!normalizedClassId || !idsEqual(row?.classId, normalizedClassId)) return false;
      if (normalizedTermRegistrationId && !idsEqual(row?.termRegistrationId, normalizedTermRegistrationId)) return false;
      return true;
    }

    return false;
  }) || null;
}

async function resolveContextForClass({ classId, termRegistrationId, studentId, reqUser }) {
  let termRegistration = null;
  let program = null;
  let classItem = null;
  let student = null;

  if (termRegistrationId) {
    termRegistration = await schoolRepositories.studentTermRegistrations.getById(termRegistrationId);
    if (termRegistration?.programId) {
      program = await schoolDataService.getDataById('programs', termRegistration.programId, reqUser);
    }
  }

  if (classId) {
    classItem = await schoolDataService.getDataById('classes', classId, reqUser);
  }
  if (studentId) {
    student = await schoolDataService.getDataById('students', studentId, reqUser);
  }

  return {
    classItem,
    termRegistration,
    program,
    student,
    programId: toPublicId(program?.id || termRegistration?.programId || ''),
    termId: toPublicId(termRegistration?.termId || ''),
    programAdministratorPersonId: toPublicId(program?.programAdministratorPersonId || '')
  };
}

async function resolveContextForTerm({ termRegistrationId, reqUser }) {
  const { termRegistration, program, student, termRow } = await termWithdrawalService.getTermRegistrationWithDetails(
    termRegistrationId,
    reqUser
  );
  return {
    termRegistration,
    program,
    student,
    termRow,
    programId: toPublicId(program?.id || termRegistration?.programId || ''),
    termId: toPublicId(termRegistration?.termId || ''),
    programAdministratorPersonId: toPublicId(program?.programAdministratorPersonId || '')
  };
}

async function resolveContextForProgram({ programRegistrationId, reqUser }) {
  const { programRegistration, program, student } = await programWithdrawalService.getProgramRegistrationWithDetails(
    programRegistrationId,
    reqUser
  );
  return {
    programRegistration,
    program,
    student,
    programId: toPublicId(program?.id || programRegistration?.programId || ''),
    programAdministratorPersonId: toPublicId(program?.programAdministratorPersonId || '')
  };
}

function resolveFinalizationRule(reqUser, context = {}) {
  if (isPrivilegedFinalizer(reqUser)) {
    return {
      canFinalizeNow: true,
      finalizeMode: 'admin_bypass',
      queueStatus: ''
    };
  }

  const userPersonId = toPublicId(reqUser?.personId || '');
  const adminPersonId = toPublicId(context?.programAdministratorPersonId || '');
  if (userPersonId && adminPersonId && idsEqual(userPersonId, adminPersonId)) {
    return {
      canFinalizeNow: true,
      finalizeMode: 'program_admin',
      queueStatus: ''
    };
  }

  return {
    canFinalizeNow: false,
    finalizeMode: 'requires_review',
    queueStatus: adminPersonId ? 'pending_program_admin_approval' : 'pending_approval'
  };
}

function ensurePreviewIsRunnable(preview) {
  if (!preview) throw new Error('Unable to create a withdrawal preview.');
  if (preview.canProceed) return;

  const issues = Array.isArray(preview.issues) ? preview.issues : [];
  if (!issues.length) throw new Error('Withdrawal cannot proceed.');
  throw new Error(issues.join(' '));
}

async function createPendingWithdrawalRecord({
  type,
  payload,
  preview,
  reqUser,
  context,
  queueStatus
}) {
  const studentId = toPublicId(
    payload.studentId ||
    preview.studentId ||
    context?.student?.id ||
    context?.termRegistration?.studentId ||
    context?.programRegistration?.studentId ||
    ''
  );
  if (!studentId) throw new Error('Student id is required.');

  const student = context?.student || await schoolDataService.getDataById('students', studentId, reqUser);
  if (!student) throw new Error('Student not found.');

  const duplicate = await findSimilarActiveRequest({
    type,
    orgId: toPublicId(student?.orgId || reqUser?.activeOrgId || ''),
    studentId,
    classId: toPublicId(payload.classId || context?.classItem?.id || ''),
    termRegistrationId: toPublicId(payload.termRegistrationId || context?.termRegistration?.id || ''),
    programRegistrationId: toPublicId(payload.programRegistrationId || context?.programRegistration?.id || ''),
    classEnrollmentId: toPublicId(payload.classEnrollmentId || ''),
    excludeId: toPublicId(payload.existingWithdrawalId || '')
  });
  if (duplicate) {
    throw buildDuplicateRequestError(type, toPublicId(duplicate.id) || duplicate.id);
  }

  const nowDate = withdrawalPolicyService.todayISO();
  const internalLines = [];
  internalLines.push(`Request submitted by ${toPublicId(reqUser?.id) || 'unknown'} (${reqUser?.username || 'n/a'}).`);
  if (queueStatus === 'pending_program_admin_approval' && context?.programAdministratorPersonId) {
    internalLines.push(`Program admin approval required: person ${context.programAdministratorPersonId}.`);
  }
  if (Array.isArray(preview?.warnings) && preview.warnings.length) {
    internalLines.push(`Preview warnings: ${preview.warnings.join(' | ')}`);
  }

  const record = await withdrawalRepository.addWithdrawal({
    orgId: toPublicId(student.orgId || reqUser?.activeOrgId || ''),
    type,
    status: queueStatus || 'pending_approval',
    studentId,
    personId: toPublicId(student.personId || ''),
    reason: payload.reason || 'other',
    reasonDetail: String(payload.reasonDetail || '').trim(),
    initiatorType: resolveInitiatorType(student, reqUser),
    initiatorId: toPublicId(reqUser?.id || ''),
    requestDate: nowDate,
    effectiveDate: payload.effectiveDate || nowDate,
    approvedDate: '',
    completedDate: '',
    approvedBy: '',
    processedBy: '',
    programRegistrationId: toPublicId(payload.programRegistrationId || context?.programRegistration?.id || ''),
    termRegistrationId: toPublicId(payload.termRegistrationId || context?.termRegistration?.id || ''),
    classEnrollmentId: toPublicId(payload.classEnrollmentId || ''),
    classId: toPublicId(payload.classId || context?.classItem?.id || ''),
    programId: toPublicId(payload.programId || context?.programId || ''),
    termId: toPublicId(payload.termId || context?.termId || ''),
    financialImpact: {
      ...(preview?.financialImpact || {}),
      refundAmount: Number(preview?.financialImpact?.refundAmount || preview?.financialImpact?.totalRefund || 0),
      penaltyAmount: Number(preview?.financialImpact?.penaltyAmount || preview?.financialImpact?.totalPenalty || 0),
      totalAmount: Number(preview?.financialImpact?.refundAmount || preview?.financialImpact?.totalRefund || 0)
    },
    academicImpact: { ...(preview?.academicImpact || {}) },
    notes: String(payload.reasonDetail || '').trim(),
    internalNotes: internalLines.join('\n'),
    warnings: Array.isArray(preview?.warnings) ? preview.warnings : [],
    errors: Array.isArray(preview?.issues) ? preview.issues : [],
    resolutionPlan: {
      workflowVersion: 'withdrawal-v2',
      submittedByUserId: toPublicId(reqUser?.id || ''),
      queueStatus: queueStatus || 'pending_approval',
      finalizeMode: 'awaiting_review',
      programAdministratorPersonId: toPublicId(context?.programAdministratorPersonId || '')
    },
    audit: { createUser: toPublicId(reqUser?.id || '') }
  });

  return record;
}

function buildNonAdminFinalizeNote(reqUser, context = {}) {
  const userId = toPublicId(reqUser?.id || '');
  const username = String(reqUser?.username || '').trim();
  const personId = toPublicId(reqUser?.personId || '');
  const programAdminPersonId = toPublicId(context?.programAdministratorPersonId || '');
  return `Finalized by non-admin user ${userId || 'unknown'} (${username || 'n/a'}), person ${personId || 'n/a'}, as program administrator ${programAdminPersonId || 'n/a'}.`;
}

async function submitOrExecuteClass(payload, reqUser) {
  const preview = await classWithdrawalService.previewClassWithdrawal({
    classId: payload.classId,
    studentId: payload.studentId,
    termRegistrationId: payload.termRegistrationId,
    reason: payload.reason,
    effectiveDate: payload.effectiveDate,
    reqUser
  });
  ensurePreviewIsRunnable(preview);

  const context = await resolveContextForClass({
    classId: payload.classId,
    termRegistrationId: payload.termRegistrationId,
    studentId: payload.studentId,
    reqUser
  });

  if (!payload.existingWithdrawalId) {
    const duplicate = await findSimilarActiveRequest({
      type: 'class',
      orgId: toPublicId(context?.student?.orgId || reqUser?.activeOrgId || ''),
      studentId: toPublicId(payload.studentId || preview.studentId || context?.student?.id || ''),
      classId: toPublicId(payload.classId || context?.classItem?.id || ''),
      termRegistrationId: toPublicId(payload.termRegistrationId || context?.termRegistration?.id || ''),
      classEnrollmentId: toPublicId(payload.classEnrollmentId || ''),
      excludeId: toPublicId(payload.existingWithdrawalId || '')
    });
    if (duplicate) throw buildDuplicateRequestError('class', toPublicId(duplicate.id) || duplicate.id);
  }
  const rule = resolveFinalizationRule(reqUser, context);

  if (!rule.canFinalizeNow) {
    if (payload.existingWithdrawalId) {
      throw new Error('You are not allowed to finalize this withdrawal request.');
    }
    const queued = await createPendingWithdrawalRecord({
      type: 'class',
      payload,
      preview,
      reqUser,
      context,
      queueStatus: rule.queueStatus
    });
    return {
      success: true,
      queued: true,
      message: 'Withdrawal request submitted for review.',
      withdrawal: queued,
      preview
    };
  }

  const internalNote = rule.finalizeMode === 'program_admin' ? buildNonAdminFinalizeNote(reqUser, context) : '';
  return await classWithdrawalService.executeClassWithdrawal({
    classId: payload.classId,
    studentId: payload.studentId,
    termRegistrationId: payload.termRegistrationId,
    reason: payload.reason,
    reasonDetail: payload.reasonDetail,
    effectiveDate: payload.effectiveDate,
    initiatorType: resolveInitiatorType(context?.student, reqUser),
    initiatorId: toPublicId(reqUser?.id || ''),
    reqUser,
    existingWithdrawalId: toPublicId(payload.existingWithdrawalId || ''),
    additionalInternalNote: internalNote
  });
}

async function submitOrExecuteTerm(payload, reqUser) {
  const preview = await termWithdrawalService.previewTermWithdrawal({
    termRegistrationId: payload.termRegistrationId,
    reason: payload.reason,
    effectiveDate: payload.effectiveDate,
    reqUser
  });
  ensurePreviewIsRunnable(preview);

  const context = await resolveContextForTerm({ termRegistrationId: payload.termRegistrationId, reqUser });
  if (!payload.existingWithdrawalId) {
    const duplicate = await findSimilarActiveRequest({
      type: 'term',
      orgId: toPublicId(context?.student?.orgId || reqUser?.activeOrgId || ''),
      studentId: toPublicId(context?.student?.id || ''),
      termRegistrationId: toPublicId(payload.termRegistrationId || context?.termRegistration?.id || ''),
      programRegistrationId: toPublicId(context?.termRegistration?.programRegistrationId || ''),
      excludeId: toPublicId(payload.existingWithdrawalId || '')
    });
    if (duplicate) throw buildDuplicateRequestError('term', toPublicId(duplicate.id) || duplicate.id);
  }
  const rule = resolveFinalizationRule(reqUser, context);

  if (!rule.canFinalizeNow) {
    if (payload.existingWithdrawalId) {
      throw new Error('You are not allowed to finalize this withdrawal request.');
    }
    const queued = await createPendingWithdrawalRecord({
      type: 'term',
      payload,
      preview,
      reqUser,
      context,
      queueStatus: rule.queueStatus
    });
    return {
      success: true,
      queued: true,
      message: 'Withdrawal request submitted for review.',
      withdrawal: queued,
      preview
    };
  }

  const internalNote = rule.finalizeMode === 'program_admin' ? buildNonAdminFinalizeNote(reqUser, context) : '';
  return await termWithdrawalService.executeTermWithdrawal({
    termRegistrationId: payload.termRegistrationId,
    reason: payload.reason,
    reasonDetail: payload.reasonDetail,
    effectiveDate: payload.effectiveDate,
    withdrawClasses: payload.withdrawClasses !== false,
    initiatorType: resolveInitiatorType(context?.student, reqUser),
    initiatorId: toPublicId(reqUser?.id || ''),
    reqUser,
    existingWithdrawalId: toPublicId(payload.existingWithdrawalId || ''),
    additionalInternalNote: internalNote
  });
}

async function submitOrExecuteProgram(payload, reqUser) {
  const preview = await programWithdrawalService.previewProgramWithdrawal({
    programRegistrationId: payload.programRegistrationId,
    reason: payload.reason,
    effectiveDate: payload.effectiveDate,
    reqUser
  });

  const context = await resolveContextForProgram({ programRegistrationId: payload.programRegistrationId, reqUser });
  if (!payload.existingWithdrawalId) {
    const duplicate = await findSimilarActiveRequest({
      type: 'program',
      orgId: toPublicId(context?.student?.orgId || reqUser?.activeOrgId || ''),
      studentId: toPublicId(context?.student?.id || ''),
      programRegistrationId: toPublicId(payload.programRegistrationId || context?.programRegistration?.id || ''),
      excludeId: toPublicId(payload.existingWithdrawalId || '')
    });
    if (duplicate) throw buildDuplicateRequestError('program', toPublicId(duplicate.id) || duplicate.id);
  }
  const rule = resolveFinalizationRule(reqUser, context);

  // Policy: Program withdrawal is always request-first.
  if (!payload.existingWithdrawalId) {
    const queued = await createPendingWithdrawalRecord({
      type: 'program',
      payload,
      preview,
      reqUser,
      context,
      queueStatus: rule.queueStatus || 'pending_approval'
    });
    return {
      success: true,
      queued: true,
      message: 'Program withdrawal request submitted for review.',
      withdrawal: queued,
      preview
    };
  }

  if (!rule.canFinalizeNow) {
    throw new Error('You are not allowed to finalize this withdrawal request.');
  }

  ensurePreviewIsRunnable(preview);

  const internalNote = rule.finalizeMode === 'program_admin' ? buildNonAdminFinalizeNote(reqUser, context) : '';
  const manualSettlementRows = Array.isArray(payload?.manualSettlementRows) ? payload.manualSettlementRows : [];
  const settlementNote = String(payload?.settlementNote || '').trim();
  const executionOptions = {};
  if (manualSettlementRows.length) executionOptions.manualSettlementRows = manualSettlementRows;
  return await programWithdrawalService.executeProgramWithdrawal({
    programRegistrationId: payload.programRegistrationId,
    reason: payload.reason,
    reasonDetail: payload.reasonDetail,
    effectiveDate: payload.effectiveDate,
    withdrawTerms: payload.withdrawTerms !== false,
    withdrawClasses: payload.withdrawClasses !== false,
    initiatorType: resolveInitiatorType(context?.student, reqUser),
    initiatorId: toPublicId(reqUser?.id || ''),
    reqUser,
    options: executionOptions,
    existingWithdrawalId: toPublicId(payload.existingWithdrawalId || ''),
    additionalInternalNote: appendNotes(internalNote, settlementNote)
  });
}

async function finalizePendingWithdrawal(withdrawalId, payload, reqUser) {
  const existing = await withdrawalRepository.getWithdrawalById(withdrawalId);
  if (!existing) throw new Error('Withdrawal request not found.');
  if (!PENDING_STATUSES.has(String(existing.status || '').toLowerCase())) {
    throw new Error('Only pending withdrawal requests can be finalized.');
  }

  const manageAccess = await canManagePendingWithdrawal(existing, reqUser);
  if (!manageAccess.canManage) {
    throw new Error('Only administrators, superusers, or the assigned program administrator can manage this request.');
  }

  const mergedPayload = {
    reason: payload?.reason || existing.reason || 'other',
    reasonDetail: payload?.reasonDetail || existing.reasonDetail || '',
    effectiveDate: payload?.effectiveDate || existing.effectiveDate || withdrawalPolicyService.todayISO(),
    existingWithdrawalId: existing.id,
    manualSettlementRows: Array.isArray(payload?.manualSettlementRows) ? payload.manualSettlementRows : [],
    settlementNote: String(payload?.settlementNote || '').trim()
  };

  if (existing.type === 'class') {
    return await submitOrExecuteClass({
      ...mergedPayload,
      classId: existing.classId,
      studentId: existing.studentId,
      termRegistrationId: existing.termRegistrationId,
      classEnrollmentId: existing.classEnrollmentId
    }, reqUser);
  }
  if (existing.type === 'term') {
    return await submitOrExecuteTerm({
      ...mergedPayload,
      termRegistrationId: existing.termRegistrationId,
      withdrawClasses: payload?.withdrawClasses !== false
    }, reqUser);
  }
  if (existing.type === 'program') {
    return await submitOrExecuteProgram({
      ...mergedPayload,
      programRegistrationId: existing.programRegistrationId,
      withdrawTerms: payload?.withdrawTerms !== false,
      withdrawClasses: payload?.withdrawClasses !== false
    }, reqUser);
  }

  throw new Error(`Unsupported withdrawal type: ${existing.type}`);
}

async function rejectPendingWithdrawal(withdrawalId, payload, reqUser) {
  const existing = await withdrawalRepository.getWithdrawalById(withdrawalId);
  if (!existing) throw new Error('Withdrawal request not found.');
  if (!PENDING_STATUSES.has(String(existing.status || '').toLowerCase())) {
    throw new Error('Only pending withdrawal requests can be rejected.');
  }

  const manageAccess = await canManagePendingWithdrawal(existing, reqUser);
  if (!manageAccess.canManage) {
    throw new Error('Only administrators, superusers, or the assigned program administrator can reject this request.');
  }

  const reviewerId = toPublicId(reqUser?.id || '');
  const reviewerLabel = `${reviewerId || 'unknown'} (${reqUser?.username || 'n/a'})`;
  const reviewNote = appendNotes(
    existing.internalNotes,
    `Request rejected by ${reviewerLabel}${payload?.note ? `: ${String(payload.note).trim()}` : '.'}`
  );

  return await withdrawalRepository.updateWithdrawal(existing.id, {
    status: 'rejected',
    approvedDate: withdrawalPolicyService.todayISO(),
    approvedBy: reviewerId,
    processedBy: reviewerId,
    internalNotes: reviewNote,
    errors: [],
    audit: { lastUpdateUser: reviewerId }
  });
}

module.exports = {
  submitOrExecuteClass,
  submitOrExecuteTerm,
  submitOrExecuteProgram,
  canManagePendingWithdrawal,
  finalizePendingWithdrawal,
  rejectPendingWithdrawal
};
