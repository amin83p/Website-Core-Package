'use strict';

const schoolDataService = require('../../services/school/schoolDataService');
const libraryCirculationService = require('../../services/school/libraryCirculationService');
const schoolPersonAccessService = require('../../services/school/schoolPersonAccessService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const { isAjax, buildDataServiceQuery } = requireCoreModule('MVC/utils/generalTools');
const { applyGenericFilter } = requireCoreModule('MVC/utils/queryEngine');
const settingService = requireCoreModule('MVC/services/settingService');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const { getActiveOrgIdOrThrow } = requireCoreModule('MVC/utils/orgContextUtils');
const { OPEN_STATUSES, LOAN_STATUSES } = require('../../models/school/libraryLoanModel');
const { COPY_TYPES, COPY_STATUSES } = require('../../models/school/libraryCopyModel');

async function enrichLoans(loans, reqUser) {
  const bookMap = new Map();
  const patronMap = new Map();
  const copyMap = new Map();
  for (const loan of loans) {
    if (loan.bookId && !bookMap.has(loan.bookId)) {
      bookMap.set(loan.bookId, await schoolDataService.getDataById('books', loan.bookId, reqUser));
    }
    if (loan.patronId && !patronMap.has(loan.patronId)) {
      patronMap.set(loan.patronId, await schoolDataService.getDataById('libraryPatrons', loan.patronId, reqUser));
    }
    if (loan.copyId && !copyMap.has(loan.copyId)) {
      copyMap.set(loan.copyId, await schoolDataService.getDataById('libraryCopies', loan.copyId, reqUser));
    }
  }
  return loans.map((loan) => ({
    ...loan,
    bookTitle: bookMap.get(loan.bookId)?.title || '',
    bookIsbn: bookMap.get(loan.bookId)?.isbn || '',
    coverPhoto: bookMap.get(loan.bookId)?.coverPhoto || null,
    coverPhotoUrl: bookMap.get(loan.bookId)?.coverPhoto?.url || '',
    copyCode: copyMap.get(loan.copyId)?.copyCode || '',
    patronPersonId: patronMap.get(loan.patronId)?.personId || loan.personId
  }));
}

async function enrichCopiesWithBooks(copies, reqUser) {
  const bookIds = [...new Set((Array.isArray(copies) ? copies : [])
    .map((row) => String(row.bookId || '').trim())
    .filter(Boolean))];
  const bookMap = new Map();
  for (const bookId of bookIds) {
    // eslint-disable-next-line no-await-in-loop
    const book = await schoolDataService.getDataById('books', bookId, reqUser);
    if (book) bookMap.set(String(book.id), book);
  }
  return (Array.isArray(copies) ? copies : []).map((copy) => {
    const book = bookMap.get(String(copy.bookId || ''));
    return {
      ...copy,
      bookTitle: book?.title || '',
      bookIsbn: book?.isbn || '',
      coverPhoto: book?.coverPhoto || null,
      coverPhotoUrl: book?.coverPhoto?.url || ''
    };
  });
}

function roleRecordName(row) {
  return String(row?.name || row?.displayName || row?.fullName || '').trim()
    || `${String(row?.firstName || '').trim()} ${String(row?.lastName || '').trim()}`.trim();
}

async function buildPatronPickerItems(orgId, reqUser) {
  const [patrons, students, teachers, staff] = await Promise.all([
    schoolDataService.fetchAllData('libraryPatrons', {}, reqUser),
    schoolDataService.fetchAllData('students', {}, reqUser),
    schoolDataService.fetchAllData('teachers', {}, reqUser),
    schoolDataService.fetchAllData('staff', {}, reqUser)
  ]);
  const rows = (Array.isArray(patrons) ? patrons : []).filter((patron) => idsEqual(patron.orgId, orgId));
  const personIds = rows.map((patron) => patron?.personId).filter(Boolean);
  const personById = await schoolPersonAccessService.buildPersonByIdMap({
    reqUser,
    personIds,
    requireSchoolRole: false
  }).catch(() => new Map());

  function findRoleRecord(patron) {
    const role = String(patron?.patronRole || '').trim().toLowerCase();
    const source = role === 'teacher' ? teachers : (role === 'staff' ? staff : students);
    return (Array.isArray(source) ? source : []).find((row) => (
      idsEqual(row.id, patron?.roleRecordId) || idsEqual(row.personId, patron?.personId)
    )) || null;
  }

  return rows.map((patron) => {
    const person = personById instanceof Map ? personById.get(String(patron.personId || '').trim()) : null;
    const roleRecord = findRoleRecord(patron);
    const displayName = schoolPersonAccessService.formatPersonName(person, '')
      || roleRecordName(roleRecord)
      || String(patron.personId || patron.id || '').trim();
    const primaryCode = String(patron.libraryCardNumber || '').trim()
      || String(roleRecord?.customStudentId || roleRecord?.localId || roleRecord?.employeeNumber || '').trim();
    return {
      id: patron.id,
      patronId: patron.id,
      personId: patron.personId,
      roleRecordId: patron.roleRecordId || '',
      patronRole: patron.patronRole,
      status: patron.status,
      libraryCardNumber: patron.libraryCardNumber || '',
      displayName,
      name: displayName,
      label: `${displayName}${primaryCode ? ` - ${primaryCode}` : ''}`,
      primaryCode,
      email: schoolPersonAccessService.readPersonEmail(person) || roleRecord?.email || ''
    };
  }).sort((a, b) => String(a.displayName || '').localeCompare(String(b.displayName || '')));
}

function summarizePolicyForDesk(policy = {}, openLoanCount = 0, eligibility = { eligible: true, message: '' }) {
  const maxLoans = Number(policy?.maxConcurrentLoans || 0);
  const remainingLoans = maxLoans > 0 ? Math.max(0, maxLoans - Number(openLoanCount || 0)) : null;
  const canBorrow = eligibility.eligible && (remainingLoans === null || remainingLoans > 0);
  const messages = [];
  if (!eligibility.eligible && eligibility.message) messages.push(eligibility.message);
  if (eligibility.eligible && remainingLoans === 0) messages.push(`Maximum concurrent loans reached (${maxLoans}).`);
  if (eligibility.eligible && remainingLoans === null) messages.push('No concurrent loan limit is configured.');
  if (eligibility.eligible && remainingLoans !== null && remainingLoans > 0) messages.push(`Can borrow ${remainingLoans} more item${remainingLoans === 1 ? '' : 's'}.`);
  messages.push(`Loan period: ${Number(policy?.loanPeriodDays || 0)} days.`);
  messages.push(`Digital access: ${policy?.allowDigitalDownload === false ? 'not allowed' : `${Number(policy?.digitalAccessDays || 0)} days`}.`);
  messages.push(`Renewals allowed per loan: ${Number(policy?.maxRenewals || 0)}.`);
  return {
    maxLoans,
    openLoanCount: Number(openLoanCount || 0),
    remainingLoans,
    canBorrow,
    overrideActive: Boolean(policy?.overrideActive),
    overrideRecordId: policy?.overrideRecordId || '',
    overrideValidFrom: policy?.overrideValidFrom || '',
    overrideExpiresAt: policy?.overrideExpiresAt || '',
    messages
  };
}

exports.showCirculationDesk = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    await libraryCirculationService.markOverdueLoans(orgId, req.user);
    const patronPickerItems = await buildPatronPickerItems(orgId, req.user);
    return res.render('school/library/circulationDesk', {
      title: 'Circulation Desk',
      includeModal: true,
      patronPickerItems,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.apiPatronDeskSummary = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const patronId = String(req.params?.patronId || req.query?.patronId || '').trim();
    if (!patronId) throw new Error('Patron is required.');
    await libraryCirculationService.markOverdueLoans(orgId, req.user);
    const patron = await schoolDataService.getDataById('libraryPatrons', patronId, req.user);
    if (!patron || !idsEqual(patron.orgId, orgId)) throw new Error('Patron not found.');

    const allLoans = await schoolDataService.fetchAllData('libraryLoans', {}, req.user);
    const patronLoans = (Array.isArray(allLoans) ? allLoans : []).filter((loan) => (
      idsEqual(loan.orgId, orgId) && idsEqual(loan.patronId, patron.id)
    ));
    const openLoans = patronLoans.filter((loan) => OPEN_STATUSES.has(String(loan.status || '').toLowerCase()));
    const enrichedOpenLoans = await enrichLoans(openLoans, req.user);
    const policy = await libraryCirculationService.getEffectivePolicyForPatron(orgId, patron, req.user);
    let eligibility = { eligible: true, message: '' };
    try {
      libraryCirculationService.assertPatronEligible(patron);
    } catch (error) {
      eligibility = { eligible: false, message: error.message || 'Patron is not eligible for checkout.' };
    }
    const allowance = summarizePolicyForDesk(policy, enrichedOpenLoans.length, eligibility);

    return res.json({
      status: 'success',
      patron,
      loans: enrichedOpenLoans,
      policy,
      allowance
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.apiSearchAvailableCopies = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const q = String(req.query?.q || '').trim().toLowerCase();
    const copyType = String(req.query?.copyType || '').trim().toLowerCase();
    const excluded = new Set(String(req.query?.exclude || '')
      .split(',')
      .map((id) => String(id || '').trim())
      .filter(Boolean));
    if (!q) throw new Error('Enter a copy barcode or book name to search.');

    const rows = await schoolDataService.fetchAllData('libraryCopies', {}, req.user);
    let copies = (Array.isArray(rows) ? rows : []).filter((row) => (
      idsEqual(row.orgId, orgId)
      && String(row.status || '').toLowerCase() === COPY_STATUSES.AVAILABLE
      && !excluded.has(String(row.id || ''))
    ));
    if (copyType) copies = copies.filter((row) => String(row.copyType || '').toLowerCase() === copyType);
    copies = await enrichCopiesWithBooks(copies, req.user);
    const filtered = copies.filter((copy) => {
      const haystack = [
        copy.id,
        copy.copyCode,
        copy.bookId,
        copy.bookTitle,
        copy.bookIsbn,
        copy.copyType,
        copy.location,
        copy.locationPath
      ].map((value) => String(value || '').toLowerCase()).join(' ');
      return haystack.includes(q);
    }).slice(0, 25);

    return res.json({ status: 'success', results: filtered });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.apiPreviewLoans = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const requestedLoanIds = [
      req.params?.loanId,
      req.query?.loanId,
      req.query?.loanIds
    ];
    const loanIds = requestedLoanIds
      .flatMap((value) => String(value || '').split(','))
      .map((loanId) => loanId.trim())
      .filter(Boolean)
      .filter((loanId, index, arr) => arr.indexOf(loanId) === index);
    if (!loanIds.length) throw new Error('Loan id is required.');

    const loans = [];
    for (const loanId of loanIds) {
      // eslint-disable-next-line no-await-in-loop
      const loan = await schoolDataService.getDataById('libraryLoans', loanId, req.user);
      if (!loan || !idsEqual(loan.orgId, orgId)) throw new Error(`Loan ${loanId} was not found.`);
      if (!OPEN_STATUSES.has(String(loan.status || '').toLowerCase())) {
        throw new Error(`Loan ${loanId} is not open for return.`);
      }
      loans.push(loan);
    }

    const enrichedLoans = await enrichLoans(loans, req.user);
    return res.json({ status: 'success', loans: enrichedLoans });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.listLoans = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    await libraryCirculationService.markOverdueLoans(orgId, req.user);
    const query = await buildDataServiceQuery(req.query, { allowedExactKeys: ['status'] });
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query.q = '';

    const rows = await schoolDataService.fetchAllData('libraryLoans', {}, req.user);
    let loans = (Array.isArray(rows) ? rows : []).filter((row) => idsEqual(row.orgId, orgId));
    if (query.status) {
      loans = loans.filter((row) => String(row.status) === String(query.status));
    } else {
      loans = loans.filter((row) => OPEN_STATUSES.has(String(row.status || '').toLowerCase()));
    }
    loans = await enrichLoans(loans, req.user);
    loans = loans.sort((a, b) => String(b.checkoutAt || '').localeCompare(String(a.checkoutAt || '')));

    const searchableFields = ['id', 'bookTitle', 'copyCode', 'personId', 'patronPersonId', 'status', 'copyType'];
    loans = applyGenericFilter(loans, query, { defaultSearchFields: searchableFields });
    const { data, pagination } = paginate(loans, query.page, query.limit);

    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });
    return res.render('school/library/loanList', {
      title: 'Active Library Loans',
      tableName: 'School_Library_Loans',
      data,
      filterStatus: String(query.status || ''),
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
    if (isAjax(req)) return res.status(500).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.apiCheckout = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const patronId = String(req.body?.patronId || '').trim();
    const checkoutItems = (Array.isArray(req.body?.checkoutItems) ? req.body.checkoutItems : [])
      .map((item) => ({
        copyId: String(item?.copyId || '').trim(),
        dueAt: String(item?.dueAt || '').trim(),
        digitalAccessExpiresAt: String(item?.digitalAccessExpiresAt || '').trim(),
        notes: String(item?.notes || '').trim()
      }))
      .filter((item) => item.copyId);
    const requestedCopyIds = Array.isArray(req.body?.copyIds)
      ? req.body.copyIds
      : [req.body?.copyId];
    const copyIds = (checkoutItems.length ? checkoutItems.map((item) => item.copyId) : requestedCopyIds)
      .map((copyId) => String(copyId || '').trim())
      .filter(Boolean)
      .filter((copyId, index, arr) => arr.indexOf(copyId) === index);
    const personId = String(req.body?.personId || '').trim();
    const patronRole = String(req.body?.patronRole || 'student').trim();
    const roleRecordId = String(req.body?.roleRecordId || '').trim();
    const notes = String(req.body?.notes || '').trim();
    const staffUserId = req.user?.id || 'SYSTEM';

    let resolvedPatronId = patronId;
    if (!resolvedPatronId && personId) {
      const patron = await libraryCirculationService.resolveOrCreatePatron(orgId, {
        personId,
        patronRole,
        roleRecordId,
        userId: staffUserId
      }, req.user);
      resolvedPatronId = patron.id;
    }
    if (!resolvedPatronId || !copyIds.length) throw new Error('Patron and copy are required for checkout.');

    const loans = [];
    for (const copyId of copyIds) {
      const checkoutItem = checkoutItems.find((item) => idsEqual(item.copyId, copyId)) || {};
      const loanNotes = checkoutItem.notes || notes;
      // eslint-disable-next-line no-await-in-loop
      const loan = await libraryCirculationService.checkout({
        orgId,
        patronId: resolvedPatronId,
        copyId,
        staffUserId,
        notes: loanNotes,
        dueAt: checkoutItem.dueAt,
        digitalAccessExpiresAt: checkoutItem.digitalAccessExpiresAt
      }, req.user);
      loans.push(loan);
    }

    return res.json({
      status: 'success',
      message: loans.length === 1 ? 'Checkout completed.' : `${loans.length} checkouts completed.`,
      loan: loans[0] || null,
      loans
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.apiReturn = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const requestedLoanIds = Array.isArray(req.body?.loanIds)
      ? req.body.loanIds
      : [req.body?.loanId, req.params?.loanId];
    const loanIds = requestedLoanIds
      .map((loanId) => String(loanId || '').trim())
      .filter(Boolean)
      .filter((loanId, index, arr) => arr.indexOf(loanId) === index);
    if (!loanIds.length) throw new Error('Loan id is required.');

    const loans = [];
    for (const loanId of loanIds) {
      // eslint-disable-next-line no-await-in-loop
      const existing = await schoolDataService.getDataById('libraryLoans', loanId, req.user);
      if (!existing || !idsEqual(existing.orgId, orgId)) throw new Error(`Loan ${loanId} was not found.`);
      // eslint-disable-next-line no-await-in-loop
      const loan = await libraryCirculationService.returnLoan(loanId, req.user?.id || 'SYSTEM', req.user);
      loans.push(loan);
    }
    return res.json({
      status: 'success',
      message: loans.length === 1 ? 'Return recorded.' : `${loans.length} returns recorded.`,
      loan: loans[0] || null,
      loans
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.apiRenew = async (req, res) => {
  try {
    getActiveOrgIdOrThrow(req.user);
    const loanId = String(req.body?.loanId || req.params?.loanId || '').trim();
    if (!loanId) throw new Error('Loan id is required.');
    const loan = await libraryCirculationService.renewLoan(loanId, req.user?.id || 'SYSTEM', req.user);
    return res.json({ status: 'success', message: 'Loan renewed.', loan });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.apiDigitalAccess = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const loanId = String(req.params?.loanId || '').trim();
    const personId = String(req.user?.personId || '').trim();

    let loan = null;
    if (loanId) {
      loan = await schoolDataService.getDataById('libraryLoans', loanId, req.user);
      if (!loan || !idsEqual(loan.orgId, orgId)) throw new Error('Loan not found.');
      if (personId && String(loan.personId) !== String(personId)) {
        throw new Error('You are not authorized to access this digital loan.');
      }
    } else {
      const bookId = String(req.query?.bookId || '').trim();
      if (!personId || !bookId) throw new Error('Book and person context are required.');
      loan = await libraryCirculationService.getActiveDigitalLoanForBook(orgId, personId, bookId, req.user);
      if (!loan) throw new Error('No active digital loan found for this book.');
    }

    if (!libraryCirculationService.isDigitalAccessValid(loan)) {
      throw new Error('Digital access has expired or the loan is not active.');
    }

    const policy = await libraryCirculationService.getEffectivePolicyForLoan(loan, req.user);
    if (!policy?.allowDigitalDownload) {
      throw new Error('Digital download is not allowed for this patron role.');
    }

    const book = await schoolDataService.getDataById('books', loan.bookId, req.user);
    if (!book?.digitalPdf) throw new Error('Digital PDF is not available for this book.');

    const pdfUrl = String(book.digitalPdf.url || book.digitalPdf.path || '').trim();
    if (!pdfUrl) throw new Error('Digital PDF URL is missing.');

    return res.json({
      status: 'success',
      loanId: loan.id,
      bookId: loan.bookId,
      url: pdfUrl,
      expiresAt: loan.digitalAccessExpiresAt || loan.dueAt
    });
  } catch (error) {
    return res.status(403).json({ status: 'error', message: error.message });
  }
};

exports.listOverdueLoans = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    await libraryCirculationService.markOverdueLoans(orgId, req.user);
    const rows = await schoolDataService.fetchAllData('libraryLoans', {}, req.user);
    let loans = (Array.isArray(rows) ? rows : []).filter((row) => (
      idsEqual(row.orgId, orgId) && String(row.status) === LOAN_STATUSES.OVERDUE
    ));
    loans = await enrichLoans(loans, req.user);
    if (isAjax(req)) return res.json({ status: 'success', results: loans });
    return res.render('school/library/overdueList', {
      title: 'Overdue Loans',
      data: loans,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

module.exports.COPY_TYPES = COPY_TYPES;
