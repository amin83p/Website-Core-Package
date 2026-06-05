const { requireCoreModule } = require('./creditCoreModuleResolver');

const { requireAuth } = requireCoreModule('MVC/middleware/authMiddleware');
const adminChekersService = requireCoreModule('MVC/services/adminChekersService');
const dataService = requireCoreModule('MVC/services/dataService');
const dashboardController = requireCoreModule('MVC/controllers/dashboardController');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const {
  getActiveOrgIdOrThrow,
  assertCreateOrgContextOrThrow,
  assertOrgAccess,
  normalizeOrgRoles,
  getPrimaryOrgRole
} = requireCoreModule('MVC/utils/orgContextUtils');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const repositoryBackendSelector = requireCoreModule('MVC/repositories/backend/repositoryBackendSelector');
const mongoConnection = requireCoreModule('MVC/infrastructure/mongo/mongoConnection');
const mongoRepositoryUtils = requireCoreModule('MVC/repositories/backend/mongoRepositoryUtils');
const fileQueue = requireCoreModule('MVC/models/fileQueue');

module.exports = {
  requireCoreModule,
  requireAuth,
  adminChekersService,
  dataService,
  dashboardController,
  idsEqual,
  toPublicId,
  getActiveOrgIdOrThrow,
  assertCreateOrgContextOrThrow,
  assertOrgAccess,
  normalizeOrgRoles,
  getPrimaryOrgRole,
  paginate,
  runByRepositoryBackend: repositoryBackendSelector.runByRepositoryBackend,
  getMongoCollection: mongoConnection.getMongoCollection,
  ...mongoRepositoryUtils,
  queueWrite: fileQueue.queueWrite
};

