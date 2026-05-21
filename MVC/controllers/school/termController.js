const dataService = require('../../services/school/schoolDataService');
const paginate = require('../../utils/paginationHelper');
const { isAjax, buildDataServiceQuery, inferSearchableFields } = require('../../utils/generalTools');
const settingService = require('../../services/settingService');
const { TERM_STATUSES } = require('../../models/school/termModel');
const {
  getActiveOrgIdOrThrow: getActiveOrgIdOrThrowShared,
  assertCreateOrgContextOrThrow: assertCreateOrgContextOrThrowShared,
  canCreateOrgScopedItem,
  assertOrgAccess
} = require('../../utils/orgContextUtils');

function getActiveOrgIdOrThrow(reqUser) {
  return getActiveOrgIdOrThrowShared(reqUser);
}

async function assertCreateOrgContextOrThrow(reqUser) {
  return assertCreateOrgContextOrThrowShared(reqUser, { scopeLabel: 'terms' });
}

function assertTermOrgAccess(term, activeOrgId, reqUser) {
  assertOrgAccess(term, activeOrgId, reqUser, { orgField: 'orgId', allowSystemBypass: true });
}

function buildTermPayload(body, orgId) {
  return {
    orgId: String(orgId || '').trim(),
    code: String(body.code || '').trim().toUpperCase(),
    name: String(body.name || '').trim(),
    status: String(body.status || 'draft').trim().toLowerCase(),
    startDate: String(body.startDate || '').trim(),
    endDate: String(body.endDate || '').trim(),
    registrationOpenDate: String(body.registrationOpenDate || '').trim(),
    registrationCloseDate: String(body.registrationCloseDate || '').trim(),
    lateRegistrationDeadline: String(body.lateRegistrationDeadline || '').trim(),
    paymentDueDate: String(body.paymentDueDate || '').trim(),
    classesStartDate: String(body.classesStartDate || '').trim(),
    classesEndDate: String(body.classesEndDate || '').trim(),
    addDropDeadline: String(body.addDropDeadline || '').trim(),
    swapDeadline: String(body.swapDeadline || '').trim(),
    withdrawWithoutPenaltyDeadline: String(body.withdrawWithoutPenaltyDeadline || '').trim(),
    withdrawDeadline: String(body.withdrawDeadline || '').trim(),
    censusDate: String(body.censusDate || '').trim(),
    finalExamStartDate: String(body.finalExamStartDate || '').trim(),
    finalExamEndDate: String(body.finalExamEndDate || '').trim(),
    gradeSubmissionDeadline: String(body.gradeSubmissionDeadline || '').trim(),
    termResultReleaseDate: String(body.termResultReleaseDate || '').trim(),
    description: String(body.description || '').trim(),
    notes: String(body.notes || '').trim()
  };
}

async function listTerms(req, res) {
  try {
    let query = await buildDataServiceQuery(req.query);
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query = {};
    const canCreateTerms = await canCreateOrgScopedItem(req.user, { scopeLabel: 'terms' });
    const allTerms = await dataService.fetchData('terms', query, req.user);
    const searchableFields = await inferSearchableFields(allTerms, { exclude: ['audit'] });
    const { data, pagination } = paginate(allTerms, req.query.page, req.query.limit);

    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });

    res.render('school/term/termList', {
      title: 'Terms & Semesters',
      tableName: 'Term_Management',
      data,
      searchableFields,
      newUrl: 'school/terms',
      newLabel: canCreateTerms ? 'Add Term' : null,
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: true,
      print: true,
      pagination,
      filters: req.query,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', message: error.message });
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function renderTermFormView(req, res, viewName, titleOverride) {
  try {
    const isEdit = Boolean(req.params.id);
    let term = null;

    if (isEdit) {
      const activeOrgId = getActiveOrgIdOrThrow(req.user);
      term = await dataService.getDataById('terms', req.params.id, req.user);
      if (!term) throw new Error('Term not found.');
      assertTermOrgAccess(term, activeOrgId, req.user);
    } else {
      await assertCreateOrgContextOrThrow(req.user);
    }

    res.render(viewName, {
      title: titleOverride || (isEdit ? `Edit Term: ${term.code}` : 'New Term'),
      term,
      termStatuses: TERM_STATUSES,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function showForm(req, res) {
  return renderTermFormView(req, res, 'school/term/termForm');
}

async function showAddWizardForm(req, res) {
  return renderTermFormView(req, res, 'school/term/termWizardForm', 'Term Definition Wizard');
}

async function showEditWizardForm(req, res) {
  return renderTermFormView(req, res, 'school/term/termWizardForm', 'Term Definition Wizard');
}

async function saveTerm(req, res) {
  try {
    const id = String(req.params.id || '').trim();
    const activeOrgId = id ? getActiveOrgIdOrThrow(req.user) : await assertCreateOrgContextOrThrow(req.user);
    let existing = null;

    if (id) {
      existing = await dataService.getDataById('terms', id, req.user);
      if (!existing) throw new Error('Term not found.');
      assertTermOrgAccess(existing, activeOrgId, req.user);
    }

    const payload = buildTermPayload(req.body, existing?.orgId || activeOrgId);
    if (id) {
      await dataService.updateData('terms', id, payload, req.user);
    } else {
      await dataService.addData('terms', payload, req.user);
    }

    if (isAjax(req)) return res.json({ status: 'success', message: 'Term saved successfully.' });
    res.redirect('/school/terms');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function deleteTerm(req, res) {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const existing = await dataService.getDataById('terms', req.params.id, req.user);
    if (!existing) throw new Error('Term not found.');
    assertTermOrgAccess(existing, activeOrgId, req.user);
    await dataService.deleteData('terms', req.params.id, req.user);
    if (isAjax(req)) return res.json({ status: 'success', message: 'Term deleted successfully.' });
    res.redirect('/school/terms');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

module.exports = {
  listTerms,
  showForm,
  showAddWizardForm,
  showEditWizardForm,
  saveTerm,
  deleteTerm
};
