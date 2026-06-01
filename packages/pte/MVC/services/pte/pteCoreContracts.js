const fs = require('fs');
const path = require('path');

function normalizeFilePath(value = '') {
  return String(value || '').replace(/\\/g, '/').trim();
}

function buildCoreRootCandidates() {
  const unique = new Set();
  const out = [];
  const pushCandidate = (value = '') => {
    const resolved = path.resolve(value);
    const key = normalizeFilePath(resolved).toLowerCase();
    if (!key || unique.has(key)) return;
    unique.add(key);
    out.push(resolved);
  };

  const envRoot = normalizeFilePath(process.env.PACKAGE_CORE_ROOT || '');
  if (envRoot) pushCandidate(envRoot);

  // Repository runtime: <root>/packages/pte/MVC/services/pte
  pushCandidate(path.resolve(__dirname, '../../../../../'));
  // Installed runtime: <root>/uploads/packages/pte/MVC/services/pte
  pushCandidate(path.resolve(__dirname, '../../../../../../'));
  // Final fallback to current process root.
  pushCandidate(process.cwd());

  return out;
}

function fileLooksLoadable(absPath = '') {
  if (!absPath) return false;
  if (fs.existsSync(absPath)) return true;
  if (fs.existsSync(`${absPath}.js`)) return true;
  return fs.existsSync(path.join(absPath, 'index.js'));
}

function requireCoreModule(relativeModulePath = '') {
  const rel = normalizeFilePath(relativeModulePath);
  let lastError = null;
  const tried = [];
  const roots = buildCoreRootCandidates();

  for (const root of roots) {
    const absPath = path.resolve(root, rel);
    tried.push(absPath);
    if (!fileLooksLoadable(absPath)) continue;
    try {
      return require(absPath);
    } catch (error) {
      lastError = error;
    }
  }

  const suffix = lastError ? ` Last error: ${lastError.message}` : '';
  throw new Error(`Unable to resolve core module "${rel}". Tried: ${tried.join(', ')}.${suffix}`);
}

const constants = requireCoreModule('config/constants');
const adminChekersService = requireCoreModule('MVC/services/adminChekersService');
const activityQuotaLedgerService = requireCoreModule('MVC/services/activityQuotaLedgerService');
const consumptionDefinitionPolicyService = requireCoreModule('MVC/services/activityQuota/consumptionDefinitionPolicyService');
const packageDataService = requireCoreModule('MVC/services/activityQuota/packageDataService');
const packageManagerDataService = requireCoreModule('MVC/services/activityQuota/packageManagerDataService');
const coreFilesService = requireCoreModule('MVC/services/coreFilesService');
const uploadCategoryResolverService = requireCoreModule('MVC/services/uploadCategoryResolverService');
const uploadFolderSettingsService = requireCoreModule('MVC/services/uploadFolderSettingsService');
const settingService = requireCoreModule('MVC/services/settingService');
const dataService = requireCoreModule('MVC/services/dataService');
const publicRegistrationService = requireCoreModule('MVC/services/person/publicRegistrationService');
const userAccessProfileService = requireCoreModule('MVC/services/users/userAccessProfileService');
const { normalizeMembershipPayload } = requireCoreModule('MVC/services/security/entitlementService');
const { normalizeQueryOptions } = requireCoreModule('MVC/utils/queryOptionsAdapter');
const { resolveEntity } = requireCoreModule('MVC/utils/entityResolver');
const { applyGenericFilter } = requireCoreModule('MVC/utils/queryEngine');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const {
  assertCreateOrgContextOrThrow,
  getActiveOrgIdOrThrow,
  normalizeOrgRoles,
  getPrimaryOrgRole
} = requireCoreModule('MVC/utils/orgContextUtils');
const { decrypt } = requireCoreModule('MVC/utils/encyptors');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const {
  buildDataServiceQuery,
  inferSearchableFields,
  isAjax
} = requireCoreModule('MVC/utils/generalTools');
const {
  isRailwayProxyMode,
  getGatewayBaseUrl,
  getGatewayTimeoutMs
} = requireCoreModule('MVC/utils/uploadModeUtils');
const uploadPathUtils = requireCoreModule('MVC/utils/uploadPathUtils');
const { resolveCanonicalOrganizationName } = requireCoreModule('MVC/utils/organizationDisplay');
const repositoryBackendSelector = requireCoreModule('MVC/repositories/backend/repositoryBackendSelector');
const mongoRepositoryUtils = requireCoreModule('MVC/repositories/backend/mongoRepositoryUtils');
const crudRepositoryContract = requireCoreModule('MVC/repositories/contracts/crudRepositoryContract');
const userMembershipRepository = requireCoreModule('MVC/repositories/userMembershipRepository');
const activityQuotaPackageAssignmentRepository = requireCoreModule('MVC/repositories/activityQuotaPackageAssignmentRepository');
const mongoConnection = requireCoreModule('MVC/infrastructure/mongo/mongoConnection');
const { requireAuth } = requireCoreModule('MVC/middleware/authMiddleware');
const { requireAccess } = requireCoreModule('MVC/middleware/accessMiddleware');
const { trackActionState } = requireCoreModule('MVC/middleware/actionStateMiddleware');
const upload = requireCoreModule('MVC/middleware/upload');
const { resolveActivityQuotaPolicy } = requireCoreModule('MVC/middleware/activityQuotaMiddleware');

module.exports = {
  constants,
  DEFAULTS: constants.DEFAULTS,
  SYSTEM_CONTEXT: constants.SYSTEM_CONTEXT,
  adminChekersService,
  activityQuotaLedgerService,
  consumptionDefinitionPolicyService,
  packageDataService,
  packageManagerDataService,
  coreFilesService,
  uploadCategoryResolverService,
  uploadFolderSettingsService,
  settingService,
  dataService,
  publicRegistrationService,
  userAccessProfileService,
  normalizeMembershipPayload,
  normalizeQueryOptions,
  resolveEntity,
  applyGenericFilter,
  idsEqual,
  toPublicId,
  assertCreateOrgContextOrThrow,
  getActiveOrgIdOrThrow,
  normalizeOrgRoles,
  getPrimaryOrgRole,
  decrypt,
  paginate,
  buildDataServiceQuery,
  inferSearchableFields,
  isAjax,
  isRailwayProxyMode,
  getGatewayBaseUrl,
  getGatewayTimeoutMs,
  uploadPathUtils,
  resolveCanonicalOrganizationName,
  runByRepositoryBackend: repositoryBackendSelector.runByRepositoryBackend,
  repositoryBackendSelector,
  mongoRepositoryUtils,
  crudRepositoryContract,
  userMembershipRepository,
  activityQuotaPackageAssignmentRepository,
  mongoConnection,
  getMongoCollection: mongoConnection.getMongoCollection,
  requireAuth,
  requireAccess,
  trackActionState,
  upload,
  resolveActivityQuotaPolicy
};
