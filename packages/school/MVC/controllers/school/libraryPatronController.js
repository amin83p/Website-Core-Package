'use strict';

const schoolDataService = require('../../services/school/schoolDataService');
const libraryCirculationService = require('../../services/school/libraryCirculationService');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const { isAjax, buildDataServiceQuery } = requireCoreModule('MVC/utils/generalTools');
const { applyGenericFilter } = requireCoreModule('MVC/utils/queryEngine');
const settingService = requireCoreModule('MVC/services/settingService');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const {
  getActiveOrgIdOrThrow,
  assertCreateOrgContextOrThrow,
  canCreateOrgScopedItem
} = requireCoreModule('MVC/utils/orgContextUtils');
const { PATRON_STATUSES, PATRON_ROLES } = require('../../models/school/libraryPatronModel');
const { OPEN_STATUSES } = require('../../models/school/libraryLoanModel');

function assertOrgAccess(row, activeOrgId) {
  if (!row || !idsEqual(row.orgId, activeOrgId)) {
    throw new Error('<b>Security Violation</b><br>Unauthorized organization access.');
  }
}

async function listOrgPatrons(orgId, reqUser) {
  const rows = await schoolDataService.fetchAllData('libraryPatrons', {}, reqUser);
  return (Array.isArray(rows) ? rows : []).filter((row) => idsEqual(row.orgId, orgId));
}

async function enrichPatrons(patrons, orgId, reqUser) {
  const loans = await schoolDataService.fetchAllData('libraryLoans', {}, reqUser);
  const openLoans = (Array.isArray(loans) ? loans : []).filter((loan) => (
    idsEqual(loan.orgId, orgId) && OPEN_STATUSES.has(String(loan.status || '').toLowerCase())
  ));
  const students = await schoolDataService.fetchAllData('students', {}, reqUser);
  const teachers = await schoolDataService.fetchAllData('teachers', {}, reqUser);
  const staff = await schoolDataService.fetchAllData('staff', {}, reqUser);

  const personLabel = (personId) => {
    const pid = String(personId || '');
    const student = (Array.isArray(students) ? students : []).find((row) => String(row.personId) === pid);
    if (student) return `Student ${student.localId || student.id || pid}`;
    const teacher = (Array.isArray(teachers) ? teachers : []).find((row) => String(row.personId) === pid);
    if (teacher) return `Teacher ${teacher.employeeNumber || teacher.id || pid}`;
    const staffRow = (Array.isArray(staff) ? staff : []).find((row) => String(row.personId) === pid);
    if (staffRow) return `Staff ${staffRow.employeeNumber || staffRow.id || pid}`;
    return pid;
  };

  return patrons.map((patron) => ({
    ...patron,
    displayName: personLabel(patron.personId),
    activeLoanCount: openLoans.filter((loan) => String(loan.patronId) === String(patron.id)).length
  }));
}

exports.listPatrons = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const canCreate = await canCreateOrgScopedItem(req.user, { scopeLabel: 'library patrons' });
    const query = await buildDataServiceQuery(req.query, { allowedExactKeys: null });
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query.q = '';

    let rows = await listOrgPatrons(orgId, req.user);
    rows = await enrichPatrons(rows, orgId, req.user);
    rows = rows.sort((a, b) => String(a.displayName || '').localeCompare(String(b.displayName || '')));

    const searchableFields = ['displayName', 'personId', 'libraryCardNumber', 'patronRole', 'status'];
    rows = applyGenericFilter(rows, query, { defaultSearchFields: searchableFields });
    const { data, pagination } = paginate(rows, query.page, query.limit);

    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });
    return res.render('school/library/patronList', {
      title: 'Library Patrons',
      tableName: 'School_Library_Patrons',
      data,
      canCreate,
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

exports.showCreateForm = async (req, res) => {
  try {
    await assertCreateOrgContextOrThrow(req.user, { scopeLabel: 'library patrons' });
    return res.render('school/library/patronForm', {
      title: 'Register Library Patron',
      patronItem: null,
      patronRoles: Object.values(PATRON_ROLES),
      patronStatuses: Object.values(PATRON_STATUSES),
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.showEditForm = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const row = await schoolDataService.getDataById('libraryPatrons', req.params.id, req.user);
    if (!row) throw new Error('Library patron not found.');
    assertOrgAccess(row, orgId);
    return res.render('school/library/patronForm', {
      title: 'Edit Library Patron',
      patronItem: row,
      patronRoles: Object.values(PATRON_ROLES),
      patronStatuses: Object.values(PATRON_STATUSES),
      includeModal: false,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.savePatron = async (req, res) => {
  try {
    const id = String(req.params?.id || '').trim();
    const orgId = id
      ? getActiveOrgIdOrThrow(req.user)
      : await assertCreateOrgContextOrThrow(req.user, { scopeLabel: 'library patrons' });
    const userId = req.user?.id || 'SYSTEM';

    const payload = {
      orgId,
      personId: String(req.body?.personId || '').trim(),
      patronRole: String(req.body?.patronRole || 'student').trim(),
      roleRecordId: String(req.body?.roleRecordId || '').trim(),
      status: String(req.body?.status || PATRON_STATUSES.ACTIVE).trim(),
      libraryCardNumber: String(req.body?.libraryCardNumber || '').trim(),
      maxConcurrentLoans: req.body?.maxConcurrentLoans,
      notes: String(req.body?.notes || '').trim(),
      audit: { createUser: userId, lastUpdateUser: userId }
    };

    if (id) {
      const existing = await schoolDataService.getDataById('libraryPatrons', id, req.user);
      if (!existing) throw new Error('Library patron not found.');
      assertOrgAccess(existing, orgId);
      await schoolDataService.updateData('libraryPatrons', id, payload, req.user);
    } else {
      await schoolDataService.addData('libraryPatrons', payload, req.user);
    }

    const response = {
      status: 'success',
      message: id ? 'Patron updated successfully.' : 'Patron registered successfully.',
      redirectTo: '/school/library/patrons'
    };
    if (isAjax(req)) return res.json(response);
    return res.redirect('/school/library/patrons');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.apiResolvePatron = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const personId = String(req.body?.personId || '').trim();
    const patronRole = String(req.body?.patronRole || 'student').trim();
    const roleRecordId = String(req.body?.roleRecordId || '').trim();
    if (!personId) throw new Error('Person is required.');
    const patron = await libraryCirculationService.resolveOrCreatePatron(orgId, {
      personId,
      patronRole,
      roleRecordId,
      userId: req.user?.id || 'SYSTEM'
    }, req.user);
    return res.json({ status: 'success', patron });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};
