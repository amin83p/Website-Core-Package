const benchpathDataService = require('../../services/benchpath/benchpathDataService');
const { isAjax, buildDataServiceQuery } = require('../../utils/generalTools');

const DEFAULT_SEARCH_FIELDS = [
  'id',
  'slug',
  'code',
  'title',
  'frameworkId',
  'skillId',
  'benchmarkId',
  'status',
  'reviewStatus'
];

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
    frameworkId: body.frameworkId,
    skillId: body.skillId,
    stageId: body.stageId,
    benchmarkId: body.benchmarkId,
    competencyAreaId: body.competencyAreaId,
    competencyId: body.competencyId,
    description: body.description,
    domainNotes: body.domainNotes,
    relatedIds: body.relatedIds,
    tags: body.tags,
    sourceRefs: body.sourceRefs,
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

async function loadOptions(reqUser) {
  const [frameworks, stages, skills, sources, fragments, benchmarks, competencyAreas, competencies] = await Promise.all([
    benchpathDataService.fetchData('clbFrameworks', {}, reqUser),
    benchpathDataService.fetchData('clbStages', {}, reqUser),
    benchpathDataService.fetchData('clbSkills', {}, reqUser),
    benchpathDataService.fetchData('sources', {}, reqUser),
    benchpathDataService.fetchData('sourceFragments', {}, reqUser),
    benchpathDataService.fetchData('clbBenchmarks', {}, reqUser),
    benchpathDataService.fetchData('clbCompetencyAreas', {}, reqUser),
    benchpathDataService.fetchData('clbCompetencies', {}, reqUser)
  ]);
  return { frameworks, stages, skills, sources, fragments, benchmarks, competencyAreas, competencies };
}

function createReferenceEntityController(entityKey) {
  const def = benchpathDataService.getReferenceEntityDef(entityKey);
  const entityType = benchpathDataService.resolveReferenceEntityType(entityKey);
  if (!entityType) throw new Error(`Unknown BenchPath reference entity type for key: ${entityKey}`);

  async function listItems(req, res) {
    try {
      const query = await buildDataServiceQuery(req.query, {
        allowedExactKeys: ['id', 'frameworkId', 'skillId', 'benchmarkId', 'status', 'reviewStatus'],
        defaultSearchFields: DEFAULT_SEARCH_FIELDS,
        allowedSearchFields: DEFAULT_SEARCH_FIELDS
      });
      const paged = await benchpathDataService.fetchDataPaged(entityType, query, req.user);
      const data = Array.isArray(paged?.rows) ? paged.rows : [];
      const pagination = paged?.pagination || null;
      const searchableFields = DEFAULT_SEARCH_FIELDS;

      if (isAjax(req)) return res.json({ status: 'success', data, pagination, searchableFields });

      res.render('benchpath/referenceCatalog/items', {
        title: def.title,
        entity: def,
        data,
        searchableFields,
        newUrl: `benchpath/${def.routeBase}`,
        newLabel: `New ${def.title.replace('CLB ', '').replace(' Of ', ' of ')}`,
        tableName: `BenchPath_${def.entityType}`,
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

  async function renderForm(req, res, itemData = null, title = 'Create Item') {
    const allOptions = await loadOptions(req.user);
    const options = {
      frameworks: allOptions.frameworks,
      stages: allOptions.stages,
      skills: allOptions.skills,
      sources: allOptions.sources,
      fragments: allOptions.fragments,
      benchmarks: allOptions.benchmarks,
      competencyAreas: allOptions.competencyAreas,
      competencies: allOptions.competencies
    };
    const referenceMeta = benchpathDataService.getReferenceFormMeta();
    res.render('benchpath/referenceCatalog/itemForm', {
      title,
      entity: def,
      itemData,
      includeModal: true,
      statusOptions: referenceMeta.statusOptions,
      reviewStatusOptions: referenceMeta.reviewStatusOptions,
      options,
      user: req.user || null,
      actionStateId: req?.actionStateId || ''
    });
  }

  async function showAddForm(req, res) {
    try {
      await renderForm(req, res, null, `Create ${def.title}`);
    } catch (error) {
      res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
    }
  }

  async function addItem(req, res) {
    try {
      const payload = toPayload(req.body);
      await benchpathDataService.addData(entityType, payload, req.user);
      if (isAjax(req)) return res.json({ status: 'success', message: 'Record created successfully.' });
      res.redirect(`/benchpath/${def.routeBase}`);
    } catch (error) {
      if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
      res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
    }
  }

  async function showEditForm(req, res) {
    try {
      const itemData = await benchpathDataService.getDataById(entityType, req.params.id, req.user);
      if (!itemData) {
        return res.status(404).render('404', { user: req.user || null });
      }
      await renderForm(req, res, itemData, `Edit ${def.title}`);
    } catch (error) {
      res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
    }
  }

  async function editItem(req, res) {
    try {
      const existing = await benchpathDataService.getDataById(entityType, req.params.id, req.user);
      if (!existing) throw new Error('Record not found or outside organization scope.');
      const payload = toPayload(req.body);
      await benchpathDataService.updateData(entityType, req.params.id, payload, req.user);
      if (isAjax(req)) return res.json({ status: 'success', message: 'Record updated successfully.' });
      res.redirect(`/benchpath/${def.routeBase}`);
    } catch (error) {
      if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
      res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
    }
  }

  async function deleteItem(req, res) {
    try {
      const existing = await benchpathDataService.getDataById(entityType, req.params.id, req.user);
      if (!existing) throw new Error('Record not found or outside organization scope.');
      await benchpathDataService.deleteData(entityType, req.params.id, req.user);
      if (isAjax(req)) return res.json({ status: 'success', message: 'Record deleted successfully.' });
      res.redirect(`/benchpath/${def.routeBase}`);
    } catch (error) {
      if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
      res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
    }
  }

  return {
    listItems,
    showAddForm,
    addItem,
    showEditForm,
    editItem,
    deleteItem
  };
}

module.exports = { createReferenceEntityController };
