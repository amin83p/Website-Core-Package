const constants = require('../../../../../config/constants');
const adminChekersService = require('../../../../../MVC/services/adminChekersService');
const activityQuotaLedgerService = require('../../../../../MVC/services/activityQuotaLedgerService');
const consumptionDefinitionPolicyService = require('../../../../../MVC/services/activityQuota/consumptionDefinitionPolicyService');
const packageDataService = require('../../../../../MVC/services/activityQuota/packageDataService');
const packageManagerDataService = require('../../../../../MVC/services/activityQuota/packageManagerDataService');
const coreFilesService = require('../../../../../MVC/services/coreFilesService');
const uploadCategoryResolverService = require('../../../../../MVC/services/uploadCategoryResolverService');
const uploadFolderSettingsService = require('../../../../../MVC/services/uploadFolderSettingsService');
const settingService = require('../../../../../MVC/services/settingService');
const dataService = require('../../../../../MVC/services/dataService');
const publicRegistrationService = require('../../../../../MVC/services/person/publicRegistrationService');
const userAccessProfileService = require('../../../../../MVC/services/users/userAccessProfileService');
const { normalizeMembershipPayload } = require('../../../../../MVC/services/security/entitlementService');
const { normalizeQueryOptions } = require('../../../../../MVC/utils/queryOptionsAdapter');
const { resolveEntity } = require('../../../../../MVC/utils/entityResolver');
const { applyGenericFilter } = require('../../../../../MVC/utils/queryEngine');
const { idsEqual, toPublicId } = require('../../../../../MVC/utils/idAdapter');
const {
  assertCreateOrgContextOrThrow,
  getActiveOrgIdOrThrow,
  normalizeOrgRoles,
  getPrimaryOrgRole
} = require('../../../../../MVC/utils/orgContextUtils');
const { decrypt } = require('../../../../../MVC/utils/encyptors');
const paginate = require('../../../../../MVC/utils/paginationHelper');
const {
  buildDataServiceQuery,
  inferSearchableFields,
  isAjax
} = require('../../../../../MVC/utils/generalTools');
const {
  isRailwayProxyMode,
  getGatewayBaseUrl,
  getGatewayTimeoutMs
} = require('../../../../../MVC/utils/uploadModeUtils');
const uploadPathUtils = require('../../../../../MVC/utils/uploadPathUtils');
const { resolveCanonicalOrganizationName } = require('../../../../../MVC/utils/organizationDisplay');
const repositoryBackendSelector = require('../../../../../MVC/repositories/backend/repositoryBackendSelector');
const mongoRepositoryUtils = require('../../../../../MVC/repositories/backend/mongoRepositoryUtils');
const crudRepositoryContract = require('../../../../../MVC/repositories/contracts/crudRepositoryContract');
const userMembershipRepository = require('../../../../../MVC/repositories/userMembershipRepository');
const activityQuotaPackageAssignmentRepository = require('../../../../../MVC/repositories/activityQuotaPackageAssignmentRepository');
const mongoConnection = require('../../../../../MVC/infrastructure/mongo/mongoConnection');
const { requireAuth } = require('../../../../../MVC/middleware/authMiddleware');
const { requireAccess } = require('../../../../../MVC/middleware/accessMiddleware');
const { trackActionState } = require('../../../../../MVC/middleware/actionStateMiddleware');
const upload = require('../../../../../MVC/middleware/upload');
const { resolveActivityQuotaPolicy } = require('../../../../../MVC/middleware/activityQuotaMiddleware');

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
