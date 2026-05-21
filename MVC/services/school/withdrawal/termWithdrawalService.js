// MVC/services/school/withdrawal/termWithdrawalService.js

const schoolDataService = require('../schoolDataService');
const schoolRepositories = require('../../../repositories/school');
const withdrawalPolicyService = require('./withdrawalPolicyService');
const classWithdrawalService = require('./classWithdrawalService');
const withdrawalSettlementService = require('./withdrawalSettlementService');
const withdrawalRepository = require('../../../repositories/school/withdrawalRepository');
const { idsEqual } = require('../../../utils/idAdapter');

function roundMoney(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(2));
}

function appendNotes(existing, addition) {
  const base = String(existing || '').trim();
  const next = String(addition || '').trim();
  if (!next) return base;
  if (!base) return next;
  return `${base}\n${next}`;
}

async function getTermRegistrationWithDetails(termRegistrationId, reqUser) {
  const termRegistration = await schoolRepositories.studentTermRegistrations.getById(termRegistrationId);
  if (!termRegistration) return { termRegistration: null, program: null, termRow: null, student: null };

  const program = await schoolDataService.getDataById('programs', termRegistration.programId, reqUser);
  const student = await schoolDataService.getDataById('students', termRegistration.studentId, reqUser);
  
  let termRow = null;
  if (program && Array.isArray(program.terms)) {
    termRow = program.terms.find(t => idsEqual(t.termId, termRegistration.termId));
  }

  return { termRegistration, program, termRow, student };
}

async function getActiveClassesForTermRegistration(termRegistrationId, studentId, reqUser) {
  const termRegistration = await schoolRepositories.studentTermRegistrations.getById(termRegistrationId);
  if (!termRegistration) return [];

  const programId = termRegistration.programId;
  const termId = termRegistration.termId;
  const activeClassEnrollments = await classWithdrawalService.getActiveClassEnrollmentsForStudent(
    studentId,
    termRegistration.orgId,
    reqUser
  );

  if (!activeClassEnrollments.length) return [];

  const classesResult = await schoolDataService.fetchData('classes', {}, reqUser);
  const classes = classesResult?.data || classesResult || [];
  const classMap = new Map((Array.isArray(classes) ? classes : []).map((row) => [String(row?.id || '').trim(), row]));

  return activeClassEnrollments.filter((enrollment) => {
    if (String(enrollment?.termRegistrationId || '').trim() === String(termRegistrationId || '').trim()) return true;
    const classItem = classMap.get(String(enrollment?.classId || '').trim());
    const allowedProgramTerms = Array.isArray(classItem?.allowedProgramTerms) ? classItem.allowedProgramTerms : [];
    return allowedProgramTerms.some((apt) => {
      if (!idsEqual(apt?.programId, programId)) return false;
      const aptTerm = String(apt?.termId || '').trim();
      if (!aptTerm) return true;
      return idsEqual(apt.termId, termId);
    });
  });
}

async function previewTermWithdrawal({
  termRegistrationId,
  reason,
  effectiveDate,
  reqUser
}) {
  const preview = {
    type: 'term',
    status: 'ready',
    issues: [],
    warnings: [],
    termRegistrationId,
    studentId: '',
    studentName: '',
    programId: '',
    programName: '',
    termId: '',
    termName: '',
    reason: reason || '',
    effectiveDate: effectiveDate || withdrawalPolicyService.todayISO(),
    classWithdrawals: [],
    financialImpact: {
      termFeeRefund: 0,
      classFeeRefund: 0,
      totalRefund: 0,
      totalPenalty: 0,
      currency: 'CAD',
      refundPolicy: '',
      refundReason: ''
    },
    academicImpact: {
      gradeAssigned: '',
      appearsOnTranscript: true,
      gradeReason: ''
    },
    deadlines: {},
    canProceed: true,
    requiresClassWithdrawal: false
  };

  const { termRegistration, program, termRow, student } = await getTermRegistrationWithDetails(termRegistrationId, reqUser);

  if (!termRegistration) {
    preview.issues.push('Term registration not found.');
    preview.canProceed = false;
    preview.status = 'error';
    return preview;
  }

  if (!student) {
    preview.issues.push('Student not found.');
    preview.canProceed = false;
    preview.status = 'error';
    return preview;
  }

  preview.studentId = termRegistration.studentId;
  preview.studentName = `${student.firstName || ''} ${student.lastName || ''}`.trim() || student.id;
  preview.programId = termRegistration.programId;
  preview.programName = program?.name || termRegistration.programId;
  preview.termId = termRegistration.termId;
  preview.termName = termRow?.termName || termRegistration.termId;
  if (!termRow) {
    preview.warnings.push('Program term snapshot could not be resolved. This request should be reviewed by an administrator.');
  }

  const eligibility = withdrawalPolicyService.canWithdraw({
    type: 'term',
    status: termRegistration.status,
    termRow,
    effectiveDate: preview.effectiveDate
  });

  if (!eligibility.canWithdraw) {
    preview.issues.push(...eligibility.issues);
    preview.canProceed = false;
    preview.status = 'error';
    return preview;
  }
  if (eligibility.warnings.length) {
    preview.warnings.push(...eligibility.warnings);
  }

  const activeClasses = await getActiveClassesForTermRegistration(
    termRegistrationId,
    termRegistration.studentId,
    reqUser
  );

  let totalClassFees = 0;
  for (const classEnrollment of activeClasses) {
    const classPreview = await classWithdrawalService.previewClassWithdrawal({
      classId: classEnrollment.classId,
      studentId: termRegistration.studentId,
      termRegistrationId,
      reason,
      effectiveDate: preview.effectiveDate,
      reqUser
    });

    preview.classWithdrawals.push(classPreview);
    totalClassFees += roundMoney(classPreview.financialImpact?.originalAmount || 0);
    
    if (classPreview.status === 'error' && classPreview.issues.length) {
      preview.warnings.push(`Class "${classPreview.classTitle}": ${classPreview.issues.join(', ')}`);
    }
  }

  if (activeClasses.length > 0) {
    preview.requiresClassWithdrawal = true;
  }

  const termFeeAmount = roundMoney(
    termRegistration?.transactionSummary?.termTransactionTotal ||
    termRegistration?.financeSummary?.termFeeTotal || 0
  );

  const termImpact = withdrawalPolicyService.calculateWithdrawalImpact({
    type: 'term',
    termRow,
    originalAmount: termFeeAmount,
    effectiveDate: preview.effectiveDate
  });

  const classRefundTotal = preview.classWithdrawals.reduce(
    (sum, cw) => sum + roundMoney(cw.financialImpact?.refundAmount || 0), 0
  );
  const classPenaltyTotal = preview.classWithdrawals.reduce(
    (sum, cw) => sum + roundMoney(cw.financialImpact?.penaltyAmount || 0), 0
  );

  preview.financialImpact = {
    termFeeOriginal: termFeeAmount,
    termFeeRefund: termImpact.financial.refundAmount,
    termFeePenalty: termImpact.financial.penaltyAmount,
    classFeeOriginal: totalClassFees,
    classFeeRefund: classRefundTotal,
    classFeePenalty: classPenaltyTotal,
    totalRefund: roundMoney(termImpact.financial.refundAmount + classRefundTotal),
    totalPenalty: roundMoney(termImpact.financial.penaltyAmount + classPenaltyTotal),
    currency: termImpact.financial.currency,
    refundPolicy: termImpact.financial.refundPolicy,
    refundPolicyLabel: termImpact.financial.refundPolicyLabel,
    refundReason: termImpact.financial.refundReason,
    refundPercentage: termImpact.financial.refundPercentage
  };

  preview.academicImpact = termImpact.academic;
  preview.deadlines = termImpact.deadlines;
  if (Array.isArray(termImpact.policyWarnings) && termImpact.policyWarnings.length) {
    preview.warnings.push(...termImpact.policyWarnings);
  }

  if (preview.warnings.length && preview.status === 'ready') {
    preview.status = 'warning';
  }

  return preview;
}

async function executeTermWithdrawal({
  termRegistrationId,
  reason,
  reasonDetail,
  effectiveDate,
  initiatorType,
  initiatorId,
  withdrawClasses = true,
  reqUser,
  options = {},
  existingWithdrawalId = '',
  additionalInternalNote = ''
}) {
  const preview = await previewTermWithdrawal({
    termRegistrationId,
    reason,
    effectiveDate,
    reqUser
  });

  if (!preview.canProceed) {
    if (existingWithdrawalId) {
      try {
        await withdrawalRepository.updateWithdrawal(existingWithdrawalId, {
          status: 'error',
          errors: Array.isArray(preview.issues) ? preview.issues : [],
          warnings: Array.isArray(preview.warnings) ? preview.warnings : [],
          audit: { lastUpdateUser: reqUser?.id || '' }
        });
      } catch (e) {
        // Non-critical
      }
    }
    return {
      success: false,
      withdrawal: null,
      preview,
      classWithdrawalResults: [],
      errors: preview.issues
    };
  }

  const { termRegistration, student } = await getTermRegistrationWithDetails(termRegistrationId, reqUser);
  const errors = [];
  const childWithdrawalIds = [];
  const classWithdrawalResults = [];

  if (withdrawClasses && preview.classWithdrawals.length > 0) {
    for (const classPreview of preview.classWithdrawals) {
      try {
        const classResult = await classWithdrawalService.executeClassWithdrawal({
          classId: classPreview.classId,
          studentId: preview.studentId,
          termRegistrationId,
          reason,
          reasonDetail,
          effectiveDate: preview.effectiveDate,
          initiatorType,
          initiatorId,
          reqUser,
          options
        });

        classWithdrawalResults.push(classResult);
        if (classResult.withdrawal?.id) {
          childWithdrawalIds.push(classResult.withdrawal.id);
        }
        if (!classResult.success) {
          errors.push(...classResult.errors.map(e => `Class ${classPreview.classTitle}: ${e}`));
        }
      } catch (error) {
        errors.push(`Failed to withdraw from class ${classPreview.classTitle}: ${error.message}`);
      }
    }
  }

  let withdrawalRecord = null;
  if (existingWithdrawalId) {
    const existing = await withdrawalRepository.getWithdrawalById(existingWithdrawalId);
    if (!existing) throw new Error('Existing withdrawal request not found.');
    if (String(existing.type || '').toLowerCase() !== 'term') throw new Error('Existing withdrawal request type mismatch.');
    if (!idsEqual(existing.studentId, preview.studentId)) throw new Error('Existing withdrawal student mismatch.');
    if (!idsEqual(existing.termRegistrationId, termRegistrationId)) throw new Error('Existing withdrawal term registration mismatch.');

    withdrawalRecord = await withdrawalRepository.updateWithdrawal(existing.id, {
      status: 'processing',
      reason: reason || existing.reason || 'other',
      reasonDetail: reasonDetail || existing.reasonDetail || '',
      initiatorType: initiatorType || existing.initiatorType || 'admin',
      initiatorId: initiatorId || existing.initiatorId || '',
      requestDate: existing.requestDate || withdrawalPolicyService.todayISO(),
      effectiveDate: preview.effectiveDate,
      termRegistrationId,
      programId: preview.programId,
      termId: preview.termId,
      programRegistrationId: termRegistration.programRegistrationId || existing.programRegistrationId || '',
      financialImpact: {
        ...preview.financialImpact,
        refundAmount: preview.financialImpact.totalRefund,
        penaltyAmount: preview.financialImpact.totalPenalty,
        totalAmount: preview.financialImpact.totalRefund
      },
      academicImpact: preview.academicImpact,
      childWithdrawals: childWithdrawalIds,
      internalNotes: appendNotes(existing.internalNotes, additionalInternalNote),
      warnings: Array.isArray(preview.warnings) ? preview.warnings : [],
      errors: [],
      audit: { lastUpdateUser: reqUser?.id || '' }
    });
  } else {
    withdrawalRecord = await withdrawalRepository.addWithdrawal({
      orgId: student.orgId,
      type: 'term',
      status: 'processing',
      studentId: preview.studentId,
      personId: student.personId || '',
      reason: reason || 'other',
      reasonDetail: reasonDetail || '',
      initiatorType: initiatorType || 'admin',
      initiatorId: initiatorId || '',
      requestDate: withdrawalPolicyService.todayISO(),
      effectiveDate: preview.effectiveDate,
      termRegistrationId,
      programId: preview.programId,
      termId: preview.termId,
      programRegistrationId: termRegistration.programRegistrationId || '',
      financialImpact: {
        ...preview.financialImpact,
        refundAmount: preview.financialImpact.totalRefund,
        penaltyAmount: preview.financialImpact.totalPenalty,
        totalAmount: preview.financialImpact.totalRefund
      },
      academicImpact: preview.academicImpact,
      childWithdrawals: childWithdrawalIds,
      internalNotes: appendNotes('', additionalInternalNote),
      warnings: Array.isArray(preview.warnings) ? preview.warnings : [],
      audit: { createUser: reqUser?.id || '' }
    });
  }

  for (const childId of childWithdrawalIds) {
    try {
      await withdrawalRepository.updateWithdrawal(childId, {
        parentWithdrawalId: withdrawalRecord.id
      });
    } catch (e) {
      // Non-critical
    }
  }

  try {
    await schoolRepositories.studentTermRegistrations.update(termRegistrationId, {
      status: 'withdrawn',
      withdrawalId: withdrawalRecord.id,
      withdrawalDate: preview.effectiveDate,
      withdrawalReason: reason
    });
  } catch (error) {
    errors.push(`Failed to update term registration status: ${error.message}`);
  }

  try {
    await schoolRepositories.academicLedger.create({
      orgId: student.orgId,
      studentId: preview.studentId,
      personId: student.personId || '',
      entryType: 'term_withdrawn',
      status: 'posted',
      effectiveDate: preview.effectiveDate,
      programId: preview.programId,
      termId: preview.termId,
      termRegistrationId,
      note: `Term withdrawal: ${reason || 'other'}`,
      source: {
        module: 'school_withdrawal',
        eventType: 'term_withdrawal',
        eventId: `WDR-TERM-${withdrawalRecord.id}`,
        idempotencyKey: `WDR|TERM|${withdrawalRecord.id}|${termRegistrationId}`
      }
    });
  } catch (error) {
    errors.push(`Failed to create academic ledger entry: ${error.message}`);
  }

  let settlementResult = {
    transactionIds: [],
    settledRefundAmount: 0,
    sourceChargeBase: 0,
    ratio: 0,
    warnings: []
  };
  const settlementSkipped = Boolean(options?.skipFinancialSettlement);
  if (!settlementSkipped) {
    try {
      settlementResult = await withdrawalSettlementService.settleRefundFromTransactions({
        withdrawalRecord,
        orgId: student.orgId,
        scopeType: 'term',
        relatedTransactionIds: withdrawalSettlementService.asIdArray(termRegistration?.transactionSummary?.transactionIds),
        targetRefundAmount: Number(preview?.financialImpact?.termFeeRefund || 0),
        effectiveDate: preview.effectiveDate,
        reason,
        includeClassLinked: 'exclude',
        reqUser
      });
    } catch (error) {
      errors.push(`Failed to settle financial transactions: ${error.message}`);
    }
  }

  const finalWarnings = Array.from(new Set([
    ...((Array.isArray(withdrawalRecord?.warnings) ? withdrawalRecord.warnings : []).map((item) => String(item || '').trim()).filter(Boolean)),
    ...((Array.isArray(settlementResult.warnings) ? settlementResult.warnings : []).map((item) => `Financial settlement warning: ${String(item || '').trim()}`).filter(Boolean))
  ]));

  const finalStatus = errors.length > 0 ? 'error' : 'completed';
  const updatedWithdrawal = await withdrawalRepository.updateWithdrawal(withdrawalRecord.id, {
    status: finalStatus,
    completedDate: finalStatus === 'completed' ? withdrawalPolicyService.todayISO() : '',
    approvedDate: finalStatus === 'completed' ? withdrawalPolicyService.todayISO() : '',
    approvedBy: finalStatus === 'completed' ? (initiatorId || reqUser?.id || '') : '',
    processedBy: finalStatus === 'completed' ? (initiatorId || reqUser?.id || '') : '',
    financialImpact: {
      ...(withdrawalRecord.financialImpact || {}),
      ...(preview.financialImpact || {}),
      refundAmount: Number(preview?.financialImpact?.totalRefund || 0),
      penaltyAmount: Number(preview?.financialImpact?.totalPenalty || 0),
      totalAmount: Number(preview?.financialImpact?.totalRefund || 0),
      refundTransactionIds: Array.isArray(settlementResult.transactionIds) ? settlementResult.transactionIds : [],
      notes: appendNotes(
        withdrawalRecord?.financialImpact?.notes || '',
        settlementSkipped
          ? 'Term-level financial settlement skipped (handled by parent workflow).'
          : settlementResult.transactionIds.length
          ? `Financial settlement posted (${settlementResult.transactionIds.length} transactions). Requested term refund: ${Number(preview?.financialImpact?.termFeeRefund || 0)}. Settled: ${Number(settlementResult.settledRefundAmount || 0)}.`
          : 'No term-level financial settlement transactions were created.'
      )
    },
    internalNotes: withdrawalRecord.internalNotes || '',
    warnings: finalWarnings,
    errors,
    audit: { lastUpdateUser: reqUser?.id || '' }
  });

  return {
    success: errors.length === 0,
    withdrawal: updatedWithdrawal,
    preview,
    classWithdrawalResults,
    errors
  };
}

async function getActiveTermRegistrationsForStudent(studentId, orgId) {
  const rows = await schoolRepositories.studentTermRegistrations.list({
    query: {
      studentId__eq: studentId,
      orgId__eq: orgId
    },
    scope: { canViewAll: true }
  });
  return rows.filter((tr) => String(tr.status || '').toLowerCase() === 'registered');
}

module.exports = {
  previewTermWithdrawal,
  executeTermWithdrawal,
  getActiveTermRegistrationsForStudent,
  getTermRegistrationWithDetails,
  getActiveClassesForTermRegistration
};
