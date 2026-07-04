const accessUiService = require('../security/accessUiService');
const { SECTIONS, OPERATIONS } = require('../../../packages/activityQuota/config/accessConstants');

const READ_ACTIONS = Object.freeze([
  { sectionId: SECTIONS.ACTIVITY_QUOTA_OVERVIEW, operationId: OPERATIONS.READ_ALL },
  { sectionId: SECTIONS.ACTIVITY_QUOTA_CREDIT_CHECK, operationId: OPERATIONS.READ },
  { sectionId: SECTIONS.ACTIVITY_QUOTA_LEDGER, operationId: OPERATIONS.READ_ALL },
  { sectionId: SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, operationId: OPERATIONS.READ_ALL },
  { sectionId: SECTIONS.ACTIVITY_QUOTA_PACKAGE, operationId: OPERATIONS.READ_ALL },
  { sectionId: SECTIONS.ACTIVITY_QUOTA_PACKAGE_MANAGER, operationId: OPERATIONS.READ_ALL },
  { sectionId: SECTIONS.ACTIVITY_QUOTA_RULES, operationId: OPERATIONS.READ_ALL }
]);

function buildNavigationActions(options = {}) {
  const dashboardHref = options.dashboardHref || `/dashboard/section-nav/${encodeURIComponent(SECTIONS.ACTIVITY_QUOTA)}`;
  return [
    {
      key: 'dashboard',
      label: 'Activity Quota Dashboard',
      href: dashboardHref,
      icon: 'bi-speedometer2',
      className: 'activity-quota-navigator-dashboard btn btn-filled btn-secondary btn-md mb-2',
      anyOf: READ_ACTIONS
    },
    {
      key: 'overview',
      label: 'Overview',
      href: '/activity-quota/overview',
      icon: 'bi-graph-up',
      sectionId: SECTIONS.ACTIVITY_QUOTA_OVERVIEW,
      operationId: OPERATIONS.READ_ALL
    },
    {
      key: 'creditCheck',
      label: 'Credit Check',
      href: '/activity-quota/credit-check',
      icon: 'bi-patch-check',
      sectionId: SECTIONS.ACTIVITY_QUOTA_CREDIT_CHECK,
      operationId: OPERATIONS.READ
    },
    {
      key: 'ledger',
      label: 'Ledger',
      href: '/activity-quota/ledger',
      icon: 'bi-journal-text',
      sectionId: SECTIONS.ACTIVITY_QUOTA_LEDGER,
      operationId: OPERATIONS.READ_ALL
    },
    {
      key: 'addCredit',
      label: 'Add Credit',
      href: '/activity-quota/add-credit',
      icon: 'bi-plus-circle',
      sectionId: SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT,
      operationId: OPERATIONS.READ_ALL
    },
    {
      key: 'groupedCredits',
      label: 'Grouped Credits',
      href: '/activity-quota/add-credit/groups',
      icon: 'bi-diagram-3',
      sectionId: SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT,
      operationId: OPERATIONS.READ_ALL
    },
    {
      key: 'packages',
      label: 'Packages',
      href: '/activity-quota/packages',
      icon: 'bi-box-seam',
      sectionId: SECTIONS.ACTIVITY_QUOTA_PACKAGE,
      operationId: OPERATIONS.READ_ALL
    },
    {
      key: 'packageManager',
      label: 'Package Manager',
      href: '/activity-quota/package-manager',
      icon: 'bi-people',
      sectionId: SECTIONS.ACTIVITY_QUOTA_PACKAGE_MANAGER,
      operationId: OPERATIONS.READ_ALL
    },
    {
      key: 'rules',
      label: 'Rules',
      href: '/activity-quota/rules',
      icon: 'bi-sliders',
      sectionId: SECTIONS.ACTIVITY_QUOTA_RULES,
      operationId: OPERATIONS.READ_ALL
    }
  ];
}

async function buildPageActions(req, options = {}) {
  const excluded = new Set(Array.isArray(options.exclude) ? options.exclude : []);
  const included = new Set(Array.isArray(options.include) ? options.include : []);
  const actions = buildNavigationActions(options)
    .filter((action) => !excluded.has(action.key))
    .filter((action) => !included.size || included.has(action.key));
  return accessUiService.filterActions(req, actions);
}

async function buildManageButtons(req, options = {}) {
  const actions = await buildPageActions(req, options);
  return accessUiService.renderActions(actions);
}

async function buildCrudFlags(req, sectionId) {
  return accessUiService.accessFlags(req, sectionId, {
    canCreate: OPERATIONS.CREATE,
    canUpdate: OPERATIONS.UPDATE,
    canDelete: OPERATIONS.DELETE
  });
}

module.exports = {
  buildCrudFlags,
  buildManageButtons,
  buildNavigationActions,
  buildPageActions
};
