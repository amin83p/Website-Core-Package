const dataService = require('./schoolDataService');
const { requireCoreModule } = require('./schoolCoreContracts');
const schoolRepositories = require('../../repositories/school');
const academicSnapshotService = require('./academicSnapshotService');
const programTransactionService = require('./programTransactionService');
const programRegistrationDraftService = require('./programRegistrationDraftService');
const registrationIntegrityService = require('./registrationIntegrityService');
const classEnrollmentReadService = require('./classEnrollmentReadService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');

function asIdArray(value) {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)));
}

function roundMoney(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(2));
}

function resolveStudentName(person, student) {
  return schoolPersonAccessService.formatPersonName(person, String(student?.id || ''));
}

function matchesSearch(haystacks, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return haystacks.some((value) => String(value || '').toLowerCase().includes(q));
}

function getVerificationBadgeClass(status) {
  if (status === 'verified') return 'bg-success';
  if (status === 'partial') return 'bg-warning text-dark';
  if (status === 'rolled_back') return 'bg-secondary';
  if (status === 'failed') return 'bg-danger';
  return 'bg-info text-dark';
}

function isActiveRegistrationStatus(status) {
  return !['withdrawn', 'cancelled', 'completed', 'rolled_back'].includes(String(status || '').toLowerCase());
}

function isApprovedProgramRegistrationStatus(status) {
  return String(status || '').trim().toLowerCase() === 'registered';
}

function isActiveTermStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'active' || normalized === 'started';
}

function normalizeRegistrationMode(value) {
  return String(value || '').trim().toLowerCase() === 'rolling' ? 'rolling' : 'term_based';
}

function buildClassLifecycleSnapshot(classRow = {}) {
  const registrationMode = normalizeRegistrationMode(classRow?.registrationMode);
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

async function buildTermRegistrationPreview({
  studentId,
  programRegistrationId,
  termId,
  classIds,
  reqUser,
  requestBody = {},
  ignoreRegistrationId = ''
}) {
  const effectiveDate = String(requestBody.effectiveDate || '').trim() || new Date().toISOString().slice(0, 10);
  const selectedClassIds = asIdArray(classIds);

  const dependencyContext = await registrationIntegrityService.resolveTermPreviewDependencyContext({
    studentId,
    programRegistrationId,
    termId,
    ignoreRegistrationId,
    reqUser
  });
  const student = dependencyContext.student;
  const person = student?.personId
    ? await schoolPersonAccessService.getPersonById({ reqUser, personId: student.personId })
    : null;

  const [
    classes,
    subjects,
    departments,
    transactionDefinitions,
    allAccounts
  ] = await Promise.all([
    dataService.fetchData('classes', {}, reqUser),
    dataService.fetchData('subjects', {}, reqUser),
    dataService.fetchData('departments', {}, reqUser),
    dataService.fetchData('transactionDefinitions', {}, reqUser),
    dataService.fetchData('schoolAccounts', {}, reqUser)
  ]);

  const preview = {
    student: {
      id: String(student.id || ''),
      personId: String(student.personId || ''),
      name: resolveStudentName(person, student),
      feeCategory: String(student.feeCategory || ''),
      studentAccountId: String(student.studentAccountId || '')
    },
    programRegistration: null,
    term: null,
    status: 'ready',
    issues: [],
    warnings: [],
    classSelections: [],
    creditSummary: {
      selectedCredits: 0,
      minimumRequiredCredits: 0,
      totalAllowedCredits: null,
      minimumSatisfied: true,
      maximumSatisfied: true
    },
    financeSummary: {
      currency: 'CAD',
      termTransactionPreview: [],
      termTransactionItems: [],
      termTransactionTotal: 0,
      termTransactionWarnings: [],
      classTransactionPreview: [],
      classTransactionItems: [],
      classTransactionTotal: 0,
      classTransactionWarnings: [],
      classFeeTotal: 0,
      classFeeWarnings: [],
      grandTotal: 0
    }
  };

  if (!student) throw new Error('Student not found or inaccessible.');
  if (Array.isArray(dependencyContext.issues) && dependencyContext.issues.length) {
    preview.status = 'error';
    preview.issues.push(...dependencyContext.issues);
  }

  if (dependencyContext.fatal) return preview;
  const programRegistration = dependencyContext.programRegistration;
  const program = dependencyContext.program;
  const term = dependencyContext.term;
  const termRow = dependencyContext.termRow;

  preview.programRegistration = {
    id: String(programRegistration.id || ''),
    programId: String(program.id || ''),
    programCode: String(program.code || '').trim(),
    programName: String(program.name || '').trim(),
    registrationDate: String(programRegistration.registrationDate || '')
  };

  preview.term = {
    id: String(term.id || ''),
    code: String(term.code || termRow.termCode || '').trim(),
    name: String(term.name || termRow.termName || '').trim(),
    order: Number(termRow.order || 0),
    rules: termRow.termAcademicRules || {}
  };

  const snapshot = await academicSnapshotService.rebuildStudentProgramSnapshot(student.id, program.id);
  const classMap = new Map(classes.map((row) => [toPublicId(row.id), row]));
  const departmentMap = new Map(departments.map((row) => [toPublicId(row.id), row]));
  const subjectCatalogMap = new Map(subjects.map((row) => [toPublicId(row.id), row]));
  const activeOrgId = String(program?.orgId || student?.orgId || '').trim();
  const existingRosterClassIdsResult = await classEnrollmentReadService.getActiveClassIdsForStudent({
    studentId: student.id,
    classes,
    reqUser,
    activeOrgId
  });
  const existingRosterClassIds = existingRosterClassIdsResult.classIds || new Set();
  const enrollmentCountResult = await classEnrollmentReadService.buildClassEnrollmentCountMap({
    classes,
    reqUser,
    activeOrgId
  });
  const classEnrollmentCountsByClassId = enrollmentCountResult.map || new Map();
  const selectedSubjectOwners = new Map();

  selectedClassIds.forEach((classId) => {
    const classItem = classMap.get(classId);
    const resolvedDepartmentId = String(program?.departmentId || classItem?.deliveryDepartmentId || '').trim();
    preview.classSelections.push(registrationIntegrityService.buildTermClassPreview({
      classItem,
      program,
      department: resolvedDepartmentId ? (departmentMap.get(resolvedDepartmentId) || null) : null,
      termId,
      student,
      effectiveDate,
      snapshot,
      subjectCatalogMap,
      selectedSubjectOwners,
      existingRosterClassIds,
      classEnrollmentCountsByClassId
    }));
  });

  registrationIntegrityService.applyTermPreviewClassAndCreditRules(preview, termRow);

  const termTxResult = programTransactionService.buildTransactionsForFeeLines({
    feeGroups: termRow.termRegistrationFeeGroups,
    feeCategory: preview.student.feeCategory,
    student,
    transactionDefinitions,
    allAccounts,
    reqUser,
    requestBody: {
      ...requestBody,
      effectiveDate,
      sourceEventType: 'term_registration_fee',
      sourceEventId: requestBody.sourceEventId || `TRMREG-${student.id}-${program.id}-${term.id}`,
      idempotencyKey: requestBody.idempotencyKey || `TRMREG|${student.id}|${program.id}|${term.id}|${effectiveDate}`,
      externalReference: requestBody.externalReference || ''
    },
    orgId: program.orgId,
    sourceModule: 'school_term_registration',
    sourceType: 'term_transaction_definition',
    sourceEventType: 'term_registration_fee',
    sourceEventIdBase: requestBody.sourceEventId || `TRMREG-${student.id}-${program.id}-${term.id}`,
    idempotencyBase: requestBody.idempotencyKey || `TRMREG|${student.id}|${program.id}|${term.id}|${effectiveDate}`,
    externalReference: requestBody.externalReference || '',
    party: {
      programId: String(program.id || ''),
      termId: String(term.id || '')
    },
    memoLabel: 'Term transaction',
    internalNote: `Term registration transaction applied (${program.id}/${term.id})`,
    metadata: {
      programId: String(program.id || ''),
      termId: String(term.id || '')
    }
  });

  preview.financeSummary.termTransactionItems = termTxResult.items;
  preview.financeSummary.termTransactionPreview = programTransactionService.buildPreviewRowsFromTransactions(termTxResult.items);
  preview.financeSummary.termTransactionTotal = roundMoney(
    preview.financeSummary.termTransactionPreview.reduce((sum, row) => sum + Number(row.amount || 0), 0)
  );
  registrationIntegrityService.applyTermPreviewTermTransactionResult(preview, termTxResult);

  preview.classSelections.forEach((classPreview) => {
    const appliedPostingTemplate = classPreview?.pricing?.appliedPostingTemplate || null;
    const classFeeAmount = roundMoney(classPreview?.pricing?.total || 0);
    if (!appliedPostingTemplate || !(classFeeAmount > 0)) return;

    const classTxResult = programTransactionService.buildTransactionsForFeeLines({
      feeGroups: {
        [preview.student.feeCategory]: [{
          feeCategory: preview.student.feeCategory,
          amount: classFeeAmount,
          currency: String(classPreview?.pricing?.currency || 'CAD').trim().toUpperCase() || 'CAD',
          transactionDefinitionId: String(appliedPostingTemplate.transactionDefinitionId || '').trim(),
          transactionDefinitionCode: String(appliedPostingTemplate.transactionDefinitionCode || '').trim().toUpperCase(),
          notes: String(appliedPostingTemplate.notes || '').trim()
        }]
      },
      feeCategory: preview.student.feeCategory,
      student,
      transactionDefinitions,
      allAccounts,
      reqUser,
      requestBody: {
        ...requestBody,
        effectiveDate,
        sourceEventType: 'class_fee',
        sourceEventId: requestBody.sourceEventId || `TRMCLASS-${student.id}-${program.id}-${term.id}-${classPreview.classId}`,
        idempotencyKey: requestBody.idempotencyKey || `TRMCLASS|${student.id}|${program.id}|${term.id}|${classPreview.classId}|${effectiveDate}`,
        externalReference: requestBody.externalReference || ''
      },
      orgId: program.orgId,
      sourceModule: 'school_term_registration',
      sourceType: 'class_transaction_definition',
      sourceEventType: 'class_fee',
      sourceEventIdBase: requestBody.sourceEventId || `TRMCLASS-${student.id}-${program.id}-${term.id}-${classPreview.classId}`,
      idempotencyBase: requestBody.idempotencyKey || `TRMCLASS|${student.id}|${program.id}|${term.id}|${classPreview.classId}|${effectiveDate}`,
      externalReference: requestBody.externalReference || '',
      party: {
        programId: String(program.id || ''),
        termId: String(term.id || ''),
        classId: String(classPreview.classId || '')
      },
      fee: {
        classId: String(classPreview.classId || '')
      },
      memoLabel: 'Class transaction',
      internalNote: `Class fee transaction applied (${program.id}/${term.id}/${classPreview.classId})`,
      metadata: {
        programId: String(program.id || ''),
        termId: String(term.id || ''),
        classId: String(classPreview.classId || '')
      }
    });

    const classPreviewRows = programTransactionService.buildPreviewRowsFromTransactions(classTxResult.items).map((row) => ({
      ...row,
      classId: String(classPreview.classId || ''),
      classTitle: String(classPreview.classTitle || classPreview.classId || ''),
      transactionDefinitionCode: String(appliedPostingTemplate.transactionDefinitionCode || '').trim().toUpperCase(),
      transactionDefinitionName: String(appliedPostingTemplate.transactionDefinitionName || '').trim()
    }));

    registrationIntegrityService.applyTermPreviewClassTransactionResult({
      preview,
      classPreview,
      classTxResult,
      classPreviewRows
    });
  });

  preview.financeSummary.currency = preview.financeSummary.termTransactionPreview[0]?.currency
    || preview.financeSummary.classTransactionPreview[0]?.currency
    || preview.classSelections.find((row) => row.pricing?.currency)?.pricing?.currency
    || 'CAD';
  preview.financeSummary.grandTotal = roundMoney(preview.financeSummary.termTransactionTotal + preview.financeSummary.classFeeTotal);

  if (preview.status !== 'error' && preview.warnings.length) preview.status = 'warning';
  return preview;
}

async function buildRegistrationSummaries(reqUser, activeOrgId, { limit = null, registrationId = '', filters = {} } = {}) {
  const [registrations, students, programs, terms, allTransactions, allEntries] = await Promise.all([
    schoolRepositories.studentTermRegistrations.list({ query: {}, scope: { canViewAll: true } }),
    dataService.fetchData('students', {}, reqUser),
    dataService.fetchData('programs', {}, reqUser),
    dataService.fetchData('terms', {}, reqUser),
    schoolRepositories.globalTransactions.list({ query: {}, scope: { canViewAll: true } }),
    schoolRepositories.academicLedger.list({ query: {}, scope: { canViewAll: true } })
  ]);

  const studentMap = new Map(students.map((row) => [toPublicId(row.id), row]));
  const personMap = await schoolPersonAccessService.buildPersonByIdMap({
    reqUser,
    personIds: (Array.isArray(students) ? students : []).map((student) => student.personId)
  });
  const programMap = new Map(programs.map((row) => [toPublicId(row.id), row]));
  const termMap = new Map(terms.map((row) => [toPublicId(row.id), row]));
  const transactionMap = new Map(allTransactions.map((row) => [toPublicId(row.id), row]));
  const academicMap = new Map(allEntries.map((row) => [toPublicId(row.id), row]));

  const normalizedStatus = String(filters.status || '').trim().toLowerCase();
  const normalizedVerification = String(filters.verificationStatus || '').trim().toLowerCase();
  const normalizedStudentId = String(filters.studentId || '').trim();
  const searchQuery = String(filters.q || '').trim();

  let rows = registrations
    .filter((row) => idsEqual(row.orgId, activeOrgId))
    .filter((row) => !registrationId || idsEqual(row.id, registrationId))
    .sort((a, b) => {
      const aTime = new Date(a?.audit?.lastUpdateDateTime || a?.audit?.createDateTime || a?.registrationDate || 0).getTime();
      const bTime = new Date(b?.audit?.lastUpdateDateTime || b?.audit?.createDateTime || b?.registrationDate || 0).getTime();
      return bTime - aTime;
    })
    .map((registration) => {
      const student = studentMap.get(toPublicId(registration.studentId)) || null;
      const person = student?.personId ? personMap.get(toPublicId(student.personId)) : null;
      const program = programMap.get(toPublicId(registration.programId)) || null;
      const term = termMap.get(toPublicId(registration.termId)) || null;

      const transactionIds = asIdArray(registration?.transactionSummary?.transactionIds);
      const reversalIds = asIdArray(registration?.transactionSummary?.reversalIds);
      const academicEntryIds = asIdArray(registration?.academicSummary?.entryIds);
      const voidedEntryIds = asIdArray(registration?.academicSummary?.voidedEntryIds);

      const financeExpected = Math.max(
        transactionIds.length,
        Number(registration?.transactionSummary?.postedCount || 0),
        Number(registration?.transactionSummary?.previewCount || 0)
      );
      const academicExpected = Math.max(
        academicEntryIds.length,
        Number(registration?.academicSummary?.entryCount || 0),
        Number(registration?.academicSummary?.expectedEntryCount || 0)
      );
      const postedTransactions = transactionIds.filter((id) => String(transactionMap.get(id)?.status || '').toLowerCase() === 'posted').length;
      const reversedTransactions = reversalIds.filter((id) => transactionMap.has(id)).length;
      const postedAcademicEntries = academicEntryIds.filter((id) => String(academicMap.get(id)?.status || '').toLowerCase() === 'posted').length;
      const voidedAcademicEntries = voidedEntryIds.filter((id) => String(academicMap.get(id)?.status || '').toLowerCase() === 'void').length;

      let verificationStatus = 'pending';
      if (String(registration.status || '').toLowerCase() === 'registered') {
        verificationStatus = postedTransactions === financeExpected && postedAcademicEntries === academicExpected
          ? 'verified'
          : 'partial';
      } else if (String(registration.status || '').toLowerCase() === 'rolled_back') {
        verificationStatus = 'rolled_back';
      } else if (String(registration.status || '').toLowerCase() === 'error') {
        verificationStatus = 'failed';
      }

      return {
        id: registration.id,
        status: registration.status,
        verificationStatus,
        registrationDate: registration.registrationDate,
        studentId: registration.studentId,
        studentRecordId: toPublicId(registration.studentId),
        studentName: resolveStudentName(person, student || registration),
        programId: registration.programId,
        programLabel: [String(program?.code || registration.programId || ''), String(program?.name || '')].filter(Boolean).join(' - '),
        termId: registration.termId,
        termLabel: [String(term?.code || registration.termId || ''), String(term?.name || '')].filter(Boolean).join(' - '),
        feeCategorySnapshot: registration.feeCategorySnapshot || '',
        classCount: Number(registration?.classSummary?.count || 0),
        selectedCredits: Number(registration?.creditSummary?.selectedCredits || 0),
        note: registration.note || '',
        finance: {
          expected: financeExpected,
          posted: postedTransactions,
          reversed: reversedTransactions,
          totalAmount: Number(registration?.transactionSummary?.termTransactionTotal || 0)
        },
        academic: {
          expected: academicExpected,
          posted: postedAcademicEntries,
          voided: voidedAcademicEntries
        },
        statusBadgeClass: getVerificationBadgeClass(verificationStatus),
        canApprove: String(registration.status || '').toLowerCase() === 'draft',
        canDeleteDraft: String(registration.status || '').toLowerCase() === 'draft',
        canRollback: ['registered', 'error'].includes(String(registration.status || '').toLowerCase()),
        transactionIds,
        reversalIds,
        academicEntryIds,
        voidedEntryIds
      };
    });

  rows = rows.filter((row) => {
    if (normalizedStatus && String(row.status || '').toLowerCase() !== normalizedStatus) return false;
    if (normalizedVerification && String(row.verificationStatus || '').toLowerCase() !== normalizedVerification) return false;
    if (normalizedStudentId && !idsEqual(row.studentId, normalizedStudentId)) return false;
    if (!matchesSearch([row.id, row.studentId, row.studentName, row.programLabel, row.termLabel, row.feeCategorySnapshot, row.note], searchQuery)) return false;
    return true;
  });

  if (Number.isFinite(limit) && limit > 0) rows = rows.slice(0, limit);
  return rows;
}

async function buildRegistrationDetail(reqUser, activeOrgId, registrationId) {
  const rows = await buildRegistrationSummaries(reqUser, activeOrgId, { registrationId, limit: 1 });
  const summary = rows[0] || null;
  if (!summary) return null;

  const [record, allTransactions, allEntries] = await Promise.all([
    schoolRepositories.studentTermRegistrations.getById(registrationId),
    schoolRepositories.globalTransactions.list({ query: {}, scope: { canViewAll: true } }),
    schoolRepositories.academicLedger.list({ query: {}, scope: { canViewAll: true } })
  ]);

  const transactionMap = new Map(allTransactions.map((row) => [toPublicId(row.id), row]));
  const academicMap = new Map(allEntries.map((row) => [toPublicId(row.id), row]));
  const postedTransactions = summary.transactionIds
    .map((id) => transactionMap.get(toPublicId(id)))
    .filter(Boolean);
  const draftTermItems = Array.isArray(record?.transactionSummary?.draftTermTransactionItems)
    ? record.transactionSummary.draftTermTransactionItems
    : [];
  const draftClassItems = Array.isArray(record?.transactionSummary?.draftClassTransactionItems)
    ? record.transactionSummary.draftClassTransactionItems
    : [];
  const combinedDraftItems = draftTermItems.concat(draftClassItems);
  const pendingDraftTransactions = combinedDraftItems
    .filter(Boolean)
    .map((row, index) => ({
      ...row,
      id: String(row?.id || row?.source?.eventId || row?.source?.idempotencyKey || `DRAFT-TX-${index + 1}`),
      status: 'draft',
      __isPendingDraft: true
    }));
  const draftPreviewRows = programRegistrationDraftService.buildDraftPreviewRowsFromItems(combinedDraftItems);
  const financialTransactions = postedTransactions
    .map((row) => ({ ...row, __isPendingDraft: false }))
    .concat(pendingDraftTransactions);

  return {
    ...summary,
    record,
    postedTransactions,
    pendingDraftTransactions,
    draftPreviewRows,
    financialTransactions,
    reversalTransactions: summary.reversalIds.map((id) => transactionMap.get(toPublicId(id))).filter(Boolean),
    academicEntries: summary.academicEntryIds.map((id) => academicMap.get(toPublicId(id))).filter(Boolean),
    voidedAcademicEntries: summary.voidedEntryIds.map((id) => academicMap.get(toPublicId(id))).filter(Boolean)
  };
}

async function buildActiveProgramRegistrationOptions(reqUser, activeOrgId) {
  const [students, programs, terms, programRegistrations, termRegistrations] = await Promise.all([
    dataService.fetchData('students', {}, reqUser),
    dataService.fetchData('programs', {}, reqUser),
    dataService.fetchData('terms', {}, reqUser),
    schoolRepositories.studentProgramRegistrations.list({ query: {}, scope: { canViewAll: true } }),
    schoolRepositories.studentTermRegistrations.list({ query: {}, scope: { canViewAll: true } })
  ]);

  const personMap = await schoolPersonAccessService.buildPersonByIdMap({
    reqUser,
    personIds: (Array.isArray(students) ? students : []).map((student) => student.personId)
  });
  const programMap = new Map(programs.map((row) => [toPublicId(row.id), row]));
  const termMap = new Map(terms.map((row) => [toPublicId(row.id), row]));

  return programRegistrations
    .filter((row) => idsEqual(row.orgId, activeOrgId))
    .filter((row) => isApprovedProgramRegistrationStatus(row.status))
    .map((row) => {
      const student = students.find((item) => idsEqual(item.id, row.studentId)) || null;
      const person = student?.personId ? personMap.get(toPublicId(student.personId)) : null;
      const program = programMap.get(toPublicId(row.programId)) || null;
      const registeredTermIds = new Set(
        termRegistrations
          .filter((termReg) =>
            idsEqual(termReg.studentId, row.studentId) &&
            idsEqual(termReg.programId, row.programId) &&
            isActiveRegistrationStatus(termReg.status)
          )
          .map((termReg) => toPublicId(termReg.termId))
      );
      const termOptions = (Array.isArray(program?.terms) ? program.terms : []).map((termRow) => {
        const term = termMap.get(toPublicId(termRow.termId)) || null;
        return {
          termId: String(termRow.termId || ''),
          termCode: String(termRow.termCode || term?.code || '').trim(),
          termName: String(termRow.termName || term?.name || '').trim(),
          termStatus: String(term?.status || '').trim().toLowerCase(),
          order: Number(termRow.order || 0),
          isRequired: Boolean(termRow.isRequired),
          alreadyRegistered: registeredTermIds.has(toPublicId(termRow.termId)),
          rules: termRow.termAcademicRules || {}
        };
      }).filter((termRow) => isActiveTermStatus(termRow.termStatus));

      return {
        id: String(row.id || ''),
        studentId: String(row.studentId || ''),
        studentRecordId: toPublicId(row.studentId),
        studentName: resolveStudentName(person, student || row),
        programId: String(row.programId || ''),
        programCode: String(program?.code || '').trim(),
        programName: String(program?.name || '').trim(),
        registrationDate: String(row.registrationDate || ''),
        feeCategory: String(student?.feeCategory || row.feeCategorySnapshot || ''),
        programSubjectIds: Array.isArray(program?.subjects) ? program.subjects.map((subject) => String(subject.subjectId || '')).filter(Boolean) : [],
        termOptions
      };
    })
    .filter((row) => row.studentId && row.programId)
    .sort((a, b) => a.studentName.localeCompare(b.studentName) || a.programName.localeCompare(b.programName));
}

async function buildClassCatalogOptions(reqUser, activeOrgId) {
  const classes = await dataService.fetchData('classes', {}, reqUser);
  const enrollmentCountsResult = await classEnrollmentReadService.buildClassEnrollmentCountMap({
    classes,
    reqUser,
    activeOrgId
  });
  const enrollmentCountMap = enrollmentCountsResult.map || new Map();
  return classes
    .filter((row) => idsEqual(row.orgId, activeOrgId))
    .map((row) => {
      const lifecycle = buildClassLifecycleSnapshot(row);
      return {
        id: String(row.id || ''),
        title: String(row.title || row.id || ''),
        status: String(row.status || ''),
        credits: Number.isFinite(Number(row?.credits)) ? roundMoney(row.credits) : null,
        deliveryDepartmentName: String(row.deliveryDepartmentName || '').trim(),
        curriculumSubjects: Array.isArray(row?.curriculum?.subjects) ? row.curriculum.subjects.map((subjectRef) => ({
          subjectId: String(subjectRef?.subjectId || ''),
          code: String(subjectRef?.code || '').trim(),
          name: String(subjectRef?.name || '').trim()
        })) : [],
        allowedProgramTerms: Array.isArray(row.allowedProgramTerms) ? row.allowedProgramTerms : [],
        enrolledCount: Number(enrollmentCountMap.get(toPublicId(row.id)) || 0),
        maxCapacity: Number(row?.enrollment?.maxCapacity || 0),
        lifecycle,
        registrationMode: lifecycle.registrationMode,
        cycleNo: lifecycle.cycleNo,
        cycleGroupId: lifecycle.cycleGroupId,
        cycleStartDate: lifecycle.cycleStartDate,
        cycleEndDate: lifecycle.cycleEndDate,
        isClosedForNewEnrollment: lifecycle.isClosedForNewEnrollment,
        previousClassId: lifecycle.previousClassId,
        nextClassId: lifecycle.nextClassId
      };
    });
}

function countExpectedAcademicEntries(preview) {
  const classRows = Array.isArray(preview?.classSelections) ? preview.classSelections : [];
  const subjectEntryCount = classRows.reduce((sum, row) => sum + asIdArray(row?.subjectIds).length, 0);
  return Math.max(0, 1 + subjectEntryCount);
}

module.exports = {
  buildTermRegistrationPreview,
  buildRegistrationSummaries,
  buildRegistrationDetail,
  buildActiveProgramRegistrationOptions,
  buildClassCatalogOptions,
  countExpectedAcademicEntries
};
