const { requireCoreModule } = require('../../services/benchpath/benchpathCoreModuleResolver');
const benchpathDataService = require('../../services/benchpath/benchpathDataService');
const { isAjax, buildDataServiceQuery } = requireCoreModule('MVC/utils/generalTools');

const DEFAULT_SEARCH_FIELDS = [
  'id',
  'slug',
  'code',
  'sourceId',
  'title',
  'fragmentType',
  'semanticRole',
  'language',
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
    sourceId: body.sourceId,
    sourceType: body.sourceType,
    authorityLevel: body.authorityLevel,
    framework: body.framework,
    title: body.title,
    shortTitle: body.shortTitle,
    fragmentType: body.fragmentType,
    sectionPath: body.sectionPath,
    pageStart: body.pageStart,
    pageEnd: body.pageEnd,
    paragraphStart: body.paragraphStart,
    paragraphEnd: body.paragraphEnd,
    lineStart: body.lineStart,
    lineEnd: body.lineEnd,
    text: body.text,
    normalizedText: body.normalizedText,
    summary: body.summary,
    excerptLabel: body.excerptLabel,
    language: body.language,
    contextTags: body.contextTags,
    usageTags: body.usageTags,
    mappedEntityType: body.mappedEntityType,
    mappedEntityIds: body.mappedEntityIds,
    semanticRole: body.semanticRole,
    isDirectQuote: body.isDirectQuote,
    quoteConfidence: body.quoteConfidence,
    extractionMethod: body.extractionMethod,
    reviewStatus: body.reviewStatus,
    status: body.status,
    isActive: hasIsActive ? body.isActive : false,
    isSystem: hasIsSystem ? body.isSystem : false,
    isLocked: hasIsLocked ? body.isLocked : false,
    validationNotes: body.validationNotes,
    notes: body.notes,
    tags: body.tags,
    approvedBy: body.approvedBy,
    approvedAt: body.approvedAt,
    updatedBy: body.updatedBy
  };
}

async function listFragments(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, {
      allowedExactKeys: ['id', 'sourceId', 'fragmentType', 'semanticRole', 'status', 'reviewStatus', 'language'],
      defaultSearchFields: DEFAULT_SEARCH_FIELDS,
      allowedSearchFields: DEFAULT_SEARCH_FIELDS
    });
    const paged = await benchpathDataService.fetchDataPaged('sourceFragments', query, req.user);
    const data = Array.isArray(paged?.rows) ? paged.rows : [];
    const pagination = paged?.pagination || null;
    const searchableFields = DEFAULT_SEARCH_FIELDS;

    if (isAjax(req)) return res.json({ status: 'success', data, pagination, searchableFields });

    res.render('benchpath/sourceFragment/sourceFragments', {
      title: 'BenchPath Source Fragments',
      data,
      searchableFields,
      newUrl: 'benchpath/source-fragments',
      newLabel: 'New Source Fragment',
      tableName: 'BenchPath_Source_Fragments',
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

async function renderForm(req, res, sourceData = null, title = 'Create Source Fragment') {
  const [sources, meta] = await Promise.all([
    benchpathDataService.fetchData('sources', {}, req.user),
    Promise.resolve(benchpathDataService.getSourceFragmentFormMeta())
  ]);
  res.render('benchpath/sourceFragment/sourceFragmentForm', {
    title,
    sourceData,
    includeModal: true,
    sources,
    fragmentTypeOptions: meta.fragmentTypeOptions,
    languageOptions: meta.languageOptions,
    usageTagOptions: meta.usageTagOptions,
    reviewStatusOptions: meta.reviewStatusOptions,
    statusOptions: meta.statusOptions,
    semanticRoleOptions: meta.semanticRoleOptions,
    extractionMethodOptions: meta.extractionMethodOptions,
    mappedEntityTypeOptions: meta.mappedEntityTypeOptions,
    user: req.user || null,
    actionStateId: req?.actionStateId || ''
  });
}

async function showAddForm(req, res) {
  try {
    await renderForm(req, res, null, 'Create Source Fragment');
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function addFragment(req, res) {
  try {
    const payload = toPayload(req.body);
    await benchpathDataService.addData('sourceFragments', payload, req.user);
    if (isAjax(req)) return res.json({ status: 'success', message: 'Source fragment created successfully.' });
    res.redirect('/benchpath/source-fragments');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function showEditForm(req, res) {
  try {
    const sourceData = await benchpathDataService.getDataById('sourceFragments', req.params.id, req.user);
    if (!sourceData) {
      return res.status(404).render('404', { user: req.user || null });
    }
    await renderForm(req, res, sourceData, 'Edit Source Fragment');
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function editFragment(req, res) {
  try {
    const existing = await benchpathDataService.getDataById('sourceFragments', req.params.id, req.user);
    if (!existing) throw new Error('Source fragment not found or outside organization scope.');
    const payload = toPayload(req.body);
    await benchpathDataService.updateData('sourceFragments', req.params.id, payload, req.user);
    if (isAjax(req)) return res.json({ status: 'success', message: 'Source fragment updated successfully.' });
    res.redirect('/benchpath/source-fragments');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function deleteFragment(req, res) {
  try {
    const existing = await benchpathDataService.getDataById('sourceFragments', req.params.id, req.user);
    if (!existing) throw new Error('Source fragment not found or outside organization scope.');
    await benchpathDataService.deleteData('sourceFragments', req.params.id, req.user);
    if (isAjax(req)) return res.json({ status: 'success', message: 'Source fragment deleted successfully.' });
    res.redirect('/benchpath/source-fragments');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

module.exports = {
  listFragments,
  showAddForm,
  addFragment,
  showEditForm,
  editFragment,
  deleteFragment
};
