const dataService = require('../../services/school/schoolDataService');
const paginate = require('../../utils/paginationHelper');
const academicLedgerService = require('../../services/school/academicLedgerService');
const registrationIntegrityService = require('../../services/school/registrationIntegrityService');
const termRegistrationViewService = require('../../services/school/termRegistrationViewService');
const programRegistrationDraftService = require('../../services/school/programRegistrationDraftService');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');
const { createTransactionContext } = require('../../services/transactionContextService');
const { normalizeSearchKeyword } = require('../../utils/generalTools');
const { idsEqual, toPublicId } = require('../../utils/idAdapter');
const {
  getActiveOrgIdOrThrow,
  assertCreateOrgContextOrThrow,
  canCreateOrgScopedItem
} = require('../../utils/orgContextUtils');

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

function matchesSearch(haystacks, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return haystacks.some((value) => String(value || '').toLowerCase().includes(q));
}

function roundMoney(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(2));
}

function sanitizeCurrency(value) {
  const code = String(value || 'CAD').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function splitEditedRowsByBucket(editedRowsInput, termRowCount) {
  const rows = Array.isArray(editedRowsInput) ? editedRowsInput : [];
  const termEdits = [];
  const classEdits = [];

  rows.forEach((row) => {
    const rowIndex = Number(row?.rowIndex);
    if (!Number.isInteger(rowIndex) || rowIndex < 0) return;
    const normalized = { ...(row || {}) };
    if (rowIndex < termRowCount) {
      normalized.rowIndex = rowIndex;
      termEdits.push(normalized);
      return;
    }
    normalized.rowIndex = rowIndex - termRowCount;
    classEdits.push(normalized);
  });

  return { termEdits, classEdits };
}

function reindexDraftPreviewRows(rowsInput, startIndex = 0) {
  const rows = Array.isArray(rowsInput) ? rowsInput : [];
  return rows.map((row, offset) => ({
    ...(row || {}),
    rowIndex: startIndex + offset
  }));
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
      code: 'MANUAL_TERM_ADJUSTMENT',
      label: 'Manual Term Registration Adjustment',
      frequency: 'one_time',
      isOptional: false
    },
    amount: {
      value: roundMoney(amount),
      currency
    },
    memo: memo || 'Manual term registration adjustment',
    externalReference,
    internalNote: `Manual draft adjustment before approval (${registration?.id || ''})`,
    metadata: {
      sourceType: 'manual_term_adjustment',
      registrationId: toPublicId(registration?.id || ''),
      generatedBy,
      isManualAdjustment: true
    }
  };

  return [
    {
      ...base,
      source: {
        module: 'school_term_registration',
        eventType: 'term_registration_manual_adjustment',
        eventId: `STRMAN-${registration?.id || ''}-${lineKey}-DR`,
        idempotencyKey: `STRMAN|${registration?.id || ''}|${lineKey}|DR`
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
        module: 'school_term_registration',
        eventType: 'term_registration_manual_adjustment',
        eventId: `STRMAN-${registration?.id || ''}-${lineKey}-CR`,
        idempotencyKey: `STRMAN|${registration?.id || ''}|${lineKey}|CR`
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

async function applyTermDraftTransactionChanges({
  registration,
  editedRows = [],
  addedRows = [],
  reqUser,
  activeOrgId,
  fallbackTermItems = [],
  fallbackClassItems = []
}) {
  const currentTermItems = programRegistrationDraftService.normalizeDraftTransactionItems(
    Array.isArray(registration?.transactionSummary?.draftTermTransactionItems) && registration.transactionSummary.draftTermTransactionItems.length
      ? registration.transactionSummary.draftTermTransactionItems
      : fallbackTermItems
  );
  const currentClassItems = programRegistrationDraftService.normalizeDraftTransactionItems(
    Array.isArray(registration?.transactionSummary?.draftClassTransactionItems) && registration.transactionSummary.draftClassTransactionItems.length
      ? registration.transactionSummary.draftClassTransactionItems
      : fallbackClassItems
  );

  const expectedPreviewCount = Number(registration?.transactionSummary?.previewCount || 0);
  if (!currentTermItems.length && !currentClassItems.length && expectedPreviewCount > 0) {
    throw new Error('Draft transaction lines are missing. Recreate the draft from the registration page and try again.');
  }

  const termRowCount = Math.floor(currentTermItems.length / 2);
  const { termEdits, classEdits } = splitEditedRowsByBucket(editedRows, termRowCount);
  const parsedAddedRows = normalizeAddedRows(addedRows);
  const hasAccountEdits = termEdits.some((row) => toPublicId(row?.debitAccountId || row?.debitAccount?.id || '') || toPublicId(row?.creditAccountId || row?.creditAccount?.id || ''))
    || classEdits.some((row) => toPublicId(row?.debitAccountId || row?.debitAccount?.id || '') || toPublicId(row?.creditAccountId || row?.creditAccount?.id || ''));
  const accountMap = (parsedAddedRows.length || hasAccountEdits) ? await buildPostableAccountMap(reqUser, activeOrgId) : new Map();
  const enrichedTermEdits = enrichEditedRowsWithAccountSnapshots(termEdits, accountMap, 'Term row');
  const enrichedClassEdits = enrichEditedRowsWithAccountSnapshots(classEdits, accountMap, 'Class row');
  const editedTerm = programRegistrationDraftService.applyDraftRowEditsToItems(currentTermItems, enrichedTermEdits);
  const editedClass = programRegistrationDraftService.applyDraftRowEditsToItems(currentClassItems, enrichedClassEdits);
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

  const termItems = editedTerm.items.concat(appendedManualItems);
  const classItems = editedClass.items;
  const termPreviewRows = programRegistrationDraftService.buildDraftPreviewRowsFromItems(termItems);
  const classPreviewRows = programRegistrationDraftService.buildDraftPreviewRowsFromItems(classItems);
  const draftPreviewRows = reindexDraftPreviewRows(termPreviewRows)
    .concat(reindexDraftPreviewRows(classPreviewRows, termPreviewRows.length));

  const termTotal = roundMoney(termPreviewRows.reduce((sum, row) => sum + Number(row?.amount || 0), 0));
  const classTotal = roundMoney(classPreviewRows.reduce((sum, row) => sum + Number(row?.amount || 0), 0));
  const grandTotal = roundMoney(termTotal + classTotal);

  return {
    termItems,
    classItems,
    termPreviewRows,
    classPreviewRows,
    draftPreviewRows,
    termTotal,
    classTotal,
    grandTotal
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
  return termRegistrationViewService.buildTermRegistrationPreview({
    studentId,
    programRegistrationId,
    termId,
    classIds,
    reqUser,
    requestBody,
    ignoreRegistrationId
  });
}

async function buildRegistrationSummaries(reqUser, activeOrgId, { limit = null, registrationId = '', filters = {} } = {}) {
  return termRegistrationViewService.buildRegistrationSummaries(reqUser, activeOrgId, { limit, registrationId, filters });
}

async function buildRegistrationDetail(reqUser, activeOrgId, registrationId) {
  return termRegistrationViewService.buildRegistrationDetail(reqUser, activeOrgId, registrationId);
}

async function buildActiveProgramRegistrationOptions(reqUser, activeOrgId) {
  return termRegistrationViewService.buildActiveProgramRegistrationOptions(reqUser, activeOrgId);
}

async function buildClassCatalogOptions(reqUser, activeOrgId) {
  return termRegistrationViewService.buildClassCatalogOptions(reqUser, activeOrgId);
}

function normalizeDateOnly(value) {
  const trimmed = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : '';
}

function normalizeTermRegistrationPayload(body = {}) {
  return {
    studentId: toPublicId(body.studentId),
    programRegistrationId: toPublicId(body.programRegistrationId),
    termId: toPublicId(body.termId),
    classIds: asIdArray(parseJsonSafe(body.classIds, [])),
    effectiveDate: normalizeDateOnly(body.effectiveDate) || new Date().toISOString().slice(0, 10),
    note: String(body.note || '').trim(),
    externalReference: String(body.externalReference || '').trim()
  };
}

function normalizeTermBatchPayload(body = {}) {
  return {
    programId: toPublicId(body.programId),
    termId: toPublicId(body.termId),
    effectiveDate: normalizeDateOnly(body.effectiveDate) || new Date().toISOString().slice(0, 10),
    externalReference: String(body.externalReference || '').trim(),
    note: String(body.note || '').trim(),
    programRegistrationIds: asIdArray(parseJsonSafe(body.programRegistrationIds, [])),
    classIds: asIdArray(parseJsonSafe(body.classIds, []))
  };
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

async function buildValidatedSinglePreview(reqUser, payload, { ignoreRegistrationId = '' } = {}) {
  const preview = await buildTermRegistrationPreview({
    studentId: payload.studentId,
    programRegistrationId: payload.programRegistrationId,
    termId: payload.termId,
    classIds: payload.classIds,
    reqUser,
    requestBody: {
      effectiveDate: payload.effectiveDate,
      externalReference: payload.externalReference
    },
    ignoreRegistrationId
  });

  if (!preview.programRegistration || !preview.term) {
    throw new Error('Preview could not resolve the selected registration.');
  }

  return preview;
}

function getEffectiveDateOutOfRangeMessage(effectiveDate, termStartDate, termEndDate) {
  const effective = normalizeDateOnly(effectiveDate);
  const start = normalizeDateOnly(termStartDate);
  const end = normalizeDateOnly(termEndDate);
  if (!effective || !start || !end) return '';
  if (effective < start || effective > end) {
    return `Effective Date ${effective} is outside the selected term range (${start} to ${end}).`;
  }
  return '';
}

function isBatchEligibleTermStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'active' || normalized === 'started';
}

async function buildBatchProgramCatalog(reqUser, activeOrgId) {
  const [registrationOptions, terms] = await Promise.all([
    buildActiveProgramRegistrationOptions(reqUser, activeOrgId),
    dataService.fetchData('terms', {}, reqUser)
  ]);
  const termMap = new Map((Array.isArray(terms) ? terms : []).map((row) => [toPublicId(row?.id), row]));
  const grouped = new Map();

  (Array.isArray(registrationOptions) ? registrationOptions : []).forEach((row) => {
    const programId = toPublicId(row?.programId);
    if (!programId) return;

    if (!grouped.has(programId)) {
      grouped.set(programId, {
        programId,
        programCode: String(row?.programCode || '').trim(),
        programName: String(row?.programName || '').trim(),
        registrationCount: 0,
        termMap: new Map()
      });
    }

    const programEntry = grouped.get(programId);
    programEntry.registrationCount += 1;

    (Array.isArray(row?.termOptions) ? row.termOptions : []).forEach((termOption) => {
      const termId = toPublicId(termOption?.termId);
      if (!termId) return;
      const normalizedTermStatus = String(termOption?.termStatus || '').trim().toLowerCase();
      if (!isBatchEligibleTermStatus(normalizedTermStatus)) return;

      if (!programEntry.termMap.has(termId)) {
        const term = termMap.get(termId) || null;
        programEntry.termMap.set(termId, {
          termId,
          termCode: String(termOption?.termCode || term?.code || '').trim(),
          termName: String(termOption?.termName || term?.name || '').trim(),
          termStatus: normalizedTermStatus || String(term?.status || '').trim().toLowerCase(),
          order: Number(termOption?.order || 0),
          startDate: normalizeDateOnly(term?.startDate),
          endDate: normalizeDateOnly(term?.endDate),
          totalProgramRegistrations: 0,
          alreadyRegisteredCount: 0,
          openRegistrationCount: 0
        });
      }

      const termEntry = programEntry.termMap.get(termId);
      termEntry.totalProgramRegistrations += 1;
      if (termOption?.alreadyRegistered) termEntry.alreadyRegisteredCount += 1;
      else termEntry.openRegistrationCount += 1;
    });
  });

  return Array.from(grouped.values())
    .map((row) => ({
      id: row.programId,
      programId: row.programId,
      programCode: row.programCode,
      programName: row.programName,
      registrationCount: row.registrationCount,
      termOptions: Array.from(row.termMap.values()).sort((a, b) => {
        const orderDiff = Number(a?.order || 0) - Number(b?.order || 0);
        if (orderDiff !== 0) return orderDiff;
        return String(a?.termCode || '').localeCompare(String(b?.termCode || ''));
      })
    }))
    .filter((row) => Array.isArray(row.termOptions) && row.termOptions.length > 0)
    .sort((a, b) =>
      String(a?.programName || '').localeCompare(String(b?.programName || '')) ||
      String(a?.programCode || '').localeCompare(String(b?.programCode || ''))
    );
}

async function buildBatchStudentRows(reqUser, activeOrgId, { programId, termId, query = '' } = {}) {
  const [registrationOptions, students] = await Promise.all([
    buildActiveProgramRegistrationOptions(reqUser, activeOrgId),
    dataService.fetchData('students', {}, reqUser)
  ]);
  const studentMap = new Map((Array.isArray(students) ? students : []).map((row) => [toPublicId(row?.id), row]));
  const normalizedProgramId = toPublicId(programId);
  const normalizedTermId = toPublicId(termId);
  const normalizedQuery = String(normalizeSearchKeyword(query || '') || '').trim();

  return (Array.isArray(registrationOptions) ? registrationOptions : [])
    .filter((row) => idsEqual(row?.programId, normalizedProgramId))
    .map((row) => {
      const selectedTermOption = (Array.isArray(row?.termOptions) ? row.termOptions : [])
        .find((termRow) => idsEqual(termRow?.termId, normalizedTermId)) || null;
      if (!selectedTermOption) return null;
      const student = studentMap.get(toPublicId(row?.studentId)) || null;
      return {
        id: toPublicId(row?.id),
        programRegistrationId: toPublicId(row?.id),
        studentId: toPublicId(row?.studentId),
        studentName: String(row?.studentName || '').trim(),
        feeCategory: String(row?.feeCategory || student?.feeCategory || '').trim(),
        studentAccountId: toPublicId(student?.studentAccountId || ''),
        alreadyRegisteredInTerm: Boolean(selectedTermOption?.alreadyRegistered),
        termCode: String(selectedTermOption?.termCode || '').trim(),
        termName: String(selectedTermOption?.termName || '').trim(),
        registrationDate: String(row?.registrationDate || '').trim()
      };
    })
    .filter(Boolean)
    .filter((row) => matchesSearch([
      row.programRegistrationId,
      row.studentId,
      row.studentName,
      row.feeCategory,
      row.studentAccountId,
      row.termCode,
      row.termName
    ], normalizedQuery))
    .sort((a, b) =>
      String(a?.studentName || '').localeCompare(String(b?.studentName || '')) ||
      String(a?.studentId || '').localeCompare(String(b?.studentId || ''))
    );
}

async function buildBatchClassRows(reqUser, activeOrgId, { programId, termId, query = '' } = {}) {
  const normalizedProgramId = toPublicId(programId);
  const normalizedTermId = toPublicId(termId);
  const normalizedQuery = String(normalizeSearchKeyword(query || '') || '').trim();
  const catalogRows = await buildClassCatalogOptions(reqUser, activeOrgId);

  return (Array.isArray(catalogRows) ? catalogRows : [])
    .filter((row) =>
      (Array.isArray(row?.allowedProgramTerms) ? row.allowedProgramTerms : [])
        .some((allowedRow) =>
          idsEqual(allowedRow?.programId, normalizedProgramId) &&
          idsEqual(allowedRow?.termId, normalizedTermId)
        )
    )
    .filter((row) => matchesSearch([
      row.id,
      row.title,
      row.status,
      row.deliveryDepartmentName,
      row.credits,
      ...(Array.isArray(row?.curriculumSubjects) ? row.curriculumSubjects : [])
        .flatMap((subjectRef) => [subjectRef?.subjectId, subjectRef?.code, subjectRef?.name])
    ], normalizedQuery))
    .sort((a, b) => String(a?.title || '').localeCompare(String(b?.title || '')));
}

async function buildTermBatchPreview(reqUser, activeOrgId, payload) {
  const {
    programId,
    termId,
    effectiveDate,
    externalReference,
    note,
    programRegistrationIds,
    classIds
  } = payload;

  if (!programId) throw new Error('Program is required.');
  if (!termId) throw new Error('Term is required.');
  if (!effectiveDate) throw new Error('Effective Date is required.');

  const [programCatalog, studentRows] = await Promise.all([
    buildBatchProgramCatalog(reqUser, activeOrgId),
    buildBatchStudentRows(reqUser, activeOrgId, { programId, termId, query: '' })
  ]);
  const selectedProgram = programCatalog.find((row) => idsEqual(row?.programId, programId)) || null;
  if (!selectedProgram) throw new Error('Selected program is invalid for the active organization.');

  const selectedTerm = (Array.isArray(selectedProgram?.termOptions) ? selectedProgram.termOptions : [])
    .find((row) => idsEqual(row?.termId, termId)) || null;
  if (!selectedTerm) throw new Error('Selected term is not available for the chosen program.');
  if (!isBatchEligibleTermStatus(selectedTerm?.termStatus)) {
    throw new Error('Selected term must be Active or Started for batch term registration.');
  }

  const effectiveDateIssue = getEffectiveDateOutOfRangeMessage(
    effectiveDate,
    selectedTerm?.startDate,
    selectedTerm?.endDate
  );
  const studentMap = new Map((Array.isArray(studentRows) ? studentRows : []).map((row) => [toPublicId(row?.programRegistrationId), row]));
  const selectedClassIds = asIdArray(classIds);
  const selectedCandidateStudents = asIdArray(programRegistrationIds)
    .map((registrationId) => studentMap.get(toPublicId(registrationId)) || null)
    .filter((row) => row && !row.alreadyRegisteredInTerm);
  const requestedSeatCount = selectedCandidateStudents.length;
  const classSeatIssueById = new Map();

  if (selectedClassIds.length && requestedSeatCount > 0) {
    const classRows = await buildBatchClassRows(reqUser, activeOrgId, { programId, termId, query: '' });
    const classMap = new Map((Array.isArray(classRows) ? classRows : []).map((row) => [toPublicId(row?.id), row]));
    selectedClassIds.forEach((classId) => {
      const classRow = classMap.get(toPublicId(classId)) || null;
      if (!classRow) return;
      const maxCapacity = Number(classRow?.maxCapacity || 0);
      const enrolledCount = Number(classRow?.enrolledCount || 0);
      if (maxCapacity > 0 && enrolledCount + requestedSeatCount > maxCapacity) {
        const availableSeats = Math.max(0, maxCapacity - enrolledCount);
        const classTitle = String(classRow?.title || classRow?.id || classId).trim() || classId;
        classSeatIssueById.set(toPublicId(classId), `Class "${classTitle}" has ${availableSeats} available seat(s), but ${requestedSeatCount} selected student(s) require seats.`);
      }
    });
  }

  const rows = [];

  for (const registrationId of asIdArray(programRegistrationIds)) {
    const selectedStudent = studentMap.get(toPublicId(registrationId)) || null;
    if (!selectedStudent) {
      rows.push({
        programRegistrationId: registrationId,
        studentId: '',
        studentName: registrationId,
        status: 'error',
        issues: ['Selected student/program registration is no longer available for this program and term.'],
        warnings: [],
        totalAmount: 0,
        classCount: 0,
        selectedCredits: 0,
        preview: null
      });
      continue;
    }

    if (selectedStudent.alreadyRegisteredInTerm) {
      rows.push({
        programRegistrationId: selectedStudent.programRegistrationId,
        studentId: selectedStudent.studentId,
        studentName: selectedStudent.studentName || selectedStudent.studentId,
        status: 'error',
        issues: ['Student already has an active registration in the selected term.'],
        warnings: [],
        totalAmount: 0,
        classCount: 0,
        selectedCredits: 0,
        preview: null
      });
      continue;
    }

    try {
      const preview = await buildTermRegistrationPreview({
        studentId: selectedStudent.studentId,
        programRegistrationId: selectedStudent.programRegistrationId,
        termId,
        classIds,
        reqUser,
        requestBody: {
          effectiveDate,
          externalReference
        }
      });
      const issues = Array.isArray(preview?.issues) ? [...preview.issues] : [];
      if (effectiveDateIssue) issues.unshift(effectiveDateIssue);
      const warnings = Array.isArray(preview?.warnings) ? [...preview.warnings] : [];
      const rowSeatIssues = (Array.isArray(preview?.classSelections) ? preview.classSelections : [])
        .map((classPreview) => classSeatIssueById.get(toPublicId(classPreview?.classId)))
        .filter(Boolean);
      if (rowSeatIssues.length) {
        issues.push(...rowSeatIssues);
      }
      const fullClasses = (Array.isArray(preview?.classSelections) ? preview.classSelections : [])
        .filter((classPreview) => Number(classPreview?.capacity?.max || 0) > 0 && Number(classPreview?.capacity?.enrolled || 0) >= Number(classPreview?.capacity?.max || 0))
        .map((classPreview) => String(classPreview?.classTitle || classPreview?.classId || '').trim())
        .filter(Boolean);
      if (fullClasses.length) {
        issues.push(`No available seats in: ${fullClasses.join(', ')}.`);
      }
      const hasIssues = issues.length > 0;
      const status = hasIssues ? 'error' : (String(preview?.status || '').toLowerCase() === 'warning' ? 'warning' : 'ready');

      rows.push({
        programRegistrationId: selectedStudent.programRegistrationId,
        studentId: selectedStudent.studentId,
        studentName: selectedStudent.studentName || selectedStudent.studentId,
        status,
        issues,
        warnings,
        totalAmount: Number(preview?.financeSummary?.grandTotal || 0),
        classCount: Number((Array.isArray(preview?.classSelections) ? preview.classSelections.length : 0)),
        selectedCredits: Number(preview?.creditSummary?.selectedCredits || 0),
        preview
      });
    } catch (error) {
      rows.push({
        programRegistrationId: selectedStudent.programRegistrationId,
        studentId: selectedStudent.studentId,
        studentName: selectedStudent.studentName || selectedStudent.studentId,
        status: 'error',
        issues: [String(error?.message || 'Failed to build preview for this student.')],
        warnings: [],
        totalAmount: 0,
        classCount: 0,
        selectedCredits: 0,
        preview: null
      });
    }
  }

  const readyRows = rows.filter((row) => row.status !== 'error');
  return {
    note: String(note || '').trim(),
    effectiveDate,
    externalReference: String(externalReference || '').trim(),
    program: selectedProgram,
    term: selectedTerm,
    effectiveDateIssue,
    rows,
    summary: {
      totalRows: rows.length,
      readyRows: readyRows.length,
      errorRows: rows.length - readyRows.length,
      totalAmount: roundMoney(readyRows.reduce((sum, row) => sum + Number(row?.totalAmount || 0), 0))
    },
    aggregateIssues: Array.from(classSeatIssueById.values())
  };
}

function sanitizeBatchPreviewRows(rowsInput) {
  return (Array.isArray(rowsInput) ? rowsInput : []).map((row) => ({
    programRegistrationId: row.programRegistrationId,
    studentId: row.studentId,
    studentName: row.studentName,
    status: row.status,
    issues: Array.isArray(row.issues) ? row.issues : [],
    warnings: Array.isArray(row.warnings) ? row.warnings : [],
    totalAmount: Number(row.totalAmount || 0),
    classCount: Number(row.classCount || 0),
    selectedCredits: Number(row.selectedCredits || 0)
  }));
}

async function renderRegistrationPage(req, res, viewName, pageTitle) {
  try {
    const activeOrgId = await assertCreateOrgContextOrThrow(req.user, { scopeLabel: 'term registrations' });
    const recentRegistrations = await buildRegistrationSummaries(req.user, activeOrgId, { limit: 20 });
    const canManageRegistrations = await canCreateOrgScopedItem(req.user, { scopeLabel: 'term registrations' });

    res.render(viewName, {
      title: pageTitle,
      recentRegistrations,
      canManageRegistrations,
      user: req.user,
      includeModal: true,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
}

exports.showRegistrationPage = async (req, res) => {
  return renderRegistrationPage(req, res, 'school/program/termRegistrationForm', 'Student Term Registration');
};

exports.showRegistrationWizardPage = async (req, res) => {
  return renderRegistrationPage(req, res, 'school/program/termRegistrationWizardForm', 'Student Term Registration Wizard');
};

exports.showBatchRegistrationWizardPage = async (req, res) => {
  return renderRegistrationPage(req, res, 'school/program/termRegistrationBatchWizard', 'Student Term Registration Batch Wizard');
};

exports.listBatchProgramOptions = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const query = String(normalizeSearchKeyword(req.query.q || '') || '').trim();
    const rows = (await buildBatchProgramCatalog(req.user, activeOrgId))
      .filter((row) => matchesSearch([
        row.programId,
        row.programCode,
        row.programName,
        ...(Array.isArray(row?.termOptions) ? row.termOptions : []).flatMap((termRow) => [
          termRow.termId,
          termRow.termCode,
          termRow.termName
        ])
      ], query))
      .slice(0, 100);
    return res.json({ status: 'success', results: rows });
  } catch (error) {
    return res.status(400).json({
      status: 'error',
      message: String(error?.message || 'Batch preview failed due to invalid data or missing dependencies.')
    });
  }
};

exports.listBatchStudents = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const programId = toPublicId(req.query.programId);
    const termId = toPublicId(req.query.termId);
    const query = String(req.query.q || '').trim();
    if (!programId || !termId) return res.json({ status: 'success', results: [] });
    const rows = (await buildBatchStudentRows(req.user, activeOrgId, { programId, termId, query })).slice(0, 300);
    return res.json({ status: 'success', results: rows });
  } catch (error) {
    return res.status(400).json({
      status: 'error',
      message: String(error?.message || 'Batch draft save failed due to invalid data or missing dependencies.')
    });
  }
};

exports.listBatchClasses = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const programId = toPublicId(req.query.programId);
    const termId = toPublicId(req.query.termId);
    const query = String(req.query.q || '').trim();
    if (!programId || !termId) return res.json({ status: 'success', results: [] });
    const rows = (await buildBatchClassRows(req.user, activeOrgId, { programId, termId, query })).slice(0, 300);
    return res.json({ status: 'success', results: rows });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.previewBatchRegistration = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const payload = normalizeTermBatchPayload(req.body);

    const preview = await buildTermBatchPreview(req.user, activeOrgId, payload);
    return res.json({
      status: preview.summary.errorRows ? (preview.summary.readyRows ? 'warning' : 'error') : 'success',
      preview: {
        effectiveDate: preview.effectiveDate,
        effectiveDateIssue: preview.effectiveDateIssue,
        program: preview.program,
        term: preview.term,
        summary: preview.summary,
        aggregateIssues: Array.isArray(preview.aggregateIssues) ? preview.aggregateIssues : [],
        rows: sanitizeBatchPreviewRows(preview.rows)
      }
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.applyBatchRegistration = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const payload = normalizeTermBatchPayload(req.body);
    const guardKey = idempotencyGuardService.createGuardKey([
      'term_batch_apply',
      activeOrgId,
      payload.programId,
      payload.termId,
      payload.effectiveDate,
      asSortedIdArray(payload.programRegistrationIds),
      asSortedIdArray(payload.classIds)
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 120000,
      replayTtlMs: 20000
    });
    if (sendGuardedResponse(res, guardResult, 'This batch draft save is already in progress. Please wait.')) return;

    try {
      const preview = await buildTermBatchPreview(req.user, activeOrgId, payload);
      const creatableRows = preview.rows.filter((row) => row.status !== 'error' && row.preview);
      if (!creatableRows.length) {
        const payloadOut = {
          status: 'error',
          message: 'No students are ready for draft creation. Resolve issues and run preview again.',
          preview: {
            summary: preview.summary,
            rows: sanitizeBatchPreviewRows(preview.rows)
          }
        };
        idempotencyGuardService.completeGuard(guardKey, payloadOut);
        return res.status(400).json(payloadOut);
      }

      const created = [];
      const skipped = [];

      for (const row of preview.rows) {
        if (row.status === 'error' || !row.preview) {
          skipped.push({
            programRegistrationId: row.programRegistrationId,
            studentId: row.studentId,
            studentName: row.studentName,
            status: row.status,
            issues: Array.isArray(row.issues) ? row.issues : []
          });
          continue;
        }

        const studentPreview = row.preview;
        const expectedAcademicEntryCount = countExpectedAcademicEntries(studentPreview);
        const registration = await dataService.addData('studentTermRegistrations', {
          orgId: activeOrgId,
          studentId: studentPreview.student.id,
          personId: studentPreview.student.personId,
          programId: studentPreview.programRegistration.programId,
          programRegistrationId: studentPreview.programRegistration.id,
          termId: studentPreview.term.id,
          registrationDate: preview.effectiveDate,
          status: 'draft',
          feeCategorySnapshot: studentPreview.student.feeCategory,
          note: preview.note,
          creditSummary: studentPreview.creditSummary,
          classSummary: {
            count: studentPreview.classSelections.length,
            rows: studentPreview.classSelections
          },
          validationSummary: {
            status: studentPreview.status,
            issues: studentPreview.issues,
            warnings: studentPreview.warnings
          },
          transactionSummary: {
            previewCount: studentPreview.financeSummary.termTransactionPreview.length + studentPreview.financeSummary.classTransactionPreview.length,
            termPreviewCount: studentPreview.financeSummary.termTransactionPreview.length,
            classPreviewCount: studentPreview.financeSummary.classTransactionPreview.length,
            postedCount: 0,
            termTransactionTotal: studentPreview.financeSummary.termTransactionTotal,
            classTransactionTotal: studentPreview.financeSummary.classTransactionTotal,
            classFeeTotal: studentPreview.financeSummary.classFeeTotal,
            grandTotal: studentPreview.financeSummary.grandTotal,
            transactionIds: [],
            reversalIds: [],
            draftTermTransactionItems: Array.isArray(studentPreview.financeSummary.termTransactionItems) ? studentPreview.financeSummary.termTransactionItems : [],
            draftClassTransactionItems: Array.isArray(studentPreview.financeSummary.classTransactionItems) ? studentPreview.financeSummary.classTransactionItems : [],
            draftTermTransactionPreview: Array.isArray(studentPreview.financeSummary.termTransactionPreview) ? studentPreview.financeSummary.termTransactionPreview : [],
            draftClassTransactionPreview: Array.isArray(studentPreview.financeSummary.classTransactionPreview) ? studentPreview.financeSummary.classTransactionPreview : [],
            draftSavedAt: new Date().toISOString(),
            externalReference: preview.externalReference
          },
          academicSummary: {
            entryCount: 0,
            expectedEntryCount: expectedAcademicEntryCount,
            entryIds: [],
            voidedEntryIds: []
          },
          classEnrollmentSummary: {
            rows: [],
            removedRows: [],
            expectedCount: studentPreview.classSelections.length
          },
          rosterSummary: {
            rows: [],
            removedRows: [],
            expectedRosterCount: studentPreview.classSelections.length
          }
        }, req.user);

        created.push({
          registrationId: registration.id,
          programRegistrationId: row.programRegistrationId,
          studentId: row.studentId,
          studentName: row.studentName,
          status: row.status
        });
      }

      const hasSkipped = skipped.length > 0;
      const payloadOut = {
        status: hasSkipped ? 'warning' : 'success',
        message: hasSkipped
          ? `Saved ${created.length} draft term registrations. ${skipped.length} rows were skipped due to validation issues.`
          : `Saved ${created.length} draft term registrations successfully.`,
        result: {
          createdCount: created.length,
          skippedCount: skipped.length,
          created,
          skipped
        }
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

exports.listProgramRegistrationOptions = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const studentId = toPublicId(req.query.studentId);
    const query = String(normalizeSearchKeyword(req.query.q || '') || '').trim();
    if (!studentId) return res.json({ status: 'success', results: [] });

    const rows = (await buildActiveProgramRegistrationOptions(req.user, activeOrgId))
      .filter((row) => idsEqual(row.studentId, studentId))
      .filter((row) => matchesSearch([
        row.id,
        row.studentName,
        row.programId,
        row.programCode,
        row.programName,
        row.registrationDate,
        row.feeCategory,
        ...(row.termOptions || []).flatMap((term) => [term.termId, term.termCode, term.termName])
      ], query))
      .map((row) => ({
        ...row,
        termCount: Array.isArray(row.termOptions) ? row.termOptions.length : 0,
        openTermCount: Array.isArray(row.termOptions) ? row.termOptions.filter((term) => !term.alreadyRegistered).length : 0
      }))
      .slice(0, 20);

    return res.json({ status: 'success', results: rows });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.listEligibleClasses = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const programRegistrationId = toPublicId(req.query.programRegistrationId);
    const termId = toPublicId(req.query.termId);
    const query = String(normalizeSearchKeyword(req.query.q || '') || '').trim();
    if (!programRegistrationId || !termId) return res.json({ status: 'success', results: [] });

    const registrations = await buildActiveProgramRegistrationOptions(req.user, activeOrgId);
    const registration = registrations.find((row) => idsEqual(row.id, programRegistrationId)) || null;
    if (!registration) return res.json({ status: 'success', results: [] });

    const programSubjectIds = new Set((registration.programSubjectIds || []).map(String));
    const rows = (await buildClassCatalogOptions(req.user, activeOrgId))
      .filter((row) => {
        const allowed = Array.isArray(row.allowedProgramTerms) && row.allowedProgramTerms.length
          && row.allowedProgramTerms.some((allowedRow) =>
            idsEqual(allowedRow.programId, registration.programId) &&
            idsEqual(allowedRow.termId, termId)
          );
        if (!allowed) return false;
        return (row.curriculumSubjects || []).some((subjectRef) => programSubjectIds.has(String(subjectRef.subjectId || '')));
      })
      .filter((row) => matchesSearch([
        row.id,
        row.title,
        row.status,
        row.deliveryDepartmentName,
        ...(row.curriculumSubjects || []).flatMap((subjectRef) => [subjectRef.subjectId, subjectRef.code, subjectRef.name])
      ], query))
      .slice(0, 20);

    return res.json({ status: 'success', results: rows });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.listAvailableTerms = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const programRegistrationId = toPublicId(req.query.programRegistrationId);
    const query = String(normalizeSearchKeyword(req.query.q || '') || '').trim();
    if (!programRegistrationId) return res.json({ status: 'success', results: [] });

    const registrations = await buildActiveProgramRegistrationOptions(req.user, activeOrgId);
    const registration = registrations.find((row) => idsEqual(row.id, programRegistrationId)) || null;
    if (!registration) return res.json({ status: 'success', results: [] });

    const rows = (registration.termOptions || [])
      .filter((term) => !term.alreadyRegistered)
      .filter((term) => matchesSearch([
        term.termId,
        term.termCode,
        term.termName,
        term.termStatus,
        term.order
      ], query))
      .slice(0, 20);

    return res.json({ status: 'success', results: rows });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.previewRegistration = async (req, res) => {
  try {
    const payload = normalizeTermRegistrationPayload(req.body);
    const preview = await buildValidatedSinglePreview(req.user, payload);

    return res.json({ status: 'success', preview });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

function countExpectedAcademicEntries(preview) {
  return termRegistrationViewService.countExpectedAcademicEntries(preview);
}

exports.applyRegistration = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const payload = normalizeTermRegistrationPayload(req.body);
    const guardKey = idempotencyGuardService.createGuardKey([
      'term_single_apply',
      activeOrgId,
      payload.studentId,
      payload.programRegistrationId,
      payload.termId,
      payload.effectiveDate,
      asSortedIdArray(payload.classIds)
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 120000,
      replayTtlMs: 20000
    });
    if (sendGuardedResponse(res, guardResult, 'Draft save is already in progress. Please wait.')) return;

    try {
      const preview = await buildValidatedSinglePreview(req.user, payload);
      if (preview.status === 'error') throw new Error(preview.issues.join(' '));

      const student = await dataService.getDataById('students', payload.studentId, req.user);
      const program = await registrationIntegrityService.getProgramInOrgOrThrow(preview.programRegistration.programId, activeOrgId, req.user);
      const term = await dataService.getDataById('terms', payload.termId, req.user);
      if (!student || !term) throw new Error('Student, program, or term could not be loaded during apply.');

      const expectedAcademicEntryCount = countExpectedAcademicEntries(preview);
      const registration = await dataService.addData('studentTermRegistrations', {
        orgId: program.orgId,
        studentId: preview.student.id,
        personId: preview.student.personId,
        programId: preview.programRegistration.programId,
        programRegistrationId: preview.programRegistration.id,
        termId: preview.term.id,
        registrationDate: payload.effectiveDate,
        status: 'draft',
        feeCategorySnapshot: preview.student.feeCategory,
        note: payload.note,
        creditSummary: preview.creditSummary,
        classSummary: {
          count: preview.classSelections.length,
          rows: preview.classSelections
        },
        validationSummary: {
          status: preview.status,
          issues: preview.issues,
          warnings: preview.warnings
        },
        transactionSummary: {
          previewCount: preview.financeSummary.termTransactionPreview.length + preview.financeSummary.classTransactionPreview.length,
          termPreviewCount: preview.financeSummary.termTransactionPreview.length,
          classPreviewCount: preview.financeSummary.classTransactionPreview.length,
          postedCount: 0,
          termTransactionTotal: preview.financeSummary.termTransactionTotal,
          classTransactionTotal: preview.financeSummary.classTransactionTotal,
          classFeeTotal: preview.financeSummary.classFeeTotal,
          grandTotal: preview.financeSummary.grandTotal,
          transactionIds: [],
          reversalIds: [],
          draftTermTransactionItems: Array.isArray(preview.financeSummary.termTransactionItems) ? preview.financeSummary.termTransactionItems : [],
          draftClassTransactionItems: Array.isArray(preview.financeSummary.classTransactionItems) ? preview.financeSummary.classTransactionItems : [],
          draftTermTransactionPreview: Array.isArray(preview.financeSummary.termTransactionPreview) ? preview.financeSummary.termTransactionPreview : [],
          draftClassTransactionPreview: Array.isArray(preview.financeSummary.classTransactionPreview) ? preview.financeSummary.classTransactionPreview : [],
          draftSavedAt: new Date().toISOString(),
          externalReference: payload.externalReference
        },
        academicSummary: {
          entryCount: 0,
          expectedEntryCount: expectedAcademicEntryCount,
          entryIds: [],
          voidedEntryIds: []
        },
        classEnrollmentSummary: {
          rows: [],
          removedRows: [],
          expectedCount: preview.classSelections.length
        },
        rosterSummary: {
          rows: [],
          removedRows: [],
          expectedRosterCount: preview.classSelections.length
        }
      });

      const payloadOut = {
        status: preview.warnings.length ? 'warning' : 'success',
        message: preview.warnings.length
          ? 'Draft saved with warnings. Review and approve to post.'
          : 'Draft saved successfully. Review and approve to post.',
        registrationId: registration.id
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
    const registrationId = toPublicId(req.params.id);
    const note = String(req.body.note || '').trim();
    const editedRows = parseJsonSafe(req.body.editedRows, []);
    const addedRows = parseJsonSafe(req.body.addedRows, []);
    if (!registrationId) throw new Error('Registration id is required.');

    const guardKey = idempotencyGuardService.createGuardKey([
      'term_draft_update',
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
      const registration = await registrationIntegrityService.getTermDraftForEditOrThrow(registrationId, activeOrgId);
      const draftState = await applyTermDraftTransactionChanges({
        registration,
        editedRows,
        addedRows,
        reqUser: req.user,
        activeOrgId
      });

      const updated = await dataService.updateData(
        'studentTermRegistrations',
        registration.id,
        {
          status: 'draft',
          programRegistrationId: registration.programRegistrationId,
          registrationDate: registration.registrationDate,
          feeCategorySnapshot: registration.feeCategorySnapshot,
          note: note ? appendNote(registration.note, note) : registration.note,
          creditSummary: registration.creditSummary || {},
          classSummary: registration.classSummary || {},
          validationSummary: registration.validationSummary || {},
          transactionSummary: {
            ...(registration.transactionSummary || {}),
            previewCount: draftState.draftPreviewRows.length,
            termPreviewCount: draftState.termPreviewRows.length,
            classPreviewCount: draftState.classPreviewRows.length,
            postedCount: Number(registration?.transactionSummary?.postedCount || 0),
            termTransactionTotal: draftState.termTotal,
            classTransactionTotal: draftState.classTotal,
            classFeeTotal: draftState.classTotal,
            grandTotal: draftState.grandTotal,
            draftTermTransactionItems: draftState.termItems,
            draftClassTransactionItems: draftState.classItems,
            draftTermTransactionPreview: draftState.termPreviewRows,
            draftClassTransactionPreview: draftState.classPreviewRows,
            draftSavedAt: new Date().toISOString()
          },
          academicSummary: registration.academicSummary || {},
          classEnrollmentSummary: registration.classEnrollmentSummary || {},
          rosterSummary: registration.rosterSummary || {}
        },
        req.user
      );

      const payloadOut = {
        status: 'success',
        message: 'Draft transactions updated.',
        registrationId: updated.id,
        draftPreviewRows: draftState.draftPreviewRows,
        totalAmount: draftState.grandTotal
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
    const approvalNote = String(req.body.note || '').trim();
    const editedRows = parseJsonSafe(req.body.editedRows, []);
    const addedRows = parseJsonSafe(req.body.addedRows, []);
    if (!registrationId) throw new Error('Registration id is required.');

    guardKey = idempotencyGuardService.createGuardKey([
      'term_approve',
      activeOrgId,
      registrationId
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 180000,
      replayTtlMs: 20000
    });
    if (sendGuardedResponse(res, guardResult, 'Approval is already in progress for this registration. Please wait.')) return;

    const approvalContext = await registrationIntegrityService.getTermDraftForApproval(registrationId, activeOrgId);
    const registration = approvalContext.registration;
    if (approvalContext.alreadyApproved) {
      const payloadOut = { status: 'success', message: 'Term registration was already approved and posted.', registrationId: registration.id };
      idempotencyGuardService.completeGuard(guardKey, payloadOut);
      return res.json(payloadOut);
    }

    txContext = createTransactionContext({
      name: 'term_registration_approve',
      metadata: {
        registrationId,
        activeOrgId: toPublicId(activeOrgId),
        requestUserId: toPublicId(req.user?.id) || String(req.user?.username || 'system')
      }
    });

    const classRows = Array.isArray(registration?.classSummary?.rows) ? registration.classSummary.rows : [];
    const classIds = asIdArray(classRows.map((row) => row?.classId || row?.id));
    const effectiveDate = String(registration.registrationDate || '').trim() || new Date().toISOString().slice(0, 10);
    const externalReference = String(registration?.transactionSummary?.externalReference || '').trim();
    const effectiveNote = approvalNote || String(registration.note || '').trim();

    const preview = await buildTermRegistrationPreview({
      studentId: toPublicId(registration.studentId),
      programRegistrationId: toPublicId(registration.programRegistrationId),
      termId: toPublicId(registration.termId),
      classIds,
      reqUser: req.user,
      requestBody: {
        effectiveDate,
        externalReference,
        sourceEventId: `STR-${registration.id}`,
        idempotencyKey: `STR|${registration.id}|${effectiveDate}`
      },
      ignoreRegistrationId: registration.id
    });

    if (!preview.programRegistration || !preview.term) {
      throw new Error('Draft approval failed: registration context could not be resolved.');
    }
    if (preview.status === 'error') {
      throw new Error((preview.issues || []).join(' ') || 'Draft approval failed due to validation errors.');
    }

    const student = await dataService.getDataById('students', preview.student.id, req.user);
    const program = await registrationIntegrityService.getProgramInOrgOrThrow(preview.programRegistration.programId, activeOrgId, req.user);
    const term = await dataService.getDataById('terms', preview.term.id, req.user);
    if (!student || !term) throw new Error('Student, program, or term could not be loaded during approval.');
    const termId = toPublicId(preview.term?.id || registration.termId);
    if (!termId) throw new Error('Term id is required during approval.');

    const createdTransactions = [];
    const academicEntries = [];
    const classEnrollmentEntries = [];
    const finalDraftState = await applyTermDraftTransactionChanges({
      registration,
      editedRows,
      addedRows,
      reqUser: req.user,
      activeOrgId,
      fallbackTermItems: preview?.financeSummary?.termTransactionItems || [],
      fallbackClassItems: preview?.financeSummary?.classTransactionItems || []
    });
    try {
      if (Array.isArray(finalDraftState.termItems) && finalDraftState.termItems.length) {
        const postedTransactions = await dataService.addData(
          'globalTransactions',
          finalDraftState.termItems,
          req.user,
          { transactionContext: txContext }
        );
        createdTransactions.push(...(Array.isArray(postedTransactions) ? postedTransactions : [postedTransactions]).filter(Boolean));
      }
      if (Array.isArray(finalDraftState.classItems) && finalDraftState.classItems.length) {
        const postedClassTransactions = await dataService.addData(
          'globalTransactions',
          finalDraftState.classItems,
          req.user,
          { transactionContext: txContext }
        );
        createdTransactions.push(...(Array.isArray(postedClassTransactions) ? postedClassTransactions : [postedClassTransactions]).filter(Boolean));
      }

      const postedTermEntry = await academicLedgerService.postTermRegistration({
        reqUser: req.user,
        student,
        program,
        term,
        effectiveDate,
        note: effectiveNote,
        source: {
          eventId: `STR-${registration.id}-TERM`,
          idempotencyKey: `STR|${registration.id}|term`
        },
        options: { transactionContext: txContext }
      });
      academicEntries.push(...(Array.isArray(postedTermEntry) ? postedTermEntry : [postedTermEntry]).filter(Boolean));

      for (const classPreview of preview.classSelections) {
        for (const subjectId of asIdArray(classPreview.subjectIds)) {
          const postedClassEntries = await academicLedgerService.postClassEnrollment({
            reqUser: req.user,
            student,
            program,
            termId,
            classItem: { id: classPreview.classId, title: classPreview.classTitle },
            subjectId,
            subjectType: '',
            creditsAttempted: null,
            effectiveDate,
            note: effectiveNote,
            source: {
              eventId: `STR-${registration.id}-${classPreview.classId}-${subjectId}`,
              idempotencyKey: `STR|${registration.id}|${classPreview.classId}|${subjectId}`
            },
            options: { transactionContext: txContext }
          });
          academicEntries.push(...(Array.isArray(postedClassEntries) ? postedClassEntries : [postedClassEntries]).filter(Boolean));
        }

        const classEnrollmentEntry = await registrationIntegrityService.addStudentToClassEnrollment({
          classId: classPreview.classId,
          student,
          classPreview,
          reqUser: req.user,
          registrationId: registration.id,
          programRegistrationId: preview.programRegistration.id,
          programId: preview.programRegistration.programId,
          termId,
          effectiveDate,
          options: { transactionContext: txContext }
        });
        if (!classEnrollmentEntry.reused) classEnrollmentEntries.push(classEnrollmentEntry);
      }

      const updated = await dataService.updateData(
        'studentTermRegistrations',
        registration.id,
        {
          status: 'registered',
          programRegistrationId: preview.programRegistration.id,
          registrationDate: effectiveDate,
          feeCategorySnapshot: preview.student.feeCategory,
          note: effectiveNote,
          creditSummary: preview.creditSummary,
          classSummary: {
            count: preview.classSelections.length,
            rows: preview.classSelections
          },
          validationSummary: {
            status: preview.status,
            issues: preview.issues,
            warnings: preview.warnings
          },
          transactionSummary: {
            previewCount: finalDraftState.draftPreviewRows.length,
            termPreviewCount: finalDraftState.termPreviewRows.length,
            classPreviewCount: finalDraftState.classPreviewRows.length,
            postedCount: createdTransactions.length,
            termTransactionTotal: finalDraftState.termTotal,
            classTransactionTotal: finalDraftState.classTotal,
            classFeeTotal: finalDraftState.classTotal,
            grandTotal: finalDraftState.grandTotal,
            transactionIds: createdTransactions.map((row) => toPublicId(row.id)).filter(Boolean),
            reversalIds: [],
            draftTermTransactionItems: finalDraftState.termItems,
            draftClassTransactionItems: finalDraftState.classItems,
            draftTermTransactionPreview: finalDraftState.termPreviewRows,
            draftClassTransactionPreview: finalDraftState.classPreviewRows,
            externalReference,
            approvedAt: new Date().toISOString(),
            approvedBy: toPublicId(req.user?.id) || String(req.user?.username || 'system')
          },
          academicSummary: {
            entryCount: academicEntries.length,
            expectedEntryCount: countExpectedAcademicEntries(preview),
            entryIds: academicEntries.map((entry) => toPublicId(entry.id)).filter(Boolean),
            voidedEntryIds: []
          },
          classEnrollmentSummary: {
            rows: classEnrollmentEntries,
            removedRows: [],
            expectedCount: preview.classSelections.length
          },
          rosterSummary: {
            rows: classEnrollmentEntries,
            removedRows: [],
            expectedRosterCount: preview.classSelections.length
          }
        },
        req.user,
        { transactionContext: txContext }
      );

      await txContext.commit({ registrationId: toPublicId(updated.id), flow: 'term_approval' });

      const payloadOut = {
        status: preview.warnings.length ? 'warning' : 'success',
        message: preview.warnings.length
          ? 'Draft approved and posted with warnings.'
          : 'Draft approved and posted successfully.',
        registrationId: updated.id
      };
      idempotencyGuardService.completeGuard(guardKey, payloadOut);
      return res.json(payloadOut);
    } catch (approvalError) {
      const rollbackResult = await registrationIntegrityService.rollbackTermRegistrationSideEffects({
        registrationId: registration.id,
        transactionIds: createdTransactions.map((row) => toPublicId(row.id)).filter(Boolean),
        academicEntryIds: academicEntries.map((row) => toPublicId(row.id)).filter(Boolean),
        classEnrollmentEntries,
        reqUser: req.user,
        studentId: preview.student.id,
        programId: preview.programRegistration.programId,
        reason: `Term registration draft approval ${registration.id} failed and was rolled back. ${approvalError.message}`,
        options: { transactionContext: txContext }
      });

      const rollbackSucceeded = rollbackResult.issues.length === 0;
      const nextStatus = rollbackSucceeded ? 'draft' : 'error';

      await dataService.updateData(
        'studentTermRegistrations',
        registration.id,
        {
          status: nextStatus,
          programRegistrationId: preview.programRegistration.id,
          registrationDate: effectiveDate,
          feeCategorySnapshot: preview.student.feeCategory,
          note: buildRollbackNote(registration.note, approvalError.message, rollbackResult.issues),
          creditSummary: preview.creditSummary,
          classSummary: {
            count: preview.classSelections.length,
            rows: preview.classSelections
          },
          validationSummary: {
            status: preview.status,
            issues: preview.issues,
            warnings: preview.warnings
          },
          transactionSummary: {
            previewCount: finalDraftState.draftPreviewRows.length,
            termPreviewCount: finalDraftState.termPreviewRows.length,
            classPreviewCount: finalDraftState.classPreviewRows.length,
            postedCount: 0,
            termTransactionTotal: finalDraftState.termTotal,
            classTransactionTotal: finalDraftState.classTotal,
            classFeeTotal: finalDraftState.classTotal,
            grandTotal: finalDraftState.grandTotal,
            transactionIds: [],
            reversalIds: rollbackResult.reversalIds,
            draftTermTransactionItems: finalDraftState.termItems,
            draftClassTransactionItems: finalDraftState.classItems,
            draftTermTransactionPreview: finalDraftState.termPreviewRows,
            draftClassTransactionPreview: finalDraftState.classPreviewRows,
            externalReference,
            lastApprovalAttempt: {
              attemptedAt: new Date().toISOString(),
              error: String(approvalError.message || ''),
              rollbackIssues: rollbackResult.issues
            }
          },
          academicSummary: {
            entryCount: 0,
            expectedEntryCount: countExpectedAcademicEntries(preview),
            entryIds: [],
            voidedEntryIds: rollbackResult.voidedEntryIds
          },
          classEnrollmentSummary: {
            rows: [],
            expectedCount: preview.classSelections.length,
            removedRows: rollbackResult.removedClassEnrollmentEntries
          },
          rosterSummary: {
            rows: [],
            expectedRosterCount: preview.classSelections.length,
            removedRows: rollbackResult.removedClassEnrollmentEntries
          }
        },
        req.user,
        { transactionContext: txContext }
      );

      await txContext.rollback({
        registrationId: toPublicId(registration.id),
        flow: 'term_approval',
        reason: approvalError.message || 'Approval failed'
      });

      idempotencyGuardService.failGuard(guardKey);
      return res.status(400).json({
        status: rollbackSucceeded ? 'warning' : 'error',
        message: rollbackSucceeded
          ? `Draft approval failed and all side effects were rolled back. Draft remains open. ${approvalError.message}`
          : buildRollbackNote('', approvalError.message, rollbackResult.issues),
        registrationId: registration.id
      });
    }
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (txContext) {
      await txContext.rollback({ flow: 'term_approval', reason: error.message || 'Unhandled approval failure' });
    }
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.listRegistrations = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const filters = {
      q: req.query.q || '',
      status: req.query.status || '',
      verificationStatus: req.query.verificationStatus || ''
    };
    const allRows = await buildRegistrationSummaries(req.user, activeOrgId, { filters });
    const { data, pagination } = paginate(allRows, req.query);
    const canManageRegistrations = await canCreateOrgScopedItem(req.user, { scopeLabel: 'term registrations' });

    res.render('school/program/termRegistrationList', {
      title: 'Term Registrations',
      tableName: 'Term_Registrations',
      newUrl: 'school/programs/register-terms',
      newLabel: 'Register Term',
      data,
      pagination,
      filters: req.query,
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
    if (!registration) throw new Error('Term registration not found or inaccessible.');
    const canManageRegistrations = await canCreateOrgScopedItem(req.user, { scopeLabel: 'term registrations' });

    res.render('school/program/termRegistrationDetails', {
      title: 'Term Registration Details',
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

exports.rollbackRegistration = async (req, res) => {
  let txContext = null;
  let guardKey = '';
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const registrationId = toPublicId(req.params.id);
    const note = String(req.body.note || '').trim();
    if (!registrationId) throw new Error('Registration id is required.');

    guardKey = idempotencyGuardService.createGuardKey([
      'term_rollback',
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
      name: 'term_registration_manual_rollback',
      metadata: {
        registrationId,
        activeOrgId: toPublicId(activeOrgId),
        requestUserId: toPublicId(req.user?.id) || String(req.user?.username || 'system')
      }
    });

    const registration = await registrationIntegrityService.getTermRegistrationInOrgOrThrow(registrationId, activeOrgId);
    const currentStatus = String(registration.status || '').toLowerCase();
    if (currentStatus === 'draft') {
      const payloadOut = { status: 'success', message: 'Registration is already in draft.' };
      idempotencyGuardService.completeGuard(guardKey, payloadOut);
      return res.json(payloadOut);
    }
    if (!['registered', 'error'].includes(currentStatus)) {
      throw new Error('Only posted registrations (or failed-posting errors) can be rolled back to draft.');
    }

    const rollbackResult = await registrationIntegrityService.rollbackTermRegistrationSideEffects({
      registrationId: registration.id,
      transactionIds: registration?.transactionSummary?.transactionIds,
      academicEntryIds: registration?.academicSummary?.entryIds,
      classEnrollmentEntries: registration?.classEnrollmentSummary?.rows || registration?.rosterSummary?.rows,
      reqUser: req.user,
      studentId: registration.studentId,
      programId: registration.programId,
      reason: note || `Manual rollback of term registration ${registration.id}`,
      options: { transactionContext: txContext }
    });

    const rollbackSucceeded = rollbackResult.issues.length === 0;
    const nextStatus = rollbackSucceeded ? 'draft' : 'error';
    await dataService.updateData(
      'studentTermRegistrations',
      registration.id,
      {
        status: nextStatus,
        programRegistrationId: registration.programRegistrationId,
        registrationDate: registration.registrationDate,
        feeCategorySnapshot: registration.feeCategorySnapshot,
        note: buildRollbackNote(registration.note, note || 'Registration moved back to draft.', rollbackResult.issues),
        creditSummary: registration.creditSummary || {},
        classSummary: registration.classSummary || {},
        validationSummary: registration.validationSummary || {},
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
        },
        classEnrollmentSummary: {
          ...(registration.classEnrollmentSummary || registration.rosterSummary || {}),
          removedRows: rollbackResult.removedClassEnrollmentEntries
        },
        rosterSummary: {
          ...(registration.rosterSummary || registration.classEnrollmentSummary || {}),
          removedRows: rollbackResult.removedClassEnrollmentEntries
        }
      },
      req.user,
      { transactionContext: txContext }
    );

    await txContext.commit({ registrationId: toPublicId(registration.id), flow: 'term_manual_rollback' });

    const payloadOut = {
      status: rollbackResult.issues.length ? 'warning' : 'success',
      message: rollbackResult.issues.length
        ? `Rollback completed with issues: ${rollbackResult.issues.join(' ')}`
        : 'Registration moved back to draft. Posted side effects were reversed.',
      rollback: {
        reversalCount: rollbackResult.reversalIds.length,
        voidedEntryCount: rollbackResult.voidedEntryIds.length,
        classEnrollmentRemovalCount: rollbackResult.removedClassEnrollmentEntries.length,
        rosterRemovalCount: rollbackResult.removedClassEnrollmentEntries.length
      }
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    return res.json(payloadOut);
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (txContext) {
      await txContext.rollback({ flow: 'term_manual_rollback', reason: error.message || 'Rollback failed' });
    }
    return res.status(400).json({ status: 'error', message: error.message });
  }
};
