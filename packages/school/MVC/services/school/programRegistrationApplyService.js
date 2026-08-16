const dataService = require('./schoolDataService');
const academicLedgerService = require('./academicLedgerService');
const registrationFinanceLifecycleService = require('./registrationFinanceLifecycleService');
const registrationIntegrityService = require('./registrationIntegrityService');
const programRegistrationDraftService = require('./programRegistrationDraftService');
const programRegistrationViewService = require('./programRegistrationViewService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const { createTransactionContext, addDeleteCompensation } = requireCoreModule('MVC/services/transactionContextService');

function roundMoney(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(2));
}

function appendNote(baseNote, extraNote) {
  const base = String(baseNote || '').trim();
  const extra = String(extraNote || '').trim();
  return [base, extra].filter(Boolean).join(' | ');
}

function isZeroFeePreview(preview = {}) {
  const items = programRegistrationDraftService.normalizeDraftTransactionItems(preview.transactionItems || []);
  const chargeableItems = items.filter((item) => roundMoney(item?.amount?.value) > 0);
  return roundMoney(preview.totalAmount) === 0 && chargeableItems.length === 0;
}

function buildDraftTransactionSummary({ draftItems, draftPreviewRows, externalReference = '' } = {}) {
  return {
    previewCount: draftPreviewRows.length,
    postedCount: 0,
    totalAmount: programRegistrationDraftService.roundMoney(
      draftPreviewRows.reduce((sum, row) => sum + Number(row.amount || 0), 0)
    ),
    externalReference: externalReference || '',
    transactionIds: [],
    reversalIds: [],
    draftTransactionItems: draftItems,
    draftPreviewRows,
    draftSavedAt: new Date().toISOString()
  };
}

async function createDraftRegistrationFromPreview({
  program,
  preview,
  registrationDate,
  note = '',
  externalReference = '',
  reqUser,
  options = {}
} = {}) {
  if (!program?.id) throw new Error('Program is required.');
  if (!preview?.studentId) throw new Error('Student preview is required.');
  const draftItems = programRegistrationDraftService.normalizeDraftTransactionItems(preview.transactionItems || []);
  const draftPreviewRows = programRegistrationDraftService.buildDraftPreviewRowsFromItems(draftItems);
  let created = await dataService.addData('studentProgramRegistrations', {
    orgId: program.orgId,
    studentId: preview.studentId,
    personId: preview.personId,
    programId: program.id,
    registrationDate,
    status: 'draft',
    feeCategorySnapshot: preview.feeCategory,
    note,
    transactionSummary: buildDraftTransactionSummary({ draftItems, draftPreviewRows, externalReference }),
    academicSummary: {
      entryCount: 0,
      entryIds: [],
      voidedEntryIds: []
    }
  }, reqUser, options);

  const draftFinance = await registrationFinanceLifecycleService.ensureDraftTransactions(
    created.transactionSummary,
    draftItems,
    {
      registrationType: 'program',
      registrationId: created.id,
      orgId: created.orgId,
      reason: 'Program registration draft saved.'
    },
    { ...options, requestingUser: reqUser }
  );

  created = await dataService.updateData('studentProgramRegistrations', created.id, {
    status: 'draft',
    transactionSummary: {
      ...draftFinance.summary,
      previewCount: draftPreviewRows.length,
      postedCount: 0,
      totalAmount: programRegistrationDraftService.roundMoney(draftPreviewRows.reduce((sum, row) => sum + Number(row.amount || 0), 0)),
      externalReference: externalReference || '',
      draftTransactionItems: draftFinance.items,
      draftPreviewRows,
      draftSavedAt: new Date().toISOString()
    }
  }, reqUser, options);

  return {
    status: 'draft',
    registration: created,
    transactionCount: draftItems.length,
    totalAmount: roundMoney(preview.totalAmount),
    message: 'Draft saved. Review, edit transaction rows if needed, then approve to post.'
  };
}

async function createZeroFeeRegisteredFromPreview({
  program,
  student,
  preview,
  registrationDate,
  note = '',
  externalReference = '',
  reqUser
} = {}) {
  if (!program?.id) throw new Error('Program is required.');
  if (!student?.id) throw new Error('Student record is required.');
  if (!isZeroFeePreview(preview)) throw new Error('Only zero-fee previews can be finalized automatically.');

  const txContext = createTransactionContext({
    name: 'program_registration_zero_fee_approve',
    metadata: {
      activeOrgId: toPublicId(program.orgId || student.orgId),
      studentId: toPublicId(student.id),
      programId: toPublicId(program.id),
      requestUserId: toPublicId(reqUser?.id) || String(reqUser?.username || 'system')
    }
  });

  try {
    let created = await dataService.addData('studentProgramRegistrations', {
      orgId: program.orgId,
      studentId: student.id,
      personId: student.personId,
      programId: program.id,
      registrationDate,
      status: 'draft',
      feeCategorySnapshot: preview.feeCategory,
      note,
      transactionSummary: {
        previewCount: 0,
        postedCount: 0,
        totalAmount: 0,
        externalReference: externalReference || '',
        transactionIds: [],
        reversalIds: [],
        draftTransactionItems: [],
        draftPreviewRows: [],
        draftSavedAt: new Date().toISOString()
      },
      academicSummary: {
        entryCount: 0,
        entryIds: [],
        voidedEntryIds: []
      }
    }, reqUser, { transactionContext: txContext });

    addDeleteCompensation(txContext, {
      service: dataService,
      entityType: 'studentProgramRegistrations',
      id: toPublicId(created?.id),
      requestingUser: reqUser,
      label: 'student_program_zero_fee_registration'
    });

    const cycleState = registrationFinanceLifecycleService.beginPostingCycle(
      created.transactionSummary,
      { registrationType: 'program', registrationId: created.id }
    );
    const academicSource = registrationFinanceLifecycleService.scopeAcademicSource({
      eventId: `SPR-${created.id}`,
      idempotencyKey: `SPR|${created.id}|academic`
    }, cycleState.cycle);
    const academicEntries = await registrationFinanceLifecycleService.postAcademicEntriesIdempotently({
      source: academicSource,
      options: { transactionContext: txContext },
      post: () => academicLedgerService.postProgramRegistration({
        reqUser,
        student,
        program,
        effectiveDate: registrationDate,
        note,
        source: academicSource,
        options: { transactionContext: txContext }
      })
    });

    const now = new Date().toISOString();
    const transactionSummary = registrationFinanceLifecycleService.updatePostingCycle(
      cycleState.summary,
      cycleState.cycle.cycleNo,
      {
        status: 'posted',
        postedAt: now,
        transactionIds: [],
        reversalIds: [],
        unresolvedTransactionIds: [],
        issues: []
      },
      { registrationType: 'program', registrationId: created.id }
    );

    created = await dataService.updateData('studentProgramRegistrations', created.id, {
      status: 'registered',
      registrationDate,
      feeCategorySnapshot: preview.feeCategory,
      note: appendNote(created.note, ''),
      transactionSummary: {
        ...transactionSummary,
        previewCount: 0,
        postedCount: 0,
        totalAmount: 0,
        externalReference: externalReference || '',
        draftTransactionItems: [],
        draftPreviewRows: [],
        approvedAt: now,
        approvedBy: toPublicId(reqUser?.id) || String(reqUser?.username || 'system')
      },
      academicSummary: {
        entryCount: academicEntries.length,
        entryIds: academicEntries.map((entry) => toPublicId(entry.id)).filter(Boolean),
        voidedEntryIds: []
      }
    }, reqUser, { transactionContext: txContext });

    await txContext.commit({ registrationId: toPublicId(created?.id), flow: 'program_zero_fee_approval' });

    return {
      status: 'finalized',
      registration: created,
      transactionCount: 0,
      totalAmount: 0,
      message: 'Zero-fee registration finalized automatically.'
    };
  } catch (error) {
    await txContext.rollback({ flow: 'program_zero_fee_approval', reason: error.message || 'Zero-fee registration failed' });
    throw error;
  }
}

async function processSingleStudentProgramRegistration({
  student,
  programId,
  registrationDate,
  note = '',
  externalReference = '',
  activeOrgId,
  reqUser,
  autoApproveZeroFee = false
} = {}) {
  const program = await dataService.getDataById('programs', programId, reqUser);
  if (!program) throw new Error('Program not found or inaccessible.');
  await registrationIntegrityService.getProgramInOrgOrThrow(program.id, activeOrgId, reqUser);

  const preview = await programRegistrationViewService.buildStudentRegistrationPreview(program, student, reqUser, {
    effectiveDate: registrationDate,
    sourceEventType: 'program_registration_fee',
    externalReference
  });

  if (preview.status === 'error') {
    return {
      status: 'error',
      programId: program.id,
      programLabel: [String(program.code || program.id || ''), String(program.name || '')].filter(Boolean).join(' - '),
      studentId: preview.studentId,
      studentName: preview.studentName,
      feeCategory: preview.feeCategory,
      studentAccountId: preview.studentAccountId,
      totalAmount: preview.totalAmount,
      transactionCount: preview.transactionCount,
      issues: preview.issues,
      message: preview.issues.join(' ')
    };
  }

  const result = autoApproveZeroFee && isZeroFeePreview(preview)
    ? await createZeroFeeRegisteredFromPreview({ program, student, preview, registrationDate, note, externalReference, reqUser })
    : await createDraftRegistrationFromPreview({ program, preview, registrationDate, note, externalReference, reqUser });

  return {
    status: result.status,
    registrationId: result.registration?.id,
    programId: program.id,
    programLabel: [String(program.code || program.id || ''), String(program.name || '')].filter(Boolean).join(' - '),
    studentId: preview.studentId,
    studentName: preview.studentName,
    feeCategory: preview.feeCategory,
    studentAccountId: preview.studentAccountId,
    totalAmount: result.totalAmount,
    transactionCount: result.transactionCount,
    message: result.message
  };
}

function summarizeRegistrationResults(results = []) {
  const rows = Array.isArray(results) ? results : [];
  const finalizedCount = rows.filter((row) => row.status === 'finalized').length;
  const draftCount = rows.filter((row) => row.status === 'draft').length;
  const errorCount = rows.filter((row) => row.status === 'error').length;
  const successCount = finalizedCount + draftCount;
  const status = successCount && errorCount ? 'warning' : (errorCount && !successCount ? 'error' : 'success');
  const message = successCount || errorCount
    ? `Program registration completed. ${finalizedCount} finalized, ${draftCount} draft${draftCount === 1 ? '' : 's'}, ${errorCount} failed.`
    : 'No program registrations were selected.';
  return { status, message, finalizedCount, draftCount, errorCount, results: rows };
}

module.exports = {
  isZeroFeePreview,
  createDraftRegistrationFromPreview,
  createZeroFeeRegisteredFromPreview,
  processSingleStudentProgramRegistration,
  summarizeRegistrationResults
};
