const { requireCoreModule } = require('../schoolCoreContracts');
const schoolDataService = require('../schoolDataService');
const schoolRepositories = require('../../../repositories/school');
const withdrawalPolicyService = require('./withdrawalPolicyService');
const termWithdrawalService = require('./termWithdrawalService');
const withdrawalSettlementService = require('./withdrawalSettlementService');
const withdrawalRepository = require('../../../repositories/school/withdrawalRepository');
const registrationFinanceLifecycleService = require('../registrationFinanceLifecycleService');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

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

function isPostedTransaction(row) {
  return String(row?.status || '').toLowerCase() === 'posted';
}

function isRegistrationLinkedTransaction(row, programRegistrationId) {
  const registrationId = toPublicId(programRegistrationId || '');
  if (!registrationId) return false;
  const metaRegistrationId = toPublicId(row?.metadata?.programRegistrationId || '');
  const externalReference = toPublicId(row?.externalReference || '');
  return (metaRegistrationId && idsEqual(metaRegistrationId, registrationId))
    || (externalReference && idsEqual(externalReference, registrationId));
}

function sumAmount(rows) {
  return roundMoney((Array.isArray(rows) ? rows : []).reduce((sum, row) => {
    return sum + Number(row?.amount?.value || 0);
  }, 0));
}

function asDataRows(result) {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.data)) return result.data;
  return [];
}

async function getProgramPaymentSnapshot(programRegistration, student) {
  const orgId = toPublicId(programRegistration?.orgId || student?.orgId || '');
  const studentId = toPublicId(programRegistration?.studentId || student?.id || '');
  const programId = toPublicId(programRegistration?.programId || '');
  const registrationId = toPublicId(programRegistration?.id || '');
  const studentAccountId = toPublicId(student?.studentAccountId || '');
  const registrationDate = String(programRegistration?.registrationDate || '').trim();
  const txSummary = programRegistration?.transactionSummary || {};
  const registrationTxIds = new Set(withdrawalSettlementService.asIdArray(txSummary.transactionIds));

  const orgTransactions = await schoolRepositories.globalTransactions.list({
    query: { orgId__eq: orgId },
    scope: { canViewAll: true }
  });

  const candidateRows = (Array.isArray(orgTransactions) ? orgTransactions : []).filter((row) => {
    if (!isPostedTransaction(row)) return false;
    if (!idsEqual(row?.party?.studentId || '', studentId)) return false;
    if (!idsEqual(row?.party?.programId || '', programId)) return false;
    if (studentAccountId && !idsEqual(row?.metadata?.accountId || '', studentAccountId)) return false;
    return true;
  });

  const linkedRows = candidateRows.filter((row) => isRegistrationLinkedTransaction(row, registrationId));
  const fallbackRows = candidateRows.filter((row) => {
    if (!registrationDate) return true;
    const effectiveDate = String(row?.effectiveDate || '').trim();
    if (!effectiveDate) return true;
    return effectiveDate >= registrationDate;
  });
  const scopedRows = linkedRows.length ? linkedRows : fallbackRows;

  let chargeRows = scopedRows.filter((row) => registrationTxIds.has(toPublicId(row?.id || '')));
  if (!chargeRows.length) chargeRows = linkedRows.length ? linkedRows : scopedRows;
  chargeRows = chargeRows.filter((row) => String(row?.amount?.direction || '').toLowerCase() === 'debit');

  let chargedAmount = sumAmount(chargeRows);
  if (!(chargedAmount > 0)) {
    chargedAmount = roundMoney(
      txSummary.totalAmount ||
      txSummary.total ||
      txSummary.grandTotal ||
      txSummary.programFeeTotal ||
      txSummary?.draftTransactionItems?.reduce((sum, item) => sum + roundMoney(item.amount || 0), 0) ||
      0
    );
  }

  const paymentCredits = sumAmount(scopedRows.filter((row) => (
    String(row?.transactionType || '').toLowerCase() === 'payment' &&
    String(row?.amount?.direction || '').toLowerCase() === 'credit'
  )));
  const refundDebits = sumAmount(scopedRows.filter((row) => (
    String(row?.transactionType || '').toLowerCase() === 'refund' &&
    String(row?.amount?.direction || '').toLowerCase() === 'debit'
  )));

  const paidAmount = roundMoney(Math.max(paymentCredits - refundDebits, 0));
  const refundableBase = roundMoney(Math.min(chargedAmount, paidAmount));
  const outstandingDebt = roundMoney(Math.max(chargedAmount - paidAmount, 0));

  return {
    chargedAmount,
    paidAmount,
    refundableBase,
    outstandingDebt,
    usedLinkedTransactions: linkedRows.length > 0
  };
}

async function getProgramRegistrationWithDetails(programRegistrationId, reqUser) {
  const programRegistration = await schoolRepositories.studentProgramRegistrations.getById(programRegistrationId);
  if (!programRegistration) return { programRegistration: null, program: null, student: null };

  const program = await schoolDataService.getDataById('programs', programRegistration.programId, reqUser);
  const student = await schoolDataService.getDataById('students', programRegistration.studentId, reqUser);

  return { programRegistration, program, student };
}

async function getActiveTermRegistrationsForProgramRegistration(programRegistrationId, studentId) {
  const rows = await schoolRepositories.studentTermRegistrations.list({
    query: {
      programRegistrationId__eq: programRegistrationId,
      studentId__eq: studentId
    },
    scope: { canViewAll: true }
  });
  return rows.filter((tr) => String(tr.status || '').toLowerCase() === 'registered');
}

async function previewProgramWithdrawal({
  programRegistrationId,
  reason,
  effectiveDate,
  reqUser
}) {
  const preview = {
    type: 'program',
    status: 'ready',
    issues: [],
    warnings: [],
    programRegistrationId,
    studentId: '',
    studentName: '',
    programId: '',
    programName: '',
    reason: reason || '',
    effectiveDate: effectiveDate || withdrawalPolicyService.todayISO(),
    termWithdrawals: [],
    financialImpact: {
      programFeeOriginal: 0,
      programFeeRefund: 0,
      programFeePenalty: 0,
      termFeeRefund: 0,
      termFeePenalty: 0,
      classFeeRefund: 0,
      classFeePenalty: 0,
      totalRefund: 0,
      totalPenalty: 0,
      currency: 'CAD',
      refundPolicy: '',
      refundReason: ''
    },
    academicImpact: {
      gradeAssigned: 'W',
      appearsOnTranscript: true,
      reason: 'Program withdrawal'
    },
    canProceed: true,
    requiresTermWithdrawal: false,
    activeTermCount: 0
  };

  const { programRegistration, program, student } = await getProgramRegistrationWithDetails(programRegistrationId, reqUser);

  if (!programRegistration) {
    preview.issues.push('Program registration not found.');
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

  preview.studentId = programRegistration.studentId;
  preview.studentName = `${student.firstName || ''} ${student.lastName || ''}`.trim() || student.id;
  preview.programId = programRegistration.programId;
  preview.programName = program?.name || programRegistration.programId;

  if (['withdrawn', 'cancelled', 'completed', 'rolled_back'].includes(String(programRegistration.status).toLowerCase())) {
    preview.issues.push(`Cannot withdraw: Program registration is already ${programRegistration.status}.`);
    preview.canProceed = false;
    preview.status = 'error';
    return preview;
  }

  const activeTermRegs = await getActiveTermRegistrationsForProgramRegistration(
    programRegistrationId,
    programRegistration.studentId
  );

  preview.activeTermCount = activeTermRegs.length;

  if (activeTermRegs.length > 0) {
    preview.requiresTermWithdrawal = true;

    for (const termReg of activeTermRegs) {
      const termPreview = await termWithdrawalService.previewTermWithdrawal({
        termRegistrationId: termReg.id,
        reason,
        effectiveDate: preview.effectiveDate,
        reqUser
      });

      preview.termWithdrawals.push(termPreview);

      if (termPreview.status === 'error') {
        preview.warnings.push(`Term "${termPreview.termName}": ${termPreview.issues.join(', ')}`);
      }
    }
  }

  const paymentSnapshot = await getProgramPaymentSnapshot(programRegistration, student);
  const programFeeAmount = roundMoney(paymentSnapshot.chargedAmount || 0);
  const programFeePaid = roundMoney(paymentSnapshot.paidAmount || 0);
  const programOutstandingDebt = roundMoney(paymentSnapshot.outstandingDebt || 0);
  const refundablePaymentBase = roundMoney(paymentSnapshot.refundableBase || 0);

  const programRefundPercentage = 100;
  preview.financialImpact.programFeeOriginal = programFeeAmount;
  preview.financialImpact.programFeePaid = programFeePaid;
  preview.financialImpact.programFeeOutstandingDebt = programOutstandingDebt;
  preview.financialImpact.refundablePaymentBase = refundablePaymentBase;
  preview.financialImpact.programFeeRefund = roundMoney(refundablePaymentBase * (programRefundPercentage / 100));
  preview.financialImpact.programFeePenalty = roundMoney(programFeeAmount - preview.financialImpact.programFeeRefund);

  if (programOutstandingDebt > 0) {
    preview.warnings.push(`Student still owes ${programOutstandingDebt.toFixed(2)} on this program registration. Refund can only be applied on paid amounts.`);
  }
  if (!(programFeePaid > 0)) {
    preview.warnings.push('No posted payment was found for this program registration yet. The request can be submitted for review, but refund remains 0 until payment is posted.');
  }

  let termRefundTotal = 0;
  let termPenaltyTotal = 0;
  let classRefundTotal = 0;
  let classPenaltyTotal = 0;

  for (const tw of preview.termWithdrawals) {
    termRefundTotal += roundMoney(tw.financialImpact?.termFeeRefund || 0);
    termPenaltyTotal += roundMoney(tw.financialImpact?.termFeePenalty || 0);
    classRefundTotal += roundMoney(tw.financialImpact?.classFeeRefund || 0);
    classPenaltyTotal += roundMoney(tw.financialImpact?.classFeePenalty || 0);
  }

  preview.financialImpact.termFeeRefund = termRefundTotal;
  preview.financialImpact.termFeePenalty = termPenaltyTotal;
  preview.financialImpact.classFeeRefund = classRefundTotal;
  preview.financialImpact.classFeePenalty = classPenaltyTotal;
  preview.financialImpact.totalRefund = roundMoney(
    preview.financialImpact.programFeeRefund + termRefundTotal + classRefundTotal
  );
  preview.financialImpact.totalPenalty = roundMoney(
    preview.financialImpact.programFeePenalty + termPenaltyTotal + classPenaltyTotal
  );

  if (preview.warnings.length && preview.status === 'ready') {
    preview.status = 'warning';
  }

  return preview;
}

async function executeProgramWithdrawal({
  programRegistrationId,
  reason,
  reasonDetail,
  effectiveDate,
  initiatorType,
  initiatorId,
  withdrawTerms = true,
  withdrawClasses = true,
  reqUser,
  options = {},
  existingWithdrawalId = '',
  additionalInternalNote = ''
}) {
  const preview = await previewProgramWithdrawal({
    programRegistrationId,
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
      termWithdrawalResults: [],
      errors: preview.issues
    };
  }

  const { programRegistration, student } = await getProgramRegistrationWithDetails(programRegistrationId, reqUser);
  const manualSettlementRows = Array.isArray(options?.manualSettlementRows) ? options.manualSettlementRows : [];
  if (manualSettlementRows.length) {
    const manualTotal = roundMoney(manualSettlementRows.reduce((sum, row) => sum + Number(row?.amount || 0), 0));
    const maxRefund = roundMoney(Number(preview?.financialImpact?.programFeeRefund || 0));
    if (!(maxRefund > 0) && manualTotal > 0) {
      throw new Error('Manual settlement cannot be posted because no paid amount is available for refund yet.');
    }
    if (manualTotal > maxRefund + 0.01) {
      throw new Error(`Manual settlement total (${manualTotal.toFixed(2)}) exceeds refundable paid amount (${maxRefund.toFixed(2)}).`);
    }
  }
  const errors = [];
  const childWithdrawalIds = [];
  const termWithdrawalResults = [];

  if (withdrawTerms && preview.termWithdrawals.length > 0) {
    for (const termPreview of preview.termWithdrawals) {
      try {
        const termResult = await termWithdrawalService.executeTermWithdrawal({
          termRegistrationId: termPreview.termRegistrationId,
          reason,
          reasonDetail,
          effectiveDate: preview.effectiveDate,
          initiatorType,
          initiatorId,
          withdrawClasses,
          reqUser,
          options: {
            ...(options && typeof options === 'object' ? options : {}),
            skipFinancialSettlement: true
          }
        });

        termWithdrawalResults.push(termResult);
        if (termResult.withdrawal?.id) {
          childWithdrawalIds.push(termResult.withdrawal.id);
        }
        if (!termResult.success) {
          errors.push(...termResult.errors.map(e => `Term ${termPreview.termName}: ${e}`));
        }
      } catch (error) {
        errors.push(`Failed to withdraw from term ${termPreview.termName}: ${error.message}`);
      }
    }
  }

  let withdrawalRecord = null;
  if (existingWithdrawalId) {
    const existing = await withdrawalRepository.getWithdrawalById(existingWithdrawalId);
    if (!existing) throw new Error('Existing withdrawal request not found.');
    if (String(existing.type || '').toLowerCase() !== 'program') throw new Error('Existing withdrawal request type mismatch.');
    if (!idsEqual(existing.studentId, preview.studentId)) throw new Error('Existing withdrawal student mismatch.');
    if (!idsEqual(existing.programRegistrationId, programRegistrationId)) throw new Error('Existing withdrawal program registration mismatch.');

    withdrawalRecord = await withdrawalRepository.updateWithdrawal(existing.id, {
      status: 'processing',
      reason: reason || existing.reason || 'other',
      reasonDetail: reasonDetail || existing.reasonDetail || '',
      initiatorType: initiatorType || existing.initiatorType || 'admin',
      initiatorId: initiatorId || existing.initiatorId || '',
      requestDate: existing.requestDate || withdrawalPolicyService.todayISO(),
      effectiveDate: preview.effectiveDate,
      programRegistrationId,
      programId: preview.programId,
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
      type: 'program',
      status: 'processing',
      studentId: preview.studentId,
      personId: student.personId || '',
      reason: reason || 'other',
      reasonDetail: reasonDetail || '',
      initiatorType: initiatorType || 'admin',
      initiatorId: initiatorId || '',
      requestDate: withdrawalPolicyService.todayISO(),
      effectiveDate: preview.effectiveDate,
      programRegistrationId,
      programId: preview.programId,
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
    const source = {
      module: 'school_withdrawal',
      eventType: 'program_withdrawal',
      eventId: `WDR-PROGRAM-${withdrawalRecord.id}`,
      idempotencyKey: `WDR|PROGRAM|${withdrawalRecord.id}|${programRegistrationId}`
    };
    await registrationFinanceLifecycleService.postAcademicEntriesIdempotently({
      source,
      post: () => schoolRepositories.academicLedger.create({
      orgId: student.orgId,
      studentId: preview.studentId,
      personId: student.personId || '',
      entryType: 'program_withdrawn',
      status: 'posted',
      effectiveDate: preview.effectiveDate,
      programId: preview.programId,
      programRegistrationId,
      note: `Program withdrawal: ${reason || 'other'}`,
        source
      })
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
  try {
    const relatedTransactionIds = withdrawalSettlementService.asIdArray(programRegistration?.transactionSummary?.transactionIds);
    if (manualSettlementRows.length) {
      settlementResult = await withdrawalSettlementService.settleRefundWithManualEntries({
        withdrawalRecord,
        orgId: student.orgId,
        effectiveDate: preview.effectiveDate,
        reason,
        manualRows: manualSettlementRows,
        relatedTransactionIds,
        reqUser
      });
    } else {
      settlementResult = await withdrawalSettlementService.settleRefundFromTransactions({
        withdrawalRecord,
        orgId: student.orgId,
        scopeType: 'program',
        relatedTransactionIds,
        targetRefundAmount: Number(preview?.financialImpact?.programFeeRefund || 0),
        effectiveDate: preview.effectiveDate,
        reason,
        includeClassLinked: 'all',
        reqUser
      });
    }
  } catch (error) {
    errors.push(`Failed to settle financial transactions: ${error.message}`);
  }

  const requestedRefundAmount = Number(preview?.financialImpact?.programFeeRefund || 0);
  if (requestedRefundAmount > 0 &&
      Math.abs(Number(settlementResult.settledRefundAmount || 0) - requestedRefundAmount) > 0.009) {
    errors.push(
      `Financial settlement is incomplete. Requested ${requestedRefundAmount.toFixed(2)}, settled ${Number(settlementResult.settledRefundAmount || 0).toFixed(2)}.`
    );
  }

  if (!errors.length) {
    try {
      await schoolRepositories.studentProgramRegistrations.update(programRegistrationId, {
        status: 'withdrawn',
        withdrawalId: withdrawalRecord.id,
        withdrawalDate: preview.effectiveDate,
        withdrawalReason: reason
      });
    } catch (error) {
      errors.push(`Failed to update program registration status: ${error.message}`);
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
        settlementResult.transactionIds.length
          ? `Financial settlement posted (${settlementResult.transactionIds.length} transactions). Requested refund (paid base): ${Number(preview?.financialImpact?.programFeeRefund || 0)}. Settled: ${Number(settlementResult.settledRefundAmount || 0)}.${Array.isArray(options?.manualSettlementRows) && options.manualSettlementRows.length ? ' Manual double-entry settlement applied.' : ''}`
          : 'No financial settlement transactions were created.'
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
    termWithdrawalResults,
    errors
  };
}

async function getActiveProgramRegistrationsForStudent(studentId, orgId) {
  const rows = await schoolRepositories.studentProgramRegistrations.list({
    query: {
      studentId__eq: studentId,
      orgId__eq: orgId
    },
    scope: { canViewAll: true }
  });
  return rows.filter((pr) => String(pr.status || '').toLowerCase() === 'registered');
}

async function getStudentWithdrawalStatus(studentId, orgId, reqUser) {
  const student = await schoolDataService.getDataById('students', studentId, reqUser);
  if (!student) return null;

  const [programRegs, termRegs, classEnrollments, programsResult, termsResult] = await Promise.all([
    getActiveProgramRegistrationsForStudent(studentId, orgId),
    termWithdrawalService.getActiveTermRegistrationsForStudent(studentId, orgId),
    (require('./classWithdrawalService')).getActiveClassEnrollmentsForStudent(studentId, orgId, reqUser),
    schoolDataService.fetchData('programs', {}, reqUser),
    schoolDataService.fetchData('terms', {}, reqUser)
  ]);
  const programs = asDataRows(programsResult).filter((row) => idsEqual(row?.orgId || '', orgId));
  const terms = asDataRows(termsResult).filter((row) => idsEqual(row?.orgId || '', orgId));
  const programNameById = new Map(programs.map((row) => [toPublicId(row?.id || ''), String(row?.name || row?.title || row?.id || '').trim()]));
  const termNameById = new Map(terms.map((row) => [toPublicId(row?.id || ''), String(row?.termName || row?.name || row?.title || row?.id || '').trim()]));
  const warnings = [];

  if (classEnrollments.length > 0 && termRegs.length === 0) {
    warnings.push('Student has active class enrollments but no active term registration. Please review registration integrity.');
  }
  if (termRegs.length > 0 && programRegs.length === 0) {
    warnings.push('Student has active term registrations but no active program registration. Please review registration integrity.');
  }

  const termRegistrationIdSet = new Set(termRegs.map((row) => toPublicId(row?.id || '')).filter(Boolean));
  const activeProgramTermKeySet = new Set(
    termRegs
      .map((row) => {
        const p = toPublicId(row?.programId || '');
        const t = toPublicId(row?.termId || '');
        return p && t ? `${p}::${t}` : '';
      })
      .filter(Boolean)
  );
  const orphanClassEnrollments = classEnrollments.filter((row) => {
    const termRegistrationId = toPublicId(row?.termRegistrationId || '');
    if (termRegistrationId) return !termRegistrationIdSet.has(termRegistrationId);
    const p = toPublicId(row?.programId || '');
    const t = toPublicId(row?.termId || '');
    if (p && t && activeProgramTermKeySet.has(`${p}::${t}`)) return false;
    return true;
  });
  if (orphanClassEnrollments.length > 0) {
    warnings.push('Some class enrollments are not linked to an active term registration.');
  }

  return {
    student: {
      id: student.id,
      name: `${student.firstName || ''} ${student.lastName || ''}`.trim(),
      studentNumber: student.studentNumber || ''
    },
    activeProgramRegistrations: programRegs.length,
    activeTermRegistrations: termRegs.length,
    activeClassEnrollments: classEnrollments.length,
    warnings,
    reviewRequired: warnings.length > 0,
    orphanClassEnrollments,
    programs: programRegs.map(pr => ({
      registrationId: pr.id,
      programId: pr.programId,
      programName: programNameById.get(toPublicId(pr?.programId || '')) || String(pr?.programId || ''),
      status: pr.status
    })),
    terms: termRegs.map(tr => ({
      registrationId: tr.id,
      termId: tr.termId,
      programId: tr.programId,
      termName: termNameById.get(toPublicId(tr?.termId || '')) || String(tr?.termId || ''),
      programName: programNameById.get(toPublicId(tr?.programId || '')) || String(tr?.programId || ''),
      status: tr.status
    })),
    classes: classEnrollments.map((row) => {
      const programName = programNameById.get(toPublicId(row?.programId || '')) || String(row?.programId || '');
      const termName = termNameById.get(toPublicId(row?.termId || '')) || String(row?.termId || '');
      return {
        ...row,
        programName,
        termName
      };
    })
  };
}

module.exports = {
  previewProgramWithdrawal,
  executeProgramWithdrawal,
  getActiveProgramRegistrationsForStudent,
  getProgramRegistrationWithDetails,
  getActiveTermRegistrationsForProgramRegistration,
  getStudentWithdrawalStatus
};
