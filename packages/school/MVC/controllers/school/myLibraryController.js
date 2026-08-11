'use strict';

const schoolDataService = require('../../services/school/schoolDataService');
const libraryCirculationService = require('../../services/school/libraryCirculationService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { getActiveOrgIdOrThrow } = requireCoreModule('MVC/utils/orgContextUtils');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const { COPY_TYPES } = require('../../models/school/libraryCopyModel');

async function enrichMyLoans(loans, reqUser) {
  const output = [];
  for (const loan of loans) {
    const book = await schoolDataService.getDataById('books', loan.bookId, reqUser);
    const copy = await schoolDataService.getDataById('libraryCopies', loan.copyId, reqUser);
    output.push({
      ...loan,
      bookTitle: book?.title || '',
      copyCode: copy?.copyCode || '',
      hasDigitalAccess: libraryCirculationService.isDigitalAccessValid(loan),
      digitalPdfUrl: book?.digitalPdf?.url || book?.digitalPdf?.path || ''
    });
  }
  return output;
}

exports.showMyLibrary = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const personId = String(req.user?.personId || '').trim();
    if (!personId) {
      throw new Error('Your account is not linked to a school person profile. Contact an administrator.');
    }

    await libraryCirculationService.markOverdueLoans(orgId, req.user);
    const loans = await libraryCirculationService.listOpenLoansForPerson(orgId, personId, req.user);
    const enriched = await enrichMyLoans(loans, req.user);

    return res.render('school/library/myLibrary', {
      title: 'My Library',
      loans: enriched,
      personId,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.apiMyLoans = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const personId = String(req.user?.personId || '').trim();
    if (!personId) throw new Error('Person profile is required.');
    await libraryCirculationService.markOverdueLoans(orgId, req.user);
    const loans = await libraryCirculationService.listOpenLoansForPerson(orgId, personId, req.user);
    const enriched = await enrichMyLoans(loans, req.user);
    return res.json({ status: 'success', results: enriched });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.apiOpenDigital = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const personId = String(req.user?.personId || '').trim();
    const loanId = String(req.params?.loanId || '').trim();
    if (!personId) throw new Error('Person profile is required.');

    const loan = await schoolDataService.getDataById('libraryLoans', loanId, req.user);
    if (!loan || !idsEqual(loan.orgId, orgId) || String(loan.personId) !== personId) {
      throw new Error('Loan not found.');
    }
    if (String(loan.copyType) !== COPY_TYPES.DIGITAL) {
      throw new Error('This loan is not a digital loan.');
    }
    if (!libraryCirculationService.isDigitalAccessValid(loan)) {
      throw new Error('Digital access has expired.');
    }

    const policy = await libraryCirculationService.getEffectivePolicyForLoan(loan, req.user);
    if (!policy?.allowDigitalDownload) {
      throw new Error('Digital download is not allowed for your patron role.');
    }

    const book = await schoolDataService.getDataById('books', loan.bookId, req.user);
    const url = String(book?.digitalPdf?.url || book?.digitalPdf?.path || '').trim();
    if (!url) throw new Error('Digital PDF is not available.');

    return res.json({
      status: 'success',
      url,
      expiresAt: loan.digitalAccessExpiresAt || loan.dueAt
    });
  } catch (error) {
    return res.status(403).json({ status: 'error', message: error.message });
  }
};
