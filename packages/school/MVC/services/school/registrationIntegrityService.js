const schoolDataService = require('./schoolDataService');
const schoolRepositories = require('../../repositories/school');
const postingPolicyService = require('./postingPolicyService');
const academicSnapshotService = require('./academicSnapshotService');
const indexService = require('./schoolIndexService');
const classEnrollmentReadService = require('./classEnrollmentReadService');
const leaveRequestService = require('./leaveRequestService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { recordTransactionOperation } = requireCoreModule('MVC/services/transactionContextService');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function normalizeStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function isInactiveRegistrationStatus(status) {
  return ['withdrawn', 'cancelled', 'completed', 'rolled_back'].includes(normalizeStatus(status));
}

function isApprovedProgramRegistrationStatus(status) {
  return normalizeStatus(status) === 'registered';
}

function isActiveTermStatus(status) {
  return normalizeStatus(status) === 'active';
}

async function assertStudentLeaveDoesNotOverlapClass({ classItem, student, reqUser } = {}) {
  const personId = toPublicId(student?.personId);
  const classId = toPublicId(classItem?.id);
  if (!personId || !classId) return;

  const sessions = await schoolDataService.getClassSessions(classId, reqUser);
  const windows = (Array.isArray(sessions) ? sessions : [])
    .map((session, index) => ({
      sessionIndex: index,
      personId,
      personName: [student?.firstName, student?.lastName].map((part) => String(part || '').trim()).filter(Boolean).join(' ') || personId,
      date: String(session?.date || '').trim(),
      startTime: String(session?.startTime || '').trim(),
      endTime: String(session?.endTime || '').trim()
    }))
    .filter((window) => window.date && window.startTime && window.endTime);
  if (!windows.length) return;

  const conflicts = await leaveRequestService.findApprovedLeaveConflicts({
    orgId: classItem?.orgId,
    windows,
    reqUser
  });
  if (!conflicts.length) return;

  const first = conflicts[0];
  throw new Error(
    `Student has approved leave overlapping class ${classId} on ${first.date} (${first.leaveLabel || 'approved leave'}).`
  );
}

function resolveProgramTermRow(program, termId) {
  const rows = Array.isArray(program?.terms) ? program.terms : [];
  return rows.find((row) => idsEqual(row?.termId, termId)) || null;
}

function roundMoney(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(2));
}

function asIdArray(value) {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map((item) => toPublicId(item))
    .filter(Boolean)));
}

function normalizeWeight(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(2));
}

function buildEffectiveSubjectWeights(subjects) {
  const rows = Array.isArray(subjects) ? subjects : [];
  if (!rows.length) return [];

  const rawTotal = rows.reduce((sum, subject) => sum + Number(subject?.weight || 0), 0);
  if (rawTotal <= 0) {
    const evenWeight = Number((100 / rows.length).toFixed(2));
    return rows.map((subject, index) => ({
      subjectId: String(subject?.subjectId || '').trim(),
      weight: index === rows.length - 1
        ? Number((100 - evenWeight * (rows.length - 1)).toFixed(2))
        : evenWeight
    }));
  }

  let running = 0;
  return rows.map((subject, index) => {
    const normalized = index === rows.length - 1
      ? Number((100 - running).toFixed(2))
      : Number(((Number(subject?.weight || 0) / rawTotal) * 100).toFixed(2));
    running += normalized;
    return {
      subjectId: String(subject?.subjectId || '').trim(),
      weight: normalized
    };
  });
}

function selectClassFeeRule(classItem, feeCategory) {
  const rules = Array.isArray(classItem?.pricing?.feeRules) ? classItem.pricing.feeRules : [];
  const normalizedCategory = String(feeCategory || '').trim();
  const activeRules = rules.filter((rule) => rule && rule.active !== false && String(rule.active) !== 'false');
  return activeRules.find((rule) => String(rule.feeCategory || '').trim() === normalizedCategory)
    || activeRules.find((rule) => String(rule.feeCategory || '').trim() === '__ALL__')
    || null;
}

function selectSubjectFeeRule(subject, feeCategory, effectiveDate) {
  const rules = Array.isArray(subject?.feeRules) ? subject.feeRules : [];
  const isEffectiveRule = (rule) => {
    if (!rule || rule.active === false || String(rule.active) === 'false') return false;
    const validFrom = String(rule.validFrom || '').trim();
    const validTo = String(rule.validTo || '').trim();
    if (!validFrom) return false;
    if (effectiveDate < validFrom) return false;
    if (validTo && effectiveDate > validTo) return false;
    return true;
  };

  const normalizedCategory = String(feeCategory || '').trim();
  const specificMatches = rules.filter((rule) => isEffectiveRule(rule) && String(rule.feeCategory || '').trim() === normalizedCategory);
  specificMatches.sort((a, b) => String(b.validFrom || '').localeCompare(String(a.validFrom || '')));
  if (specificMatches[0]) return specificMatches[0];

  const fallbackMatches = rules.filter((rule) => isEffectiveRule(rule) && String(rule.feeCategory || '').trim() === '__ALL__');
  fallbackMatches.sort((a, b) => String(b.validFrom || '').localeCompare(String(a.validFrom || '')));
  return fallbackMatches[0] || null;
}

function getRelevantClassSubjects(classItem, program) {
  const programSubjects = new Map((Array.isArray(program?.subjects) ? program.subjects : []).map((subject) => [String(subject.subjectId || ''), subject]));
  const curriculum = Array.isArray(classItem?.curriculum?.subjects) ? classItem.curriculum.subjects : [];
  const effectiveWeightMap = new Map(buildEffectiveSubjectWeights(curriculum).map((item) => [item.subjectId, item.weight]));
  const seen = new Set();
  return curriculum
    .map((subjectRef) => {
      const subjectId = String(subjectRef?.subjectId || '').trim();
      if (!subjectId || seen.has(subjectId)) return null;
      seen.add(subjectId);
      const programSubject = programSubjects.get(subjectId);
      if (!programSubject) return null;
      return {
        subjectId,
        subjectCode: String(subjectRef?.code || '').trim() || subjectId,
        subjectName: String(subjectRef?.name || '').trim() || subjectId,
        weight: normalizeWeight(effectiveWeightMap.get(subjectId)),
        credits: Number(programSubject?.programCredits || 0),
        prerequisites: Array.isArray(programSubject?.prerequisites) ? programSubject.prerequisites.map((id) => String(id || '').trim()).filter(Boolean) : [],
        subjectType: String(programSubject?.subjectType || 'main').trim().toLowerCase()
      };
    })
    .filter(Boolean);
}

function resolveClassCredits(classItem) {
  const storedCredits = Number(classItem?.credits);
  if (Number.isFinite(storedCredits) && storedCredits >= 0) {
    return roundMoney(storedCredits);
  }
  return null;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeClassBillingMode(value) {
  return String(value || '').trim().toLowerCase() === 'no_charge' ? 'no_charge' : 'chargeable';
}

function normalizeClassRegistrationMode(value) {
  return String(value || '').trim().toLowerCase() === 'rolling' ? 'rolling' : 'term_based';
}

function buildClassLifecycleSnapshot(classRow = {}) {
  const registrationMode = normalizeClassRegistrationMode(classRow?.registrationMode);
  const parsedCycleNo = Number.parseInt(String(classRow?.cycleNo || '').trim(), 10);
  const cycleNo = Number.isFinite(parsedCycleNo) && parsedCycleNo > 0 ? parsedCycleNo : 1;
  return {
    registrationMode,
    cycleNo,
    cycleGroupId: String(classRow?.cycleGroupId || '').trim(),
    cycleStartDate: String(classRow?.cycleStartDate || '').trim(),
    cycleEndDate: String(classRow?.cycleEndDate || '').trim(),
    isClosedForNewEnrollment: classRow?.isClosedForNewEnrollment === true || String(classRow?.isClosedForNewEnrollment || '').trim().toLowerCase() === 'true',
    previousClassId: String(classRow?.previousClassId || '').trim(),
    nextClassId: String(classRow?.nextClassId || '').trim()
  };
}

function isClassEligibleForProgramTerm(classItem, programId, termId) {
  const rows = Array.isArray(classItem?.allowedProgramTerms) ? classItem.allowedProgramTerms : [];
  if (!rows.length) return false;
  return rows.some((row) => {
    if (!idsEqual(row?.programId, programId)) return false;
    const rowTerm = String(row?.termId || '').trim();
    if (!rowTerm) return true;
    return idsEqual(row.termId, termId);
  });
}

function buildClassPricingSnapshot({ classItem, program, department, relevantSubjects, subjectCatalogMap, feeCategory, effectiveDate }) {
  const billingMode = normalizeClassBillingMode(classItem?.billingMode);
  if (billingMode === 'no_charge') {
    return {
      billingMode,
      isNoCharge: true,
      currency: 'CAD',
      total: 0,
      proposedTotal: 0,
      breakdown: [],
      warnings: [],
      appliedPostingTemplate: null,
      appliedClassFeeRule: null
    };
  }

  const breakdown = [];
  const warnings = [];
  let currency = 'CAD';
  let total = 0;

  relevantSubjects.forEach((subjectRef) => {
    const subject = subjectCatalogMap.get(String(subjectRef.subjectId || ''));
    if (!subject) {
      warnings.push(`Subject ${subjectRef.subjectId} was not found and was excluded from pricing.`);
      return;
    }
    const matchedRule = selectSubjectFeeRule(subject, feeCategory, effectiveDate);
    if (!matchedRule) {
      warnings.push(`No active fee rule for ${subject.title || subjectRef.subjectName || subjectRef.subjectId} and category "${feeCategory}" on ${effectiveDate}.`);
      return;
    }

    const lineCurrency = String(matchedRule.currency || currency || 'CAD').trim().toUpperCase() || 'CAD';
    if (breakdown.length === 0) currency = lineCurrency;
    if (lineCurrency !== currency) {
      warnings.push(`Skipped ${subject.title || subjectRef.subjectId} because its currency ${lineCurrency} does not match ${currency}.`);
      return;
    }

    const weight = normalizeWeight(subjectRef?.weight);
    const baseAmount = roundMoney(matchedRule.amount);
    const amount = roundMoney(baseAmount * (weight / 100));
    total += amount;
    breakdown.push({
      subjectId: subjectRef.subjectId,
      subjectCode: subject.code || subjectRef.subjectCode || subjectRef.subjectId,
      subjectName: subject.title || subjectRef.subjectName || subjectRef.subjectId,
      weight,
      baseAmount,
      amount,
      currency,
      validFrom: matchedRule.validFrom || '',
      validTo: matchedRule.validTo || '',
      notes: matchedRule.notes || ''
    });
  });

  const calculatedPricing = {
    billingMode,
    isNoCharge: false,
    currency,
    total: roundMoney(total),
    breakdown,
    warnings
  };

  const classFeeRule = selectClassFeeRule(classItem, feeCategory);
  const postingPolicy = postingPolicyService.resolveInheritedPostingPolicy({
    feeCategory,
    classItem,
    program,
    department
  });
  if (!classFeeRule) {
    return {
      ...calculatedPricing,
      appliedPostingTemplate: postingPolicy
    };
  }

  return {
    ...calculatedPricing,
    currency: classFeeRule.currency || calculatedPricing.currency || 'CAD',
    total: roundMoney(classFeeRule.amount),
    proposedTotal: calculatedPricing.total,
    appliedClassFeeRule: {
      feeCategory: classFeeRule.feeCategory,
      amount: roundMoney(classFeeRule.amount),
      suggestedAmount: roundMoney(classFeeRule.suggestedAmount),
      currency: classFeeRule.currency || calculatedPricing.currency || 'CAD',
      manualOverride: classFeeRule.manualOverride === true || String(classFeeRule.manualOverride) === 'true',
      notes: classFeeRule.notes || ''
    },
    appliedPostingTemplate: postingPolicy,
    warnings: calculatedPricing.warnings.concat([
      `Using class fee ${roundMoney(classFeeRule.amount).toFixed(2)} ${(classFeeRule.currency || calculatedPricing.currency || 'CAD')} from the class pricing table.`
    ])
  };
}

function formatDependentTermExamples(rows) {
  return (Array.isArray(rows) ? rows : [])
    .slice(0, 5)
    .map((row) => `${row.id || '(no-id)'} (term: ${row.termId || '-'}, status: ${row.status || '-'})`)
    .join(', ');
}

const registrationIntegrityService = {
  isInactiveRegistrationStatus,
  isApprovedProgramRegistrationStatus,
  isActiveTermStatus,

  async getProgramInOrgOrThrow(programId, activeOrgId, reqUser) {
    const program = await schoolDataService.getDataById('programs', programId, reqUser);
    if (!program) throw new Error('Program not found or inaccessible.');
    if (!idsEqual(program.orgId, activeOrgId)) {
      throw new Error('Program is outside the active organization.');
    }
    return program;
  },

  async evaluateProgramPreviewDependencies(program, student) {
    const issues = [];
    const studentOrgId = String(student?.orgId || '');
    const programOrgId = String(program?.orgId || '');

    if (studentOrgId !== programOrgId) {
      issues.push('Student and program organization mismatch.');
      return { status: 'error', issues, activeRegistration: null };
    }

    const feeCategory = String(student?.feeCategory || '').trim();
    if (!feeCategory) {
      issues.push('Student fee category is missing.');
      return { status: 'error', issues, activeRegistration: null };
    }

    const studentAccountId = String(student?.studentAccountId || '').trim();
    if (!studentAccountId) {
      issues.push('Student account is missing.');
      return { status: 'error', issues, activeRegistration: null };
    }

    const activeRows = await schoolRepositories.studentProgramRegistrations.findActiveByStudentAndProgram(
      student?.id,
      program?.id,
      { limit: 1 }
    );
    const activeRegistration = activeRows[0] || null;
    if (activeRegistration) {
      issues.push(`Student already has an active program registration (${activeRegistration.id}).`);
      return { status: 'error', issues, activeRegistration };
    }

    return { status: 'ready', issues: [], activeRegistration: null };
  },

  async resolveTermPreviewDependencyContext({
    studentId,
    programRegistrationId,
    termId,
    ignoreRegistrationId = '',
    reqUser
  }) {
    const student = await schoolDataService.getDataById('students', studentId, reqUser);
    if (!student) throw new Error('Student not found or inaccessible.');

    const issues = [];
    if (!String(student?.feeCategory || '').trim()) {
      issues.push('Student fee category is missing.');
    }
    if (!String(student?.studentAccountId || '').trim()) {
      issues.push('Student account is missing.');
    }

    const programRegistration = await schoolRepositories.studentProgramRegistrations.getById(programRegistrationId);
    if (
      !programRegistration ||
      !idsEqual(programRegistration?.studentId, studentId)
    ) {
      issues.push('Selected program registration was not found for this student.');
      return {
        fatal: true,
        issues,
        student,
        programRegistration: null,
        program: null,
        term: null,
        termRow: null,
        duplicateTermRegistration: null
      };
    }

    if (!isApprovedProgramRegistrationStatus(programRegistration?.status)) {
      issues.push('Selected program registration is not approved yet. Approve and post the draft registration first.');
      return {
        fatal: true,
        issues,
        student,
        programRegistration,
        program: null,
        term: null,
        termRow: null,
        duplicateTermRegistration: null
      };
    }

    const program = await schoolDataService.getDataById('programs', programRegistration.programId, reqUser);
    if (!program) {
      issues.push('Program could not be resolved from the selected registration.');
      return {
        fatal: true,
        issues,
        student,
        programRegistration,
        program: null,
        term: null,
        termRow: null,
        duplicateTermRegistration: null
      };
    }

    if (!idsEqual(program.orgId, student.orgId)) {
      issues.push('Student and program organization mismatch.');
      return {
        fatal: true,
        issues,
        student,
        programRegistration,
        program,
        term: null,
        termRow: null,
        duplicateTermRegistration: null
      };
    }

    const term = await schoolDataService.getDataById('terms', termId, reqUser);
    const termRow = resolveProgramTermRow(program, termId);
    if (!term || !termRow) {
      issues.push('Selected term is not configured on the chosen program.');
      return {
        fatal: true,
        issues,
        student,
        programRegistration,
        program,
        term: null,
        termRow: null,
        duplicateTermRegistration: null
      };
    }

    if (!isActiveTermStatus(term.status)) {
      issues.push('Selected term is not active.');
      return {
        fatal: true,
        issues,
        student,
        programRegistration,
        program,
        term,
        termRow,
        duplicateTermRegistration: null
      };
    }

    const duplicateRows = await schoolRepositories.studentTermRegistrations.findActiveByStudentProgramAndTerm(
      student.id,
      program.id,
      term.id,
      { excludeId: ignoreRegistrationId, limit: 1 }
    );
    const duplicateTermRegistration = duplicateRows[0] || null;
    if (duplicateTermRegistration) {
      issues.push(`Student already has an active term registration (${duplicateTermRegistration.id}) for this program and term.`);
    }

    return {
      fatal: false,
      issues,
      student,
      programRegistration,
      program,
      term,
      termRow,
      duplicateTermRegistration
    };
  },

  applyProgramPreviewTransactionResult(preview, txResult) {
    if (!preview || typeof preview !== 'object') return preview;
    const skipped = Array.isArray(txResult?.skipped) ? txResult.skipped : [];
    const items = Array.isArray(txResult?.items) ? txResult.items : [];
    const noFeeIssueMatchers = [
      /No transaction rows in program/i,
      /No transaction rows found for fee category/i,
      /No program enrollment fees were generated/i
    ];

    if (skipped.length) {
      preview.issues.push(...skipped);
    }
    if (!items.length) {
      const noFeeRowsOnly = preview.issues.length > 0
        && preview.issues.every((issue) => noFeeIssueMatchers.some((matcher) => matcher.test(String(issue || ''))));
      preview.status = noFeeRowsOnly ? 'warning' : 'error';
      if (noFeeRowsOnly) {
        preview.issues = ['No program enrollment fee applies to this student category. Academic registration will still be recorded.'];
      } else if (!preview.issues.length) {
        preview.issues.push('No program enrollment fees were generated.');
      }
    } else if (skipped.length) {
      preview.status = 'warning';
    }
    return preview;
  },

  applyTermPreviewClassAndCreditRules(preview, termRow) {
    if (!preview || typeof preview !== 'object') return preview;
    const classSelections = Array.isArray(preview.classSelections) ? preview.classSelections : [];

    if (!classSelections.length) {
      preview.status = 'error';
      preview.issues.push('Select at least one class.');
    }

    classSelections.forEach((classPreview) => {
      preview.creditSummary.selectedCredits = roundMoney(
        Number(preview.creditSummary.selectedCredits || 0) + Number(classPreview?.credits || 0)
      );
      if (classPreview?.status === 'error') preview.status = 'error';
      if (Array.isArray(classPreview?.issues) && classPreview.issues.length) {
        preview.issues.push(...classPreview.issues.map((issue) => `${classPreview.classTitle}: ${issue}`));
      }
      if (Array.isArray(classPreview?.warnings) && classPreview.warnings.length) {
        preview.warnings.push(...classPreview.warnings.map((warning) => `${classPreview.classTitle}: ${warning}`));
      }

      const pricingTotal = Number(classPreview?.pricing?.total || 0);
      preview.financeSummary.classFeeTotal = roundMoney(
        Number(preview.financeSummary.classFeeTotal || 0) + pricingTotal
      );
      if (Array.isArray(classPreview?.pricing?.warnings) && classPreview.pricing.warnings.length) {
        preview.financeSummary.classFeeWarnings.push(
          ...classPreview.pricing.warnings.map((warning) => `${classPreview.classTitle}: ${warning}`)
        );
      }
    });

    const termRules = termRow?.termAcademicRules || {};
    preview.creditSummary.minimumRequiredCredits = Number(termRules.minimumRequiredCredits || 0) || 0;
    preview.creditSummary.totalAllowedCredits =
      termRules.totalAllowedCredits === null || termRules.totalAllowedCredits === undefined || termRules.totalAllowedCredits === ''
        ? null
        : Number(termRules.totalAllowedCredits);

    preview.creditSummary.minimumSatisfied =
      Number(preview.creditSummary.selectedCredits || 0) >= Number(preview.creditSummary.minimumRequiredCredits || 0);
    preview.creditSummary.maximumSatisfied =
      preview.creditSummary.totalAllowedCredits === null
        ? true
        : Number(preview.creditSummary.selectedCredits || 0) <= Number(preview.creditSummary.totalAllowedCredits || 0);

    if (!preview.creditSummary.minimumSatisfied) {
      preview.status = 'error';
      preview.issues.push(
        `Selected credits ${Number(preview.creditSummary.selectedCredits || 0).toFixed(2)} are below the minimum required ${Number(preview.creditSummary.minimumRequiredCredits || 0).toFixed(2)}.`
      );
    }
    if (!preview.creditSummary.maximumSatisfied) {
      preview.status = 'error';
      preview.issues.push(
        `Selected credits ${Number(preview.creditSummary.selectedCredits || 0).toFixed(2)} exceed the term limit ${Number(preview.creditSummary.totalAllowedCredits || 0).toFixed(2)}.`
      );
    }

    return preview;
  },

  applyTermPreviewTermTransactionResult(preview, termTxResult) {
    if (!preview || typeof preview !== 'object') return preview;
    const skipped = Array.isArray(termTxResult?.skipped) ? termTxResult.skipped : [];
    if (skipped.length) {
      preview.financeSummary.termTransactionWarnings.push(...skipped);
      preview.warnings.push(...skipped);
    }
    return preview;
  },

  applyTermPreviewClassTransactionResult({ preview, classPreview, classTxResult, classPreviewRows }) {
    if (!preview || typeof preview !== 'object') return preview;
    const safeRows = Array.isArray(classPreviewRows) ? classPreviewRows : [];
    const txItems = Array.isArray(classTxResult?.items) ? classTxResult.items : [];
    const skipped = Array.isArray(classTxResult?.skipped) ? classTxResult.skipped : [];
    const classLabel = String(classPreview?.classTitle || classPreview?.classId || 'Class').trim() || 'Class';

    preview.financeSummary.classTransactionItems.push(...txItems);
    preview.financeSummary.classTransactionPreview.push(...safeRows);
    preview.financeSummary.classTransactionTotal = roundMoney(
      Number(preview.financeSummary.classTransactionTotal || 0) + safeRows.reduce((sum, row) => sum + Number(row?.amount || 0), 0)
    );

    if (skipped.length) {
      const labeledWarnings = skipped.map((warning) => `${classLabel}: ${warning}`);
      preview.financeSummary.classTransactionWarnings.push(...labeledWarnings);
      preview.warnings.push(...labeledWarnings);
      preview.status = 'error';
      preview.issues.push(...labeledWarnings);
    }

    if (!safeRows.length) {
      preview.status = 'error';
      preview.issues.push(`${classLabel}: no class-fee posting rows could be generated from the selected Transaction Template.`);
    }
    return preview;
  },

  buildTermClassPreview({
    classItem,
    program,
    department,
    termId,
    student,
    effectiveDate,
    snapshot,
    subjectCatalogMap,
    selectedSubjectOwners,
    existingRosterClassIds,
    classEnrollmentCountsByClassId = null
  }) {
    const resolvedClassId = String(classItem?.id || '').trim();
    const mappedEnrollmentCount = classEnrollmentCountsByClassId instanceof Map
      ? Number(classEnrollmentCountsByClassId.get(toPublicId(resolvedClassId)) || 0)
      : null;
    const preview = {
      classId: resolvedClassId,
      classTitle: String(classItem?.title || classItem?.id || ''),
      lifecycle: buildClassLifecycleSnapshot(classItem),
      registrationMode: normalizeClassRegistrationMode(classItem?.registrationMode),
      status: 'ready',
      issues: [],
      warnings: [],
      subjectIds: [],
      subjectLabels: [],
      credits: 0,
      capacity: {
        max: Number(classItem?.enrollment?.maxCapacity || 0),
        enrolled: Number.isFinite(mappedEnrollmentCount)
          ? mappedEnrollmentCount
          : 0
      },
      pricing: {
        currency: 'CAD',
        total: 0,
        breakdown: [],
        warnings: []
      }
    };

    if (!classItem || !preview.classId) {
      preview.status = 'error';
      preview.issues.push('Selected class was not found.');
      return preview;
    }

    if (!idsEqual(classItem.orgId, program.orgId)) {
      preview.status = 'error';
      preview.issues.push('Class organization does not match the selected program.');
      return preview;
    }
    if (String(classItem.status || '').toLowerCase() !== 'active') {
      preview.status = 'error';
      preview.issues.push('Class is not active.');
    }
    if (!isClassEligibleForProgramTerm(classItem, program.id, termId)) {
      preview.status = 'error';
      preview.issues.push('Class is not enabled for the selected program and term.');
    }
    if (existingRosterClassIds.has(preview.classId)) {
      preview.status = 'error';
      preview.issues.push('Student is already actively enrolled in this class.');
    }

    const relevantSubjects = getRelevantClassSubjects(classItem, program);
    if (!relevantSubjects.length) {
      preview.status = 'error';
      preview.issues.push('Class does not contain any subjects that belong to the selected program.');
      return preview;
    }

    preview.credits = resolveClassCredits(classItem);
    if (preview.credits === null) {
      preview.status = 'error';
      preview.issues.push('Class credits are not defined. Set the class credit value before using it in term registration.');
      return preview;
    }

    const passedSubjects = new Set(asIdArray(snapshot?.results?.passedSubjects));
    relevantSubjects.forEach((subjectRef) => {
      preview.subjectIds.push(subjectRef.subjectId);
      preview.subjectLabels.push(`${subjectRef.subjectCode} - ${subjectRef.subjectName}`);

      const duplicateOwner = selectedSubjectOwners.get(subjectRef.subjectId);
      if (duplicateOwner && duplicateOwner !== preview.classId) {
        preview.status = 'error';
        preview.issues.push(`Subject ${subjectRef.subjectCode || subjectRef.subjectId} is already included in another selected class.`);
      } else {
        selectedSubjectOwners.set(subjectRef.subjectId, preview.classId);
      }

      const missingPrerequisites = subjectRef.prerequisites.filter((preId) => !passedSubjects.has(preId));
      if (missingPrerequisites.length) {
        preview.status = 'error';
        preview.issues.push(`Missing prerequisite(s) for ${subjectRef.subjectCode || subjectRef.subjectId}: ${missingPrerequisites.join(', ')}.`);
      }
    });

    const classPricing = buildClassPricingSnapshot({
      classItem,
      program,
      department,
      relevantSubjects,
      subjectCatalogMap,
      feeCategory: student.feeCategory,
      effectiveDate
    });
    preview.pricing = classPricing;
    if (Number(classPricing.total || 0) > 0 && !classPricing.appliedPostingTemplate) {
      preview.status = 'error';
      preview.issues.push('Posting Policy is missing. Add a Posting Policy for this student fee category or All Categories.');
    }
    if (classPricing.warnings.length) preview.warnings.push(...classPricing.warnings);
    if (preview.capacity.max > 0 && preview.capacity.enrolled >= preview.capacity.max) {
      preview.warnings.push('Class is at or above its configured capacity.');
    }
    if (preview.status !== 'error' && preview.warnings.length) {
      preview.status = 'warning';
    }

    return preview;
  },

  async addStudentToClassEnrollment({
    classId,
    student,
    classPreview,
    reqUser,
    registrationId,
    programRegistrationId = '',
    programId = '',
    termId = '',
    effectiveDate,
    options = {}
  }) {
    const classItem = await schoolDataService.getDataById('classes', classId, reqUser);
    if (!classItem) throw new Error(`Class ${classId} not found.`);

    const activeExistingResult = await classEnrollmentReadService.hasActiveEnrollmentForStudentInClass({
      classId,
      studentId: student?.id,
      classItem,
      reqUser,
      activeOrgId: classItem?.orgId
    });
    if (activeExistingResult?.exists) {
      const existingRow = activeExistingResult.row || {};
      return { classId, enrollmentId: String(existingRow?.enrollmentId || existingRow?.id || ''), reused: true };
    }

    await assertStudentLeaveDoesNotOverlapClass({ classItem, student, reqUser });

    const pricingSnapshot = {
      currency: String(classPreview?.pricing?.currency || 'CAD'),
      effectiveDate: String(effectiveDate || '').trim() || todayISO(),
      suggestedTotal: roundMoney(classPreview?.pricing?.total || 0),
      finalTotal: roundMoney(classPreview?.pricing?.total || 0),
      note: `Added by term registration ${registrationId}`,
      breakdown: Array.isArray(classPreview?.pricing?.breakdown) ? classPreview.pricing.breakdown : [],
      warnings: Array.isArray(classPreview?.pricing?.warnings) ? classPreview.pricing.warnings : []
    };

    const created = await schoolDataService.createClassEnrollmentPeriod({
      orgId: String(classItem?.orgId || '').trim(),
      classId: String(classId || '').trim(),
      studentId: String(student?.id || '').trim(),
      startDate: String(effectiveDate || '').trim() || todayISO(),
      status: 'active',
      authorizationRef: String(registrationId || '').trim(),
      reasonStart: `Term registration ${registrationId}`,
      personId: String(student?.personId || '').trim(),
      programRegistrationId: String(programRegistrationId || '').trim(),
      programId: String(programId || '').trim(),
      termId: String(termId || '').trim(),
      enrollmentSource: 'term_registration',
      feeCategory: String(student?.feeCategory || '').trim(),
      pricing: pricingSnapshot,
      notes: `Term registration ${registrationId}`
    }, reqUser, options);

    await indexService.rebuildIndexesForClass(classId);
    return {
      classId,
      enrollmentId: String(created?.period?.id || '').trim(),
      reused: false,
      source: 'canonical'
    };
  },

  async rollbackProgramRegistrationSideEffects({
    registrationId,
    transactionIds = [],
    academicEntryIds = [],
    reqUser,
    studentId = '',
    programId = '',
    reason = '',
    options = {}
  }) {
    return await this.rollbackRegistrationSideEffects({
      registrationId,
      transactionIds,
      academicEntryIds,
      reqUser,
      studentId,
      programId,
      reason,
      options,
      reverseEventPrefix: 'SPRREV',
      idempotencyPrefix: 'SPR-ROLLBACK',
      memoLabel: 'program registration',
      includeRosterRollback: false
    });
  },

  async rollbackTermRegistrationSideEffects({
    registrationId,
    transactionIds = [],
    academicEntryIds = [],
    rosterEntries = [],
    classEnrollmentEntries = [],
    reqUser,
    studentId = '',
    programId = '',
    reason = '',
    options = {}
  }) {
    const effectiveEnrollmentEntries = Array.isArray(classEnrollmentEntries) && classEnrollmentEntries.length
      ? classEnrollmentEntries
      : rosterEntries;
    return await this.rollbackRegistrationSideEffects({
      registrationId,
      transactionIds,
      academicEntryIds,
      rosterEntries: effectiveEnrollmentEntries,
      classEnrollmentEntries: effectiveEnrollmentEntries,
      reqUser,
      studentId,
      programId,
      reason,
      options,
      reverseEventPrefix: 'STRREV',
      idempotencyPrefix: 'STR-ROLLBACK',
      memoLabel: 'term registration',
      includeClassEnrollmentRollback: true,
      includeRosterRollback: true
    });
  },

  async rollbackRegistrationSideEffects({
    registrationId,
    transactionIds = [],
    academicEntryIds = [],
    rosterEntries = [],
    classEnrollmentEntries = [],
    reqUser,
    studentId = '',
    programId = '',
    reason = '',
    options = {},
    reverseEventPrefix = 'ROLLREV',
    idempotencyPrefix = 'ROLL-ROLLBACK',
    memoLabel = 'registration',
    includeClassEnrollmentRollback = false,
    includeRosterRollback = false
  }) {
    const txIds = asIdArray(transactionIds);
    const entryIds = asIdArray(academicEntryIds);
    const issues = [];
    const reversalIds = [];
    const voidedEntryIds = [];
    const removedClassEnrollmentEntries = [];
    let enrollmentRows = Array.isArray(classEnrollmentEntries) && classEnrollmentEntries.length
      ? classEnrollmentEntries
      : (Array.isArray(rosterEntries) ? rosterEntries : []);

    if ((includeClassEnrollmentRollback || includeRosterRollback) && !enrollmentRows.length && registrationId) {
      try {
        const classesResult = await schoolDataService.fetchData('classes', {}, reqUser);
        const classes = classesResult?.data || classesResult || [];
        const discovery = await classEnrollmentReadService.discoverClassEnrollmentRowsByRegistrationId({
          registrationId,
          reqUser,
          activeOrgId: reqUser?.activeOrgId || '',
          classes
        });
        const derivedRows = Array.isArray(discovery?.rows) ? discovery.rows : [];
        if (derivedRows.length) enrollmentRows = derivedRows;
      } catch (error) {
        issues.push(`Failed to discover class enrollments linked to registration ${registrationId}: ${error.message}`);
      }
    }

    if (txIds.length) {
      for (const txId of txIds) {
        const existingReverse = await schoolRepositories.globalTransactions.findReversalByTransactionId(txId);
        if (existingReverse) {
          reversalIds.push(String(existingReverse.id || ''));
          continue;
        }
        const original = await schoolRepositories.globalTransactions.getById(txId);
        if (!original) {
          issues.push(`Financial transaction ${txId} was not found for rollback.`);
          continue;
        }
        if (String(original.status || '').toLowerCase() !== 'posted') {
          issues.push(`Financial transaction ${txId} is not posted and could not be reversed.`);
          continue;
        }
        try {
          const reversed = await schoolRepositories.globalTransactions.reverseTransaction(txId, {
            eventId: `${reverseEventPrefix}-${registrationId}-${reversalIds.length + 1}`,
            idempotencyKey: `${idempotencyPrefix}-${registrationId}-${txId}`,
            memo: `Rollback of ${memoLabel} ${registrationId}`,
            internalNote: reason
          }, options);
          reversalIds.push(String(reversed.id || ''));
          recordTransactionOperation(options, {
            type: 'create',
            entityType: 'globalTransactions',
            id: toPublicId(reversed?.id),
            operation: 'reverse'
          });
        } catch (error) {
          issues.push(`Failed to reverse financial transaction ${txId}: ${error.message}`);
        }
      }
    }

    if (entryIds.length) {
      for (const entryId of entryIds) {
        const existing = await schoolRepositories.academicLedger.getById(entryId);
        if (!existing) {
          issues.push(`Academic ledger entry ${entryId} was not found for rollback.`);
          continue;
        }
        if (String(existing.status || '').toLowerCase() === 'void') {
          voidedEntryIds.push(String(existing.id || ''));
          continue;
        }
        try {
          const updated = await schoolRepositories.academicLedger.voidEntry(
            entryId,
            reason || `Rollback of ${memoLabel} ${registrationId}`,
            options
          );
          voidedEntryIds.push(String(updated.id || ''));
          recordTransactionOperation(options, {
            type: 'update',
            entityType: 'academicLedger',
            id: toPublicId(updated?.id),
            operation: 'void'
          });
        } catch (error) {
          issues.push(`Failed to void academic entry ${entryId}: ${error.message}`);
        }
      }
    }

    if (includeClassEnrollmentRollback || includeRosterRollback) {
      for (const enrollmentEntry of enrollmentRows) {
        const classId = String(enrollmentEntry?.classId || '').trim();
        const enrollmentId = String(enrollmentEntry?.enrollmentId || '').trim();
        if (!classId || !enrollmentId) continue;
        try {
          await schoolDataService.closeClassEnrollmentPeriod(enrollmentId, {
            status: 'cancelled',
            endDate: todayISO(),
            reasonEnd: reason || `Rollback of ${memoLabel} ${registrationId}`
          }, reqUser, options);
          await indexService.rebuildIndexesForClass(classId);
          removedClassEnrollmentEntries.push({ classId, enrollmentId });
        } catch (error) {
          issues.push(`Failed to close class enrollment entry ${enrollmentId} in ${classId}: ${error.message}`);
        }
      }
    }

    if (studentId && programId && entryIds.length) {
      try {
        await academicSnapshotService.rebuildStudentProgramSnapshot(studentId, programId);
      } catch (error) {
        issues.push(`Snapshot rebuild failed after rollback: ${error.message}`);
      }
    }

    return {
      reversalIds,
      voidedEntryIds,
      removedClassEnrollmentEntries,
      removedRosterEntries: removedClassEnrollmentEntries,
      issues
    };
  },

  async getProgramRegistrationInOrgOrThrow(registrationId, activeOrgId) {
    const registration = await schoolRepositories.studentProgramRegistrations.getByIdInOrg(registrationId, activeOrgId);
    if (!registration) {
      const existing = await schoolRepositories.studentProgramRegistrations.getById(registrationId);
      if (!existing) throw new Error('Program registration not found.');
      throw new Error('Program registration is outside the active organization.');
    }
    return registration;
  },

  async getProgramDraftForEditOrThrow(registrationId, activeOrgId) {
    const registration = await this.getProgramRegistrationInOrgOrThrow(registrationId, activeOrgId);
    if (normalizeStatus(registration.status) !== 'draft') {
      throw new Error('Only draft registrations can be edited.');
    }
    return registration;
  },

  async getProgramDraftForApproval(registrationId, activeOrgId) {
    const registration = await this.getProgramRegistrationInOrgOrThrow(registrationId, activeOrgId);
    const status = normalizeStatus(registration.status);
    if (status === 'registered') return { registration, alreadyApproved: true };
    if (status !== 'draft') {
      throw new Error('Only draft registrations can be approved.');
    }
    return { registration, alreadyApproved: false };
  },

  async assertProgramRollbackAllowed(registration, activeOrgId) {
    const registrationId = String(registration?.id || '').trim();
    if (!registrationId) throw new Error('Program registration not found.');

    const dependentCount = await schoolRepositories.studentTermRegistrations.countActiveByProgramRegistrationId(
      registrationId,
      { orgId: activeOrgId }
    );
    if (dependentCount <= 0) return;

    const dependentPreview = await schoolRepositories.studentTermRegistrations.findActiveByProgramRegistrationId(
      registrationId,
      { orgId: activeOrgId, limit: 5 }
    );
    const examples = formatDependentTermExamples(dependentPreview);
    throw new Error(
      `Cannot rollback program registration ${registrationId} because term registrations exist for it (${dependentCount}). ` +
      `Rollback the student's term registrations first. ${examples ? `Examples: ${examples}` : ''}`
    );
  },

  async getTermRegistrationInOrgOrThrow(registrationId, activeOrgId) {
    const registration = await schoolRepositories.studentTermRegistrations.getByIdInOrg(registrationId, activeOrgId);
    if (!registration) {
      const existing = await schoolRepositories.studentTermRegistrations.getById(registrationId);
      if (!existing) throw new Error('Term registration not found.');
      throw new Error('Term registration is outside the active organization.');
    }
    return registration;
  },

  async getTermDraftForApproval(registrationId, activeOrgId) {
    const registration = await this.getTermRegistrationInOrgOrThrow(registrationId, activeOrgId);
    const status = normalizeStatus(registration.status);
    if (status === 'registered') return { registration, alreadyApproved: true };
    if (status !== 'draft') {
      throw new Error('Only draft term registrations can be approved.');
    }
    return { registration, alreadyApproved: false };
  },

  async getTermDraftForEditOrThrow(registrationId, activeOrgId) {
    const registration = await this.getTermRegistrationInOrgOrThrow(registrationId, activeOrgId);
    if (normalizeStatus(registration.status) !== 'draft') {
      throw new Error('Only draft term registrations can be edited.');
    }
    return registration;
  }
};

module.exports = registrationIntegrityService;
