const { requireCoreModule } = require('../../services/benchpath/benchpathCoreModuleResolver');
const benchpathDataService = require('../../services/benchpath/benchpathDataService');
const { isAjax, buildDataServiceQuery } = requireCoreModule('MVC/utils/generalTools');

const DEFAULT_SEARCH_FIELDS = ['id', 'slug', 'code', 'title', 'frameworkId', 'modality', 'status', 'reviewStatus'];

function toPayload(body = {}) {
  const hasIsActive = Object.prototype.hasOwnProperty.call(body, 'isActive');
  const hasIsSystem = Object.prototype.hasOwnProperty.call(body, 'isSystem');
  const hasIsLocked = Object.prototype.hasOwnProperty.call(body, 'isLocked');

  const assessmentCharacteristics = {
    primaryEvidenceModes: body.primaryEvidenceModes || body['assessmentCharacteristics.primaryEvidenceModes'] || [],
    defaultAssessmentApproach: body.defaultAssessmentApproach || body['assessmentCharacteristics.defaultAssessmentApproach'],
    supportsPortfolioEvidence: Object.prototype.hasOwnProperty.call(body, 'supportsPortfolioEvidence') ? body.supportsPortfolioEvidence : body['assessmentCharacteristics.supportsPortfolioEvidence'],
    supportsDeterministicChecks: Object.prototype.hasOwnProperty.call(body, 'supportsDeterministicChecks') ? body.supportsDeterministicChecks : body['assessmentCharacteristics.supportsDeterministicChecks'],
    supportsAiAssistance: Object.prototype.hasOwnProperty.call(body, 'supportsAiAssistance') ? body.supportsAiAssistance : body['assessmentCharacteristics.supportsAiAssistance']
  };

  const teachingCharacteristics = {
    taskBased: body.taskBased || body['teachingCharacteristics.taskBased'],
    realWorldOriented: body.realWorldOriented || body['teachingCharacteristics.realWorldOriented'],
    oftenIntegratedWithOtherSkills: body.oftenIntegratedWithOtherSkills || body['teachingCharacteristics.oftenIntegratedWithOtherSkills'],
    canUseVisualSupport: body.canUseVisualSupport || body['teachingCharacteristics.canUseVisualSupport']
  };

  return {
    id: body.id,
    slug: body.slug,
    code: body.code,
    title: body.title,
    shortTitle: body.shortTitle,
    frameworkId: body.frameworkId,
    frameworkCode: body.frameworkCode,
    modality: body.modality,
    displayOrder: body.displayOrder,
    description: body.description,
    stageIds: body.stageIds,
    supportedBenchmarkRange: body.supportedBenchmarkRange,
    benchmarkIds: body.benchmarkIds,
    competencyAreaIds: body.competencyAreaIds,
    assessmentCharacteristics,
    teachingCharacteristics,
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

async function listSkills(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, {
      allowedExactKeys: ['id', 'frameworkId', 'modality', 'status', 'reviewStatus', 'code'],
      defaultSearchFields: DEFAULT_SEARCH_FIELDS,
      allowedSearchFields: DEFAULT_SEARCH_FIELDS
    });
    const paged = await benchpathDataService.fetchDataPaged('clbSkills', query, req.user);
    const data = Array.isArray(paged?.rows) ? paged.rows : [];
    const pagination = paged?.pagination || null;
    const searchableFields = DEFAULT_SEARCH_FIELDS;

    if (isAjax(req)) return res.json({ status: 'success', data, pagination, searchableFields });

    res.render('benchpath/clbSkill/skills', {
      title: 'CLB Skills',
      data,
      searchableFields,
      newUrl: 'benchpath/clb-skills',
      newLabel: 'New Skill',
      tableName: 'BenchPath_CLB_Skills',
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

async function renderForm(req, res, skillData = null, title = 'Create CLB Skill') {
  const [frameworks, stages, sources, fragments, meta] = await Promise.all([
    benchpathDataService.fetchData('clbFrameworks', {}, req.user),
    benchpathDataService.fetchData('clbStages', {}, req.user),
    benchpathDataService.fetchData('sources', {}, req.user),
    benchpathDataService.fetchData('sourceFragments', {}, req.user),
    Promise.resolve(benchpathDataService.getSkillFormMeta())
  ]);
  const stageOptionsByFramework = (stages || []).reduce((acc, stage) => {
    const frameworkId = String(stage?.frameworkId || '').trim();
    const stageId = String(stage?.id || '').trim();
    if (!frameworkId || !stageId) return acc;
    if (!Array.isArray(acc[frameworkId])) acc[frameworkId] = [];
    acc[frameworkId].push(stageId);
    return acc;
  }, {});
  Object.keys(stageOptionsByFramework).forEach((frameworkId) => {
    stageOptionsByFramework[frameworkId] = Array.from(new Set(stageOptionsByFramework[frameworkId]));
  });

  res.render('benchpath/clbSkill/skillForm', {
    title,
    skillData,
    includeModal: true,
    modalityOptions: meta.modalityOptions,
    statusOptions: meta.statusOptions,
    reviewStatusOptions: meta.reviewStatusOptions,
    evidenceModeOptions: meta.evidenceModeOptions,
    assessmentApproachOptions: meta.assessmentApproachOptions,
    frameworks,
    sources,
    fragments,
    stageOptionsByFramework,
    user: req.user || null,
    actionStateId: req?.actionStateId || ''
  });
}

async function showAddForm(req, res) {
  try {
    await renderForm(req, res, null, 'Create CLB Skill');
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function addSkill(req, res) {
  try {
    const payload = toPayload(req.body);
    await benchpathDataService.addData('clbSkills', payload, req.user);
    if (isAjax(req)) return res.json({ status: 'success', message: 'Skill created successfully.' });
    res.redirect('/benchpath/clb-skills');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function showEditForm(req, res) {
  try {
    const skillData = await benchpathDataService.getDataById('clbSkills', req.params.id, req.user);
    if (!skillData) {
      return res.status(404).render('404', { user: req.user || null });
    }
    await renderForm(req, res, skillData, 'Edit CLB Skill');
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function editSkill(req, res) {
  try {
    const existing = await benchpathDataService.getDataById('clbSkills', req.params.id, req.user);
    if (!existing) throw new Error('Skill not found or outside organization scope.');
    const payload = toPayload(req.body);
    await benchpathDataService.updateData('clbSkills', req.params.id, payload, req.user);
    if (isAjax(req)) return res.json({ status: 'success', message: 'Skill updated successfully.' });
    res.redirect('/benchpath/clb-skills');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function deleteSkill(req, res) {
  try {
    const existing = await benchpathDataService.getDataById('clbSkills', req.params.id, req.user);
    if (!existing) throw new Error('Skill not found or outside organization scope.');
    await benchpathDataService.deleteData('clbSkills', req.params.id, req.user);
    if (isAjax(req)) return res.json({ status: 'success', message: 'Skill deleted successfully.' });
    res.redirect('/benchpath/clb-skills');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

module.exports = {
  listSkills,
  showAddForm,
  addSkill,
  showEditForm,
  editSkill,
  deleteSkill
};
