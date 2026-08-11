'use strict';

const schoolDataService = require('./schoolDataService');
const {
  COPY_TYPES,
  COPY_STATUSES
} = require('../../models/school/libraryCopyModel');
const {
  PATRON_STATUSES,
  normalizePatronRole,
  getActivePolicyOverrideRecord,
  isPatronAccountValid
} = require('../../models/school/libraryPatronModel');
const {
  DEFAULT_POLICIES,
  buildDefaultPolicyDoc
} = require('../../models/school/libraryPolicyModel');
const {
  LOAN_STATUSES,
  OPEN_STATUSES
} = require('../../models/school/libraryLoanModel');
const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId, idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const POLICY_OVERRIDE_FIELDS = Object.freeze([
  'maxConcurrentLoans',
  'loanPeriodDays',
  'digitalAccessDays',
  'allowDigitalDownload',
  'maxRenewals'
]);

const LIBRARY_CARD_ROLE_PREFIX = Object.freeze({
  student: 'STU',
  teacher: 'TCH',
  staff: 'STF'
});

async function fetchOrgRows(entityType, orgId, user, predicate = null) {
  const rows = await schoolDataService.fetchAllData(entityType, {}, user);
  let list = (Array.isArray(rows) ? rows : []).filter((row) => idsEqual(row.orgId, orgId));
  if (predicate) list = list.filter(predicate);
  return list;
}

function cardToken(value, fallback = '') {
  const token = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(-8);
  return token || fallback;
}

function buildLibraryCardNumber({ patronRole, personId, roleRecordId, existingNumbers = [] } = {}) {
  const role = normalizePatronRole(patronRole);
  const prefix = LIBRARY_CARD_ROLE_PREFIX[role] || 'LIB';
  const token = cardToken(personId, cardToken(roleRecordId, Date.now().toString(36).toUpperCase()));
  const base = `LIB-${prefix}-${token}`;
  const existing = new Set((Array.isArray(existingNumbers) ? existingNumbers : []).map((value) => String(value || '').toUpperCase()));
  if (!existing.has(base.toUpperCase())) return base;
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`.toUpperCase())) suffix += 1;
  return `${base}-${suffix}`;
}

function addDaysIso(baseDate, days) {
  const parsed = new Date(baseDate || Date.now());
  parsed.setDate(parsed.getDate() + Number(days || 0));
  return parsed.toISOString();
}

function isLoanOpen(loan) {
  return OPEN_STATUSES.has(String(loan?.status || '').trim().toLowerCase());
}

function isDigitalAccessValid(loan) {
  if (!loan || !isLoanOpen(loan)) return false;
  if (String(loan.copyType || '') !== COPY_TYPES.DIGITAL) return false;
  const expires = loan.digitalAccessExpiresAt || loan.dueAt;
  if (!expires) return false;
  return new Date(expires).getTime() >= Date.now();
}

async function listOrgPolicies(orgId, user) {
  const list = await fetchOrgRows('libraryPolicies', orgId, user);
  const roles = Object.keys(DEFAULT_POLICIES);
  const output = [];
  for (const role of roles) {
    const existing = list.find((row) => (
      idsEqual(row.orgId, orgId) && String(row.patronRole) === role && row.active !== false
    ));
    if (existing) {
      output.push(existing);
    } else {
      output.push(buildDefaultPolicyDoc(orgId, role));
    }
  }
  return output;
}

async function getPolicyForRole(orgId, patronRole, user) {
  const policies = await listOrgPolicies(orgId, user);
  return policies.find((row) => String(row.patronRole) === normalizePatronRole(patronRole)) || null;
}

function todayDateKey(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const validDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = validDate.getFullYear();
  const month = String(validDate.getMonth() + 1).padStart(2, '0');
  const day = String(validDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function hasPolicyOverrideValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function isPatronPolicyOverrideActive(patron, now = new Date()) {
  const activeRecord = getActivePolicyOverrideRecord(patron?.policyOverrideRecords, now);
  if (activeRecord) return true;
  const overrides = patron?.policyOverrides && typeof patron.policyOverrides === 'object'
    ? patron.policyOverrides
    : { maxConcurrentLoans: patron?.maxConcurrentLoans };
  const hasOverride = POLICY_OVERRIDE_FIELDS.some((field) => hasPolicyOverrideValue(overrides[field]));
  if (!hasOverride) return false;
  const expiresAt = String(patron?.policyOverrideExpiresAt || '').trim();
  if (!expiresAt) return true;
  return expiresAt.slice(0, 10) >= todayDateKey(now);
}

function applyPatronPolicyOverrides(policy, patron, { now = new Date() } = {}) {
  const activeRecord = getActivePolicyOverrideRecord(patron?.policyOverrideRecords, now);
  const effective = {
    ...(policy || {}),
    overrideActive: false,
    overrideRecordId: activeRecord?.id || '',
    overrideValidFrom: activeRecord?.validFrom || '',
    overrideExpiresAt: activeRecord?.validTo || String(patron?.policyOverrideExpiresAt || '').trim()
  };
  if (!activeRecord && !isPatronPolicyOverrideActive(patron, now)) return effective;
  const overrides = activeRecord?.policyOverrides || (patron?.policyOverrides && typeof patron.policyOverrides === 'object'
    ? patron.policyOverrides
    : { maxConcurrentLoans: patron?.maxConcurrentLoans });
  for (const field of POLICY_OVERRIDE_FIELDS) {
    if (hasPolicyOverrideValue(overrides[field])) {
      effective[field] = overrides[field];
    }
  }
  effective.overrideActive = true;
  return effective;
}

async function getEffectivePolicyForPatron(orgId, patron, user, options = {}) {
  const policy = await getPolicyForRole(orgId, patron?.patronRole, user);
  return applyPatronPolicyOverrides(policy, patron, options);
}

async function getEffectivePolicyForLoan(loan, user, options = {}) {
  let patron = null;
  if (loan?.patronId) {
    patron = await schoolDataService.getDataById('libraryPatrons', loan.patronId, user);
    if (patron && !idsEqual(patron.orgId, loan.orgId)) patron = null;
  }
  if (patron) {
    assertPatronEligible(patron);
    return getEffectivePolicyForPatron(loan.orgId, patron, user, options);
  }
  return getPolicyForRole(loan.orgId, loan.patronRole, user);
}

async function countOpenLoansForPatron(orgId, patronId, user) {
  const rows = await fetchOrgRows('libraryLoans', orgId, user, (row) => String(row.patronId) === String(patronId));
  return rows.filter(isLoanOpen).length;
}

async function resolveOrCreatePatron(orgId, {
  personId,
  patronRole,
  roleRecordId,
  userId
}, user) {
  const normalizedPersonId = toPublicId(personId);
  if (!normalizedPersonId) throw new Error('Person is required for checkout.');

  const rows = await fetchOrgRows('libraryPatrons', orgId, user, (row) => idsEqual(row.personId, normalizedPersonId));
  const existing = rows[0];
  if (existing) return existing;
  const patronRows = await fetchOrgRows('libraryPatrons', orgId, user);
  const existingNumbers = patronRows.map((row) => row.libraryCardNumber).filter(Boolean);
  const normalizedRole = normalizePatronRole(patronRole);

  return schoolDataService.addData('libraryPatrons', {
    orgId,
    personId: normalizedPersonId,
    patronRole: normalizedRole,
    roleRecordId: toPublicId(roleRecordId) || '',
    status: PATRON_STATUSES.ACTIVE,
    libraryCardNumber: buildLibraryCardNumber({
      patronRole: normalizedRole,
      personId: normalizedPersonId,
      roleRecordId,
      existingNumbers
    }),
    audit: { createUser: userId, lastUpdateUser: userId }
  }, user);
}

function assertPatronEligible(patron) {
  const status = String(patron?.status || '').trim().toLowerCase();
  if (!isPatronAccountValid(patron)) {
    throw new Error('This patron account is outside its validity dates.');
  }
  if (status === PATRON_STATUSES.BLOCKED) {
    throw new Error('This patron is blocked from library services.');
  }
  if (status === PATRON_STATUSES.SUSPENDED) {
    throw new Error('This patron is suspended from library services.');
  }
}

async function checkout({
  orgId,
  patronId,
  copyId,
  staffUserId,
  notes,
  dueAt: requestedDueAt,
  digitalAccessExpiresAt: requestedDigitalAccessExpiresAt
}, user) {
  const patron = await schoolDataService.getDataById('libraryPatrons', patronId, user);
  if (!patron || !idsEqual(patron.orgId, orgId)) throw new Error('Patron not found.');
  assertPatronEligible(patron);

  const copy = await schoolDataService.getDataById('libraryCopies', copyId, user);
  if (!copy || !idsEqual(copy.orgId, orgId)) throw new Error('Copy not found.');
  if (String(copy.status) !== COPY_STATUSES.AVAILABLE) {
    throw new Error('Copy is not available for checkout.');
  }

  const book = await schoolDataService.getDataById('books', copy.bookId, user);
  if (!book || !idsEqual(book.orgId, orgId)) throw new Error('Catalog book not found for this copy.');
  if (String(copy.copyType) === COPY_TYPES.DIGITAL && !book.digitalPdf) {
    throw new Error('Digital copy cannot be lent because the catalog book has no PDF.');
  }

  const policy = await getEffectivePolicyForPatron(orgId, patron, user);
  const maxLoans = Number(policy?.maxConcurrentLoans || 0);
  const openCount = await countOpenLoansForPatron(orgId, patron.id, user);
  if (maxLoans > 0 && openCount >= maxLoans) {
    throw new Error(`Patron has reached the maximum of ${maxLoans} concurrent loans.`);
  }

  const now = new Date().toISOString();
  const isDigital = String(copy.copyType) === COPY_TYPES.DIGITAL;
  const loanDays = isDigital
    ? Number(policy?.digitalAccessDays || 30)
    : Number(policy?.loanPeriodDays || 14);
  const dueAt = requestedDueAt || addDaysIso(now, loanDays);
  const digitalAccessExpiresAt = isDigital
    ? (requestedDigitalAccessExpiresAt || dueAt)
    : requestedDigitalAccessExpiresAt || null;

  const loan = await schoolDataService.addData('libraryLoans', {
    orgId,
    patronId: patron.id,
    personId: patron.personId,
    patronRole: patron.patronRole,
    copyId: copy.id,
    bookId: copy.bookId,
    copyType: copy.copyType,
    status: LOAN_STATUSES.ACTIVE,
    checkoutAt: now,
    dueAt,
    digitalAccessExpiresAt,
    renewalCount: 0,
    checkedOutByUserId: String(staffUserId || 'SYSTEM'),
    notes: String(notes || '').trim(),
    audit: { createUser: staffUserId, lastUpdateUser: staffUserId }
  }, user);

  await schoolDataService.updateData('libraryCopies', copy.id, {
    status: COPY_STATUSES.LOANED,
    audit: { lastUpdateUser: staffUserId }
  }, user);

  return loan;
}

async function returnLoan(loanId, staffUserId, user) {
  const loan = await schoolDataService.getDataById('libraryLoans', loanId, user);
  if (!loan) throw new Error('Loan not found.');
  if (!isLoanOpen(loan)) throw new Error('Loan is not open for return.');

  const now = new Date().toISOString();
  const updated = await schoolDataService.updateData('libraryLoans', loan.id, {
    status: LOAN_STATUSES.RETURNED,
    returnedAt: now,
    returnedByUserId: String(staffUserId || 'SYSTEM'),
    audit: { lastUpdateUser: staffUserId }
  }, user);

  const copy = await schoolDataService.getDataById('libraryCopies', loan.copyId, user);
  if (copy) {
    await schoolDataService.updateData('libraryCopies', copy.id, {
      status: COPY_STATUSES.AVAILABLE,
      audit: { lastUpdateUser: staffUserId }
    }, user);
  }

  return updated;
}

async function renewLoan(loanId, staffUserId, user) {
  const loan = await schoolDataService.getDataById('libraryLoans', loanId, user);
  if (!loan) throw new Error('Loan not found.');
  if (!isLoanOpen(loan)) throw new Error('Only active or overdue loans can be renewed.');

  const policy = await getEffectivePolicyForLoan(loan, user);
  const maxRenewals = Number(policy?.maxRenewals || 0);
  const currentRenewals = Number(loan.renewalCount || 0);
  if (currentRenewals >= maxRenewals) {
    throw new Error(`Maximum renewals (${maxRenewals}) reached for this loan.`);
  }

  const isDigital = String(loan.copyType) === COPY_TYPES.DIGITAL;
  const extensionDays = isDigital
    ? Number(policy?.digitalAccessDays || 30)
    : Number(policy?.loanPeriodDays || 14);
  const baseDue = loan.dueAt || new Date().toISOString();
  const dueAt = addDaysIso(baseDue, extensionDays);
  const digitalAccessExpiresAt = isDigital ? dueAt : loan.digitalAccessExpiresAt;

  return schoolDataService.updateData('libraryLoans', loan.id, {
    status: LOAN_STATUSES.ACTIVE,
    dueAt,
    digitalAccessExpiresAt,
    renewalCount: currentRenewals + 1,
    audit: { lastUpdateUser: staffUserId }
  }, user);
}

async function markOverdueLoans(orgId, user) {
  const rows = await fetchOrgRows('libraryLoans', orgId, user, (row) => String(row.status) === LOAN_STATUSES.ACTIVE);
  const now = Date.now();
  let updated = 0;
  for (const loan of (Array.isArray(rows) ? rows : [])) {
    if (!loan.dueAt) continue;
    if (new Date(loan.dueAt).getTime() < now) {
      await schoolDataService.updateData('libraryLoans', loan.id, {
        status: LOAN_STATUSES.OVERDUE,
        audit: { lastUpdateUser: 'SYSTEM' }
      }, user);
      updated += 1;
    }
  }
  return updated;
}

async function getActiveDigitalLoanForBook(orgId, personId, bookId, user) {
  const normalizedPersonId = toPublicId(personId);
  const normalizedBookId = toPublicId(bookId);
  const rows = await fetchOrgRows('libraryLoans', orgId, user, (row) => (
    idsEqual(row.personId, normalizedPersonId)
    && idsEqual(row.bookId, normalizedBookId)
    && String(row.copyType) === COPY_TYPES.DIGITAL
  ));
  return rows.find((loan) => isDigitalAccessValid(loan)) || null;
}

async function canAccessDigitalPdf(orgId, personId, bookId, user) {
  const loan = await getActiveDigitalLoanForBook(orgId, personId, bookId, user);
  return Boolean(loan);
}

async function listOpenLoansForPerson(orgId, personId, user) {
  await markOverdueLoans(orgId, user);
  const normalizedPersonId = toPublicId(personId);
  const rows = await fetchOrgRows('libraryLoans', orgId, user, (row) => idsEqual(row.personId, normalizedPersonId));
  return rows.filter(isLoanOpen);
}

async function ensureDigitalCopyForBook(book, userId, user) {
  if (!book?.digitalPdf || !book?.id || !book?.orgId) return null;
  const copies = await fetchOrgRows('libraryCopies', book.orgId, user, (row) => (
    idsEqual(row.bookId, book.id) && String(row.copyType) === COPY_TYPES.DIGITAL
  ));
  const existing = copies.find((row) => row.status !== COPY_STATUSES.RETIRED);
  if (existing) return existing;

  return schoolDataService.addData('libraryCopies', {
    orgId: book.orgId,
    bookId: book.id,
    copyType: COPY_TYPES.DIGITAL,
    copyCode: `DIG-${book.id}`,
    status: COPY_STATUSES.AVAILABLE,
    digitalAsset: book.digitalPdf,
    notes: 'Auto-created digital lendable unit',
    audit: { createUser: userId, lastUpdateUser: userId }
  }, user);
}

module.exports = {
  listOrgPolicies,
  getPolicyForRole,
  getEffectivePolicyForPatron,
  getEffectivePolicyForLoan,
  applyPatronPolicyOverrides,
  isPatronPolicyOverrideActive,
  resolveOrCreatePatron,
  checkout,
  returnLoan,
  renewLoan,
  markOverdueLoans,
  getActiveDigitalLoanForBook,
  canAccessDigitalPdf,
  listOpenLoansForPerson,
  ensureDigitalCopyForBook,
  isLoanOpen,
  isDigitalAccessValid,
  assertPatronEligible
};
