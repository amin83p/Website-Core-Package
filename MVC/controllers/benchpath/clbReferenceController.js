const benchpathDataService = require('../../services/benchpath/benchpathDataService');
const paginate = require('../../utils/paginationHelper');
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

const DEFAULT_ALLOWED_EXACT_KEYS = ['id', 'frameworkId', 'skillId', 'benchmarkId', 'status', 'reviewStatus'];
const IN_MEMORY_DEFAULT_SORT_THRESHOLD = 500;

const ENTITY_FORM_META = Object.freeze({
  competencyAreas: {
    semanticTitle: 'Competency Area Semantics',
    semanticHelp: 'Define competency-area specific fields and instructional contexts.'
  },
  benchmarks: {
    semanticTitle: 'Benchmark Semantics',
    semanticHelp: 'Define benchmark number, profile link, and CLB benchmark-page relations.'
  },
  competencies: {
    semanticTitle: 'Competency Semantics',
    semanticHelp: 'Define competency statement and downstream indicator/task relationships.'
  },
  indicators: {
    semanticTitle: 'Indicator Semantics',
    semanticHelp: 'Define canonical indicator text and assessment evidence dimensions.'
  },
  profileOfAbility: {
    semanticTitle: 'Profile Semantics',
    semanticHelp: 'Define profile descriptors and linked communication feature references.'
  },
  featuresOfCommunication: {
    semanticTitle: 'Feature Semantics',
    semanticHelp: 'Define scope and descriptor values for communication features.'
  },
  sampleTaskLabels: {
    semanticTitle: 'Sample Task Label Semantics',
    semanticHelp: 'Define official sample-task metadata and contextual benchmark links.'
  }
});

const ENTITY_LIST_CONFIG = Object.freeze({
  competencyAreas: {
    placeholder: 'Search competency areas...',
    allowedExactKeys: ['id', 'frameworkId', 'skillId', 'areaFamilyCode', 'status', 'reviewStatus'],
    searchableFields: ['id', 'slug', 'code', 'title', 'frameworkId', 'skillId', 'areaFamilyCode', 'communicativeContexts', 'status', 'reviewStatus'],
    defaultSort: [
      { key: 'frameworkId', dir: 'asc' },
      { key: 'skillId', dir: 'asc' },
      { key: 'title', dir: 'asc' }
    ],
    columns: [
      { key: 'id', label: 'ID', type: 'mono' },
      { key: 'title', label: 'Title', type: 'title' },
      { key: 'frameworkId', label: 'Framework', type: 'text' },
      { key: 'skillId', label: 'Skill', type: 'text' },
      { key: 'areaFamilyCode', label: 'Family Code', type: 'text' },
      { key: 'communicativeContexts', label: 'Context Tags', type: 'list' },
      { key: 'status', label: 'Status', type: 'status' },
      { key: 'reviewStatus', label: 'Review State', type: 'review' }
    ]
  },
  benchmarks: {
    placeholder: 'Search benchmarks...',
    allowedExactKeys: ['id', 'frameworkId', 'skillId', 'stageId', 'benchmarkNumber', 'status', 'reviewStatus'],
    searchableFields: ['id', 'slug', 'code', 'title', 'frameworkId', 'skillId', 'stageId', 'benchmarkNumber', 'stageBandLabel', 'status', 'reviewStatus'],
    defaultSort: [
      { key: 'skillId', dir: 'asc' },
      { key: 'benchmarkNumber', dir: 'asc' },
      { key: 'title', dir: 'asc' }
    ],
    columns: [
      { key: 'id', label: 'ID', type: 'mono' },
      { key: 'title', label: 'Title', type: 'title' },
      { key: 'frameworkId', label: 'Framework', type: 'text' },
      { key: 'skillId', label: 'Skill', type: 'text' },
      { key: 'stageId', label: 'Stage', type: 'text' },
      { key: 'benchmarkNumber', label: 'Benchmark Level', type: 'text' },
      { key: 'profileOfAbilityId', label: 'Profile Ref', type: 'text' },
      { key: 'status', label: 'Status', type: 'status' },
      { key: 'reviewStatus', label: 'Review State', type: 'review' }
    ]
  },
  competencies: {
    placeholder: 'Search competencies...',
    allowedExactKeys: ['id', 'frameworkId', 'skillId', 'benchmarkId', 'competencyAreaId', 'status', 'reviewStatus'],
    searchableFields: ['id', 'slug', 'code', 'title', 'frameworkId', 'skillId', 'benchmarkId', 'competencyAreaId', 'communicativePurpose', 'status', 'reviewStatus'],
    defaultSort: [
      { key: 'benchmarkId', dir: 'asc' },
      { key: 'competencyAreaId', dir: 'asc' },
      { key: 'title', dir: 'asc' }
    ],
    columns: [
      { key: 'id', label: 'ID', type: 'mono' },
      { key: 'title', label: 'Title', type: 'title' },
      { key: 'frameworkId', label: 'Framework', type: 'text' },
      { key: 'skillId', label: 'Skill', type: 'text' },
      { key: 'benchmarkId', label: 'Benchmark', type: 'text' },
      { key: 'competencyAreaId', label: 'Competency Area', type: 'text' },
      { key: 'communicativePurpose', label: 'Purpose', type: 'text' },
      { key: 'indicatorIds', label: 'Indicator Count', type: 'count' },
      { key: 'status', label: 'Status', type: 'status' },
      { key: 'reviewStatus', label: 'Review State', type: 'review' }
    ]
  },
  indicators: {
    placeholder: 'Search indicators...',
    allowedExactKeys: ['id', 'frameworkId', 'skillId', 'benchmarkId', 'competencyId', 'indicatorCategory', 'status', 'reviewStatus'],
    searchableFields: ['id', 'slug', 'code', 'title', 'frameworkId', 'skillId', 'benchmarkId', 'competencyId', 'indicatorCategory', 'indicatorDimension', 'evidenceType', 'status', 'reviewStatus'],
    defaultSort: [
      { key: 'benchmarkId', dir: 'asc' },
      { key: 'competencyId', dir: 'asc' },
      { key: 'indicatorCategory', dir: 'asc' },
      { key: 'title', dir: 'asc' }
    ],
    columns: [
      { key: 'id', label: 'ID', type: 'mono' },
      { key: 'title', label: 'Title', type: 'title' },
      { key: 'frameworkId', label: 'Framework', type: 'text' },
      { key: 'skillId', label: 'Skill', type: 'text' },
      { key: 'benchmarkId', label: 'Benchmark', type: 'text' },
      { key: 'competencyId', label: 'Competency', type: 'text' },
      { key: 'indicatorCategory', label: 'Category', type: 'text' },
      { key: 'evidenceType', label: 'Evidence', type: 'text' },
      { key: 'status', label: 'Status', type: 'status' },
      { key: 'reviewStatus', label: 'Review State', type: 'review' }
    ]
  },
  profileOfAbility: {
    placeholder: 'Search profile of ability...',
    allowedExactKeys: ['id', 'frameworkId', 'skillId', 'benchmarkId', 'status', 'reviewStatus'],
    searchableFields: ['id', 'slug', 'code', 'title', 'frameworkId', 'skillId', 'benchmarkId', 'descriptorSummary', 'descriptorDimensions', 'status', 'reviewStatus'],
    defaultSort: [
      { key: 'skillId', dir: 'asc' },
      { key: 'benchmarkId', dir: 'asc' },
      { key: 'title', dir: 'asc' }
    ],
    columns: [
      { key: 'id', label: 'ID', type: 'mono' },
      { key: 'title', label: 'Title', type: 'title' },
      { key: 'frameworkId', label: 'Framework', type: 'text' },
      { key: 'skillId', label: 'Skill', type: 'text' },
      { key: 'benchmarkId', label: 'Benchmark', type: 'text' },
      { key: 'descriptorDimensions', label: 'Descriptor Dimensions', type: 'list' },
      { key: 'featureIds', label: 'Feature Count', type: 'count' },
      { key: 'status', label: 'Status', type: 'status' },
      { key: 'reviewStatus', label: 'Review State', type: 'review' }
    ]
  },
  featuresOfCommunication: {
    placeholder: 'Search features of communication...',
    allowedExactKeys: ['id', 'frameworkId', 'skillId', 'benchmarkId', 'scopeType', 'featureDimension', 'status', 'reviewStatus'],
    searchableFields: ['id', 'slug', 'code', 'title', 'frameworkId', 'skillId', 'benchmarkId', 'scopeType', 'featureDimension', 'complexityLevel', 'featureValue', 'status', 'reviewStatus'],
    defaultSort: [
      { key: 'scopeType', dir: 'asc' },
      { key: 'skillId', dir: 'asc' },
      { key: 'benchmarkId', dir: 'asc' },
      { key: 'featureDimension', dir: 'asc' },
      { key: 'title', dir: 'asc' }
    ],
    columns: [
      { key: 'id', label: 'ID', type: 'mono' },
      { key: 'title', label: 'Title', type: 'title' },
      { key: 'frameworkId', label: 'Framework', type: 'text' },
      { key: 'skillId', label: 'Skill', type: 'text' },
      { key: 'benchmarkId', label: 'Benchmark', type: 'text' },
      { key: 'scopeType', label: 'Scope', type: 'text' },
      { key: 'featureDimension', label: 'Dimension', type: 'text' },
      { key: 'complexityLevel', label: 'Complexity', type: 'text' },
      { key: 'status', label: 'Status', type: 'status' },
      { key: 'reviewStatus', label: 'Review State', type: 'review' }
    ]
  },
  sampleTaskLabels: {
    placeholder: 'Search sample task labels...',
    allowedExactKeys: ['id', 'frameworkId', 'skillId', 'benchmarkId', 'linkedBenchmarkId', 'linkedCompetencyId', 'contextDomain', 'status', 'reviewStatus'],
    searchableFields: ['id', 'slug', 'code', 'title', 'frameworkId', 'skillId', 'benchmarkId', 'linkedBenchmarkId', 'linkedCompetencyId', 'contextDomain', 'taskType', 'status', 'reviewStatus'],
    defaultSort: [
      { key: 'linkedBenchmarkId', dir: 'asc' },
      { key: 'linkedCompetencyId', dir: 'asc' },
      { key: 'contextDomain', dir: 'asc' },
      { key: 'title', dir: 'asc' }
    ],
    columns: [
      { key: 'id', label: 'ID', type: 'mono' },
      { key: 'title', label: 'Title', type: 'title' },
      { key: 'frameworkId', label: 'Framework', type: 'text' },
      { key: 'skillId', label: 'Skill', type: 'text' },
      { key: 'linkedBenchmarkId', label: 'Linked Benchmark', type: 'text' },
      { key: 'linkedCompetencyId', label: 'Linked Competency', type: 'text' },
      { key: 'contextDomain', label: 'Context', type: 'text' },
      { key: 'taskType', label: 'Task Type', type: 'text' },
      { key: 'officialSample', label: 'Official', type: 'boolean' },
      { key: 'status', label: 'Status', type: 'status' },
      { key: 'reviewStatus', label: 'Review State', type: 'review' }
    ]
  }
});

function getListConfig(entityKey) {
  const config = ENTITY_LIST_CONFIG[entityKey];
  if (config) return config;
  return {
    placeholder: 'Search records...',
    allowedExactKeys: DEFAULT_ALLOWED_EXACT_KEYS,
    searchableFields: DEFAULT_SEARCH_FIELDS,
    defaultSort: [{ key: 'title', dir: 'asc' }, { key: 'id', dir: 'asc' }],
    columns: [
      { key: 'id', label: 'ID', type: 'mono' },
      { key: 'title', label: 'Title', type: 'title' },
      { key: 'frameworkId', label: 'Framework', type: 'text' },
      { key: 'skillId', label: 'Skill', type: 'text' },
      { key: 'benchmarkId', label: 'Benchmark', type: 'text' },
      { key: 'status', label: 'Status', type: 'status' },
      { key: 'reviewStatus', label: 'Review', type: 'review' }
    ]
  };
}

function normalizeSortDirection(value) {
  return String(value || '').toLowerCase() === 'desc' ? -1 : 1;
}

function comparePrimitiveValues(a, b) {
  const left = a == null ? '' : a;
  const right = b == null ? '' : b;

  const leftNum = typeof left === 'number' ? left : Number.parseFloat(String(left));
  const rightNum = typeof right === 'number' ? right : Number.parseFloat(String(right));
  const bothNumeric = Number.isFinite(leftNum) && Number.isFinite(rightNum) && String(left).trim() !== '' && String(right).trim() !== '';
  if (bothNumeric) {
    if (leftNum < rightNum) return -1;
    if (leftNum > rightNum) return 1;
    return 0;
  }

  const leftText = String(left).toLowerCase();
  const rightText = String(right).toLowerCase();
  return leftText.localeCompare(rightText);
}

function sortByDefaultConfig(rows = [], sortSpec = []) {
  const rules = Array.isArray(sortSpec) ? sortSpec.filter((entry) => entry && entry.key) : [];
  if (!rules.length) return Array.isArray(rows) ? rows : [];

  const copy = [...rows];
  copy.sort((a, b) => {
    for (const rule of rules) {
      const direction = normalizeSortDirection(rule.dir);
      const result = comparePrimitiveValues(a?.[rule.key], b?.[rule.key]);
      if (result !== 0) return result * direction;
    }
    return comparePrimitiveValues(a?.id, b?.id);
  });
  return copy;
}

function buildSortExpressionFromConfig(sortSpec = []) {
  const rules = Array.isArray(sortSpec) ? sortSpec.filter((entry) => entry && entry.key) : [];
  if (!rules.length) return '';
  return rules
    .map((rule) => (String(rule.dir || '').toLowerCase() === 'desc' ? `-${rule.key}` : `${rule.key}`))
    .join(',');
}

function stripPaginationFromQuery(query = {}) {
  if (!query || typeof query !== 'object') return {};
  const output = { ...query };
  delete output.page;
  delete output.limit;
  return output;
}

function s(value) {
  return String(value == null ? '' : value).trim();
}

function sn(value) {
  const normalized = s(value);
  return normalized || null;
}

function i(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function b(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = s(value).toLowerCase();
  if (!normalized) return fallback;
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function arr(value, sep = ',') {
  if (Array.isArray(value)) return value.map((entry) => s(entry)).filter(Boolean);
  const normalized = s(value);
  if (!normalized) return [];
  return normalized.split(sep).map((entry) => entry.trim()).filter(Boolean);
}

function parseSourceRefs(value) {
  if (Array.isArray(value)) return value;
  const normalized = s(value);
  if (!normalized) return [];
  try {
    const parsed = JSON.parse(normalized);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function formatListValue(item, column) {
  const raw = item ? item[column.key] : null;
  if (column.type === 'list') {
    const list = Array.isArray(raw) ? raw.map((entry) => s(entry)).filter(Boolean) : [];
    if (!list.length) return '-';
    return list.length > 2 ? `${list.slice(0, 2).join(', ')} +${list.length - 2}` : list.join(', ');
  }
  if (column.type === 'count') {
    if (Array.isArray(raw)) return raw.length;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (column.type === 'boolean') {
    return Boolean(raw);
  }
  const normalized = s(raw);
  return normalized || '-';
}

function buildListRows(data = [], columns = []) {
  return (Array.isArray(data) ? data : []).map((item) => {
    const cells = {};
    columns.forEach((column) => {
      cells[column.key] = formatListValue(item, column);
    });
    return {
      id: s(item?.id),
      slug: s(item?.slug),
      code: sn(item?.code),
      flags: {
        isActive: Boolean(item?.isActive),
        isSystem: Boolean(item?.isSystem),
        isLocked: Boolean(item?.isLocked)
      },
      cells
    };
  });
}

const SEMANTIC_PAYLOAD_MAPPERS = Object.freeze({
  competencyAreas(body, payload) {
    payload.areaFamilyCode = body.areaFamilyCode;
    payload.communicativeContexts = arr(body.communicativeContexts);
    payload.progressionNotes = body.progressionNotes;
  },
  benchmarks(body, payload) {
    payload.benchmarkNumber = i(body.benchmarkNumber, null);
    payload.stageBandLabel = body.stageBandLabel;
    payload.summaryStatement = body.summaryStatement;
    payload.profileOfAbilityId = body.profileOfAbilityId;
    payload.competencyIds = arr(body.competencyIds);
    payload.featureIds = arr(body.featureIds);
    payload.sampleTaskLabelIds = arr(body.sampleTaskLabelIds);
  },
  competencies(body, payload) {
    payload.competencyStatement = body.competencyStatement;
    payload.communicativePurpose = body.communicativePurpose;
    payload.indicatorIds = arr(body.indicatorIds);
    payload.featureIds = arr(body.featureIds);
    payload.sampleTaskLabelIds = arr(body.sampleTaskLabelIds);
  },
  indicators(body, payload) {
    payload.indicatorText = body.indicatorText;
    payload.indicatorCategory = body.indicatorCategory;
    payload.indicatorDimension = body.indicatorDimension;
    payload.evidenceType = body.evidenceType;
  },
  profileOfAbility(body, payload) {
    payload.descriptorSummary = body.descriptorSummary;
    payload.descriptorDimensions = arr(body.descriptorDimensions);
    payload.featureIds = arr(body.featureIds);
  },
  featuresOfCommunication(body, payload) {
    payload.scopeType = body.scopeType;
    payload.scopeSkillId = body.scopeSkillId;
    payload.scopeBenchmarkId = body.scopeBenchmarkId;
    payload.scopeCompetencyId = body.scopeCompetencyId;
    payload.featureDimension = body.featureDimension;
    payload.featureValue = body.featureValue;
    payload.complexityLevel = body.complexityLevel;
  },
  sampleTaskLabels(body, payload) {
    payload.taskLabelText = body.taskLabelText;
    payload.contextDomain = body.contextDomain;
    payload.taskType = body.taskType;
    payload.officialSample = b(body.officialSample, false);
    payload.linkedBenchmarkId = body.linkedBenchmarkId;
    payload.linkedCompetencyId = body.linkedCompetencyId;
  }
});

function toPayload(entityKey, body = {}) {
  const hasIsActive = Object.prototype.hasOwnProperty.call(body, 'isActive');
  const hasIsSystem = Object.prototype.hasOwnProperty.call(body, 'isSystem');
  const hasIsLocked = Object.prototype.hasOwnProperty.call(body, 'isLocked');

  const payload = {
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
    relatedIds: arr(body.relatedIds),
    tags: arr(body.tags),
    sourceRefs: parseSourceRefs(body.sourceRefs),
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

  const semanticMapper = SEMANTIC_PAYLOAD_MAPPERS[entityKey];
  if (typeof semanticMapper === 'function') semanticMapper(body, payload);

  return payload;
}

async function loadOptions(reqUser) {
  const [
    frameworks,
    stages,
    skills,
    benchmarks,
    competencyAreas,
    competencies,
    indicators,
    profileOfAbility,
    featuresOfCommunication,
    sampleTaskLabels,
    sources,
    fragments
  ] = await Promise.all([
    benchpathDataService.fetchData('clbFrameworks', {}, reqUser),
    benchpathDataService.fetchData('clbStages', {}, reqUser),
    benchpathDataService.fetchData('clbSkills', {}, reqUser),
    benchpathDataService.fetchData('clbBenchmarks', {}, reqUser),
    benchpathDataService.fetchData('clbCompetencyAreas', {}, reqUser),
    benchpathDataService.fetchData('clbCompetencies', {}, reqUser),
    benchpathDataService.fetchData('clbIndicators', {}, reqUser),
    benchpathDataService.fetchData('clbProfileOfAbility', {}, reqUser),
    benchpathDataService.fetchData('clbFeaturesOfCommunication', {}, reqUser),
    benchpathDataService.fetchData('clbSampleTaskLabels', {}, reqUser),
    benchpathDataService.fetchData('sources', {}, reqUser),
    benchpathDataService.fetchData('sourceFragments', {}, reqUser)
  ]);

  return {
    frameworks,
    stages,
    skills,
    benchmarks,
    competencyAreas,
    competencies,
    indicators,
    profileOfAbility,
    featuresOfCommunication,
    sampleTaskLabels,
    sources,
    fragments
  };
}

function createClbReferenceEntityController(entityKey) {
  const def = benchpathDataService.getReferenceEntityDef(entityKey);
  const entityType = benchpathDataService.resolveReferenceEntityType(entityKey);
  const listConfig = getListConfig(entityKey);
  if (!entityType) throw new Error(`Unknown BenchPath reference entity type for key: ${entityKey}`);

  async function listItems(req, res) {
    try {
      const query = await buildDataServiceQuery(req.query, {
        allowedExactKeys: listConfig.allowedExactKeys || DEFAULT_ALLOWED_EXACT_KEYS,
        defaultSearchFields: listConfig.searchableFields || DEFAULT_SEARCH_FIELDS,
        allowedSearchFields: listConfig.searchableFields || DEFAULT_SEARCH_FIELDS
      });
      const pagedQuery = { ...(query || {}) };
      const hasUserSort = Boolean(s(pagedQuery.sort) || s(pagedQuery.order));
      const canUseDefaultSort = !hasUserSort && Array.isArray(listConfig.defaultSort) && listConfig.defaultSort.length > 0;

      let data = [];
      let pagination = null;

      if (canUseDefaultSort) {
        const fullQuery = stripPaginationFromQuery(pagedQuery);
        const fullRows = await benchpathDataService.fetchData(entityType, fullQuery, req.user);
        if (fullRows.length <= IN_MEMORY_DEFAULT_SORT_THRESHOLD) {
          const sortedRows = sortByDefaultConfig(fullRows, listConfig.defaultSort);
          const pagedRows = paginate(sortedRows, pagedQuery.page, pagedQuery.limit);
          data = Array.isArray(pagedRows?.data) ? pagedRows.data : [];
          pagination = pagedRows?.pagination || null;
        } else {
          const defaultSortExpression = buildSortExpressionFromConfig(listConfig.defaultSort);
          if (defaultSortExpression) {
            pagedQuery.sort = defaultSortExpression;
          }
          const paged = await benchpathDataService.fetchDataPaged(entityType, pagedQuery, req.user);
          data = Array.isArray(paged?.rows) ? paged.rows : [];
          pagination = paged?.pagination || null;
        }
      } else {
        const paged = await benchpathDataService.fetchDataPaged(entityType, pagedQuery, req.user);
        data = Array.isArray(paged?.rows) ? paged.rows : [];
        pagination = paged?.pagination || null;
      }

      const rows = buildListRows(data, listConfig.columns || []);
      const searchableFields = listConfig.searchableFields || DEFAULT_SEARCH_FIELDS;

      if (isAjax(req)) return res.json({ status: 'success', data: rows, pagination, searchableFields });

      res.render('benchpath/referenceCatalog/items', {
        title: def.title,
        entity: def,
        data: rows,
        listConfig,
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
    const options = await loadOptions(req.user);
    const referenceMeta = benchpathDataService.getReferenceFormMeta();

    res.render('benchpath/clbReference/referenceForm', {
      title,
      entity: def,
      entityKey,
      entityFormMeta: ENTITY_FORM_META[entityKey] || null,
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
      const payload = toPayload(entityKey, req.body);
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
      const payload = toPayload(entityKey, req.body);
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

module.exports = { createClbReferenceEntityController };
