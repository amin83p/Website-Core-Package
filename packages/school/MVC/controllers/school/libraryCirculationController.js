'use strict';

const schoolDataService = require('../../services/school/schoolDataService');
const libraryCirculationService = require('../../services/school/libraryCirculationService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const { isAjax, buildDataServiceQuery } = requireCoreModule('MVC/utils/generalTools');
const { applyGenericFilter } = requireCoreModule('MVC/utils/queryEngine');
const settingService = requireCoreModule('MVC/services/settingService');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const { getActiveOrgIdOrThrow } = requireCoreModule('MVC/utils/orgContextUtils');
const { OPEN_STATUSES, LOAN_STATUSES } = require('../../models/school/libraryLoanModel');
const { COPY_TYPES } = require('../../models/school/libraryCopyModel');

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
    copyCode: copyMap.get(loan.copyId)?.copyCode || '',
    patronPersonId: patronMap.get(loan.patronId)?.personId || loan.personId
  }));
}

exports.showCirculationDesk = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    await libraryCirculationService.markOverdueLoans(orgId, req.user);
    return res.render('school/library/circulationDesk', {
      title: 'Circulation Desk',
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
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
    const copyId = String(req.body?.copyId || '').trim();
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
    if (!resolvedPatronId || !copyId) throw new Error('Patron and copy are required for checkout.');

    const loan = await libraryCirculationService.checkout({
      orgId,
      patronId: resolvedPatronId,
      copyId,
      staffUserId,
      notes
    }, req.user);

    return res.json({ status: 'success', message: 'Checkout completed.', loan });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.apiReturn = async (req, res) => {
  try {
    getActiveOrgIdOrThrow(req.user);
    const loanId = String(req.body?.loanId || req.params?.loanId || '').trim();
    if (!loanId) throw new Error('Loan id is required.');
    const loan = await libraryCirculationService.returnLoan(loanId, req.user?.id || 'SYSTEM', req.user);
    return res.json({ status: 'success', message: 'Return recorded.', loan });
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

    const policy = await libraryCirculationService.getPolicyForRole(orgId, loan.patronRole, req.user);
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
