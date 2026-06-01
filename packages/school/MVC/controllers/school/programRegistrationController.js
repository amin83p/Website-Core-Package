const dataService = require('../../services/school/schoolDataService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const { createTransactionContext } = requireCoreModule('MVC/services/transactionContextService');

const paginate = requireCoreModule('MVC/utils/paginationHelper');
const academicLedgerService = require('../../services/school/academicLedgerService');
const registrationIntegrityService = require('../../services/school/registrationIntegrityService');
const programRegistrationViewService = require('../../services/school/programRegistrationViewService');
const { PROGRAM_REGISTRATION_LIST_SEARCHABLE_FIELDS } = programRegistrationViewService;
const programRegistrationDraftService = require('../../services/school/programRegistrationDraftService');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');
const {
  getActiveOrgIdOrThrow,
  assertCreateOrgContextOrThrow,
  canCreateOrgScopedItem
} = requireCoreModule('MVC/utils/orgContextUtils');

function parseJsonSafe(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

function asIdArray(value) {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map((item) => toPublicId(item))
    .filter(Boolean)));
}

function asSortedIdArray(value) {
  return asIdArray(value).sort((a, b) => String(a).localeCompare(String(b)));
}

function buildRollbackNote(baseNote, errorMessage, rollbackIssues = []) {
  return [baseNote, errorMessage, ...rollbackIssues].filter(Boolean).join(' | ');
}

function appendNote(baseNote, extraNote) {
  const base = String(baseNote || '').trim();
  const extra = String(extraNote || '').trim();
  return [base, extra].filter(Boolean).join(' | ');
}

function roundMoney(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(2));
}

function sendGuardedResponse(res, guardResult, duplicateMessage, duplicateStatus = 409) {
  if (!guardResult || guardResult.status === 'acquired') return false;
  if (guardResult.status === 'busy') {
    res.status(duplicateStatus).json({
      status: 'warning',
      message: duplicateMessage,
      idempotency: {
        state: 'busy',
        retryAfterMs: Number(guardResult.retryAfterMs || 0)
      }
    });
    return true;
  }
  if (guardResult.status === 'replay') {
    const payload = guardResult.payload && typeof guardResult.payload === 'object'
      ? { ...guardResult.payload }
      : { status: 'success' };
    payload.idempotency = { state: 'replayed' };
    res.json(payload);
    return true;
  }
  return false;
}

function sanitizeCurrency(value) {
  const code = String(value || 'CAD').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

async function buildPostableAccountMap(reqUser, activeOrgId) {
  const allowedOrgIds = new Set([toPublicId(activeOrgId), 'SYSTEM']);
  const rows = await dataService.fetchData('schoolAccounts', {}, reqUser);
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach((account) => {
    const accountId = toPublicId(account?.id);
    if (!accountId) return;
    if (!allowedOrgIds.has(toPublicId(account?.orgId))) return;
    if (!Boolean(account?.allowPost)) return;
    if (String(account?.status || '').toLowerCase() !== 'active') return;
    map.set(accountId, account);
  });
  return map;
}

function normalizeAddedRows(rowsInput) {
  const rows = Array.isArray(rowsInput) ? rowsInput : [];
  return rows
    .map((row) => ({
      include: !(row?.include === false || String(row?.include || '').toLowerCase() === 'false' || String(row?.include || '') === '0'),
      debitAccountId: toPublicId(row?.debitAccountId || row?.debitAccount?.id || ''),
      creditAccountId: toPublicId(row?.creditAccountId || row?.creditAccount?.id || ''),
      amount: Number(row?.amount),
      currency: sanitizeCurrency(row?.currency || 'CAD'),
      memo: String(row?.memo || '').trim()
    }))
    .filter((row) => row.include);
}

function enrichEditedRowsWithAccountSnapshots(rowsInput, accountMap, labelPrefix = 'Draft row') {
  const rows = Array.isArray(rowsInput) ? rowsInput : [];
  return rows.map((row, index) => {
    const next = { ...(row || {}) };
    const debitAccountId = toPublicId(next?.debitAccountId || next?.debitAccount?.id || '');
    const creditAccountId = toPublicId(next?.creditAccountId || next?.creditAccount?.id || '');
    if (!debitAccountId && !creditAccountId) return next;

    if (debitAccountId && creditAccountId && debitAccountId === creditAccountId) {
      throw new Error(`${labelPrefix} #${index + 1} cannot use the same account for debit and credit.`);
    }

    if (debitAccountId) {
      const debitAccount = accountMap.get(debitAccountId);
      if (!debitAccount) throw new Error(`${labelPrefix} #${index + 1} debit account is invalid or not postable.`);
      next.debitAccount = {
        id: toPublicId(debitAccount.id),
        code: String(debitAccount.code || '').trim(),
        name: String(debitAccount.name || '').trim()
      };
    }

    if (creditAccountId) {
      const creditAccount = accountMap.get(creditAccountId);
      if (!creditAccount) throw new Error(`${labelPrefix} #${index + 1} credit account is invalid or not postable.`);
      next.creditAccount = {
        id: toPublicId(creditAccount.id),
        code: String(creditAccount.code || '').trim(),
        name: String(creditAccount.name || '').trim()
      };
    }

    return next;
  });
}

function buildManualDraftTransactionPair({
  registration,
  debitAccount,
  creditAccount,
  amount,
  currency,
  memo,
  lineKey,
  requestUser
}) {
  const nowIso = new Date().toISOString();
  const effectiveDate = String(registration?.registrationDate || '').trim() || nowIso.slice(0, 10);
  const orgId = toPublicId(registration?.orgId || '');
  const feeCategory = String(registration?.feeCategorySnapshot || '').trim() || 'manual';
  const externalReference = String(registration?.transactionSummary?.externalReference || '').trim();
  const generatedBy = toPublicId(requestUser?.id) || String(requestUser?.username || 'system');

  const base = {
    orgId,
    status: 'posted',
    postedAt: nowIso,
    effectiveDate,
    transactionType: 'charge',
    party: {
      studentId: toPublicId(registration?.studentId || ''),
      personId: toPublicId(registration?.personId || ''),
      programId: toPublicId(registration?.programId || ''),
      feeCategory
    },
    fee: {
      category: feeCategory,
      code: 'MANUAL_PROGRAM_ADJUSTMENT',
      label: 'Manual Program Registration Adjustment',
      frequency: 'one_time',
      isOptional: false
    },
    amount: {
      value: roundMoney(amount),
      currency
    },
    memo: memo || 'Manual program registration adjustment',
    externalReference,
    internalNote: `Manual draft adjustment before approval (${registration?.id || ''})`,
    metadata: {
      sourceType: 'manual_program_adjustment',
      registrationId: toPublicId(registration?.id || ''),
      generatedBy,
      isManualAdjustment: true
    }
  };

  return [
    {
      ...base,
      source: {
        module: 'school_program_registration',
        eventType: 'program_registration_manual_adjustment',
        eventId: `SPRMAN-${registration?.id || ''}-${lineKey}-DR`,
        idempotencyKey: `SPRMAN|${registration?.id || ''}|${lineKey}|DR`
      },
      amount: {
        ...base.amount,
        direction: 'debit'
      },
      metadata: {
        ...base.metadata,
        ledgerSide: 'debit',
        accountId: toPublicId(debitAccount?.id || ''),
        accountCode: String(debitAccount?.code || '').trim(),
        accountName: String(debitAccount?.name || '').trim()
      }
    },
    {
      ...base,
      source: {
        module: 'school_program_registration',
        eventType: 'program_registration_manual_adjustment',
        eventId: `SPRMAN-${registration?.id || ''}-${lineKey}-CR`,
        idempotencyKey: `SPRMAN|${registration?.id || ''}|${lineKey}|CR`
      },
      amount: {
        ...base.amount,
        direction: 'credit'
      },
      metadata: {
        ...base.metadata,
        ledgerSide: 'credit',
        accountId: toPublicId(creditAccount?.id || ''),
        accountCode: String(creditAccount?.code || '').trim(),
        accountName: String(creditAccount?.name || '').trim()
      }
    }
  ];
}

async function applyProgramDraftTransactionChanges({
  registration,
  editedRows = [],
  addedRows = [],
  reqUser,
  activeOrgId
}) {
  const currentItems = programRegistrationDraftService.normalizeDraftTransactionItems(registration?.transactionSummary?.draftTransactionItems || []);
  const expectedPreviewCount = Number(registration?.transactionSummary?.previewCount || 0);
  if (!currentItems.length && expectedPreviewCount > 0) {
    throw new Error('Draft transaction lines are missing. Recreate the draft from the registration page and try again.');
  }

  const parsedAddedRows = normalizeAddedRows(addedRows);
  const hasAccountEdits = (Array.isArray(editedRows) ? editedRows : []).some((row) =>
    toPublicId(row?.debitAccountId || row?.debitAccount?.id || '') ||
    toPublicId(row?.creditAccountId || row?.creditAccount?.id || '')
  );
  const accountMap = (parsedAddedRows.length || hasAccountEdits) ? await buildPostableAccountMap(reqUser, activeOrgId) : new Map();
  const enrichedEdits = enrichEditedRowsWithAccountSnapshots(editedRows, accountMap, 'Draft row');
  const edited = programRegistrationDraftService.applyDraftRowEditsToItems(currentItems, enrichedEdits);

  const appendedManualItems = [];
  parsedAddedRows.forEach((row, index) => {
    if (!row.debitAccountId || !row.creditAccountId) {
      throw new Error(`Manual row #${index + 1} requires both debit and credit accounts.`);
    }
    if (row.debitAccountId === row.creditAccountId) {
      throw new Error(`Manual row #${index + 1} cannot use the same account for debit and credit.`);
    }
    if (!Number.isFinite(row.amount) || row.amount <= 0) {
      throw new Error(`Manual row #${index + 1} amount must be greater than zero.`);
    }
    if (!row.currency) {
      throw new Error(`Manual row #${index + 1} currency must be a valid ISO code (for example CAD).`);
    }

    const debitAccount = accountMap.get(row.debitAccountId);
    const creditAccount = accountMap.get(row.creditAccountId);
    if (!debitAccount) throw new Error(`Manual row #${index + 1} debit account is invalid or not postable.`);
    if (!creditAccount) throw new Error(`Manual row #${index + 1} credit account is invalid or not postable.`);

    const lineKey = `${Date.now()}-${index + 1}-${Math.floor(Math.random() * 1000)}`;
    appendedManualItems.push(...buildManualDraftTransactionPair({
      registration,
      debitAccount,
      creditAccount,
      amount: row.amount,
      currency: row.currency,
      memo: row.memo,
      lineKey,
      requestUser: reqUser
    }));
  });

  const items = edited.items.concat(appendedManualItems);
  const previewRows = programRegistrationDraftService.buildDraftPreviewRowsFromItems(items);
  const totalAmount = roundMoney(previewRows.reduce((sum, row) => sum + Number(row.amount || 0), 0));

  return {
    items,
    previewRows,
    totalAmount
  };
}

async function buildRegistrationSummaries(reqUser, activeOrgId, options = {}) {
  return programRegistrationViewService.buildRegistrationSummaries(reqUser, activeOrgId, options);
}

async function buildRegistrationDetail(reqUser, activeOrgId, registrationId) {
  return programRegistrationViewService.buildRegistrationDetail(reqUser, activeOrgId, registrationId);
}

async function buildBatchPreview(studentIds, programId, reqUser, requestBody = {}) {
  return programRegistrationViewService.buildBatchPreview(studentIds, programId, reqUser, requestBody);
}

async function renderBatchRegistrationPage(req, res, viewName, pageTitle) {
  try {
    const activeOrgId = await assertCreateOrgContextOrThrow(req.user, { scopeLabel: 'program registrations' });
    const programs = (await dataService.fetchData('programs', {}, req.user))
      .filter((program) => idsEqual(program.orgId || '', activeOrgId));
    const canManageRegistrations = await canCreateOrgScopedItem(req.user, { scopeLabel: 'program registrations' });

    res.render(viewName, {
      title: pageTitle,
      programs,
      canManageRegistrations,
      user: req.user,
      includeModal: true,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
}

exports.showBatchRegistrationPage = async (req, res) => {
  return renderBatchRegistrationPage(req, res, 'school/program/programRegistrationBatch', 'Student Program Registration');
};

exports.showBatchRegistrationWizardPage = async (req, res) => {
  return renderBatchRegistrationPage(req, res, 'school/program/programRegistrationBatchWizard', 'Student Program Registration Wizard');
};

exports.listRegistrations = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const filters = {
      q: req.query.q || '',
      type: req.query.type || '',
      searchFields: req.query.searchFields || '',
      status: req.query.status || '',
      verificationStatus: req.query.verificationStatus || '',
      programId: req.query.programId || '',
      studentId: req.query.studentId || ''
    };
    const allRows = await buildRegistrationSummaries(req.user, activeOrgId, { filters });
    const { data, pagination } = paginate(allRows, req.query);
    const canManageRegistrations = await canCreateOrgScopedItem(req.user, { scopeLabel: 'program registrations' });

    res.render('school/program/programRegistrationList', {
      title: 'Program Registrations',
      tableName: 'Program_Registrations',
      newUrl: 'school/programs/register-students',
      newLabel: 'Register Students',
      data,
      pagination,
      filters: req.query,
      searchableFields: [...PROGRAM_REGISTRATION_LIST_SEARCHABLE_FIELDS],
      canManageRegistrations,
      includeModal: true,
      includeModal_Table: true,
      print: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.showRegistrationDetails = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const registrationId = String(req.params.id || '').trim();
    if (!registrationId) throw new Error('Registration id is required.');
    const registration = await buildRegistrationDetail(req.user, activeOrgId, registrationId);
    if (!registration) throw new Error('Program registration not found or inaccessible.');
    const canManageRegistrations = await canCreateOrgScopedItem(req.user, { scopeLabel: 'program registrations' });

    res.render('school/program/programRegistrationDetails', {
      title: 'Program Registration Details',
      registration,
      canManageRegistrations,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.previewBatchRegistration = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const programId = String(req.body.programId || '').trim();
    const studentIds = Array.from(new Set((parseJsonSafe(req.body.studentIds, []) || []).map((id) => String(id || '').trim()).filter(Boolean)));
    if (!programId) throw new Error('Program is required.');
    if (!studentIds.length) throw new Error('Select at least one student.');

    const result = await buildBatchPreview(studentIds, programId, req.user, {
      effectiveDate: req.body.effectiveDate,
      sourceEventType: 'program_registration_fee',
      externalReference: req.body.externalReference
    });

    await registrationIntegrityService.getProgramInOrgOrThrow(result.program.id, activeOrgId, req.user);

    return res.json({
      status: 'success',
      program: {
        id: result.program.id,
        code: result.program.code,
        name: result.program.name
      },
      preview: result.previews.map((row) => ({
        studentId: row.studentId,
        personId: row.personId,
        studentName: row.studentName,
        feeCategory: row.feeCategory,
        studentAccountId: row.studentAccountId,
        status: row.status,
        issues: row.issues,
        previewTransactions: row.previewTransactions,
        totalAmount: row.totalAmount,
        transactionCount: row.transactionCount
      }))
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.applyBatchRegistration = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const programId = String(req.body.programId || '').trim();
    const studentIds = asIdArray(parseJsonSafe(req.body.studentIds, []));
    const registrationDate = String(req.body.effectiveDate || '').trim() || new Date().toISOString().slice(0, 10);
    const note = String(req.body.note || '').trim();
    if (!programId) throw new Error('Program is required.');
    if (!studentIds.length) throw new Error('Select at least one student.');

    const guardKey = idempotencyGuardService.createGuardKey([
      'program_batch_apply',
      activeOrgId,
      programId,
      registrationDate,
      asSortedIdArray(studentIds)
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 120000,
      replayTtlMs: 20000
    });
    if (sendGuardedResponse(res, guardResult, 'Program registration draft save is already in progress. Please wait.')) return;

    try {
      const { program, previews } = await buildBatchPreview(studentIds, programId, req.user, {
        effectiveDate: registrationDate,
        sourceEventType: 'program_registration_fee',
        externalReference: req.body.externalReference
      });
      await registrationIntegrityService.getProgramInOrgOrThrow(program.id, activeOrgId, req.user);

      const results = [];
      for (const preview of previews) {
        if (preview.status === 'error') {
          results.push({
            studentId: preview.studentId,
            studentName: preview.studentName,
            status: 'error',
            message: preview.issues.join(' ')
          });
          continue;
        }

        try {
          const draftItems = programRegistrationDraftService.normalizeDraftTransactionItems(preview.transactionItems || []);
          const draftPreviewRows = programRegistrationDraftService.buildDraftPreviewRowsFromItems(draftItems);
          const created = await dataService.addData('studentProgramRegistrations', {
            orgId: program.orgId,
            studentId: preview.studentId,
            personId: preview.personId,
            programId: program.id,
            registrationDate,
            status: 'draft',
            feeCategorySnapshot: preview.feeCategory,
            note,
            transactionSummary: {
              previewCount: draftPreviewRows.length,
              postedCount: 0,
              totalAmount: programRegistrationDraftService.roundMoney(draftPreviewRows.reduce((sum, row) => sum + Number(row.amount || 0), 0)),
              externalReference: req.body.externalReference || '',
              transactionIds: [],
              reversalIds: [],
              draftTransactionItems: draftItems,
              draftPreviewRows,
              draftSavedAt: new Date().toISOString()
            },
            academicSummary: {
              entryCount: 0,
              entryIds: [],
              voidedEntryIds: []
            }
          }, req.user);

          results.push({
            studentId: preview.studentId,
            studentName: preview.studentName,
            status: 'draft',
            registrationId: created.id,
            transactionCount: draftItems.length,
            message: 'Draft saved. Review, edit transaction rows if needed, then approve to post.'
          });
        } catch (registrationError) {
          results.push({
            studentId: preview.studentId,
            studentName: preview.studentName,
            status: 'error',
            message: registrationError.message || 'Failed to save draft registration.'
          });
        }
      }

      const draftCount = results.filter((row) => row.status === 'draft').length;
      const errorCount = results.filter((row) => row.status === 'error').length;
      const aggregateStatus = draftCount && errorCount
        ? 'warning'
        : (draftCount ? 'success' : 'error');
      const aggregateMessage = draftCount && errorCount
        ? `Draft save completed with partial success. ${draftCount} draft${draftCount === 1 ? '' : 's'} saved, ${errorCount} failed.`
        : (draftCount
          ? `Draft save completed. ${draftCount} registration draft${draftCount === 1 ? '' : 's'} created.`
          : `Draft save failed. ${errorCount} student${errorCount === 1 ? '' : 's'} failed.`);

      const payloadOut = {
        status: aggregateStatus,
        message: aggregateMessage,
        results
      };
      idempotencyGuardService.completeGuard(guardKey, payloadOut);
      return res.json(payloadOut);
    } catch (error) {
      idempotencyGuardService.failGuard(guardKey);
      throw error;
    }
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.updateDraftTransactions = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const registrationId = String(req.params.id || '').trim();
    const note = String(req.body.note || '').trim();
    const editedRows = parseJsonSafe(req.body.editedRows, []);
    const addedRows = parseJsonSafe(req.body.addedRows, []);
    if (!registrationId) throw new Error('Registration id is required.');

    const guardKey = idempotencyGuardService.createGuardKey([
      'program_draft_update',
      activeOrgId,
      registrationId,
      { note, editedRows, addedRows }
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 90000,
      replayTtlMs: 15000
    });
    if (sendGuardedResponse(res, guardResult, 'Draft update is already in progress. Please wait.')) return;

    try {
      const registration = await registrationIntegrityService.getProgramDraftForEditOrThrow(registrationId, activeOrgId);
      const draftState = await applyProgramDraftTransactionChanges({
        registration,
        editedRows,
        addedRows,
        reqUser: req.user,
        activeOrgId
      });

      const updated = await dataService.updateData('studentProgramRegistrations', registration.id, {
        status: 'draft',
        registrationDate: registration.registrationDate,
        feeCategorySnapshot: registration.feeCategorySnapshot,
        note: note ? appendNote(registration.note, note) : registration.note,
        transactionSummary: {
          ...(registration.transactionSummary || {}),
          previewCount: draftState.previewRows.length,
          totalAmount: draftState.totalAmount,
          postedCount: Number(registration?.transactionSummary?.postedCount || 0),
          draftTransactionItems: draftState.items,
          draftPreviewRows: draftState.previewRows,
          draftSavedAt: new Date().toISOString()
        },
        academicSummary: registration.academicSummary || {}
      }, req.user);

      const payloadOut = {
        status: 'success',
        message: 'Draft transactions updated.',
        registrationId: updated.id,
        draftPreviewRows: draftState.previewRows,
        totalAmount: draftState.totalAmount
      };
      idempotencyGuardService.completeGuard(guardKey, payloadOut);
      return res.json(payloadOut);
    } catch (error) {
      idempotencyGuardService.failGuard(guardKey);
      throw error;
    }
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.approveRegistration = async (req, res) => {
  let txContext = null;
  let guardKey = '';
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const registrationId = toPublicId(req.params.id);
    const note = String(req.body.note || '').trim();
    const editedRows = parseJsonSafe(req.body.editedRows, []);
    const addedRows = parseJsonSafe(req.body.addedRows, []);
    const externalReference = String(req.body.externalReference || '').trim();
    if (!registrationId) throw new Error('Registration id is required.');

    guardKey = idempotencyGuardService.createGuardKey([
      'program_approve',
      activeOrgId,
      registrationId
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 180000,
      replayTtlMs: 20000
    });
    if (sendGuardedResponse(res, guardResult, 'Approval is already in progress for this registration. Please wait.')) return;

    const approvalContext = await registrationIntegrityService.getProgramDraftForApproval(registrationId, activeOrgId);
    const registration = approvalContext.registration;
    if (approvalContext.alreadyApproved) {
      const payloadOut = { status: 'success', message: 'Registration was already approved and posted.', registrationId: registration.id };
      idempotencyGuardService.completeGuard(guardKey, payloadOut);
      return res.json(payloadOut);
    }

    txContext = createTransactionContext({
      name: 'program_registration_approve',
      metadata: {
        registrationId: toPublicId(registration.id),
        activeOrgId: toPublicId(activeOrgId),
        requestUserId: toPublicId(req.user?.id) || String(req.user?.username || 'system')
      }
    });

    const [student, program] = await Promise.all([
      dataService.getDataById('students', registration.studentId, req.user),
      dataService.getDataById('programs', registration.programId, req.user)
    ]);
    if (!student) throw new Error('Student record was not found.');
    if (!program) throw new Error('Program record was not found.');

    const draftState = await applyProgramDraftTransactionChanges({
      registration,
      editedRows,
      addedRows,
      reqUser: req.user,
      activeOrgId
    });
    const finalItems = draftState.items.map((item) => ({
      ...(item || {}),
      externalReference: externalReference || String(item?.externalReference || registration.id || ''),
      metadata: {
        ...((item && typeof item.metadata === 'object') ? item.metadata : {}),
        programRegistrationId: toPublicId(registration.id)
      }
    }));
    const finalPreviewRows = draftState.previewRows;
    const totalAmount = draftState.totalAmount;

    const createdTransactions = [];
    const academicEntries = [];
    try {
      if (finalItems.length) {
        const postedTransactions = await dataService.addData('globalTransactions', finalItems, req.user, { transactionContext: txContext });
        createdTransactions.push(...(Array.isArray(postedTransactions) ? postedTransactions : [postedTransactions]).filter(Boolean));
      }

      const postedAcademicEntries = await academicLedgerService.postProgramRegistration({
        reqUser: req.user,
        student,
        program,
        effectiveDate: registration.registrationDate,
        note: note || registration.note || '',
        source: {
          eventId: `SPR-${registration.id}`,
          idempotencyKey: `SPR|${registration.id}|academic`
        },
        options: { transactionContext: txContext }
      });
      academicEntries.push(...(Array.isArray(postedAcademicEntries) ? postedAcademicEntries : [postedAcademicEntries]).filter(Boolean));

      const updated = await dataService.updateData(
        'studentProgramRegistrations',
        registration.id,
        {
          status: 'registered',
          registrationDate: registration.registrationDate,
          feeCategorySnapshot: registration.feeCategorySnapshot,
          note: note ? appendNote(registration.note, note) : registration.note,
          transactionSummary: {
            ...(registration.transactionSummary || {}),
            previewCount: finalPreviewRows.length,
            postedCount: createdTransactions.length,
            totalAmount,
            externalReference: externalReference || String(registration?.transactionSummary?.externalReference || ''),
            transactionIds: createdTransactions.map((row) => toPublicId(row.id)).filter(Boolean),
            reversalIds: asIdArray(registration?.transactionSummary?.reversalIds),
            draftTransactionItems: finalItems,
            draftPreviewRows: finalPreviewRows,
            approvedAt: new Date().toISOString(),
            approvedBy: toPublicId(req.user?.id) || String(req.user?.username || 'system')
          },
          academicSummary: {
            ...(registration.academicSummary || {}),
            entryCount: academicEntries.length,
            entryIds: academicEntries.map((entry) => toPublicId(entry.id)).filter(Boolean),
            voidedEntryIds: asIdArray(registration?.academicSummary?.voidedEntryIds)
          }
        },
        req.user,
        { transactionContext: txContext }
      );

      await txContext.commit({ registrationId: toPublicId(updated?.id), flow: 'program_approval' });
      const payloadOut = {
        status: 'success',
        message: 'Draft approved and posted successfully.',
        registrationId: updated.id,
        summary: {
          postedTransactionCount: createdTransactions.length,
          postedAcademicEntryCount: academicEntries.length
        }
      };
      idempotencyGuardService.completeGuard(guardKey, payloadOut);
      return res.json(payloadOut);
    } catch (approvalError) {
      const rollbackResult = await registrationIntegrityService.rollbackProgramRegistrationSideEffects({
        registrationId: registration.id,
        transactionIds: createdTransactions.map((row) => toPublicId(row.id)).filter(Boolean),
        academicEntryIds: academicEntries.map((row) => toPublicId(row.id)).filter(Boolean),
        reqUser: req.user,
        studentId: registration.studentId,
        programId: registration.programId,
        reason: `Approval failed for ${registration.id}. ${approvalError.message}`,
        options: { transactionContext: txContext }
      });
      const rollbackSucceeded = rollbackResult.issues.length === 0;
      const nextStatus = rollbackSucceeded ? 'draft' : 'error';

      await dataService.updateData(
        'studentProgramRegistrations',
        registration.id,
        {
          status: nextStatus,
          registrationDate: registration.registrationDate,
          feeCategorySnapshot: registration.feeCategorySnapshot,
          note: buildRollbackNote(registration.note, approvalError.message, rollbackResult.issues),
          transactionSummary: {
            ...(registration.transactionSummary || {}),
            previewCount: finalPreviewRows.length,
            totalAmount,
            postedCount: 0,
            transactionIds: [],
            reversalIds: rollbackResult.reversalIds,
            draftTransactionItems: finalItems,
            draftPreviewRows: finalPreviewRows,
            lastApprovalAttempt: {
              attemptedAt: new Date().toISOString(),
              error: String(approvalError.message || ''),
              rollbackIssues: rollbackResult.issues
            }
          },
          academicSummary: {
            ...(registration.academicSummary || {}),
            entryCount: 0,
            entryIds: [],
            voidedEntryIds: rollbackResult.voidedEntryIds
          }
        },
        req.user,
        { transactionContext: txContext }
      );

      await txContext.rollback({
        registrationId: toPublicId(registration.id),
        flow: 'program_approval',
        reason: approvalError.message || 'Approval failed'
      });

      idempotencyGuardService.failGuard(guardKey);
      return res.status(400).json({
        status: rollbackSucceeded ? 'warning' : 'error',
        message: rollbackSucceeded
          ? `Approval failed and all side effects were rolled back. Draft remains open. ${approvalError.message}`
          : buildRollbackNote('', approvalError.message, rollbackResult.issues),
        registrationId: registration.id
      });
    }
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (txContext) {
      await txContext.rollback({ flow: 'program_approval', reason: error.message || 'Unhandled approval failure' });
    }
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.rollbackRegistration = async (req, res) => {
  let txContext = null;
  let guardKey = '';
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const registrationId = toPublicId(req.params.id);
    const note = String(req.body.note || '').trim();
    if (!registrationId) throw new Error('Registration id is required.');

    guardKey = idempotencyGuardService.createGuardKey([
      'program_rollback',
      activeOrgId,
      registrationId,
      note
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 120000,
      replayTtlMs: 15000
    });
    if (sendGuardedResponse(res, guardResult, 'Rollback is already in progress for this registration. Please wait.')) return;

    txContext = createTransactionContext({
      name: 'program_registration_manual_rollback',
      metadata: {
        registrationId,
        activeOrgId: toPublicId(activeOrgId),
        requestUserId: toPublicId(req.user?.id) || String(req.user?.username || 'system')
      }
    });

    const registration = await registrationIntegrityService.getProgramRegistrationInOrgOrThrow(registrationId, activeOrgId);
    const currentStatus = String(registration.status || '').toLowerCase();
    if (currentStatus === 'draft') {
      const payloadOut = { status: 'success', message: 'Registration is already in draft.' };
      idempotencyGuardService.completeGuard(guardKey, payloadOut);
      return res.json(payloadOut);
    }
    if (!['registered', 'error'].includes(currentStatus)) {
      throw new Error('Only posted registrations (or failed-posting errors) can be rolled back to draft.');
    }

    await registrationIntegrityService.assertProgramRollbackAllowed(registration, activeOrgId);

    const rollbackResult = await registrationIntegrityService.rollbackProgramRegistrationSideEffects({
      registrationId: registration.id,
      transactionIds: registration?.transactionSummary?.transactionIds,
      academicEntryIds: registration?.academicSummary?.entryIds,
      reqUser: req.user,
      studentId: registration.studentId,
      programId: registration.programId,
      reason: note || `Manual rollback of program registration ${registration.id}`,
      options: { transactionContext: txContext }
    });

    const rollbackSucceeded = rollbackResult.issues.length === 0;
    const nextStatus = rollbackSucceeded ? 'draft' : 'error';
    await dataService.updateData(
      'studentProgramRegistrations',
      registration.id,
      {
        status: nextStatus,
        registrationDate: registration.registrationDate,
        feeCategorySnapshot: registration.feeCategorySnapshot,
        note: buildRollbackNote(registration.note, note || 'Registration moved back to draft.', rollbackResult.issues),
        transactionSummary: {
          ...(registration.transactionSummary || {}),
          postedCount: 0,
          approvedAt: '',
          approvedBy: '',
          lastRollbackAt: new Date().toISOString(),
          reversalIds: Array.from(new Set([
            ...asIdArray(registration?.transactionSummary?.reversalIds),
            ...rollbackResult.reversalIds
          ]))
        },
        academicSummary: {
          ...(registration.academicSummary || {}),
          entryCount: 0,
          voidedEntryIds: Array.from(new Set([
            ...asIdArray(registration?.academicSummary?.voidedEntryIds),
            ...rollbackResult.voidedEntryIds
          ]))
        }
      },
      req.user,
      { transactionContext: txContext }
    );

    await txContext.commit({ registrationId: toPublicId(registration.id), flow: 'program_manual_rollback' });
    const payloadOut = {
      status: rollbackResult.issues.length ? 'warning' : 'success',
      message: rollbackResult.issues.length
        ? `Rollback completed with issues: ${rollbackResult.issues.join(' ')}`
        : 'Registration moved back to draft. Posted side effects were reversed.',
      rollback: {
        reversalCount: rollbackResult.reversalIds.length,
        voidedEntryCount: rollbackResult.voidedEntryIds.length
      }
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    return res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (txContext) {
      await txContext.rollback({ flow: 'program_manual_rollback', reason: error.message || 'Rollback failed' });
    }
    return res.status(400).json({ status: 'error', message: error.message });
  }
};
