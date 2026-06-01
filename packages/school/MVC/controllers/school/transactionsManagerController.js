const dataService = require('../../services/school/schoolDataService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');

const paginate = requireCoreModule('MVC/utils/paginationHelper');
const settingService = requireCoreModule('MVC/services/settingService');
const { isAjax, buildDataServiceQuery, inferSearchableFields } = requireCoreModule('MVC/utils/generalTools');
const {
  getActiveOrgIdOrThrow: getActiveOrgIdOrThrowShared,
  assertCreateOrgContextOrThrow: assertCreateOrgContextOrThrowShared,
  canCreateOrgScopedItem,
  assertOrgAccess
} = requireCoreModule('MVC/utils/orgContextUtils');
const transactionJournalModel = require('../../models/school/transactionJournalModel');
const globalTransactionLedgerModel = require('../../models/school/globalTransactionLedgerModel');

function parseJsonSafe(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return fallback; }
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

function parseArrayParam(value) {
  if (Array.isArray(value)) return value.map((x) => String(x || '').trim()).filter(Boolean);
  if (value === undefined || value === null || value === '') return [];
  return String(value)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function getTransactionAccountId(tx) {
  return String(tx?.metadata?.accountId || '').trim();
}

function normalizeStatementFilters(query) {
  const accountIds = parseArrayParam(query.accountIds);
  const statuses = parseArrayParam(query.statuses);
  const transactionTypes = parseArrayParam(query.transactionTypes);
  const includeReversalsRaw = String(query.includeReversals || '').trim().toLowerCase();
  const includeReversals = includeReversalsRaw
    ? (includeReversalsRaw === '1' || includeReversalsRaw === 'true')
    : true;

  return {
    accountIds,
    statuses: statuses.length ? statuses : ['posted'],
    allAccounts: String(query.allAccounts || '').trim() === '1' || String(query.allAccounts || '').trim().toLowerCase() === 'true',
    includeReversals,
    direction: String(query.direction || '').trim().toLowerCase(),
    transactionTypes,
    currency: String(query.currency || '').trim().toUpperCase(),
    amountMin: parseNumberOrNull(query.amountMin),
    amountMax: parseNumberOrNull(query.amountMax),
    search: String(query.search || '').trim().toLowerCase(),
    effectiveFrom: String(query.effectiveFrom || '').trim(),
    effectiveTo: String(query.effectiveTo || '').trim(),
    postedFrom: String(query.postedFrom || '').trim(),
    postedTo: String(query.postedTo || '').trim()
  };
}

function matchStatementFilters(tx, filters, accountSet, { includeDateWindow = true } = {}) {
  const accountId = getTransactionAccountId(tx);
  if (!accountId) return false;
  if (accountSet && accountSet.size && !accountSet.has(accountId)) return false;

  const status = String(tx?.status || '').trim().toLowerCase();
  if (filters.statuses.length && !filters.statuses.includes(status)) return false;

  const direction = String(tx?.amount?.direction || '').trim().toLowerCase();
  if (filters.direction && direction !== filters.direction) return false;

  const txType = String(tx?.transactionType || '').trim().toLowerCase();
  if (filters.transactionTypes.length && !filters.transactionTypes.includes(txType)) return false;

  const currency = String(tx?.amount?.currency || '').trim().toUpperCase();
  if (filters.currency && currency !== filters.currency) return false;

  const amountValue = Number(tx?.amount?.value || 0);
  if (filters.amountMin !== null && amountValue < filters.amountMin) return false;
  if (filters.amountMax !== null && amountValue > filters.amountMax) return false;

  if (filters.search) {
    const haystack = [
      tx?.id,
      tx?.memo,
      tx?.externalReference,
      tx?.source?.eventId,
      tx?.source?.eventType,
      tx?.metadata?.journalId,
      tx?.metadata?.journalNumber,
      tx?.metadata?.accountCode,
      tx?.metadata?.accountName
    ]
      .map((x) => String(x || '').toLowerCase())
      .join(' ');
    if (!haystack.includes(filters.search)) return false;
  }

  if (includeDateWindow) {
    const effectiveDate = String(tx?.effectiveDate || '').trim();
    if (filters.effectiveFrom && (!effectiveDate || effectiveDate < filters.effectiveFrom)) return false;
    if (filters.effectiveTo && (!effectiveDate || effectiveDate > filters.effectiveTo)) return false;

    const postedMs = tx?.postedAt ? Date.parse(String(tx.postedAt)) : NaN;
    if (filters.postedFrom) {
      const fromMs = Date.parse(filters.postedFrom);
      if (!Number.isFinite(postedMs) || !Number.isFinite(fromMs) || postedMs < fromMs) return false;
    }
    if (filters.postedTo) {
      const toMs = Date.parse(filters.postedTo);
      if (!Number.isFinite(postedMs) || !Number.isFinite(toMs) || postedMs > toMs) return false;
    }
  }

  return true;
}

function isBeforeOpeningBoundary(tx, filters) {
  if (filters.postedFrom) {
    const fromMs = Date.parse(filters.postedFrom);
    const postedMs = tx?.postedAt ? Date.parse(String(tx.postedAt)) : NaN;
    return Number.isFinite(fromMs) && Number.isFinite(postedMs) && postedMs < fromMs;
  }
  if (filters.effectiveFrom) {
    const effectiveDate = String(tx?.effectiveDate || '').trim();
    return !!effectiveDate && effectiveDate < filters.effectiveFrom;
  }
  return false;
}

function computeAccountImpact(tx, account) {
  const direction = String(tx?.amount?.direction || '').trim().toLowerCase();
  const amount = roundMoney(Number(tx?.amount?.value || 0));
  const normalBalance = String(account?.normalBalance || 'debit').trim().toLowerCase();

  if (normalBalance === 'credit') {
    return direction === 'credit' ? amount : -amount;
  }
  return direction === 'debit' ? amount : -amount;
}

function sortStatementTransactions(a, b) {
  const aEffective = String(a?.effectiveDate || '');
  const bEffective = String(b?.effectiveDate || '');
  if (aEffective !== bEffective) return aEffective.localeCompare(bEffective);

  const aPosted = String(a?.postedAt || '');
  const bPosted = String(b?.postedAt || '');
  if (aPosted !== bPosted) return aPosted.localeCompare(bPosted);

  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

function getActiveOrgIdOrThrow(reqUser) {
  return getActiveOrgIdOrThrowShared(reqUser);
}

async function assertCreateOrgContextOrThrow(reqUser) {
  return assertCreateOrgContextOrThrowShared(reqUser, { scopeLabel: 'transactions' });
}

function assertJournalOrgAccess(journal, activeOrgId, reqUser) {
  assertOrgAccess(journal, activeOrgId, reqUser, { orgField: 'orgId', allowSystemBypass: true });
}

async function getPostingAccountsByOrg(reqUser, orgId) {
  const accounts = await dataService.fetchData('schoolAccounts', {}, reqUser);
  return (accounts || [])
    .filter((a) =>
      idsEqual(a.orgId || '', orgId || '') &&
      a.allowPost &&
      String(a.status || '').toLowerCase() === 'active'
    )
    .sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')));
}

function buildJournalPayload(body, activeOrgId) {
  const lines = parseJsonSafe(body.lines, []);
  const safeLines = Array.isArray(lines) ? lines : [];
  const requestedType = String(body.transactionType || 'adjustment').trim().toLowerCase();
  const transactionType = transactionJournalModel.JOURNAL_TYPES.includes(requestedType)
    ? requestedType
    : 'adjustment';

  return {
    orgId: String(activeOrgId),
    effectiveDate: String(body.effectiveDate || '').trim(),
    transactionType,
    description: String(body.description || '').trim(),
    referenceNo: String(body.referenceNo || '').trim(),
    externalReference: String(body.externalReference || '').trim(),
    internalNote: String(body.internalNote || '').trim(),
    lines: safeLines.map((line) => ({
      accountId: String(line?.accountId || '').trim(),
      direction: String(line?.direction || '').trim().toLowerCase(),
      amount: line?.amount,
      currency: String(line?.currency || '').trim().toUpperCase() || 'CAD',
      memo: String(line?.memo || '').trim(),
      note: String(line?.note || '').trim()
    })),
    status: 'draft'
  };
}

function determineSaveAction(rawAction, journal) {
  const action = String(rawAction || 'auto').trim().toLowerCase();
  const diff = Number(journal?.totals?.difference);
  const isBalanced = Boolean(journal?.totals?.isBalanced) || (Number.isFinite(diff) && Math.abs(diff) < 0.0001);

  if (action === 'draft') {
    return { finalMode: 'draft', message: 'Draft saved successfully.' };
  }
  if (action === 'post') {
    if (!isBalanced) {
      return { finalMode: 'draft', message: 'Journal is not balanced, so it was saved as draft.' };
    }
    return { finalMode: 'post', message: 'Journal posted successfully.' };
  }
  if (isBalanced) {
    return { finalMode: 'post', message: 'Balanced journal posted successfully.' };
  }
  return { finalMode: 'draft', message: 'Journal saved as draft (not balanced).' };
}

function assertPostingAccounts(lines, postingAccountsMap) {
  (lines || []).forEach((line, idx) => {
    const accountId = String(line?.accountId || '').trim();
    if (!accountId) throw new Error(`Line ${idx + 1}: account is required.`);
    const account = postingAccountsMap.get(accountId);
    if (!account) {
      throw new Error(`Line ${idx + 1}: selected account ${accountId} is not active/postable.`);
    }
  });
}

function buildLedgerItemsFromJournal(journal, postingAccountsMap, reqUser) {
  const nowIso = new Date().toISOString();
  const actor = String(reqUser?.id || reqUser?.username || 'system');
  const sourceEventIdBase = `JOURNAL-${journal.id}`;
  const idempotencyBase = `TXJM|${journal.id}`;
  const description = String(journal.description || '').trim() || `Journal ${journal.journalNumber || journal.id}`;
  const txCode = 'MANUAL_JOURNAL';
  const txLabel = description;

  return (journal.lines || []).map((line, idx) => {
    const account = postingAccountsMap.get(String(line.accountId));
    const lineNo = Number(line.lineNo || idx + 1);
    const lineMemo = String(line.memo || '').trim();
    const lineNote = String(line.note || '').trim();
    const memo = lineMemo || description;

    return {
      orgId: String(journal.orgId),
      status: 'posted',
      postedAt: nowIso,
      effectiveDate: String(journal.effectiveDate),
      transactionType: 'adjustment',
      source: {
        module: 'school_transactions_manager',
        eventType: 'manual_journal_post',
        eventId: `${sourceEventIdBase}|L${lineNo}|${String(line.direction || '').toUpperCase()}`,
        idempotencyKey: `${idempotencyBase}|L${lineNo}|${String(line.direction || '').toUpperCase()}`
      },
      party: {
        studentId: 'DIRECT',
        personId: '',
        programId: 'DIRECT',
        feeCategory: 'general'
      },
      fee: {
        category: 'general',
        code: txCode,
        label: txLabel,
        frequency: '',
        isOptional: false
      },
      amount: {
        value: Number(line.amount || 0),
        currency: String(line.currency || 'CAD').toUpperCase(),
        direction: String(line.direction || '').toLowerCase()
      },
      memo,
      internalNote: lineNote || String(journal.internalNote || '').trim(),
      externalReference: String(journal.externalReference || '').trim(),
      metadata: {
        sourceType: 'transaction_journal',
        journalId: String(journal.id),
        journalNumber: String(journal.journalNumber || ''),
        journalTransactionType: String(journal.transactionType || 'adjustment'),
        lineNo,
        accountId: String(account.id),
        accountCode: String(account.code || ''),
        accountName: String(account.name || ''),
        accountType: String(account.type || ''),
        generatedBy: actor
      }
    };
  });
}

async function postJournalOrThrow(journal, reqUser) {
  if (!journal) throw new Error('Journal not found.');
  if (String(journal.status || '') !== 'draft') throw new Error('Only draft journals can be posted.');
  const diff = Number(journal?.totals?.difference);
  const isBalanced = Boolean(journal?.totals?.isBalanced) || (Number.isFinite(diff) && Math.abs(diff) < 0.0001);
  if (!isBalanced) throw new Error('Only balanced journals can be posted.');

  const postingAccounts = await getPostingAccountsByOrg(reqUser, journal.orgId);
  const postingAccountsMap = new Map(postingAccounts.map((a) => [String(a.id), a]));
  assertPostingAccounts(journal.lines || [], postingAccountsMap);

  const items = buildLedgerItemsFromJournal(journal, postingAccountsMap, reqUser);
  if (!items.length) throw new Error('No journal lines were available for posting.');

  const created = await dataService.addData('globalTransactions', items, reqUser);
  const ledgerIds = (created || []).map((x) => String(x.id));

  return dataService.updateData('transactionJournals', journal.id, {
    status: 'posted',
    postedAt: new Date().toISOString(),
    postedLedgerTransactionIds: ledgerIds
  }, reqUser);
}

exports.listTransactions = async (req, res) => {
  try {
    const query = await buildDataServiceQuery(req.query);
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query.q = '';
    const canCreateTransactions = await canCreateOrgScopedItem(req.user, { scopeLabel: 'transactions' });

    const journals = await dataService.fetchData('transactionJournals', query, req.user);
    const enriched = (journals || []).map((j) => ({
      ...j,
      lineCount: Array.isArray(j.lines) ? j.lines.length : 0
    }));

    const searchableFields = await inferSearchableFields(enriched, {
      exclude: ['audit', 'lines', 'postedLedgerTransactionIds']
    });
    const { data, pagination } = paginate(enriched, query);

    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });

    res.render('school/transactionManager/transactionList', {
      title: 'Transactions Manager',
      tableName: 'School_Transactions_Manager',
      newUrl: 'school/transactions',
      newLabel: canCreateTransactions ? 'New Transaction Journal' : null,
      data,
      searchableFields,
      includeModal: true,
      includeModal_Table: true,
      print: true,
      pagination,
      filters: req.query,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', error, message: error.message });
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.showStatement = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const statementFilters = normalizeStatementFilters(req.query || {});

    const allAccounts = await dataService.fetchData('schoolAccounts', {}, req.user);
    // Important: Statements are used to view *any* account activity (including student sub-accounts),
    // not only accounts that allow posting. Filter to active accounts only.
    const selectableAccounts = (allAccounts || [])
      .filter((a) => String(a.status || '').toLowerCase() === 'active')
      .sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')));
    const accountMap = new Map(selectableAccounts.map((a) => [String(a.id), a]));

    const selectedAccountIds = statementFilters.allAccounts
      ? selectableAccounts.map((a) => String(a.id))
      : (statementFilters.accountIds.length
        ? statementFilters.accountIds.filter((id) => accountMap.has(String(id)))
        : []);
    const accountSet = new Set(selectedAccountIds);
    const hasSelectedAccounts = selectedAccountIds.length > 0;

    const allTransactions = await dataService.fetchData('globalTransactions', {}, req.user);
    let scopedTransactions = (allTransactions || []).filter((tx) => idsEqual(tx.orgId || '', activeOrgId));

    // By default, hide reversal pairs (original + reversal) so rollbacks don't clutter statements.
    // Users can opt-in via ?includeReversals=1 when they need audit visibility.
    if (!statementFilters.includeReversals) {
      const reversalRows = scopedTransactions.filter((tx) =>
        String(tx?.transactionType || '').trim().toLowerCase() === 'reversal' &&
        String(tx?.reversalOfTransactionId || '').trim()
      );
      const reversedOriginalIds = new Set(reversalRows.map((tx) => String(tx.reversalOfTransactionId || '').trim()).filter(Boolean));
      if (reversedOriginalIds.size) {
        scopedTransactions = scopedTransactions.filter((tx) => {
          const id = String(tx?.id || '').trim();
          const reversalOf = String(tx?.reversalOfTransactionId || '').trim();
          if (id && reversedOriginalIds.has(id)) return false; // hide original that was reversed
          if (reversalOf && reversedOriginalIds.has(reversalOf)) return false; // hide the reversal row itself
          return true;
        });
      }
    }

    const openingRows = hasSelectedAccounts ? scopedTransactions.filter((tx) =>
      matchStatementFilters(tx, statementFilters, accountSet, { includeDateWindow: false }) &&
      isBeforeOpeningBoundary(tx, statementFilters)
    ) : [];
    const periodRows = hasSelectedAccounts ? scopedTransactions.filter((tx) =>
      matchStatementFilters(tx, statementFilters, accountSet, { includeDateWindow: true })
    ) : [];
    periodRows.sort(sortStatementTransactions);

    const openingByAccount = new Map();
    openingRows.forEach((tx) => {
      const accountId = getTransactionAccountId(tx);
      const account = accountMap.get(accountId);
      if (!account) return;
      const prev = roundMoney(openingByAccount.get(accountId) || 0);
      openingByAccount.set(accountId, roundMoney(prev + computeAccountImpact(tx, account)));
    });

    const runningByAccount = new Map();
    const renderedRows = periodRows.map((tx) => {
      const accountId = getTransactionAccountId(tx);
      const account = accountMap.get(accountId);
      const opening = openingByAccount.get(accountId) || 0;
      const current = runningByAccount.has(accountId) ? runningByAccount.get(accountId) : opening;
      const next = roundMoney(current + computeAccountImpact(tx, account));
      runningByAccount.set(accountId, next);

      return {
        ...tx,
        __accountId: accountId,
        __accountCode: account?.code || '',
        __accountName: account?.name || '',
        __normalBalance: account?.normalBalance || 'debit',
        __runningBalance: next
      };
    });

    const byAccountSummary = selectedAccountIds.map((accountId) => {
      const account = accountMap.get(accountId);
      if (!account) return null;
      const opening = roundMoney(openingByAccount.get(accountId) || 0);
      const accountRows = renderedRows.filter((row) => idsEqual(row.__accountId, accountId));
      const debit = roundMoney(accountRows
        .filter((row) => String(row?.amount?.direction || '').toLowerCase() === 'debit')
        .reduce((sum, row) => sum + Number(row?.amount?.value || 0), 0));
      const credit = roundMoney(accountRows
        .filter((row) => String(row?.amount?.direction || '').toLowerCase() === 'credit')
        .reduce((sum, row) => sum + Number(row?.amount?.value || 0), 0));
      const closing = accountRows.length
        ? roundMoney(accountRows[accountRows.length - 1].__runningBalance || 0)
        : opening;
      return {
        accountId,
        code: account.code,
        name: account.name,
        normalBalance: account.normalBalance,
        opening,
        periodDebit: debit,
        periodCredit: credit,
        closing
      };
    }).filter(Boolean);

    const summary = {
      transactionCount: renderedRows.length,
      accountCount: selectedAccountIds.length,
      totalDebit: roundMoney(renderedRows
        .filter((row) => String(row?.amount?.direction || '').toLowerCase() === 'debit')
        .reduce((sum, row) => sum + Number(row?.amount?.value || 0), 0)),
      totalCredit: roundMoney(renderedRows
        .filter((row) => String(row?.amount?.direction || '').toLowerCase() === 'credit')
        .reduce((sum, row) => sum + Number(row?.amount?.value || 0), 0))
    };
    summary.netMovement = roundMoney(summary.totalDebit - summary.totalCredit);

    return res.render('school/transactionManager/statement', {
      title: 'Transactions Statement',
      filters: statementFilters,
      hasSelectedAccounts,
      summary,
      rows: renderedRows,
      byAccountSummary,
      selectedAccounts: selectedAccountIds.map((id) => {
        const acc = accountMap.get(String(id || ''));
        return {
          id: String(id || ''),
          label: acc ? `${acc.code} - ${acc.name} (${acc.id})` : String(id || '')
        };
      }),
      txStatuses: globalTransactionLedgerModel.TX_STATUSES,
      txTypes: globalTransactionLedgerModel.TX_TYPES,
      txDirections: globalTransactionLedgerModel.TX_DIRECTIONS,
      user: req.user,
      includeModal: true,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
    return res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.showForm = async (req, res) => {
  try {
    const isEdit = !!req.params.id;
    const activeOrgId = isEdit
      ? getActiveOrgIdOrThrow(req.user)
      : await assertCreateOrgContextOrThrow(req.user);
    let journal = {};

    if (isEdit) {
      journal = await dataService.getDataById('transactionJournals', req.params.id, req.user);
      if (!journal) throw new Error('Transaction journal not found.');
      assertJournalOrgAccess(journal, activeOrgId, req.user);
    }

    const journalOrgId = String(journal.orgId || activeOrgId);
    const postingAccounts = await getPostingAccountsByOrg(req.user, journalOrgId);
    const lineAccountIds = Array.from(new Set((Array.isArray(journal?.lines) ? journal.lines : [])
      .map((line) => String(line?.accountId || '').trim())
      .filter(Boolean)));
    const lineAccountRefs = lineAccountIds.map((accountId) => {
      const account = postingAccounts.find((row) => String(row?.id || '') === accountId);
      return {
        id: accountId,
        code: String(account?.code || '').trim(),
        name: String(account?.name || '').trim()
      };
    });
    const isReadOnly = String(journal.status || '') === 'posted';

    res.render('school/transactionManager/transactionForm', {
      title: isEdit ? `Edit Journal: ${journal.journalNumber || journal.id}` : 'Create Transaction Journal',
      journal,
      journalOrgId,
      lineAccountRefs,
      journalStatuses: transactionJournalModel.JOURNAL_STATUSES,
      transactionTypes: transactionJournalModel.JOURNAL_TYPES,
      lineDirections: transactionJournalModel.JOURNAL_LINE_DIRECTIONS,
      isReadOnly,
      user: req.user,
      includeModal: true,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.saveTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const activeOrgId = id
      ? getActiveOrgIdOrThrow(req.user)
      : await assertCreateOrgContextOrThrow(req.user);
    const guardKey = idempotencyGuardService.createGuardKey([
      'transactions_save',
      activeOrgId,
      String(id || 'new').trim(),
      {
        effectiveDate: req.body?.effectiveDate,
        saveAction: req.body?.saveAction,
        journalId: req.body?.journalId,
        lines: parseJsonSafe(req.body?.lines, [])
      }
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 120000,
      replayTtlMs: 20000
    });
    if (sendGuardedResponse(res, guardResult, 'Transaction save/post is already in progress. Please wait.')) return;

    try {
      let existing = null;
      if (id) {
        existing = await dataService.getDataById('transactionJournals', id, req.user);
        if (!existing) throw new Error('Transaction journal not found.');
        assertJournalOrgAccess(existing, activeOrgId, req.user);
      }

      const payload = buildJournalPayload(req.body, existing?.orgId || activeOrgId);
      if (!id && req.body.journalId) payload.id = String(req.body.journalId).trim();

      const postingAccounts = await getPostingAccountsByOrg(req.user, payload.orgId);
      const postingAccountsMap = new Map(postingAccounts.map((a) => [String(a.id), a]));
      assertPostingAccounts(payload.lines || [], postingAccountsMap);

      const savedDraft = id
        ? await dataService.updateData('transactionJournals', id, payload, req.user)
        : await dataService.addData('transactionJournals', payload, req.user);

      const saveAction = determineSaveAction(req.body.saveAction, savedDraft);
      let finalJournal = savedDraft;
      if (saveAction.finalMode === 'post') {
        finalJournal = await postJournalOrThrow(savedDraft, req.user);
      }

      const payloadOut = {
        status: 'success',
        message: saveAction.message,
        result: {
          id: finalJournal.id,
          journalNumber: finalJournal.journalNumber,
          status: finalJournal.status
        }
      };
      idempotencyGuardService.completeGuard(guardKey, payloadOut);

      if (isAjax(req)) return res.json(payloadOut);
      return res.redirect('/school/transactions');
    } catch (error) {
      idempotencyGuardService.failGuard(guardKey);
      throw error;
    }
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.postDraftTransaction = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const journalId = String(req.params.id || '').trim();
    const guardKey = idempotencyGuardService.createGuardKey([
      'transactions_post',
      activeOrgId,
      journalId
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 120000,
      replayTtlMs: 15000
    });
    if (sendGuardedResponse(res, guardResult, 'Journal posting is already in progress. Please wait.')) return;

    try {
      const journal = await dataService.getDataById('transactionJournals', journalId, req.user);
      if (!journal) throw new Error('Transaction journal not found.');
      assertJournalOrgAccess(journal, activeOrgId, req.user);

      const posted = await postJournalOrThrow(journal, req.user);
      const payloadOut = {
        status: 'success',
        message: 'Journal posted successfully.',
        result: { id: posted.id, status: posted.status }
      };
      idempotencyGuardService.completeGuard(guardKey, payloadOut);

      if (isAjax(req)) return res.json(payloadOut);
      return res.redirect('/school/transactions');
    } catch (error) {
      idempotencyGuardService.failGuard(guardKey);
      throw error;
    }
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.deleteTransaction = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const journalId = String(req.params.id || '').trim();
    const guardKey = idempotencyGuardService.createGuardKey([
      'transactions_delete',
      activeOrgId,
      journalId
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 60000,
      replayTtlMs: 10000
    });
    if (sendGuardedResponse(res, guardResult, 'Journal delete is already in progress. Please wait.')) return;

    try {
      const journal = await dataService.getDataById('transactionJournals', journalId, req.user);
      if (!journal) throw new Error('Transaction journal not found.');
      assertJournalOrgAccess(journal, activeOrgId, req.user);

      await dataService.deleteData('transactionJournals', journalId, req.user);
      const payloadOut = { status: 'success', message: 'Draft journal deleted successfully.' };
      idempotencyGuardService.completeGuard(guardKey, payloadOut);
      if (isAjax(req)) return res.json(payloadOut);
      return res.redirect('/school/transactions');
    } catch (error) {
      idempotencyGuardService.failGuard(guardKey);
      throw error;
    }
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};
