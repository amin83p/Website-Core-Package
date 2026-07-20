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

module.exports = {
  SELF_FUNDER_ID,
  SELF_FUNDER_TYPE,
  REGISTERED_FUNDER_TYPE,
  isSelfFund,
  normalizeEnrollmentFunderSelection,
  resolveEnrollmentFunderLabel,
  resolveEnrollmentBillingAccountId,
  buildStudentDetailMemoSuffix,
  appendStudentDetailToDraftMemos
};
