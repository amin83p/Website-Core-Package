const { requireCoreModule } = require('./pteCoreModuleResolver');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

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
const actionStateChangeTrackerService = requireCoreModule('MVC/services/actionStateChangeTrackerService');
const securityService = requireCoreModule('MVC/services/security');
const accessUiService = requireCoreModule('MVC/services/security/accessUiService');
const fileQueueModel = requireCoreModule('MVC/models/fileQueue');
const { requireAuth } = requireCoreModule('MVC/middleware/authMiddleware');
const { requireAccess } = requireCoreModule('MVC/middleware/accessMiddleware');
const { trackActionState } = requireCoreModule('MVC/middleware/actionStateMiddleware');
const upload = requireCoreModule('MVC/middleware/upload');
const { resolveActivityQuotaPolicy } = requireCoreModule('MVC/middleware/activityQuotaMiddleware');

module.exports = {
  constants,
  DEFAULTS: constants.DEFAULTS,
  SYSTEM_CONTEXT: constants.SYSTEM_CONTEXT,
  SECTIONS,
  OPERATIONS,
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
  requireCoreModule,
  runByRepositoryBackend: repositoryBackendSelector.runByRepositoryBackend,
  assertQueryableCrudRepository: crudRepositoryContract.assertQueryableCrudRepository,
  repositoryBackendSelector,
  mongoRepositoryUtils,
  crudRepositoryContract,
  userMembershipRepository,
  activityQuotaPackageAssignmentRepository,
  actionStateChangeTrackerService,
  securityService,
  accessUiService,
  fileQueueModel,
  mongoConnection,
  getMongoCollection: mongoConnection.getMongoCollection,
  requireAuth,
  requireAccess,
  trackActionState,
  upload,
  resolveActivityQuotaPolicy
};
