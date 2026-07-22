'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const SELF_FUNDER_ID = 'self';
const SELF_FUNDER_TYPE = 'self';
const REGISTERED_FUNDER_TYPE = 'funder';

function isSelfFund(funderId = '') {
  const token = String(funderId || '').trim().toLowerCase();
  return !token || token === SELF_FUNDER_ID;
}

/**
 * Normalize enrollment funder selection from request body or period row.
 * Self Fund => { funderId: 'self', funderType: 'self' }
 * Registered => { funderId: 'FUN_…', funderType: 'funder' }
 */
function normalizeEnrollmentFunderSelection(input = {}) {
  const rawId = String(input?.funderId || '').trim();
  if (isSelfFund(rawId)) {
    return { funderId: SELF_FUNDER_ID, funderType: SELF_FUNDER_TYPE };
  }
  return { funderId: toPublicId(rawId) || rawId, funderType: REGISTERED_FUNDER_TYPE };
}

function resolveEnrollmentFunderLabel(period = {}, funderLabelById = new Map()) {
  const funderId = String(period?.funderId || '').trim();
  const funderType = String(period?.funderType || '').trim();

  if (!isSelfFund(funderId)) {
    const known = funderLabelById.get(funderId) || funderLabelById.get(toPublicId(funderId));
    if (known) return known;
  }

  if (isSelfFund(funderId) && (!funderType || funderType.toLowerCase() === SELF_FUNDER_TYPE)) {
    return 'Self Fund';
  }

  const legacy = [funderType, funderId].filter(Boolean).join(' / ');
  return legacy || 'Self Fund';
}

/**
 * Resolve the AR/debit account used for ROLE:student enrollment postings.
 * Self Fund -> student.studentAccountId
 * Funder -> funder.funderAccountId
 */
function resolveEnrollmentBillingAccountId({
  funderId = '',
  student = null,
  funderRecord = null,
  chargeable = false
} = {}) {
  if (isSelfFund(funderId)) {
    const studentAccountId = toPublicId(student?.studentAccountId || '');
    if (chargeable && !studentAccountId) {
      throw new Error('Student financial account is required for Self Fund chargeable enrollment.');
    }
    return studentAccountId;
  }

  if (!funderRecord) {
    throw new Error('Selected funder was not found.');
  }
  const status = String(funderRecord.status || '').trim().toLowerCase();
  if (status && status !== 'active') {
    throw new Error('Selected funder is not active.');
  }

  const funderAccountId = toPublicId(funderRecord.funderAccountId || '');
  if (chargeable && !funderAccountId) {
    throw new Error('Selected funder has no linked financial account. Link an account on the funder record before charging enrollment.');
  }
  return funderAccountId;
}

function buildStudentDetailMemoSuffix({ studentId = '', studentLabel = '' } = {}) {
  const id = toPublicId(studentId) || String(studentId || '').trim();
  const label = String(studentLabel || '').trim();
  if (!id && !label) return '';
  if (label && id) return `Student: ${label} (${id})`;
  if (label) return `Student: ${label}`;
  return `Student: ${id}`;
}

function appendStudentDetailToDraftMemos(items = [], studentDetail = {}) {
  const suffix = buildStudentDetailMemoSuffix(studentDetail);
  if (!suffix) return Array.isArray(items) ? items : [];
  return (Array.isArray(items) ? items : []).map((item) => {
    const memo = String(item?.memo || '').trim();
    if (!memo) return { ...item, memo: suffix };
    if (memo.includes(suffix)) return item;
    return { ...item, memo: `${memo} | ${suffix}` };
  });
}

function collectIdsFromList(list = []) {
  const out = [];
  const seen = new Set();
  (Array.isArray(list) ? list : []).forEach((value) => {
    const id = toPublicId(value) || String(value || '').trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  });
  return out;
}

/**
 * Collect draft/posted finance transaction IDs attached to an enrollment period.
 */
function collectAttachedEnrollmentTransactionIds(period = {}) {
  const summary = (period?.transactionSummary && typeof period.transactionSummary === 'object')
    ? period.transactionSummary
    : {};
  return collectIdsFromList([
    ...(Array.isArray(summary.postedTransactionIds) ? summary.postedTransactionIds : []),
    ...(Array.isArray(summary.draftTransactionIds) ? summary.draftTransactionIds : []),
    ...(Array.isArray(summary.transactionIds) ? summary.transactionIds : [])
  ]);
}

function enrollmentHasAttachedTransactions(period = {}) {
  return collectAttachedEnrollmentTransactionIds(period).length > 0;
}

function isSameEnrollmentFunderSelection(left = {}, right = {}) {
  const a = normalizeEnrollmentFunderSelection(left);
  const b = normalizeEnrollmentFunderSelection(right);
  return a.funderId === b.funderId && a.funderType === b.funderType;
}

/**
 * Block funder changes when the period already has draft or posted finance transactions.
 * Same-funder re-saves are allowed.
 */
function assertEnrollmentFunderChangeAllowed(period = {}, nextFunderSelection = {}) {
  const next = normalizeEnrollmentFunderSelection(nextFunderSelection);
  const current = normalizeEnrollmentFunderSelection({
    funderId: period?.funderId,
    funderType: period?.funderType
  });
  if (isSameEnrollmentFunderSelection(current, next)) return;
  if (!enrollmentHasAttachedTransactions(period)) return;
  throw new Error(
    'Funder cannot be changed because this enrollment already has financial transactions. '
    + 'Reverse/rollback or void those transactions first, then change funder (or create a new period).'
  );
}

module.exports = {
  SELF_FUNDER_ID,
  SELF_FUNDER_TYPE,
  REGISTERED_FUNDER_TYPE,
  isSelfFund,
  normalizeEnrollmentFunderSelection,
  resolveEnrollmentFunderLabel,
  resolveEnrollmentBillingAccountId,
  buildStudentDetailMemoSuffix,
  appendStudentDetailToDraftMemos,
  collectAttachedEnrollmentTransactionIds,
  enrollmentHasAttachedTransactions,
  isSameEnrollmentFunderSelection,
  assertEnrollmentFunderChangeAllowed
};
