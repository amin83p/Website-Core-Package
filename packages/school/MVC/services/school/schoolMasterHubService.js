const dataService = require('./schoolDataService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');
const dataServiceGlobal = requireCoreModule('MVC/services/dataService');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const { buildDataServiceQuery } = requireCoreModule('MVC/utils/generalTools');
const accessService = requireCoreModule('MVC/services/security');
const adminAuthorityService = requireCoreModule('MVC/services/adminAuthorityService');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

const PERSON_QUERY_OPTIONS = Object.freeze({ enrichment: { includeSchoolRoles: false } });

const PEOPLE_MODULES = Object.freeze([
  {
    type: 'teachers',
    label: 'Teachers',
    singular: 'Teacher',
    sectionId: SECTIONS.SCHOOL_TEACHERS,
    entityType: 'teachers',
    icon: 'bi bi-person-workspace',
    color: 'text-success',
    directoryUrl: '/school/teachers'
  },
  {
    type: 'students',
    label: 'Students',
    singular: 'Student',
    sectionId: SECTIONS.SCHOOL_STUDENTS,
    entityType: 'students',
    icon: 'bi bi-person-vcard-fill',
    color: 'text-primary',
    directoryUrl: '/school/students'
  },
  {
    type: 'staff',
    label: 'Staff',
    singular: 'Staff',
    sectionId: SECTIONS.SCHOOL_STAFF,
    entityType: 'staff',
    icon: 'bi bi-people-fill',
    color: 'text-info',
    directoryUrl: '/school/staff'
  }
]);

function normalizeText(value = '') {
  return String(value || '').trim();
}

function lower(value = '') {
  return normalizeText(value).toLowerCase();
}

function isArchived(moduleType, row) {
  const statusValue = moduleType === 'students'
    ? row?.academicStatus
    : row?.status;
  return lower(statusValue) === 'archived';
}

function buildPersonName(person) {
  const firstName = normalizeText(person?.name?.first || 'Unknown');
  const lastName = normalizeText(person?.name?.last || 'Person');
  return `${firstName} ${lastName}`.trim();
}

function enrichRows(moduleConfig, rows, persons, departments) {
  const personRows = Array.isArray(persons) ? persons : [];
  const deptById = new Map((Array.isArray(departments) ? departments : []).map((row) => [
    String(row?.id || ''),
    normalizeText(row?.name || row?.id || '-')
  ]));

  return (Array.isArray(rows) ? rows : []).map((row) => {
    const person = personRows.find((candidate) => idsEqual(candidate?.id, row?.personId));
    const firstName = normalizeText(person?.name?.first || 'Unknown');
    const lastName = normalizeText(person?.name?.last || 'Person');
    const base = {
      id: normalizeText(row?.id),
      personId: normalizeText(row?.personId),
      firstName,
      lastName,
      name: buildPersonName(person),
      email: normalizeText(person?.contact?.email || 'N/A'),
      phone: normalizeText(person?.contact?.phones?.[0]?.number || 'N/A'),
      orgId: normalizeText(row?.orgId),
      directoryUrl: `${moduleConfig.directoryUrl}/edit/${encodeURIComponent(normalizeText(row?.id))}`,
      actions: [
        {
          label: 'Edit',
          icon: 'bi bi-pencil-square',
          tone: 'secondary',
          href: `${moduleConfig.directoryUrl}/edit/${encodeURIComponent(normalizeText(row?.id))}`
        },
        {
          label: 'Archive',
          icon: 'bi bi-archive',
          tone: 'warning',
          href: `${moduleConfig.directoryUrl}/archive/${encodeURIComponent(normalizeText(row?.id))}`
        },
        {
          label: 'Delete',
          icon: 'bi bi-trash',
          tone: 'danger',
          href: `${moduleConfig.directoryUrl}/delete/${encodeURIComponent(normalizeText(row?.id))}`
        }
      ]
    };

    if (moduleConfig.type === 'students') {
      return {
        ...base,
        status: normalizeText(row?.academicStatus || 'Active'),
        detail: normalizeText(row?.feeCategory || row?.studentAccountId || '-'),
        detailLabel: 'Fee / Account'
      };
    }

    return {
      ...base,
      status: normalizeText(row?.status || 'Active'),
      detail: deptById.get(String(row?.departmentId || '')) || '-',
      detailLabel: 'Department'
    };
  });
}

function rowMatchesSearch(row, searchTerm) {
  if (!searchTerm) return true;
  const haystack = [
    row.id,
    row.personId,
    row.firstName,
    row.lastName,
    row.name,
    row.email,
    row.phone,
    row.status,
    row.detail,
    row.orgId
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(searchTerm);
}

async function evaluateModuleAccess(req, moduleConfig) {
  const user = req?.user;
  if (!user || !moduleConfig?.sectionId) return { allowed: false, scopeId: '' };

  if (await adminAuthorityService.isAdminForRequestAsync(user, moduleConfig.sectionId, OPERATIONS.READ_ALL, {
    section: { id: moduleConfig.sectionId }
  })) {
    return { allowed: true, scopeId: '' };
  }

  const evaluation = await accessService.evaluateAccess({
    user,
    sectionId: moduleConfig.sectionId,
    operationId: OPERATIONS.READ_ALL,
    ipAddress: req?.ip
  });

  return {
    allowed: evaluation?.allowed === true,
    scopeId: normalizeText(evaluation?.scopeId)
  };
}

async function resolveAccessibleModules(req) {
  const modules = [];
  for (const moduleConfig of PEOPLE_MODULES) {
    // eslint-disable-next-line no-await-in-loop
    const access = await evaluateModuleAccess(req, moduleConfig);
    if (access.allowed) {
      modules.push({
        type: moduleConfig.type,
        label: moduleConfig.label,
        singular: moduleConfig.singular,
        sectionId: moduleConfig.sectionId,
        icon: moduleConfig.icon,
        color: moduleConfig.color,
        directoryUrl: moduleConfig.directoryUrl,
        scopeId: access.scopeId
      });
    }
  }
  return modules;
}

function findModule(type) {
  return PEOPLE_MODULES.find((item) => item.type === lower(type)) || null;
}

async function getPeoplePanelRows(type, queryInput, req) {
  const moduleConfig = findModule(type);
  if (!moduleConfig) {
    const error = new Error('Unknown people list requested.');
    error.statusCode = 400;
    throw error;
  }

  const access = await evaluateModuleAccess(req, moduleConfig);
  if (!access.allowed) {
    const error = new Error(`You do not have access to ${moduleConfig.label}.`);
    error.statusCode = 403;
    throw error;
  }

  const query = await buildDataServiceQuery(queryInput || {});
  const searchTerm = lower(query.q);
  if (searchTerm.length < 2) {
    return {
      module: {
        type: moduleConfig.type,
        label: moduleConfig.label,
        singular: moduleConfig.singular,
        sectionId: moduleConfig.sectionId,
        icon: moduleConfig.icon,
        directoryUrl: moduleConfig.directoryUrl
      },
      rows: [],
      pagination: { page: 1, limit: Number(query.limit || 25), total: 0, totalPages: 0 },
      total: 0,
      refreshedAt: new Date().toISOString(),
      minimumSearchLength: 2
    };
  }
  const fetchQuery = { ...query };
  delete fetchQuery.q;
  delete fetchQuery.type;
  delete fetchQuery.searchFields;

  const [peopleRows, persons, departments] = await Promise.all([
    dataService.fetchData(moduleConfig.entityType, fetchQuery, req.user, { scopeId: access.scopeId }),
    dataServiceGlobal.fetchData('persons', {}, req.user, PERSON_QUERY_OPTIONS),
    moduleConfig.type === 'students'
      ? Promise.resolve([])
      : dataService.fetchData('departments', {}, req.user)
  ]);

  const enriched = enrichRows(moduleConfig, peopleRows, persons, departments)
    .filter((row) => !isArchived(moduleConfig.type, row))
    .filter((row) => rowMatchesSearch(row, searchTerm));
  const { data, pagination } = paginate(enriched, {
    ...query,
    page: Number(query.page || 1),
    limit: Number(query.limit || 25)
  });

  return {
    module: {
      type: moduleConfig.type,
      label: moduleConfig.label,
      singular: moduleConfig.singular,
      sectionId: moduleConfig.sectionId,
      icon: moduleConfig.icon,
      directoryUrl: moduleConfig.directoryUrl
    },
    rows: data,
    pagination,
    total: enriched.length,
    refreshedAt: new Date().toISOString()
  };
}

module.exports = {
  resolveAccessibleModules,
  getPeoplePanelRows
};
