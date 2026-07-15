const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
// MVC/models/school/globalTransactionLedgerModel.js
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const dataDir = path.join(resolveCoreRoot(), 'data/school');
const dataPath = path.join(dataDir, 'globalTransactionLedger.json');

if (!fsSync.existsSync(dataDir)) {
  fsSync.mkdirSync(dataDir, { recursive: true });
}
if (!fsSync.existsSync(dataPath)) {
  fsSync.writeFileSync(dataPath, '[]');
}

const TX_STATUSES = new Set(['draft', 'pending', 'on_hold', 'posted', 'voided', 'reversed']);
const TX_TYPES = new Set(['charge', 'payment', 'refund', 'waiver', 'adjustment', 'reversal']);
const TX_DIRECTIONS = new Set(['debit', 'credit']);
const RECON_STATUSES = new Set(['unreconciled', 'tentative', 'reconciled']);
const TRANSACTION_PARTY_ROLES = Object.freeze(['student', 'teacher', 'staff', 'parent', 'vendor', 'organization', 'other']);
const COMMON_MEMO_PLACEHOLDERS = Object.freeze([
  { key: 'orgId', label: 'Organization ID' },
  { key: 'transactionDefinitionId', label: 'Definition ID' },
  { key: 'transactionDefinitionCode', label: 'Definition Code' },
  { key: 'transactionDefinitionName', label: 'Definition Name' },
  { key: 'entryId', label: 'Entry ID' },
  { key: 'lineIndex', label: 'Line Number' },
  { key: 'effectiveDate', label: 'Effective Date' },
  { key: 'externalReference', label: 'External Reference' },
  { key: 'amount', label: 'Amount' },
  { key: 'currency', label: 'Currency' }
]);
const MEMO_PLACEHOLDERS_BY_ROLE = Object.freeze({
  student: Object.freeze([
    { key: 'studentId', label: 'Student ID' },
    { key: 'personId', label: 'Student Person ID' },
    { key: 'programId', label: 'Program ID' },
    { key: 'feeCategory', label: 'Fee Category' }
  ]),
  teacher: Object.freeze([
    { key: 'teacherId', label: 'Teacher ID' },
    { key: 'teacherPersonId', label: 'Teacher Person ID' }
  ]),
  staff: Object.freeze([
    { key: 'staffId', label: 'Staff ID' },
    { key: 'staffPersonId', label: 'Staff Person ID' }
  ]),
  parent: Object.freeze([
    { key: 'parentId', label: 'Parent ID' },
    { key: 'parentPersonId', label: 'Parent Person ID' }
  ]),
  vendor: Object.freeze([
    { key: 'vendorId', label: 'Vendor ID' },
    { key: 'vendorName', label: 'Vendor Name' }
  ]),
  organization: Object.freeze([
    { key: 'organizationId', label: 'Organization Entity ID' },
    { key: 'organizationName', label: 'Organization Name' }
  ]),
  other: Object.freeze([
    { key: 'entityId', label: 'Entity ID' },
    { key: 'entityName', label: 'Entity Name' }
  ])
});

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function buildMemoContextMap(input, out = {}, prefix = '') {
  if (input === undefined || input === null) return out;

  if (Array.isArray(input)) {
    for (let i = 0; i < input.length; i++) {
      const nextPrefix = prefix ? `${prefix}.${i}` : String(i);
      buildMemoContextMap(input[i], out, nextPrefix);
    }
    return out;
  }

  if (isPlainObject(input)) {
    Object.keys(input).forEach((k) => {
      const nextPrefix = prefix ? `${prefix}.${k}` : String(k);
      buildMemoContextMap(input[k], out, nextPrefix);
    });
    return out;
  }

  if (prefix) out[prefix] = input;
  return out;
}

function resolveMemoTemplate(template, context = {}) {
  const memo = template === undefined || template === null ? '' : String(template);
  if (!memo.trim()) return '';

  const values = buildMemoContextMap(context);
  return memo.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (full, token) => {
    if (!Object.prototype.hasOwnProperty.call(values, token)) return full;
    const raw = values[token];
    if (raw === undefined || raw === null) return '';
    return String(raw);
  });
}

function getMemoPlaceholdersForRole(role) {
  const normalizedRole = cleanString(role, { max: 40, allowEmpty: true }).toLowerCase();
  if (!normalizedRole) return [];
  const byRole = MEMO_PLACEHOLDERS_BY_ROLE[normalizedRole];
  if (!Array.isArray(byRole)) return [];
  return [...COMMON_MEMO_PLACEHOLDERS, ...byRole];
}

function cleanString(v, { max = 500, allowEmpty = true } = {}) {
  if (v === undefined || v === null) return allowEmpty ? '' : null;
  const s = String(v).replace(/\0/g, '').trim();
  if (!allowEmpty && !s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function cleanId(v, { max = 80, allowEmpty = false } = {}) {
  const s = cleanString(v, { max, allowEmpty });
  if (s === null) return null;
  if (!s) return allowEmpty ? '' : null;
  if (!/^[A-Za-z0-9_.:-]+$/.test(s)) throw new Error('Invalid id format.');
  return s;
}

function cleanNumber(v, { min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, allowEmpty = true } = {}) {
  if (v === undefined || v === null || v === '') return allowEmpty ? null : NaN;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error('Invalid number value.');
  if (n < min || n > max) throw new Error('Number value out of range.');
  return n;
}

function cleanDateISO(v, { allowEmpty = true, withTime = false } = {}) {
  const s = cleanString(v, { max: 40, allowEmpty });
  if (s === null) return null;
  if (!s) return allowEmpty ? '' : null;
  if (!withTime && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid date value.');
  return withTime ? d.toISOString() : d.toISOString().slice(0, 10);
}

function cleanMetadata(v) {
  if (v === undefined || v === null || v === '') return {};
  if (!isPlainObject(v)) throw new Error('metadata must be an object.');
  return v;
}

function cleanComments(v) {
  if (v === undefined || v === null || v === '') return [];
  if (!Array.isArray(v)) throw new Error('comments must be an array.');
  if (v.length > 500) throw new Error('Too many comments.');
  return v.map((c) => {
    if (!isPlainObject(c)) throw new Error('Invalid comment object.');
    const text = cleanString(c.text, { max: 2000, allowEmpty: false });
    if (!text) throw new Error('Comment text is required.');
    return {
      id: cleanId(c.id, { max: 64, allowEmpty: true }) || undefined,
      text,
      by: cleanId(c.by, { max: 80, allowEmpty: true }) || '',
      at: cleanDateISO(c.at, { allowEmpty: true, withTime: true }) || new Date().toISOString()
    };
  });
}

function cleanHold(v, status) {
  if (v === undefined || v === null || v === '') {
    if (status === 'on_hold') throw new Error('hold info is required when status is on_hold.');
    return {
      isOnHold: false,
      holdReasonCode: '',
      holdReasonText: '',
      holdPlacedBy: '',
      holdPlacedAt: '',
      holdUntil: '',
      holdReleasedBy: '',
      holdReleasedAt: ''
    };
  }
  if (!isPlainObject(v)) throw new Error('hold must be an object.');

  const hold = {
    isOnHold: status === 'on_hold' ? true : Boolean(v.isOnHold),
    holdReasonCode: cleanString(v.holdReasonCode, { max: 80, allowEmpty: true }),
    holdReasonText: cleanString(v.holdReasonText, { max: 1000, allowEmpty: true }),
    holdPlacedBy: cleanId(v.holdPlacedBy, { max: 80, allowEmpty: true }) || '',
    holdPlacedAt: cleanDateISO(v.holdPlacedAt, { allowEmpty: true, withTime: true }) || '',
    holdUntil: cleanDateISO(v.holdUntil, { allowEmpty: true, withTime: false }) || '',
    holdReleasedBy: cleanId(v.holdReleasedBy, { max: 80, allowEmpty: true }) || '',
    holdReleasedAt: cleanDateISO(v.holdReleasedAt, { allowEmpty: true, withTime: true }) || ''
  };

  if (status === 'on_hold') {
    if (!hold.holdReasonCode && !hold.holdReasonText) {
      throw new Error('Hold reason is required when status is on_hold.');
    }
    if (!hold.holdPlacedAt) hold.holdPlacedAt = new Date().toISOString();
  }

  return hold;
}

function cleanSource(v) {
  if (!isPlainObject(v)) throw new Error('source is required and must be an object.');
  const module = cleanString(v.module, { max: 80, allowEmpty: false });
  const eventType = cleanString(v.eventType, { max: 80, allowEmpty: false });
  const eventId = cleanId(v.eventId, { max: 120, allowEmpty: false });
  const idempotencyKey = cleanString(v.idempotencyKey, { max: 220, allowEmpty: false });
  if (!module || !eventType || !eventId || !idempotencyKey) {
    throw new Error('source.module, source.eventType, source.eventId, source.idempotencyKey are required.');
  }
  return { module, eventType, eventId, idempotencyKey };
}

function cleanParty(v) {
  if (!isPlainObject(v)) throw new Error('party is required and must be an object.');
  const studentId = cleanId(v.studentId, { max: 80, allowEmpty: false });
  const programId = cleanId(v.programId, { max: 80, allowEmpty: false });
  const feeCategory = cleanString(v.feeCategory, { max: 80, allowEmpty: false });
  if (!studentId || !programId || !feeCategory) {
    throw new Error('party.studentId, party.programId, party.feeCategory are required.');
  }
  return {
    studentId,
    personId: cleanId(v.personId, { max: 80, allowEmpty: true }) || '',
    programId,
    feeCategory
  };
}

function cleanFee(v) {
  if (!isPlainObject(v)) throw new Error('fee is required and must be an object.');
  const category = cleanString(v.category, { max: 80, allowEmpty: false });
  const code = cleanString(v.code, { max: 80, allowEmpty: true }).toUpperCase();
  const label = cleanString(v.label, { max: 160, allowEmpty: true });
  if (!category || (!code && !label)) {
    throw new Error('fee.category and one of fee.code/fee.label are required.');
  }
  return {
    category,
    code,
    label,
    frequency: cleanString(v.frequency, { max: 30, allowEmpty: true }).toLowerCase(),
    isOptional: Boolean(v.isOptional)
  };
}

function cleanAmount(v) {
  if (!isPlainObject(v)) throw new Error('amount is required and must be an object.');
  const value = cleanNumber(v.value, { min: 0, max: 1000000000, allowEmpty: false });
  const currency = cleanString(v.currency, { max: 3, allowEmpty: false }).toUpperCase();
  const direction = cleanString(v.direction, { max: 10, allowEmpty: false }).toLowerCase();
  if (!value && value !== 0) throw new Error('amount.value is required.');
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid amount.currency. Use ISO code.');
  if (!TX_DIRECTIONS.has(direction)) throw new Error('Invalid amount.direction.');
  return { value, currency, direction };
}

function computeBalanceEffect(amount, txType) {
  const n = Number(amount.value || 0);
  if (txType === 'charge') return n;
  if (txType === 'payment' || txType === 'refund' || txType === 'waiver' || txType === 'reversal') return -n;
  if (amount.direction === 'debit') return n;
  return -n;
}

function sanitizeTransactionInput(input, { isUpdate = false } = {}) {
  if (!isPlainObject(input)) throw new Error('Invalid transaction payload.');

  const orgId = cleanId(input.orgId, { max: 80, allowEmpty: false });
  if (!orgId) throw new Error('orgId is required.');

  const status = cleanString(input.status, { max: 30, allowEmpty: true }).toLowerCase() || 'pending';
  if (!TX_STATUSES.has(status)) throw new Error('Invalid transaction status.');

  const transactionType = cleanString(input.transactionType, { max: 30, allowEmpty: false }).toLowerCase();
  if (!TX_TYPES.has(transactionType)) throw new Error('Invalid transactionType.');

  const amount = cleanAmount(input.amount);

  const out = {
    orgId,
    postedAt: cleanDateISO(input.postedAt, { allowEmpty: status !== 'posted', withTime: true }) || '',
    effectiveDate: cleanDateISO(input.effectiveDate, { allowEmpty: false, withTime: false }),
    status,
    transactionType,
    source: cleanSource(input.source),
    party: cleanParty(input.party),
    fee: cleanFee(input.fee),
    amount,
    balanceEffect: cleanNumber(input.balanceEffect, {
      min: -1000000000,
      max: 1000000000,
      allowEmpty: true
    }),
    memo: cleanString(input.memo, { max: 500, allowEmpty: true }),
    internalNote: cleanString(input.internalNote, { max: 5000, allowEmpty: true }),
    comments: cleanComments(input.comments),
    hold: cleanHold(input.hold, status),
    externalReference: cleanString(input.externalReference, { max: 120, allowEmpty: true }),
    reconciliationStatus: cleanString(input.reconciliationStatus, { max: 30, allowEmpty: true }).toLowerCase() || 'unreconciled',
    reversalOfTransactionId: cleanId(input.reversalOfTransactionId, { max: 120, allowEmpty: true }) || '',
    metadata: cleanMetadata(input.metadata)
  };

  if (!RECON_STATUSES.has(out.reconciliationStatus)) {
    throw new Error('Invalid reconciliationStatus.');
  }

  if (status === 'posted' && !out.postedAt) {
    out.postedAt = new Date().toISOString();
  }

  if (out.balanceEffect === null) {
    out.balanceEffect = computeBalanceEffect(amount, transactionType);
  }

  if (!isUpdate && input.id) {
    out.id = cleanId(input.id, { max: 120, allowEmpty: false });
  }

  return out;
}

function generateTransactionId(existingIds) {
  const prefix = `GTL${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  for (let i = 0; i < 200; i++) {
    const candidate = `${prefix}${Math.floor(10000 + Math.random() * 90000)}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `GTL${Date.now()}`;
}

function assertIdempotencyUnique(all, transaction, ignoreId = null) {
  const key = transaction?.source?.idempotencyKey;
  if (!key) return;
  const duplicate = all.find((t) =>
    idsEqual(t?.orgId, transaction?.orgId) &&
    String(t.source?.idempotencyKey) === String(key) &&
    (ignoreId ? !idsEqual(t?.id, ignoreId) : true)
  );
  if (duplicate) {
    throw new Error('Duplicate idempotencyKey for this organization.');
  }
}

function canTransition(fromStatus, toStatus) {
  if (fromStatus === toStatus) return true;
  const transitions = {
    draft: new Set(['pending', 'on_hold', 'voided']),
    pending: new Set(['on_hold', 'posted', 'voided']),
    on_hold: new Set(['pending', 'posted', 'voided']),
    posted: new Set([]),
    voided: new Set([]),
    reversed: new Set([])
  };
  return transitions[fromStatus] ? transitions[fromStatus].has(toStatus) : false;
}

const REGISTRATION_STATUS_TRANSITIONS = new Set([
  'draft:posted',
  'posted:draft',
  'draft:voided'
]);

function normalizeRegistrationTransitionInput(input = {}) {
  const transactionIds = Array.from(new Set((Array.isArray(input.transactionIds) ? input.transactionIds : [])
    .map((value) => cleanId(value, { max: 120, allowEmpty: true }))
    .filter(Boolean)));
  const registrationType = cleanString(input.registrationType, { max: 20, allowEmpty: false }).toLowerCase();
  const registrationId = cleanId(input.registrationId, { max: 80, allowEmpty: false });
  const orgId = cleanId(input.orgId, { max: 80, allowEmpty: false });
  const fromStatus = cleanString(input.fromStatus, { max: 30, allowEmpty: false }).toLowerCase();
  const toStatus = cleanString(input.toStatus, { max: 30, allowEmpty: false }).toLowerCase();
  if (!transactionIds.length) throw new Error('At least one transaction id is required.');
  if (!['program', 'term', 'class'].includes(registrationType)) throw new Error('Invalid registration type.');
  if (!registrationId || !orgId) throw new Error('Registration and organization are required.');
  if (!REGISTRATION_STATUS_TRANSITIONS.has(fromStatus + ':' + toStatus)) {
    throw new Error('Registration transaction transition ' + fromStatus + ' to ' + toStatus + ' is not allowed.');
  }
  return {
    transactionIds,
    registrationType,
    registrationId,
    orgId,
    fromStatus,
    toStatus,
    actor: cleanString(input.actor, { max: 120, allowEmpty: true }),
    reason: cleanString(input.reason, { max: 1000, allowEmpty: true }),
    cycleNo: Math.max(0, Number.parseInt(String(input.cycleNo || 0), 10) || 0),
    transitionedAt: cleanDateISO(input.transitionedAt, { allowEmpty: true, withTime: true }) || new Date().toISOString()
  };
}

function buildRegistrationStatusHistoryEntry(transaction, transition) {
  const entry = {
    fromStatus: transition.fromStatus,
    toStatus: transition.toStatus,
    at: transition.transitionedAt,
    by: transition.actor,
    reason: transition.reason,
    postingCycleNo: transition.cycleNo
  };
  if (transition.fromStatus === 'posted') {
    entry.postedSnapshot = {
      postedAt: String(transaction.postedAt || ''),
      effectiveDate: String(transaction.effectiveDate || ''),
      amount: { ...(transaction.amount || {}) },
      balanceEffect: Number(transaction.balanceEffect || 0),
      fee: { ...(transaction.fee || {}) },
      account: {
        id: String(transaction?.metadata?.accountId || ''),
        code: String(transaction?.metadata?.accountCode || ''),
        name: String(transaction?.metadata?.accountName || '')
      },
      source: { ...(transaction.source || {}) }
    };
  }
  return entry;
}

function validateLegacyRegistrationExpectation(transaction, expectation = {}, context = {}) {
  const issues = [];
  const expectedAmount = expectation?.amount && typeof expectation.amount === 'object' ? expectation.amount : {};
  const expectedParty = expectation?.party && typeof expectation.party === 'object' ? expectation.party : {};
  const expectedMetadata = expectation?.metadata && typeof expectation.metadata === 'object' ? expectation.metadata : {};
  const required = {
    orgId: cleanId(expectation.orgId, { max: 80, allowEmpty: true }) || '',
    studentId: cleanId(expectedParty.studentId, { max: 80, allowEmpty: true }) || '',
    programId: cleanId(expectedParty.programId, { max: 80, allowEmpty: true }) || '',
    accountId: cleanId(expectedMetadata.accountId, { max: 80, allowEmpty: true }) || '',
    currency: cleanString(expectedAmount.currency, { max: 3, allowEmpty: true }).toUpperCase(),
    direction: cleanString(expectedAmount.direction, { max: 10, allowEmpty: true }).toLowerCase(),
    amount: Number(expectedAmount.value)
  };
  if (!required.orgId || !required.studentId || !required.programId || !required.accountId ||
      !required.currency || !required.direction || !Number.isFinite(required.amount)) {
    return ['Legacy registration ownership cannot be verified because the stored financial line is incomplete.'];
  }
  if (!idsEqual(transaction.orgId, required.orgId) || !idsEqual(transaction.orgId, context.orgId)) {
    issues.push('organization');
  }
  if (!idsEqual(transaction?.party?.studentId, required.studentId)) issues.push('student');
  if (!idsEqual(transaction?.party?.programId, required.programId)) issues.push('program');
  if (!idsEqual(transaction?.metadata?.accountId, required.accountId)) issues.push('account');
  if (Number(transaction?.amount?.value) !== required.amount) issues.push('amount');
  if (String(transaction?.amount?.currency || '').toUpperCase() !== required.currency) issues.push('currency');
  if (String(transaction?.amount?.direction || '').toLowerCase() !== required.direction) issues.push('direction');
  return issues.length
    ? [`Legacy registration ownership verification failed for ${transaction.id}: ${issues.join(', ')} mismatch.`]
    : [];
}

function applyRegistrationOwnershipBackfill(transaction, input = {}) {
  const registrationType = cleanString(input.registrationType, { max: 20, allowEmpty: false }).toLowerCase();
  const registrationId = cleanId(input.registrationId, { max: 80, allowEmpty: false });
  const orgId = cleanId(input.orgId, { max: 80, allowEmpty: false });
  if (!['program', 'term', 'class'].includes(registrationType) || !registrationId || !orgId) {
    throw new Error('Registration ownership backfill context is incomplete.');
  }
  if (!idsEqual(transaction?.orgId, orgId)) throw new Error(`Transaction ${transaction?.id || ''} is outside the registration organization.`);
  if (String(transaction?.transactionType || '').toLowerCase() !== 'charge') {
    throw new Error(`Transaction ${transaction?.id || ''} is not a registration charge.`);
  }
  const existingType = String(transaction?.metadata?.registrationType || '').trim().toLowerCase();
  const existingId = cleanId(transaction?.metadata?.registrationId, { max: 80, allowEmpty: true }) || '';
  if (existingType || existingId) {
    if (existingType !== registrationType || !idsEqual(existingId, registrationId)) {
      throw new Error(`Transaction ${transaction?.id || ''} belongs to another registration.`);
    }
    return transaction;
  }
  const issues = validateLegacyRegistrationExpectation(transaction, input.expectation, { orgId });
  if (issues.length) throw new Error(issues.join(' '));
  const now = new Date().toISOString();
  return {
    ...transaction,
    metadata: {
      ...(transaction.metadata || {}),
      registrationType,
      registrationId,
      draftLineId: String(input?.expectation?.metadata?.draftLineId || transaction.id || ''),
      registrationLifecycle: {
        ...(transaction?.metadata?.registrationLifecycle || {}),
        registrationType,
        registrationId,
        draftLineId: String(input?.expectation?.metadata?.draftLineId || transaction.id || ''),
        currentPostingCycleNo: Number(input.cycleNo || 0),
        statusHistory: Array.isArray(transaction?.metadata?.registrationLifecycle?.statusHistory)
          ? transaction.metadata.registrationLifecycle.statusHistory
          : [],
        ownershipBackfilledAt: now,
        ownershipBackfilledBy: cleanString(input.actor, { max: 120, allowEmpty: true })
      }
    },
    audit: {
      ...(transaction.audit || {}),
      lastUpdateDateTime: now
    }
  };
}

function transitionRegistrationTransactionRow(transaction, transition) {
  if (!idsEqual(transaction?.orgId, transition.orgId)) {
    throw new Error('Transaction ' + String(transaction?.id || '') + ' is outside the registration organization.');
  }
  if (String(transaction?.transactionType || '').toLowerCase() !== 'charge') {
    throw new Error('Transaction ' + String(transaction?.id || '') + ' is not a registration charge.');
  }
  if (!idsEqual(transaction?.metadata?.registrationId, transition.registrationId) ||
      String(transaction?.metadata?.registrationType || '').toLowerCase() !== transition.registrationType) {
    throw new Error('Transaction ' + String(transaction?.id || '') + ' does not belong to this registration.');
  }
  const currentStatus = String(transaction?.status || '').toLowerCase();
  if (currentStatus === transition.toStatus) return transaction;
  if (currentStatus !== transition.fromStatus) {
    throw new Error('Transaction ' + String(transaction?.id || '') + ' is ' + (currentStatus || 'unknown') + ', expected ' + transition.fromStatus + '.');
  }

  const existingLifecycle = transaction?.metadata?.registrationLifecycle &&
    typeof transaction.metadata.registrationLifecycle === 'object' &&
    !Array.isArray(transaction.metadata.registrationLifecycle)
    ? transaction.metadata.registrationLifecycle
    : {};
  const history = Array.isArray(existingLifecycle.statusHistory)
    ? existingLifecycle.statusHistory.slice(-99)
    : [];
  history.push(buildRegistrationStatusHistoryEntry(transaction, transition));

  return {
    ...transaction,
    status: transition.toStatus,
    postedAt: transition.toStatus === 'posted' ? transition.transitionedAt : '',
    hold: cleanHold(null, transition.toStatus),
    metadata: {
      ...(transaction.metadata || {}),
      registrationType: transition.registrationType,
      registrationId: transition.registrationId,
      postingCycleNo: transition.cycleNo || Number(transaction?.metadata?.postingCycleNo || 0),
      registrationLifecycle: {
        ...existingLifecycle,
        registrationType: transition.registrationType,
        registrationId: transition.registrationId,
        draftLineId: String(existingLifecycle.draftLineId || transaction?.metadata?.draftLineId || transaction.id || ''),
        currentPostingCycleNo: transition.cycleNo || Number(existingLifecycle.currentPostingCycleNo || 0),
        statusHistory: history,
        voidedAt: transition.toStatus === 'voided' ? transition.transitionedAt : String(existingLifecycle.voidedAt || '')
      }
    },
    audit: {
      ...(transaction.audit || {}),
      lastUpdateDateTime: transition.transitionedAt
    }
  };
}

async function transitionRegistrationTransactions(input = {}, options = {}) {
  void options;
  return queueWrite(async () => {
    const transition = normalizeRegistrationTransitionInput(input);
    const all = await getAllTransactions();
    const indexById = new Map(all.map((row, index) => [String(row?.id || ''), index]));
    const rows = transition.transactionIds.map((id) => {
      const index = indexById.get(String(id));
      if (index === undefined) throw new Error('Transaction ' + id + ' was not found.');
      return { index, row: transitionRegistrationTransactionRow(all[index], transition) };
    });
    rows.forEach(({ index, row }) => { all[index] = row; });
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return rows.map(({ row }) => row);
  });
}

async function backfillRegistrationTransactionOwnership(input = {}, options = {}) {
  void options;
  return queueWrite(async () => {
    const transactionIds = Array.from(new Set((Array.isArray(input.transactionIds) ? input.transactionIds : [])
      .map((value) => cleanId(value, { max: 120, allowEmpty: true }))
      .filter(Boolean)));
    if (!transactionIds.length) return [];
    const expectations = input.expectations && typeof input.expectations === 'object' ? input.expectations : {};
    const all = await getAllTransactions();
    const indexById = new Map(all.map((row, index) => [String(row?.id || ''), index]));
    const rows = transactionIds.map((id) => {
      const index = indexById.get(String(id));
      if (index === undefined) throw new Error(`Transaction ${id} was not found.`);
      return {
        index,
        row: applyRegistrationOwnershipBackfill(all[index], {
          ...input,
          expectation: expectations[id]
        })
      };
    });
    rows.forEach(({ index, row }) => { all[index] = row; });
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return rows.map(({ row }) => row);
  });
}

async function getAllTransactions() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(data || '[]');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve Global Transactions');
  }
}

async function getTransactionById(id) {
  const all = await getAllTransactions();
  return all.find((t) => idsEqual(t?.id, id)) || null;
}

async function addTransaction(data, options = {}) {
  void options;
  return queueWrite(async () => {
    const all = await getAllTransactions();
    const sanitized = sanitizeTransactionInput(data, { isUpdate: false });
    assertIdempotencyUnique(all, sanitized);

    const existingIds = new Set(all.map((t) => String(t.id)));
    const finalId = sanitized.id ? String(sanitized.id) : generateTransactionId(existingIds);
    if (existingIds.has(finalId)) throw new Error('Transaction id already exists.');

    const newTx = {
      ...sanitized,
      id: finalId,
      audit: { createDateTime: new Date().toISOString() }
    };
    all.push(newTx);
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return newTx;
  });
}

async function addTransactionsBatch(items, options = {}) {
  void options;
  return queueWrite(async () => {
    if (!Array.isArray(items) || items.length === 0) throw new Error('items must be a non-empty array.');
    if (items.length > 1000) throw new Error('Batch is too large.');

    const all = await getAllTransactions();
    const sanitizedBatch = items.map((x) => sanitizeTransactionInput(x, { isUpdate: false }));

    const seenKeys = new Set();
    for (const tx of sanitizedBatch) {
      const composite = `${tx.orgId}::${tx.source.idempotencyKey}`;
      if (seenKeys.has(composite)) throw new Error('Duplicate idempotencyKey inside batch.');
      seenKeys.add(composite);
      assertIdempotencyUnique(all, tx);
    }

    const existingIds = new Set(all.map((t) => String(t.id)));
    const created = sanitizedBatch.map((tx) => {
      const finalId = tx.id ? String(tx.id) : generateTransactionId(existingIds);
      if (existingIds.has(finalId)) throw new Error('Transaction id already exists in batch.');
      existingIds.add(finalId);
      return {
        ...tx,
        id: finalId,
        audit: { createDateTime: new Date().toISOString() }
      };
    });

    all.push(...created);
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return created;
  });
}

async function updateTransaction(id, data, options = {}) {
  void options;
  return queueWrite(async () => {
    const all = await getAllTransactions();
    const index = all.findIndex((t) => idsEqual(t?.id, id));
    if (index === -1) throw new Error('Transaction not found');

    const existing = all[index];
    if (existing.status === 'posted' || existing.status === 'voided' || existing.status === 'reversed') {
      throw new Error('Immutable transaction state. Use status operations or reversal.');
    }

    const sanitized = sanitizeTransactionInput(
      { ...existing, ...data, orgId: existing.orgId },
      { isUpdate: true }
    );

    if (!canTransition(existing.status, sanitized.status)) {
      throw new Error(`Invalid status transition from ${existing.status} to ${sanitized.status}.`);
    }

    assertIdempotencyUnique(all, sanitized, id);

    all[index] = {
      ...existing,
      ...sanitized,
      id: existing.id,
      audit: { ...existing.audit, lastUpdateDateTime: new Date().toISOString() }
    };
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return all[index];
  });
}

async function updateTransactionStatus(id, nextStatus, holdData = {}) {
  return queueWrite(async () => {
    const all = await getAllTransactions();
    const index = all.findIndex((t) => idsEqual(t?.id, id));
    if (index === -1) throw new Error('Transaction not found');

    const existing = all[index];
    const status = cleanString(nextStatus, { max: 30, allowEmpty: false }).toLowerCase();
    if (!TX_STATUSES.has(status)) throw new Error('Invalid transaction status.');

    if (!canTransition(existing.status, status)) {
      throw new Error(`Invalid status transition from ${existing.status} to ${status}.`);
    }

    const hold = cleanHold(holdData, status);
    all[index] = {
      ...existing,
      status,
      hold,
      postedAt: status === 'posted' ? (existing.postedAt || new Date().toISOString()) : existing.postedAt,
      audit: { ...existing.audit, lastUpdateDateTime: new Date().toISOString() }
    };
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return all[index];
  });
}

async function addTransactionComment(id, comment) {
  return queueWrite(async () => {
    const all = await getAllTransactions();
    const index = all.findIndex((t) => idsEqual(t?.id, id));
    if (index === -1) throw new Error('Transaction not found');

    const existing = all[index];
    const comments = cleanComments([comment]);
    const next = {
      ...existing,
      comments: [...(Array.isArray(existing.comments) ? existing.comments : []), ...comments],
      audit: { ...existing.audit, lastUpdateDateTime: new Date().toISOString() }
    };
    all[index] = next;
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return next;
  });
}

async function reverseTransaction(id, data = {}, options = {}) {
  void options;
  return queueWrite(async () => {
    const all = await getAllTransactions();
    const original = all.find((t) => idsEqual(t?.id, id));
    if (!original) throw new Error('Original transaction not found.');
    if (original.status !== 'posted') throw new Error('Only posted transactions can be reversed.');

    const existingReverse = all.find((t) => idsEqual(t?.reversalOfTransactionId, original?.id));
    if (existingReverse) throw new Error('This transaction is already reversed.');

    const existingIds = new Set(all.map((t) => String(t.id)));
    const newId = generateTransactionId(existingIds);
    const reversedAmountDirection = original.amount.direction === 'debit' ? 'credit' : 'debit';

    const reverseTx = sanitizeTransactionInput(
      {
        ...original,
        id: newId,
        postedAt: new Date().toISOString(),
        effectiveDate: cleanDateISO(data.effectiveDate, { allowEmpty: true, withTime: false }) || original.effectiveDate,
        status: 'posted',
        transactionType: 'reversal',
        source: {
          ...original.source,
          eventType: 'transaction_reversal',
          eventId: cleanId(data.eventId, { max: 120, allowEmpty: true }) || `REV-${original.id}`,
          idempotencyKey: cleanString(data.idempotencyKey, { max: 220, allowEmpty: true }) || `REV|${original.id}`
        },
        amount: {
          ...original.amount,
          direction: reversedAmountDirection
        },
        balanceEffect: -Number(original.balanceEffect || 0),
        memo: cleanString(data.memo, { max: 500, allowEmpty: true }) || `Reversal of ${original.id}`,
        internalNote: cleanString(data.internalNote, { max: 5000, allowEmpty: true }),
        comments: [],
        hold: {
          isOnHold: false,
          holdReasonCode: '',
          holdReasonText: '',
          holdPlacedBy: '',
          holdPlacedAt: '',
          holdUntil: '',
          holdReleasedBy: '',
          holdReleasedAt: ''
        },
        reversalOfTransactionId: original.id
      },
      { isUpdate: false }
    );

    assertIdempotencyUnique(all, reverseTx);

    const newTx = {
      ...reverseTx,
      id: newId,
      audit: { createDateTime: new Date().toISOString() }
    };
    all.push(newTx);
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return newTx;
  });
}

async function clearTransactionsByOrg(orgId) {
  return queueWrite(async () => {
    const targetOrgId = String(orgId || '').trim();
    if (!targetOrgId) throw new Error('orgId is required to clear global transactions.');

    const all = await getAllTransactions();
    const before = all.length;
    const filtered = all.filter((tx) => String(tx?.orgId || '') !== targetOrgId);
    const removed = before - filtered.length;
    if (!removed) return { removed: 0, remaining: before };

    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
    return { removed, remaining: filtered.length };
  });
}

async function removeTransactionById(id) {
  return queueWrite(async () => {
    const targetId = String(id || '').trim();
    if (!targetId) throw new Error('Transaction id is required.');
    const all = await getAllTransactions();
    const index = all.findIndex((tx) => String(tx?.id || '') === targetId);
    if (index === -1) throw new Error('Global transaction not found.');
    const [removed] = all.splice(index, 1);
    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return removed;
  });
}

module.exports = {
  getAllTransactions,
  getTransactionById,
  addTransaction,
  addTransactionsBatch,
  updateTransaction,
  updateTransactionStatus,
  transitionRegistrationTransactions,
  backfillRegistrationTransactionOwnership,
  applyRegistrationOwnershipBackfill,
  validateLegacyRegistrationExpectation,
  normalizeRegistrationTransitionInput,
  transitionRegistrationTransactionRow,
  addTransactionComment,
  reverseTransaction,
  resolveMemoTemplate,
  getMemoPlaceholdersForRole,
  TRANSACTION_PARTY_ROLES,
  COMMON_MEMO_PLACEHOLDERS,
  MEMO_PLACEHOLDERS_BY_ROLE,
  clearTransactionsByOrg,
  removeTransactionById,
  TX_STATUSES: Object.freeze([...TX_STATUSES]),
  TX_TYPES: Object.freeze([...TX_TYPES]),
  TX_DIRECTIONS: Object.freeze([...TX_DIRECTIONS]),
  RECON_STATUSES: Object.freeze([...RECON_STATUSES])
};


