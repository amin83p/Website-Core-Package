'use strict';

const schoolDataService = require('../../services/school/schoolDataService');
const libraryCirculationService = require('../../services/school/libraryCirculationService');
const schoolPersonAccessService = require('../../services/school/schoolPersonAccessService');
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

const LIBRARY_CARD_ROLE_PREFIX = Object.freeze({
  [PATRON_ROLES.STUDENT]: 'STU',
  [PATRON_ROLES.TEACHER]: 'TCH',
  [PATRON_ROLES.STAFF]: 'STF'
});

function assertOrgAccess(row, activeOrgId) {
  if (!row || !idsEqual(row.orgId, activeOrgId)) {
    throw new Error('<b>Security Violation</b><br>Unauthorized organization access.');
  }
}

async function listOrgPatrons(orgId, reqUser) {
  const rows = await schoolDataService.fetchAllData('libraryPatrons', {}, reqUser);
  return (Array.isArray(rows) ? rows : []).filter((row) => idsEqual(row.orgId, orgId));
}

function buildPolicyCatalog(policies = []) {
  return (Array.isArray(policies) ? policies : []).reduce((catalog, policy) => {
    catalog[String(policy.patronRole || '')] = policy;
    return catalog;
  }, {});
}

function cardToken(value, fallback = '') {
  const token = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(-8);
  return token || fallback;
}

function buildLibraryCardSuggestion({ patronRole, personId, roleRecordId, existingNumbers = [] } = {}) {
  const role = String(patronRole || PATRON_ROLES.STUDENT).trim().toLowerCase();
  const prefix = LIBRARY_CARD_ROLE_PREFIX[role] || 'LIB';
  const personToken = cardToken(personId, cardToken(roleRecordId, Date.now().toString(36).toUpperCase()));
  const base = `LIB-${prefix}-${personToken}`;
  const existing = new Set((Array.isArray(existingNumbers) ? existingNumbers : []).map((value) => String(value || '').toUpperCase()));
  if (!existing.has(base.toUpperCase())) return base;
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`.toUpperCase())) suffix += 1;
  return `${base}-${suffix}`;
}

async function buildSelectedPersonSummary(patron, reqUser) {
  if (!patron?.personId) return null;
  const role = String(patron.patronRole || '').trim().toLowerCase();
  const roleEntityType = role === PATRON_ROLES.TEACHER
    ? 'teachers'
    : (role === PATRON_ROLES.STAFF ? 'staff' : 'students');
  const rows = await schoolDataService.fetchAllData(roleEntityType, {}, reqUser);
  const roleRecord = (Array.isArray(rows) ? rows : []).find((row) => (
    String(row.id) === String(patron.roleRecordId || '')
    || String(row.personId) === String(patron.personId)
  ));
  const person = await schoolPersonAccessService.getPersonById({
    reqUser,
    personId: patron.personId,
    requireSchoolRole: false
  }).catch(() => null);
  const name = schoolPersonAccessService.formatPersonName(person, '')
    || roleRecord?.name
    || `${String(roleRecord?.firstName || '').trim()} ${String(roleRecord?.lastName || '').trim()}`.trim()
    || patron.personId;
  return {
    role,
    name,
    personId: patron.personId,
    recordId: roleRecord?.id || patron.roleRecordId || '',
    primaryCode: role === PATRON_ROLES.STUDENT
      ? (roleRecord?.customStudentId || roleRecord?.localId || '')
      : (roleRecord?.employeeNumber || ''),
    email: schoolPersonAccessService.readPersonEmail(person) || roleRecord?.email || '',
    status: roleRecord?.status || roleRecord?.studentStatus || roleRecord?.employmentStatus || ''
  };
}

async function buildPatronFormContext(orgId, reqUser, patron = null) {
  const policies = await libraryCirculationService.listOrgPolicies(orgId, reqUser);
  const patrons = await listOrgPatrons(orgId, reqUser);
  const existingNumbers = patrons
    .filter((row) => !patron?.id || String(row.id) !== String(patron.id))
    .map((row) => row.libraryCardNumber)
    .filter(Boolean);
  const suggestedLibraryCardNumber = patron?.libraryCardNumber || buildLibraryCardSuggestion({
    patronRole: patron?.patronRole || PATRON_ROLES.STUDENT,
    personId: patron?.personId,
    roleRecordId: patron?.roleRecordId,
    existingNumbers
  });
  return {
    policyCatalog: buildPolicyCatalog(policies),
    effectivePolicy: patron
      ? await libraryCirculationService.getEffectivePolicyForPatron(orgId, patron, reqUser)
      : null,
    suggestedLibraryCardNumber,
    existingLibraryCardNumbers: existingNumbers,
    selectedPersonSummary: patron ? await buildSelectedPersonSummary(patron, reqUser) : null
  };
}

async function enrichPatrons(patrons, orgId, reqUser) {
  const patronRows = Array.isArray(patrons) ? patrons : [];
  const personIds = patronRows.map((patron) => patron?.personId).filter(Boolean);
  const [loans, students, teachers, staff, personById] = await Promise.all([
    schoolDataService.fetchAllData('libraryLoans', {}, reqUser),
    schoolDataService.fetchAllData('students', {}, reqUser),
    schoolDataService.fetchAllData('teachers', {}, reqUser),
    schoolDataService.fetchAllData('staff', {}, reqUser),
    schoolPersonAccessService.buildPersonByIdMap({
      reqUser,
      personIds,
      requireSchoolRole: false
    }).catch(() => new Map())
  ]);
  const openLoans = (Array.isArray(loans) ? loans : []).filter((loan) => (
    idsEqual(loan.orgId, orgId) && OPEN_STATUSES.has(String(loan.status || '').toLowerCase())
  ));

  const roleRecordName = (row) => (
    String(row?.name || row?.displayName || row?.fullName || '').trim()
    || `${String(row?.firstName || '').trim()} ${String(row?.lastName || '').trim()}`.trim()
  );

  const personLabel = (personId, patronRole = '') => {
    const pid = String(personId || '').trim();
    const person = personById instanceof Map ? personById.get(pid) : null;
    const personName = schoolPersonAccessService.formatPersonName(person, '');
    if (personName) return personName;

    const student = (Array.isArray(students) ? students : []).find((row) => String(row.personId) === pid);
    if (student) return roleRecordName(student) || `Student ${student.localId || student.id || pid}`;
    const teacher = (Array.isArray(teachers) ? teachers : []).find((row) => String(row.personId) === pid);
    if (teacher) return roleRecordName(teacher) || `Teacher ${teacher.employeeNumber || teacher.id || pid}`;
    const staffRow = (Array.isArray(staff) ? staff : []).find((row) => String(row.personId) === pid);
    if (staffRow) return roleRecordName(staffRow) || `Staff ${staffRow.employeeNumber || staffRow.id || pid}`;
    return pid || String(patronRole || '').trim();
  };

  return patronRows.map((patron) => ({
    ...patron,
    displayName: personLabel(patron.personId, patron.patronRole),
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
    const orgId = await assertCreateOrgContextOrThrow(req.user, { scopeLabel: 'library patrons' });
    const formContext = await buildPatronFormContext(orgId, req.user);
    return res.render('school/library/patronForm', {
      title: 'Register Library Patron',
      patronItem: null,
      patronRoles: Object.values(PATRON_ROLES),
      patronStatuses: Object.values(PATRON_STATUSES),
      ...formContext,
      includeModal: true,
      includeGenericPicker: true,
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
    const formContext = await buildPatronFormContext(orgId, req.user, row);
    return res.render('school/library/patronForm', {
      title: 'Edit Library Patron',
      patronItem: row,
      patronRoles: Object.values(PATRON_ROLES),
      patronStatuses: Object.values(PATRON_STATUSES),
      ...formContext,
      includeModal: true,
      includeGenericPicker: false,
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

    const policyOverrideRecords = req.body?.policyOverrideRecords && typeof req.body.policyOverrideRecords === 'object'
      ? req.body.policyOverrideRecords
      : [];
    const existingPatrons = await listOrgPatrons(orgId, req.user);
    const existingNumbers = existingPatrons
      .filter((row) => !id || String(row.id) !== String(id))
      .map((row) => row.libraryCardNumber)
      .filter(Boolean);
    const existingForEdit = id
      ? existingPatrons.find((row) => String(row.id) === String(id))
      : null;
    if (id && !existingForEdit) throw new Error('Library patron not found.');
    const submittedPatronRole = String(req.body?.patronRole || '').trim();
    const patronRole = submittedPatronRole || existingForEdit?.patronRole || '';
    const submittedStatus = String(req.body?.status || '').trim();
    const status = submittedStatus || existingForEdit?.status || '';
    const personId = String(req.body?.personId || '').trim();
    const roleRecordId = String(req.body?.roleRecordId || '').trim();
    const effectivePersonId = personId || existingForEdit?.personId || '';
    const effectiveRoleRecordId = roleRecordId || existingForEdit?.roleRecordId || '';
    if (!effectivePersonId) {
      throw new Error(id
        ? 'This patron is missing a selected school person and cannot be saved.'
        : 'Select a student, teacher, or staff member before registering a patron.');
    }
    if (!patronRole) throw new Error('Patron role is required.');
    if (!status) throw new Error('Patron status is required.');
    const submittedLibraryCardNumber = String(req.body?.libraryCardNumber || '').trim();
    if (id && !submittedLibraryCardNumber) throw new Error('Library card number is required.');
    const libraryCardNumber = submittedLibraryCardNumber || buildLibraryCardSuggestion({
      patronRole,
      personId: effectivePersonId,
      roleRecordId: effectiveRoleRecordId,
      existingNumbers
    });
    if (!libraryCardNumber) throw new Error('Library card number is required.');

    const payload = {
      orgId,
      personId: effectivePersonId,
      patronRole,
      roleRecordId: effectiveRoleRecordId,
      status,
      validFrom: String(req.body?.validFrom || '').trim(),
      validTo: String(req.body?.validTo || '').trim(),
      libraryCardNumber,
      policyOverrideRecords,
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

exports.deletePatron = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const id = String(req.params?.id || '').trim();
    const existing = await schoolDataService.getDataById('libraryPatrons', id, req.user);
    if (!existing) throw new Error('Library patron not found.');
    assertOrgAccess(existing, orgId);

    const loans = await schoolDataService.fetchAllData('libraryLoans', {}, req.user);
    const patronLoans = (Array.isArray(loans) ? loans : []).filter((loan) => (
      idsEqual(loan.orgId, orgId) && String(loan.patronId || '') === String(id)
    ));
    if (patronLoans.length > 0) {
      throw new Error('This patron cannot be deleted because library circulation history exists.');
    }

    await schoolDataService.deleteData('libraryPatrons', id, req.user);
    const response = {
      status: 'success',
      message: 'Patron deleted successfully.',
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
