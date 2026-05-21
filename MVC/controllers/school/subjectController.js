// MVC/controllers/school/subjectController.js
const dataService = require('../../services/school/schoolDataService');const { idsEqual } = require('../../utils/idAdapter');

const dataService1 = require('../../services/dataService');
const {isAjax, buildDataServiceQuery, inferSearchableFields} = require('../../utils/generalTools');
const settingService = require('../../services/settingService'); // ✅ Use Dynamic Service
const paginate = require('../../utils/paginationHelper');
const {
  FEE_CATEGORIES,
  ALL_FEE_CATEGORIES_KEY,
  ALL_FEE_CATEGORIES_LABEL
} = require('../../models/school/feeCategoryCatalog');
const {
  getActiveOrgIdOrThrow,
  assertCreateOrgContextOrThrow,
  canCreateOrgScopedItem,
  assertOrgAccess
} = require('../../utils/orgContextUtils');

// Helpers
function parseData(input) {
  try { return JSON.parse(input); } catch { return null; }
}

function assertSubjectOrgAccess(subject, activeOrgId, reqUser) {
  assertOrgAccess(subject, activeOrgId, reqUser, { orgField: 'orgId' });
}

function buildSubjectFromBody(body, reqUserId, activeOrgId) {
  const now = new Date().toISOString();

  // Parsing complex nested objects
  const academicUnit = parseData(body.academicUnit) || {};
  const configuration = parseData(body.configuration) || {};
  const prerequisites = parseData(body.prerequisites) || [];
  const attachments = parseData(body.attachments) || [];
  const feeRules = parseData(body.feeRules) || [];
  const defaultScoreRules = parseData(body.defaultScoreRules) || {};

  return {
    orgId: String(activeOrgId || '').trim(),
    code: (body.code || '').trim(),
    title: (body.title || '').trim(),
    status: (body.status || 'draft'),
    description: (body.description || '').trim(),
    
    academicUnit,
    configuration,
    prerequisites,
    attachments,
    feeRules,
    defaultScoreRules,

    audit: {
      lastUpdateUser: reqUserId,
      lastUpdateDateTime: now
    }
  };
}

async function listSubjects(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query);
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if(query.q === searchDefaultKeyword) query.q='';
    const canCreateSubjects = await canCreateOrgScopedItem(req.user, { scopeLabel: 'subjects' });
    // Note: You must add 'subjects' case to dataService.js
    const subjects = await dataService.fetchData('subjects', query, req.user);
    const orgs = await dataService1.fetchData('organizations', {}, req.user);
    
    const searchableFields = await inferSearchableFields(subjects, { exclude: ['audit', 'attachments'] });

    // Join Org Name for display
    const enriched = subjects.map(s => {
        const org = orgs.find(o => idsEqual(o.id, s.orgId));
        return { ...s, orgName: org ? org.identity.displayName : `Unknown Org (#${s.orgId})` };
    });

    const { data, pagination } = paginate(enriched, req.query.page, req.query.limit);

    if (isAjax(req)) {
      return res.json({ status: 'success', results:data, pagination });
    }

    res.render('school/subject/subjects', {
      title: 'Subject Management',
      tableName: 'Subjects_Management',
      data,searchableFields,
      newUrl: 'school/subjects',
      newLabel: canCreateSubjects ? 'Add Subject' : null,
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
    if (isAjax(req)) return res.status(500).json({ status: 'error', error, message: error.message });
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
}

async function showAddForm(req, res) {
  return renderSubjectFormView(req, res, 'school/subject/subjectForm', 'Add Subject');
}

async function showAddWizardForm(req, res) {
  return renderSubjectFormView(req, res, 'school/subject/subjectWizardForm', 'Subject Definition Wizard');
}

async function showEditForm(req, res) {
  return renderSubjectFormView(req, res, 'school/subject/subjectForm', 'Edit Subject');
}

async function showEditWizardForm(req, res) {
  return renderSubjectFormView(req, res, 'school/subject/subjectWizardForm', 'Subject Definition Wizard');
}

async function renderSubjectFormView(req, res, viewName, title) {
  try {
    const isEdit = Boolean(req.params.id);
    let subject = null;

    if (isEdit) {
      const activeOrgId = getActiveOrgIdOrThrow(req.user);
      subject = await dataService.getDataById('subjects', req.params.id, req.user);
      if (!subject) return res.status(404).render('404', { title: 'Not Found', user: req.user });
      assertSubjectOrgAccess(subject, activeOrgId, req.user);
    } else {
      await assertCreateOrgContextOrThrow(req.user, { scopeLabel: 'subjects' });
    }

    res.render(viewName, {
      title,
      subject: subject || null,
      feeCategories: FEE_CATEGORIES,
      allFeeCategoryKey: ALL_FEE_CATEGORIES_KEY,
      allFeeCategoryLabel: ALL_FEE_CATEGORIES_LABEL,
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
}

async function addSubject(req, res) {
  try {
    const activeOrgId = await assertCreateOrgContextOrThrow(req.user, { scopeLabel: 'subjects' });
    const item = buildSubjectFromBody(req.body, req.user?.id, activeOrgId);
    
    // Explicitly set create audit on new
    item.audit.createUser = req.user?.id;
    item.audit.createDateTime = new Date().toISOString();

    await dataService.addData('subjects', item, req.user);

    if (isAjax(req)) {
      return res.json({ status: 'success', message: 'Subject and workspace created successfully.' });
    }
    res.redirect('/school/subjects');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
}

async function editSubject(req, res) {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const existing = await dataService.getDataById('subjects', req.params.id, req.user);
    if (!existing) throw new Error('Subject not found');
    assertSubjectOrgAccess(existing, activeOrgId, req.user);

    const updates = buildSubjectFromBody(req.body, req.user?.id, existing?.orgId || activeOrgId);
    
    // Preserve creation audit and original code/ID mappings
    updates.audit.createUser = existing.audit.createUser;
    updates.audit.createDateTime = existing.audit.createDateTime;

    await dataService.updateData('subjects', req.params.id, updates, req.user);

    if (isAjax(req)) return res.json({ status: 'success', message: 'Subject updated.' });
    res.redirect('/school/subjects');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
}

async function deleteSubject(req, res) {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const existing = await dataService.getDataById('subjects', req.params.id, req.user);
    if (!existing) throw new Error('Subject not found');
    assertSubjectOrgAccess(existing, activeOrgId, req.user);

    await dataService.deleteData('subjects', req.params.id, req.user);
    if (isAjax(req)) return res.json({ status: 'success', message: 'Subject deleted.' });
    res.redirect('/school/subjects');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
}

module.exports = {
  listSubjects,
  showAddForm,
  showAddWizardForm,
  addSubject,
  showEditForm,
  showEditWizardForm,
  editSubject,
  deleteSubject
};


