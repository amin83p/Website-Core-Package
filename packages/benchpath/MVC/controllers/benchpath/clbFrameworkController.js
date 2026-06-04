const { requireCoreModule } = require('../../services/benchpath/benchpathCoreModuleResolver');
const benchpathDataService = require('../../services/benchpath/benchpathDataService');
const { isAjax, buildDataServiceQuery } = requireCoreModule('MVC/utils/generalTools');

const DEFAULT_SEARCH_FIELDS = ['id', 'slug', 'code', 'title', 'frameworkType', 'language', 'status', 'reviewStatus'];

function toPayload(body = {}) {
  const hasIsActive = Object.prototype.hasOwnProperty.call(body, 'isActive');
  const hasIsSystem = Object.prototype.hasOwnProperty.call(body, 'isSystem');
  const hasIsLocked = Object.prototype.hasOwnProperty.call(body, 'isLocked');
  return {
    id: body.id,
    slug: body.slug,
    code: body.code,
    title: body.title,
    shortTitle: body.shortTitle,
    edition: body.edition,
    versionLabel: body.versionLabel,
    frameworkType: body.frameworkType,
    publisher: body.publisher,
    authors: body.authors,
    language: body.language,
    country: body.country,
    description: body.description,
    purpose: body.purpose,
    notIntendedAs: body.notIntendedAs,
    stageIds: body.stageIds,
    skillIds: body.skillIds,
    globalNotes: body.globalNotes,
    frameworkFeatures: body.frameworkFeatures,
    supportedBenchmarks: body.supportedBenchmarks,
    sourceRefs: body.sourceRefs,
    tags: body.tags,
    status: body.status,
    reviewStatus: body.reviewStatus,
    isActive: hasIsActive ? body.isActive : false,
    isSystem: hasIsSystem ? body.isSystem : false,
    isLocked: hasIsLocked ? body.isLocked : false,
    notes: body.notes,
    approvedBy: body.approvedBy,
    approvedAt: body.approvedAt,
    updatedBy: body.updatedBy,
    version: body.version
  };
}

async function listFrameworks(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, {
      allowedExactKeys: ['id', 'code', 'frameworkType', 'language', 'status', 'reviewStatus'],
      defaultSearchFields: DEFAULT_SEARCH_FIELDS,
      allowedSearchFields: DEFAULT_SEARCH_FIELDS
    });
    const paged = await benchpathDataService.fetchDataPaged('clbFrameworks', query, req.user);
    const data = Array.isArray(paged?.rows) ? paged.rows : [];
    const pagination = paged?.pagination || null;
    const searchableFields = DEFAULT_SEARCH_FIELDS;

    if (isAjax(req)) return res.json({ status: 'success', data, pagination, searchableFields });

    res.render('benchpath/clbFramework/frameworks', {
      title: 'CLB Framework',
      data,
      searchableFields,
      newUrl: 'benchpath/clb-framework',
      newLabel: 'New Framework',
      tableName: 'BenchPath_CLB_Framework',
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: false,
      print: true,
      pagination,
      filters: req.query,
      user: req.user || null,
      actionStateId: req?.actionStateId || ''
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', message: error.message });
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function renderForm(req, res, frameworkData = null, title = 'Create CLB Framework') {
  const [sources, fragments, meta] = await Promise.all([
    benchpathDataService.fetchData('sources', {}, req.user),
    benchpathDataService.fetchData('sourceFragments', {}, req.user),
    Promise.resolve(benchpathDataService.getFrameworkFormMeta())
  ]);

  res.render('benchpath/clbFramework/frameworkForm', {
    title,
    frameworkData,
    includeModal: true,
    frameworkTypeOptions: meta.frameworkTypeOptions,
    languageOptions: meta.languageOptions,
    purposeOptions: meta.purposeOptions,
    notIntendedOptions: meta.notIntendedOptions,
    frameworkFeatureOptions: meta.frameworkFeatureOptions,
    statusOptions: meta.statusOptions,
    reviewStatusOptions: meta.reviewStatusOptions,
    sources,
    fragments,
    user: req.user || null,
    actionStateId: req?.actionStateId || ''
  });
}

async function showAddForm(req, res) {
  try {
    await renderForm(req, res, null, 'Create CLB Framework');
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function addFramework(req, res) {
  try {
    const payload = toPayload(req.body);
    await benchpathDataService.addData('clbFrameworks', payload, req.user);
    if (isAjax(req)) return res.json({ status: 'success', message: 'Framework created successfully.' });
    res.redirect('/benchpath/clb-framework');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function showEditForm(req, res) {
  try {
    const frameworkData = await benchpathDataService.getDataById('clbFrameworks', req.params.id, req.user);
    if (!frameworkData) {
      return res.status(404).render('404', { user: req.user || null });
    }
    await renderForm(req, res, frameworkData, 'Edit CLB Framework');
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function editFramework(req, res) {
  try {
    const existing = await benchpathDataService.getDataById('clbFrameworks', req.params.id, req.user);
    if (!existing) throw new Error('Framework not found or outside organization scope.');
    const payload = toPayload(req.body);
    await benchpathDataService.updateData('clbFrameworks', req.params.id, payload, req.user);
    if (isAjax(req)) return res.json({ status: 'success', message: 'Framework updated successfully.' });
    res.redirect('/benchpath/clb-framework');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function deleteFramework(req, res) {
  try {
    const existing = await benchpathDataService.getDataById('clbFrameworks', req.params.id, req.user);
    if (!existing) throw new Error('Framework not found or outside organization scope.');
    await benchpathDataService.deleteData('clbFrameworks', req.params.id, req.user);
    if (isAjax(req)) return res.json({ status: 'success', message: 'Framework deleted successfully.' });
    res.redirect('/benchpath/clb-framework');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

module.exports = {
  listFrameworks,
  showAddForm,
  addFramework,
  showEditForm,
  editFramework,
  deleteFramework
};
