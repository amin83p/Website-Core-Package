const benchpathDataService = require('../../services/benchpath/benchpathDataService');
const { isAjax, buildDataServiceQuery } = require('../../utils/generalTools');

const DEFAULT_SEARCH_FIELDS = ['id', 'slug', 'code', 'label', 'frameworkId', 'status', 'reviewStatus'];

function toPayload(body = {}) {
  const hasIsActive = Object.prototype.hasOwnProperty.call(body, 'isActive');
  const hasIsSystem = Object.prototype.hasOwnProperty.call(body, 'isSystem');
  const hasIsLocked = Object.prototype.hasOwnProperty.call(body, 'isLocked');
  return {
    id: body.id,
    slug: body.slug,
    code: body.code,
    label: body.label,
    shortLabel: body.shortLabel,
    frameworkId: body.frameworkId,
    benchmarkRange: JSON.stringify({
      minimum: Number.parseInt(String(body.benchmarkMin || '').trim(), 10),
      maximum: Number.parseInt(String(body.benchmarkMax || '').trim(), 10)
    }),
    descriptor: body.descriptor,
    description: body.description,
    displayOrder: body.displayOrder,
    status: body.status,
    reviewStatus: body.reviewStatus,
    isActive: hasIsActive ? body.isActive : false,
    isSystem: hasIsSystem ? body.isSystem : false,
    isLocked: hasIsLocked ? body.isLocked : false,
    tags: body.tags,
    notes: body.notes,
    approvedBy: body.approvedBy,
    approvedAt: body.approvedAt,
    updatedBy: body.updatedBy,
    version: body.version
  };
}

async function listStages(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, {
      allowedExactKeys: ['id', 'frameworkId', 'status', 'reviewStatus', 'code'],
      defaultSearchFields: DEFAULT_SEARCH_FIELDS,
      allowedSearchFields: DEFAULT_SEARCH_FIELDS
    });
    const paged = await benchpathDataService.fetchDataPaged('clbStages', query, req.user);
    const data = Array.isArray(paged?.rows) ? paged.rows : [];
    const pagination = paged?.pagination || null;
    const searchableFields = DEFAULT_SEARCH_FIELDS;

    if (isAjax(req)) return res.json({ status: 'success', data, pagination, searchableFields });

    res.render('benchpath/clbStage/stages', {
      title: 'CLB Stages',
      data,
      searchableFields,
      newUrl: 'benchpath/clb-stages',
      newLabel: 'New Stage',
      tableName: 'BenchPath_CLB_Stages',
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

async function renderForm(req, res, stageData = null, title = 'Create CLB Stage') {
  const [frameworks, meta] = await Promise.all([
    benchpathDataService.fetchData('clbFrameworks', {}, req.user),
    Promise.resolve(benchpathDataService.getStageFormMeta())
  ]);
  res.render('benchpath/clbStage/stageForm', {
    title,
    stageData,
    includeModal: true,
    frameworks,
    statusOptions: meta.statusOptions,
    reviewStatusOptions: meta.reviewStatusOptions,
    descriptorOptions: meta.descriptorOptions,
    user: req.user || null,
    actionStateId: req?.actionStateId || ''
  });
}

async function showAddForm(req, res) {
  try {
    await renderForm(req, res, null, 'Create CLB Stage');
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function addStage(req, res) {
  try {
    const payload = toPayload(req.body);
    await benchpathDataService.addData('clbStages', payload, req.user);
    if (isAjax(req)) return res.json({ status: 'success', message: 'Stage created successfully.' });
    res.redirect('/benchpath/clb-stages');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function showEditForm(req, res) {
  try {
    const stageData = await benchpathDataService.getDataById('clbStages', req.params.id, req.user);
    if (!stageData) {
      return res.status(404).render('404', { user: req.user || null });
    }
    await renderForm(req, res, stageData, 'Edit CLB Stage');
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function editStage(req, res) {
  try {
    const existing = await benchpathDataService.getDataById('clbStages', req.params.id, req.user);
    if (!existing) throw new Error('Stage not found or outside organization scope.');
    const payload = toPayload(req.body);
    await benchpathDataService.updateData('clbStages', req.params.id, payload, req.user);
    if (isAjax(req)) return res.json({ status: 'success', message: 'Stage updated successfully.' });
    res.redirect('/benchpath/clb-stages');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function deleteStage(req, res) {
  try {
    const existing = await benchpathDataService.getDataById('clbStages', req.params.id, req.user);
    if (!existing) throw new Error('Stage not found or outside organization scope.');
    await benchpathDataService.deleteData('clbStages', req.params.id, req.user);
    if (isAjax(req)) return res.json({ status: 'success', message: 'Stage deleted successfully.' });
    res.redirect('/benchpath/clb-stages');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

module.exports = {
  listStages,
  showAddForm,
  addStage,
  showEditForm,
  editStage,
  deleteStage
};
