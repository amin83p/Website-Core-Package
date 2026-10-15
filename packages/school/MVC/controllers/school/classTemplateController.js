const schoolDataService = require('../../services/school/schoolDataService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { isAjax, buildDataServiceQuery, inferSearchableFields } = requireCoreModule('MVC/utils/generalTools');
const settingService = requireCoreModule('MVC/services/settingService');
const { resolveOrgTodayFromRequest } = requireCoreModule('MVC/utils/timezoneUtils');
const {
  getActiveOrgIdOrThrow,
  assertCreateOrgContextOrThrow,
  canCreateOrgScopedItem,
  assertOrgAccess
} = requireCoreModule('MVC/utils/orgContextUtils');
const {
  getFeeCategories,
  ALL_FEE_CATEGORIES_KEY,
  ALL_FEE_CATEGORIES_LABEL
} = require('../../models/school/feeCategoryCatalog');
const sessionStatusPolicyService = require('../../services/school/sessionStatusPolicyService');
const schoolAdminAccessService = require('../../services/school/schoolAdminAccessService');
const skillCatalogService = require('../../services/school/skillCatalogService');
const { respondSchoolDeleteError } = require('../../utils/schoolDeleteErrorResponse');
const { buildSnapshotFromClassFormBody } = require('../../services/school/classTemplateSnapshotService');

function assertTemplateOrgAccess(template, activeOrgId, reqUser) {
  assertOrgAccess(template, activeOrgId, reqUser, { orgField: 'orgId' });
}

async function getSessionStatusMetaForOrg(orgId) {
  const definitions = await sessionStatusPolicyService.getStatusDefinitions(orgId, { includeInactive: true });
  return sessionStatusPolicyService.buildClientStatusMeta(definitions);
}

function getActiveSessionStatusMeta(statusMeta = []) {
  return (Array.isArray(statusMeta) ? statusMeta : []).filter((row) => row && row.active !== false);
}

function getSelectableSessionStatusMeta(statusMeta = [], options = {}) {
  const allowAdminStatuses = options?.allowAdminStatuses === true;
  return sessionStatusPolicyService.filterSelectableStatusMeta(
    getActiveSessionStatusMeta(statusMeta),
    { allowAdminStatuses }
  );
}

async function getSessionStatusMetaBundleForUser(orgId, reqUser) {
  const sessionStatusMeta = await getSessionStatusMetaForOrg(orgId);
  const allowAdminStatuses = await schoolAdminAccessService.canSelectAdminSessionStatuses(reqUser);
  return {
    sessionStatusMeta,
    selectableSessionStatusMeta: getSelectableSessionStatusMeta(sessionStatusMeta, { allowAdminStatuses })
  };
}

function resolveDefaultSessionStatusCode(statusMeta = []) {
  const activeRows = getActiveSessionStatusMeta(statusMeta);
  if (!activeRows.length) return 'scheduled';
  const scheduled = activeRows.find((row) => row.code === 'scheduled');
  if (scheduled) return 'scheduled';
  return String(activeRows[0].code || 'scheduled');
}

async function loadClassFormSkillCatalog(activeOrgId, reqUser) {
  const catalog = await skillCatalogService.loadOrgSkillCatalog(activeOrgId, reqUser?.id || 'SYSTEM', {
    includeInactive: true,
    allowFallback: true
  });
  return catalog.filter((row) => row?.active !== false);
}

async function loadClassFormSharedContext(req) {
  const activeOrgId = getActiveOrgIdOrThrow(req.user);
  const subjects = await schoolDataService.fetchAllData('subjects', {}, req.user);
  const { sessionStatusMeta, selectableSessionStatusMeta } = await getSessionStatusMetaBundleForUser(activeOrgId, req.user);
  const skillCatalog = await loadClassFormSkillCatalog(activeOrgId, req.user);
  const subjectFeeCatalog = subjects.map((subject) => ({
    id: String(subject.id || ''),
    code: String(subject.code || '').trim(),
    title: String(subject.title || '').trim(),
    credits: subject?.configuration?.credits,
    feeRules: Array.isArray(subject.feeRules) ? subject.feeRules : []
  }));
  return {
    activeOrgId,
    sessionStatusMeta,
    selectableSessionStatusMeta,
    skillCatalog,
    subjectFeeCatalog
  };
}

async function listClassTemplates(req, res) {
  try {
    let query = await buildDataServiceQuery(req.query);
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query.q = '';
    const canCreate = await canCreateOrgScopedItem(req.user, { scopeLabel: 'classTemplates' });
    const paged = await schoolDataService.fetchDataPaged('classTemplates', query, req.user);
    const searchableFields = await inferSearchableFields(paged.rows, { exclude: ['audit', 'snapshot'] });

    if (isAjax(req)) {
      return res.json({ status: 'success', results: paged.rows, pagination: paged.pagination });
    }

    res.render('school/class/classTemplateList', {
      title: 'Class Definition Templates',
      tableName: 'Class_Templates_List',
      data: paged.rows,
      searchableFields,
      newUrl: 'school/class-templates',
      newLabel: canCreate ? 'New Template' : null,
      includeModal: true,
      includeModal_Table: true,
      print: true,
      pagination: paged.pagination,
      filters: req.query,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', message: error.message });
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

function mapTemplateToFormData(template) {
  const snapshot = template?.snapshot && typeof template.snapshot === 'object' ? template.snapshot : {};
  return {
    ...snapshot,
    title: String(template?.titlePattern || '').trim(),
    status: String(snapshot?.status || 'active').trim()
  };
}

async function renderTemplateForm(req, res, { isEdit }) {
  try {
    await assertCreateOrgContextOrThrow(req.user);
    const ctx = await loadClassFormSharedContext(req);
    let templateData = null;
    if (isEdit) {
      const activeOrgId = getActiveOrgIdOrThrow(req.user);
      templateData = await schoolDataService.getDataById('classTemplates', req.params.id, req.user);
      if (!templateData) throw new Error('Class template not found.');
      assertTemplateOrgAccess(templateData, activeOrgId, req.user);
    }

    res.render('school/class/classTemplateForm', {
      title: isEdit ? 'Edit Class Template' : 'New Class Template',
      templateData,
      classData: templateData ? mapTemplateToFormData(templateData) : null,
      templateMode: true,
      includeModal: true,
      user: req.user,
      orgToday: resolveOrgTodayFromRequest(req),
      lifecycleContext: {},
      feeCategories: getFeeCategories({ includeAll: false }),
      allFeeCategoryKey: ALL_FEE_CATEGORIES_KEY,
      allFeeCategoryLabel: ALL_FEE_CATEGORIES_LABEL,
      sessionStatusMeta: ctx.sessionStatusMeta,
      selectableSessionStatusMeta: ctx.selectableSessionStatusMeta,
      defaultSessionStatusCode: resolveDefaultSessionStatusCode(ctx.sessionStatusMeta),
      skillCatalog: ctx.skillCatalog,
      subjectFeeCatalog: ctx.subjectFeeCatalog,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function showAddForm(req, res) {
  return renderTemplateForm(req, res, { isEdit: false });
}

async function showEditForm(req, res) {
  return renderTemplateForm(req, res, { isEdit: true });
}

async function saveTemplate(req, res, { isEdit }) {
  try {
    const activeOrgId = await assertCreateOrgContextOrThrow(req.user);
    const snapshot = buildSnapshotFromClassFormBody(req.body);
    const payload = {
      orgId: activeOrgId,
      code: String(req.body.code || '').trim(),
      name: String(req.body.name || '').trim(),
      titlePattern: String(req.body.title || req.body.titlePattern || '').trim(),
      status: String(req.body.templateStatus || 'draft').trim().toLowerCase(),
      snapshot,
      audit: {
        lastUpdateUser: req.user?.id,
        lastUpdateDateTime: new Date().toISOString()
      }
    };

    let saved;
    if (isEdit) {
      const existing = await schoolDataService.getDataById('classTemplates', req.params.id, req.user);
      if (!existing) throw new Error('Class template not found.');
      assertTemplateOrgAccess(existing, activeOrgId, req.user);
      payload.audit = {
        ...(existing.audit || {}),
        lastUpdateUser: req.user?.id,
        lastUpdateDateTime: new Date().toISOString()
      };
      saved = await schoolDataService.updateData('classTemplates', req.params.id, payload, req.user);
    } else {
      payload.audit.createUser = req.user?.id;
      payload.audit.createDateTime = new Date().toISOString();
      saved = await schoolDataService.addData('classTemplates', payload, req.user);
    }

    if (isAjax(req)) {
      return res.json({ status: 'success', message: 'Class template saved.', template: saved });
    }
    return res.redirect('/school/class-templates');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function addTemplate(req, res) {
  return saveTemplate(req, res, { isEdit: false });
}

async function editTemplate(req, res) {
  return saveTemplate(req, res, { isEdit: true });
}

async function deleteTemplate(req, res) {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const existing = await schoolDataService.getDataById('classTemplates', req.params.id, req.user);
    if (!existing) throw new Error('Class template not found.');
    assertTemplateOrgAccess(existing, activeOrgId, req.user);
    await schoolDataService.deleteData('classTemplates', req.params.id, req.user);
    if (isAjax(req)) return res.json({ status: 'success', message: 'Class template deleted.' });
    return res.redirect('/school/class-templates');
  } catch (error) {
    return respondSchoolDeleteError(req, res, error);
  }
}

module.exports = {
  listClassTemplates,
  showAddForm,
  showEditForm,
  addTemplate,
  editTemplate,
  deleteTemplate,
  mapTemplateToFormData
};
