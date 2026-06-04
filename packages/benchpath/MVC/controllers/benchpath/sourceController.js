const { requireCoreModule } = require('../../services/benchpath/benchpathCoreModuleResolver');
const benchpathDataService = require('../../services/benchpath/benchpathDataService');
const { getDashboardSection } = requireCoreModule('MVC/controllers/dashboardController');
const { isAjax, buildDataServiceQuery } = requireCoreModule('MVC/utils/generalTools');

const DEFAULT_SEARCH_FIELDS = [
  'id',
  'slug',
  'code',
  'title',
  'shortTitle',
  'sourceType',
  'authorityLevel',
  'language',
  'status',
  'reviewStatus',
  'extractionStatus'
];

function toFormPayload(body = {}) {
  const hasIsActive = Object.prototype.hasOwnProperty.call(body, 'isActive');
  const hasIsSystem = Object.prototype.hasOwnProperty.call(body, 'isSystem');
  return {
    id: body.id,
    slug: body.slug,
    code: body.code,
    title: body.title,
    shortTitle: body.shortTitle,
    sourceType: body.sourceType,
    authorityLevel: body.authorityLevel,
    framework: body.framework,
    publisher: body.publisher,
    authors: body.authors,
    edition: body.edition,
    year: body.year,
    language: body.language,
    country: body.country,
    fileName: body.fileName,
    originalFileName: body.originalFileName,
    storagePath: body.storagePath,
    mimeType: body.mimeType,
    fileExtension: body.fileExtension,
    fileSizeBytes: body.fileSizeBytes,
    pageCount: body.pageCount,
    url: body.url,
    isbn: body.isbn,
    tags: body.tags,
    description: body.description,
    usageRights: body.usageRights,
    usableFor: body.usableFor,
    status: body.status,
    reviewStatus: body.reviewStatus,
    extractionStatus: body.extractionStatus,
    isActive: hasIsActive ? body.isActive : false,
    isSystem: hasIsSystem ? body.isSystem : false,
    importBatchId: body.importBatchId,
    checksum: body.checksum,
    notes: body.notes,
    approvedBy: body.approvedBy,
    approvedAt: body.approvedAt,
    updatedBy: body.updatedBy
  };
}

async function listSources(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, {
      allowedExactKeys: ['id', 'sourceType', 'authorityLevel', 'language', 'status', 'reviewStatus', 'extractionStatus'],
      defaultSearchFields: DEFAULT_SEARCH_FIELDS,
      allowedSearchFields: DEFAULT_SEARCH_FIELDS
    });
    const paged = await benchpathDataService.fetchDataPaged('sources', query, req.user);
    const data = Array.isArray(paged?.rows) ? paged.rows : [];
    const pagination = paged?.pagination || null;
    const searchableFields = DEFAULT_SEARCH_FIELDS;

    if (isAjax(req)) return res.json({ status: 'success', data, pagination, searchableFields });

    res.render('benchpath/source/sources', {
      title: 'BenchPath Sources',
      data,
      searchableFields,
      newUrl: 'benchpath/sources',
      newLabel: 'New Source',
      tableName: 'BenchPath_Sources',
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

function showAddForm(req, res) {
  const meta = benchpathDataService.getSourceFormMeta();
  res.render('benchpath/source/sourceForm', {
    title: 'Create Source',
    sourceData: null,
    includeModal: true,
    requiredFields: meta.requiredFields,
    sourceTypeOptions: meta.sourceTypeOptions,
    authorityLevelOptions: meta.authorityLevelOptions,
    languageOptions: meta.languageOptions,
    usageRightsOptions: meta.usageRightsOptions,
    usableForOptions: meta.usableForOptions,
    statusOptions: meta.statusOptions,
    reviewStatusOptions: meta.reviewStatusOptions,
    extractionStatusOptions: meta.extractionStatusOptions,
    fileExtensionOptions: meta.fileExtensionOptions,
    user: req.user || null,
    actionStateId: req?.actionStateId || ''
  });
}

async function addSource(req, res) {
  try {
    const payload = toFormPayload(req.body);
    await benchpathDataService.addData('sources', payload, req.user);
    if (isAjax(req)) return res.json({ status: 'success', message: 'Source created successfully.' });
    res.redirect('/benchpath/sources');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function showEditForm(req, res) {
  try {
    const sourceData = await benchpathDataService.getDataById('sources', req.params.id, req.user);
    if (!sourceData) {
      return res.status(404).render('404', { user: req.user || null });
    }

    const meta = benchpathDataService.getSourceFormMeta();
    res.render('benchpath/source/sourceForm', {
      title: 'Edit Source',
      sourceData,
      includeModal: true,
      requiredFields: meta.requiredFields,
      sourceTypeOptions: meta.sourceTypeOptions,
      authorityLevelOptions: meta.authorityLevelOptions,
      languageOptions: meta.languageOptions,
      usageRightsOptions: meta.usageRightsOptions,
      usableForOptions: meta.usableForOptions,
      statusOptions: meta.statusOptions,
      reviewStatusOptions: meta.reviewStatusOptions,
      extractionStatusOptions: meta.extractionStatusOptions,
      fileExtensionOptions: meta.fileExtensionOptions,
      user: req.user || null,
      actionStateId: req?.actionStateId || ''
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function editSource(req, res) {
  try {
    const existing = await benchpathDataService.getDataById('sources', req.params.id, req.user);
    if (!existing) throw new Error('Source not found or outside organization scope.');
    const payload = toFormPayload(req.body);
    await benchpathDataService.updateData('sources', req.params.id, payload, req.user);
    if (isAjax(req)) return res.json({ status: 'success', message: 'Source updated successfully.' });
    res.redirect('/benchpath/sources');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function deleteSource(req, res) {
  try {
    const existing = await benchpathDataService.getDataById('sources', req.params.id, req.user);
    if (!existing) throw new Error('Source not found or outside organization scope.');
    await benchpathDataService.deleteData('sources', req.params.id, req.user);
    if (isAjax(req)) return res.json({ status: 'success', message: 'Source deleted successfully.' });
    res.redirect('/benchpath/sources');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function showDashboard(req, res) {
  const dashboardSections = [
    {
      priority: 10,
      title: 'Reference Sources',
      description: 'Manage foundational source documents for BenchPath reference layer.',
      href: '/benchpath/sources',
      buttonLabel: 'Open Sources',
      icon: 'bi-diagram-3-fill',
      subtleClass: 'bg-primary-subtle text-primary',
      buttonClass: 'btn btn-primary'
    },
    {
      priority: 20,
      title: 'Source Fragments',
      description: 'Extracted and mapped source fragments for reference and runtime usage.',
      href: '/benchpath/source-fragments',
      buttonLabel: 'Open Fragments',
      icon: 'bi-blockquote-left',
      subtleClass: 'bg-info-subtle text-info',
      buttonClass: 'btn btn-info text-white'
    },
    {
      priority: 30,
      title: 'CLB Framework',
      description: 'Canonical CLB framework, stages, ranges, and global reference constraints.',
      href: '/benchpath/clb-framework',
      buttonLabel: 'Open Framework',
      icon: 'bi-diagram-2-fill',
      subtleClass: 'bg-success-subtle text-success',
      buttonClass: 'btn btn-success'
    },
    {
      priority: 35,
      title: 'CLB Stages',
      description: 'Central stage definitions reused across BenchPath reference pages.',
      href: '/benchpath/clb-stages',
      buttonLabel: 'Open Stages',
      icon: 'bi-signpost-split-fill',
      subtleClass: 'bg-secondary-subtle text-secondary',
      buttonClass: 'btn btn-secondary'
    },
    {
      priority: 40,
      title: 'CLB Skills',
      description: 'Canonical CLB skills (L/S/R/W) with benchmark links and assessment characteristics.',
      href: '/benchpath/clb-skills',
      buttonLabel: 'Open Skills',
      icon: 'bi-list-check',
      subtleClass: 'bg-warning-subtle text-warning-emphasis',
      buttonClass: 'btn btn-warning text-dark'
    },
    {
      priority: 50,
      title: 'CLB Competency Areas',
      description: 'Manage competency areas by skill and their canonical references.',
      href: '/benchpath/clb-competency-areas',
      buttonLabel: 'Open Competency Areas',
      icon: 'bi-diagram-3',
      subtleClass: 'bg-secondary-subtle text-secondary',
      buttonClass: 'btn btn-secondary'
    },
    {
      priority: 60,
      title: 'CLB Benchmarks',
      description: 'Manage benchmark records linked to framework, skill, stage, and sources.',
      href: '/benchpath/clb-benchmarks',
      buttonLabel: 'Open Benchmarks',
      icon: 'bi-123',
      subtleClass: 'bg-primary-subtle text-primary',
      buttonClass: 'btn btn-primary'
    },
    {
      priority: 70,
      title: 'CLB Competencies',
      description: 'Manage competency records linked to benchmark and competency area.',
      href: '/benchpath/clb-competencies',
      buttonLabel: 'Open Competencies',
      icon: 'bi-ui-checks',
      subtleClass: 'bg-info-subtle text-info',
      buttonClass: 'btn btn-info text-white'
    },
    {
      priority: 80,
      title: 'CLB Indicators',
      description: 'Manage competency-linked indicators with source-traceable references.',
      href: '/benchpath/clb-indicators',
      buttonLabel: 'Open Indicators',
      icon: 'bi-bullseye',
      subtleClass: 'bg-success-subtle text-success',
      buttonClass: 'btn btn-success'
    },
    {
      priority: 90,
      title: 'CLB Profile Of Ability',
      description: 'Manage profile descriptors per skill and benchmark.',
      href: '/benchpath/clb-profile-of-ability',
      buttonLabel: 'Open Profiles',
      icon: 'bi-person-lines-fill',
      subtleClass: 'bg-warning-subtle text-warning-emphasis',
      buttonClass: 'btn btn-warning text-dark'
    },
    {
      priority: 100,
      title: 'CLB Features Of Communication',
      description: 'Manage communication feature descriptors for benchmark/competency scope.',
      href: '/benchpath/clb-features-of-communication',
      buttonLabel: 'Open Features',
      icon: 'bi-chat-square-text',
      subtleClass: 'bg-danger-subtle text-danger',
      buttonClass: 'btn btn-danger'
    },
    {
      priority: 110,
      title: 'CLB Sample Task Labels',
      description: 'Manage official sample task labels and benchmark links.',
      href: '/benchpath/clb-sample-task-labels',
      buttonLabel: 'Open Task Labels',
      icon: 'bi-card-list',
      subtleClass: 'bg-dark-subtle text-dark',
      buttonClass: 'btn btn-dark'
    },
    {
      priority: 115,
      title: 'Teacher Task Authoring',
      description: 'Generate and manage CLB/PBLA-aligned teacher-authored tasks with the BenchPath wizard.',
      href: '/benchpath/tasks',
      buttonLabel: 'Open Task Wizard',
      icon: 'bi-pencil-square',
      subtleClass: 'bg-primary-subtle text-primary',
      buttonClass: 'btn btn-primary'
    },
    {
      priority: 120,
      title: 'Migration Tools',
      description: 'Run dry-run validation and apply normalization migration with full audit reports.',
      href: '/benchpath/tools',
      buttonLabel: 'Open Tools',
      icon: 'bi-tools',
      subtleClass: 'bg-danger-subtle text-danger',
      buttonClass: 'btn btn-danger'
    }
  ];

  const dashboardSection = await getDashboardSection('/benchpath', req.user);
  res.render('benchpath/dashboard', {
    title: 'BenchPath',
    dashboardSections,
    dashboardSection,
    user: req.user || null
  });
}

module.exports = {
  listSources,
  showAddForm,
  addSource,
  showEditForm,
  editSource,
  deleteSource,
  showDashboard
};
