// MVC/services/school/withdrawal/classWithdrawalService.js

const schoolDataService = require('../schoolDataService');
const schoolRepositories = require('../../../repositories/school');
const academicLedgerService = require('../academicLedgerService');
const withdrawalPolicyService = require('./withdrawalPolicyService');
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

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function isOpenCanonicalPeriod(row, referenceDate = '') {
  const status = String(row?.status || '').trim().toLowerCase();
  if (!['active', 'planned'].includes(status)) return false;
  const day = normalizeDateOnly(referenceDate) || withdrawalPolicyService.todayISO();
  const start = normalizeDateOnly(row?.startDate);
  const end = normalizeDateOnly(row?.endDate);
  if (start && start > day && status !== 'planned') return false;
  if (end && end < day) return false;
  return true;
}

function mapCanonicalToEnrollmentStatus(status) {
  const token = String(status || '').trim().toLowerCase();
  if (token === 'active') return 'enrolled';
  if (token === 'planned') return 'waitlisted';
  if (token === 'cancelled') return 'cancelled';
  if (token === 'withdrawn') return 'withdrawn';
  if (token === 'completed') return 'completed';
  return token || 'enrolled';
}

function buildEnrollmentFromCanonicalPeriod(periodRow) {
  if (!periodRow) return null;
  return {
    enrollmentId: String(periodRow?.id || '').trim(),
    studentId: String(periodRow?.studentId || '').trim(),
    status: mapCanonicalToEnrollmentStatus(periodRow?.status),
    enrolledAt: String(periodRow?.startDate || '').trim(),
    withdrawnAt: String(periodRow?.endDate || '').trim(),
    termRegistrationId: String(periodRow?.authorizationRef || '').trim(),
    programRegistrationId: String(periodRow?.programRegistrationId || '').trim(),
    programId: String(periodRow?.programId || '').trim(),
    termId: String(periodRow?.termId || '').trim(),
    feeCategory: String(periodRow?.feeCategory || '').trim(),
    pricing: periodRow?.pricing && typeof periodRow.pricing === 'object'
      ? { ...periodRow.pricing }
      : {}
  };
}

async function getClassEnrollment(classId, studentId, reqUser, referenceDate = '') {
  const classItem = await schoolDataService.getDataById('classes', classId, reqUser);
  if (!classItem) return { classItem: null, enrollment: null };

  const periods = await schoolDataService.getClassEnrollmentPeriodsByClassId(classId, reqUser);
  const canonicalMatch = (Array.isArray(periods) ? periods : []).find((row) =>
    idsEqual(row?.studentId, studentId) && isOpenCanonicalPeriod(row, referenceDate)
  );
  if (!canonicalMatch) return { classItem, enrollment: null };
  return { classItem, enrollment: buildEnrollmentFromCanonicalPeriod(canonicalMatch) };
}

async function previewClassWithdrawal({
  classId,
  studentId,
  termRegistrationId,
  reason,
  effectiveDate,
  reqUser
}) {
  const preview = {
    type: 'class',
    status: 'ready',
    issues: [],
    warnings: [],
    classId,
    studentId,
    termRegistrationId: termRegistrationId || '',
    classTitle: '',
    studentName: '',
    enrollmentId: '',
    reason: reason || '',
    effectiveDate: effectiveDate || withdrawalPolicyService.todayISO(),
    financialImpact: null,
    academicImpact: null,
    canProceed: true
  };

  const student = await schoolDataService.getDataById('students', studentId, reqUser);
  if (!student) {
    preview.issues.push('Student not found.');
    preview.canProceed = false;
    preview.status = 'error';
    return preview;
  }
  preview.studentName = `${student.firstName || ''} ${student.lastName || ''}`.trim() || student.id;

  const { classItem, enrollment } = await getClassEnrollment(classId, studentId, reqUser, preview.effectiveDate);
  if (!classItem) {
    preview.issues.push('Class not found.');
    preview.canProceed = false;
    preview.status = 'error';
    return preview;
  }
  preview.classTitle = classItem.title || classItem.id;

  if (!enrollment) {
    preview.issues.push('Student is not actively enrolled in this class.');
    preview.canProceed = false;
    preview.status = 'error';
    return preview;
  }
  preview.enrollmentId = enrollment.enrollmentId || '';

  let termRow = null;
  let termRegistration = null;
  if (termRegistrationId) {
    termRegistration = await schoolRepositories.studentTermRegistrations.getById(termRegistrationId);
    if (termRegistration) {
      const program = await schoolDataService.getDataById('programs', termRegistration.programId, reqUser);
      if (program && Array.isArray(program.terms)) {
        termRow = program.terms.find(t => idsEqual(t.termId, termRegistration.termId));
      }
    }
    if (!termRegistration) {
      preview.warnings.push('Linked term registration was not found. This request should be reviewed by an administrator.');
    }
  } else {
    preview.warnings.push('Class enrollment is not linked to a term registration. This request should be reviewed by an administrator.');
  }

  const originalAmount = roundMoney(enrollment?.pricing?.finalTotal || enrollment?.pricing?.suggestedTotal || 0);
  const impact = withdrawalPolicyService.calculateWithdrawalImpact({
    type: 'class',
    termRow,
    originalAmount,
    effectiveDate: preview.effectiveDate
  });

  preview.financialImpact = impact.financial;
  preview.academicImpact = impact.academic;
  preview.deadlines = impact.deadlines;
  if (Array.isArray(impact.policyWarnings) && impact.policyWarnings.length) {
    preview.warnings.push(...impact.policyWarnings);
  }

  const eligibility = withdrawalPolicyService.canWithdraw({
    type: 'class',
    status: enrollment.status,
    termRow,
    effectiveDate: preview.effectiveDate
  });

  if (!eligibility.canWithdraw) {
    preview.issues.push(...eligibility.issues);
    preview.canProceed = false;
    preview.status = 'error';
  }
  if (eligibility.warnings.length) {
    preview.warnings.push(...eligibility.warnings);
    if (preview.status === 'ready') preview.status = 'warning';
  }

  if (preview.warnings.length && preview.status === 'ready') {
    preview.status = 'warning';
  }

  return preview;
}

async function executeClassWithdrawal({
  classId,
  studentId,
  termRegistrationId,
  reason,
  reasonDetail,
  effectiveDate,
  initiatorType,
  initiatorId,
  reqUser,
  options = {},
  existingWithdrawalId = '',
  additionalInternalNote = ''
}) {
  const preview = await previewClassWithdrawal({
    classId,
    studentId,
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
        // Non-critical: keep original error path.
      }
    }
    return {
      success: false,
      withdrawal: null,
      preview,
      errors: preview.issues
    };
  }

  const student = await schoolDataService.getDataById('students', studentId, reqUser);
  const { enrollment } = await getClassEnrollment(classId, studentId, reqUser, effectiveDate);

  let withdrawalRecord = null;
  if (existingWithdrawalId) {
    const existing = await withdrawalRepository.getWithdrawalById(existingWithdrawalId);
    if (!existing) throw new Error('Existing withdrawal request not found.');
    if (String(existing.type || '').toLowerCase() !== 'class') throw new Error('Existing withdrawal request type mismatch.');
    if (!idsEqual(existing.studentId, studentId)) throw new Error('Existing withdrawal student mismatch.');
    if (!idsEqual(existing.classId, classId)) throw new Error('Existing withdrawal class mismatch.');

    withdrawalRecord = await withdrawalRepository.updateWithdrawal(existingWithdrawalId, {
      status: 'processing',
      reason: reason || existing.reason || 'other',
      reasonDetail: reasonDetail || existing.reasonDetail || '',
      initiatorType: initiatorType || existing.initiatorType || 'admin',
      initiatorId: initiatorId || existing.initiatorId || '',
      requestDate: existing.requestDate || withdrawalPolicyService.todayISO(),
      effectiveDate: effectiveDate || existing.effectiveDate || withdrawalPolicyService.todayISO(),
      classEnrollmentId: enrollment.enrollmentId,
      classId,
      termRegistrationId: termRegistrationId || existing.termRegistrationId || '',
      financialImpact: {
        ...preview.financialImpact,
        totalAmount: preview.financialImpact.refundAmount
      },
      academicImpact: preview.academicImpact,
      internalNotes: appendNotes(existing.internalNotes, additionalInternalNote),
      warnings: Array.isArray(preview.warnings) ? preview.warnings : [],
      errors: [],
      audit: { lastUpdateUser: reqUser?.id || '' }
    });
  } else {
    withdrawalRecord = await withdrawalRepository.addWithdrawal({
      orgId: student.orgId,
      type: 'class',
      status: 'processing',
      studentId,
      personId: student.personId || '',
      reason: reason || 'other',
      reasonDetail: reasonDetail || '',
      initiatorType: initiatorType || 'admin',
      initiatorId: initiatorId || '',
      requestDate: withdrawalPolicyService.todayISO(),
      effectiveDate: effectiveDate || withdrawalPolicyService.todayISO(),
      classEnrollmentId: enrollment.enrollmentId,
      classId,
      termRegistrationId: termRegistrationId || '',
      financialImpact: {
        ...preview.financialImpact,
        totalAmount: preview.financialImpact.refundAmount
      },
      academicImpact: preview.academicImpact,
      internalNotes: appendNotes('', additionalInternalNote),
      warnings: Array.isArray(preview.warnings) ? preview.warnings : [],
      audit: { createUser: reqUser?.id || '' }
    });
  }

  const errors = [];
  const academicEntryIds = [];
  const removedEnrollments = [];

  try {
    if (String(enrollment?.enrollmentId || '').trim()) {
      await schoolDataService.closeClassEnrollmentPeriod(String(enrollment.enrollmentId).trim(), {
        status: 'withdrawn',
        endDate: effectiveDate || withdrawalPolicyService.todayISO(),
        reasonEnd: reason || 'class_withdrawal'
      }, reqUser, options);
      removedEnrollments.push({
        classId,
        enrollmentId: enrollment.enrollmentId
      });
    }
  } catch (error) {
    errors.push(`Failed to close class enrollment period: ${error.message}`);
  }

  try {
    if (preview.academicImpact.gradeAssigned) {
      const academicEntry = await schoolRepositories.academicLedger.create({
        orgId: student.orgId,
        studentId,
        personId: student.personId || '',
        entryType: 'class_dropped',
        status: 'posted',
        effectiveDate: effectiveDate || withdrawalPolicyService.todayISO(),
        classId,
        termRegistrationId: termRegistrationId || '',
        note: `Class withdrawal: ${reason || 'other'}`,
        source: {
          module: 'school_withdrawal',
          eventType: 'class_withdrawal',
          eventId: `WDR-CLASS-${withdrawalRecord.id}`,
          idempotencyKey: `WDR|CLASS|${withdrawalRecord.id}|${classId}|${enrollment.enrollmentId || ''}`
        }
      });
      academicEntryIds.push(academicEntry.id);
    }
  } catch (error) {
    errors.push(`Failed to create academic record: ${error.message}`);
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
      let resolvedTransactionIds = [];
      if (termRegistrationId) {
        const linkedTermRegistration = await schoolRepositories.studentTermRegistrations.getById(termRegistrationId);
        resolvedTransactionIds = withdrawalSettlementService.asIdArray(linkedTermRegistration?.transactionSummary?.transactionIds);
      }

      settlementResult = await withdrawalSettlementService.settleRefundFromTransactions({
        withdrawalRecord,
        orgId: student.orgId,
        scopeType: 'class',
        relatedTransactionIds: resolvedTransactionIds,
        targetRefundAmount: Number(preview?.financialImpact?.refundAmount || 0),
        effectiveDate: effectiveDate || withdrawalPolicyService.todayISO(),
        reason,
        includeClassLinked: 'only',
        classId,
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
    academicImpact: {
      ...preview.academicImpact,
      voidedAcademicEntryIds: academicEntryIds
    },
    financialImpact: {
      ...(withdrawalRecord.financialImpact || {}),
      ...(preview.financialImpact || {}),
      totalAmount: Number(preview?.financialImpact?.refundAmount || 0),
      refundTransactionIds: Array.isArray(settlementResult.transactionIds) ? settlementResult.transactionIds : [],
      notes: appendNotes(
        withdrawalRecord?.financialImpact?.notes || '',
        settlementSkipped
          ? 'Class-level financial settlement skipped (handled by parent workflow).'
          : settlementResult.transactionIds.length
          ? `Financial settlement posted (${settlementResult.transactionIds.length} transactions). Requested class refund: ${Number(preview?.financialImpact?.refundAmount || 0)}. Settled: ${Number(settlementResult.settledRefundAmount || 0)}.`
          : 'No class-level financial settlement transactions were created.'
      )
    },
    rosterImpact: {
      removedEnrollments,
      notes: ''
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
    errors
  };
}

async function getActiveClassEnrollmentsForStudent(studentId, orgId, reqUser) {
  const classesResult = await schoolDataService.fetchData('classes', {}, reqUser);
  const classes = classesResult?.data || classesResult || [];
  const classMap = new Map((Array.isArray(classes) ? classes : []).map((row) => [String(row?.id || '').trim(), row]));
  const enrollments = [];
  const canonicalRows = await schoolDataService.getClassEnrollmentPeriodsByStudentId(studentId, reqUser);
  const nowDay = withdrawalPolicyService.todayISO();
  const filteredRows = (Array.isArray(canonicalRows) ? canonicalRows : [])
    .filter((row) => String(row?.orgId || '').trim() === String(orgId || '').trim())
    .filter((row) => isOpenCanonicalPeriod(row, nowDay));

  filteredRows.forEach((periodRow) => {
    const classItem = classMap.get(String(periodRow?.classId || '').trim());
    if (!classItem) return;
    const merged = buildEnrollmentFromCanonicalPeriod(periodRow);
    const enrollmentText = `${String(periodRow?.reasonStart || '')} ${String(periodRow?.notes || '')}`;
    const termRegistrationMatch = enrollmentText.match(/term registration\s+([A-Za-z0-9:_-]+)/i);
    const allowedProgramTerms = Array.isArray(classItem.allowedProgramTerms) ? classItem.allowedProgramTerms : [];
    const primaryProgramTerm = allowedProgramTerms[0] || {};
    enrollments.push({
      classId: classItem.id,
      classTitle: classItem.title || classItem.id,
      enrollmentId: merged.enrollmentId,
      termRegistrationId: String(merged.termRegistrationId || (termRegistrationMatch ? String(termRegistrationMatch[1]) : '')).trim(),
      programRegistrationId: String(merged.programRegistrationId || '').trim(),
      programId: String(merged.programId || primaryProgramTerm?.programId || '').trim(),
      termId: String(merged.termId || primaryProgramTerm?.termId || '').trim(),
      status: merged.status,
      enrolledAt: merged.enrolledAt,
      feeCategory: merged.feeCategory || '',
      pricing: merged.pricing || {}
    });
  });

  return enrollments;
}

module.exports = {
  previewClassWithdrawal,
  executeClassWithdrawal,
  getActiveClassEnrollmentsForStudent,
  getClassEnrollment
};
