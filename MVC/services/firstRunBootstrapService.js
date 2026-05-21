const dataService = require('./dataService');
const dataBackendRuntimeService = require('./dataBackendRuntimeService');
const { SECTIONS } = require('../../config/accessConstants');
const { SYSTEM_CONTEXT } = require('../../config/constants');

const CACHE_TTL_MS = 15 * 1000;

const BYPASS_SECTION_IDS = new Set([
  SECTIONS.SYSTEM_SETTINGS,
  SECTIONS.SYSTEM_UPLOAD_FOLDERS,
  SECTIONS.UPLOADED_FILES,
  SECTIONS.USERS,
  SECTIONS.PERSONS,
  SECTIONS.SECTIONS,
  SECTIONS.OPERATIONS,
  SECTIONS.SCOPES,
  SECTIONS.SYMBOLS,
  SECTIONS.ACCESS_POLICIES,
  SECTIONS.ROLES,
  SECTIONS.ACCESS_PROFILES,
  SECTIONS.WEBSITE_POLICY
].filter(Boolean).map((value) => String(value).trim().toUpperCase()));

const cache = {
  expiresAt: 0,
  state: null
};

function nowMs() {
  return Date.now();
}

function normalizeToken(value = '') {
  return String(value || '').trim().toUpperCase();
}

function isEligibleUser(user = null) {
  if (!user || typeof user !== 'object') return false;
  const hasSystemProfile = Boolean(String(user.systemAccessProfileId || '').trim());
  const activeOrgToken = String(user.activeOrgId || '').trim().toUpperCase();
  const currentProfileMode = String(user.currentProfileMode || '').trim().toUpperCase();
  const allowedOrgs = Array.isArray(user.allowedOrgs) ? user.allowedOrgs : [];
  const hasSystemAllowedOrg = allowedOrgs.some((org) => String(org?.orgId || '').trim().toUpperCase() === 'SYSTEM');
  return Boolean(
    user.isVirtualSuperAdmin === true
    || user.isSuperAdmin === true
    || user.isSystemAdmin === true
    || user.canSwitchProfile === true
    || currentProfileMode === 'SYSTEM'
    || activeOrgToken === 'SYSTEM'
    || hasSystemAllowedOrg
    || hasSystemProfile
  );
}

function isBypassSection(sectionId = '') {
  const token = normalizeToken(sectionId);
  return token ? BYPASS_SECTION_IDS.has(token) : false;
}

function resolveRequestedMode() {
  const backendStatus = dataBackendRuntimeService.getPublicBackendStatus() || {};
  const requestedMode = String(
    backendStatus?.runtime?.requestedMode
    || backendStatus?.requested
    || backendStatus?.mode
    || 'json'
  ).trim().toLowerCase();
  return requestedMode;
}

async function countRows(entityName) {
  try {
    const rows = await dataService.fetchData(entityName, {}, SYSTEM_CONTEXT);
    if (!Array.isArray(rows)) return 0;
    return rows.length;
  } catch (error) {
    return 0;
  }
}

async function loadBootstrapReadiness() {
  const [sectionCount, operationCount, accessProfileCount] = await Promise.all([
    countRows('sections'),
    countRows('operations'),
    countRows('accesses')
  ]);

  const checks = [
    {
      key: 'sections',
      label: 'Sections',
      ready: sectionCount > 0,
      count: sectionCount
    },
    {
      key: 'operations',
      label: 'Operations',
      ready: operationCount > 0,
      count: operationCount
    },
    {
      key: 'accesses',
      label: 'Access Profiles',
      ready: accessProfileCount > 0,
      count: accessProfileCount
    }
  ];

  const missing = checks.filter((item) => item.ready !== true);
  return {
    checks,
    counts: {
      sections: sectionCount,
      operations: operationCount,
      accesses: accessProfileCount
    },
    missingKeys: missing.map((item) => item.key),
    missingLabels: missing.map((item) => item.label),
    ready: missing.length === 0
  };
}

async function resolveBootstrapState(options = {}) {
  const forceRefresh = options && options.forceRefresh === true;
  if (!forceRefresh && cache.state && cache.expiresAt > nowMs()) {
    return cache.state;
  }

  const requestedMode = resolveRequestedMode();
  const mongoRequested = requestedMode === 'mongo';
  const readiness = await loadBootstrapReadiness();
  const active = Boolean(mongoRequested && !readiness.ready);

  const state = {
    requestedMode,
    mongoRequested,
    ready: readiness.ready,
    checks: readiness.checks,
    counts: readiness.counts,
    missingKeys: readiness.missingKeys,
    missingLabels: readiness.missingLabels,
    active
  };

  cache.state = state;
  cache.expiresAt = nowMs() + CACHE_TTL_MS;
  return state;
}

async function resolveUserBootstrapContext(user, options = {}) {
  const state = await resolveBootstrapState(options);
  const eligible = isEligibleUser(user);
  return {
    ...state,
    eligible,
    bypassEnabled: Boolean(state.active && eligible)
  };
}

async function isBypassAllowed({ user, sectionId } = {}) {
  if (!isBypassSection(sectionId)) return false;
  const context = await resolveUserBootstrapContext(user);
  return context.bypassEnabled === true;
}

function clearBootstrapStateCache() {
  cache.state = null;
  cache.expiresAt = 0;
}

module.exports = {
  BYPASS_SECTION_IDS,
  isEligibleUser,
  isBypassSection,
  resolveBootstrapState,
  resolveUserBootstrapContext,
  isBypassAllowed,
  clearBootstrapStateCache
};
