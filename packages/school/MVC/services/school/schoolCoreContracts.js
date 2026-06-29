const { requireCoreModule: requireCoreModuleRaw } = require('./schoolCoreModuleResolver');

const constants = requireCoreModuleRaw('config/constants');

let wrappedDataService = null;

function isSystemContext(requestingUser) {
  if (!requestingUser) return false;
  if (requestingUser === constants.SYSTEM_CONTEXT) return true;
  return String(requestingUser?.id || requestingUser?.userId || '').trim().toUpperCase() === 'SYSTEM';
}

function normalizeEntityType(value = '') {
  return String(value || '').trim().toLowerCase();
}

function shouldBridgeSchoolPersons(entityType, requestingUser, options = {}) {
  if (normalizeEntityType(entityType) !== 'persons') return false;
  if (!requestingUser) return false;
  if (isSystemContext(requestingUser)) return false;
  if (options && options.__skipSchoolIdentityBridge === true) return false;
  return true;
}

function normalizeId(value = '') {
  return String(value || '').trim();
}

function buildScopedPersonQuery(query = {}) {
  const raw = (query && typeof query === 'object') ? query : {};
  const idEq = normalizeId(raw.id__eq || raw.idEq || raw.id || '');
  const q = normalizeId(raw.q || idEq);
  const limit = Number.parseInt(String(raw.limit || '1000').trim(), 10);
  const page = Number.parseInt(String(raw.page || '1').trim(), 10);
  return {
    q,
    query: {
      ...raw,
      q,
      page: Number.isFinite(page) && page > 0 ? page : 1,
      limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 5000) : 1000
    },
    idEq
  };
}

function getWrappedDataService(coreDataService) {
  if (wrappedDataService) return wrappedDataService;
  wrappedDataService = {
    ...coreDataService,
    async fetchData(entityType, query = {}, requestingUser = null, options = {}) {
      if (!shouldBridgeSchoolPersons(entityType, requestingUser, options)) {
        return coreDataService.fetchData(entityType, query, requestingUser, options);
      }
      const schoolIdentityLookupService = require('./schoolIdentityLookupService');
      const scoped = buildScopedPersonQuery(query);
      const payload = await schoolIdentityLookupService.listSchoolPersonRecords({
        reqUser: requestingUser,
        q: scoped.q,
        query: scoped.query,
        requireSchoolRole: false
      });
      const rows = payload?.allRows || payload?.rows || [];
      if (scoped.idEq) {
        return rows.filter((row) => normalizeId(row?.id || row?.personId) === scoped.idEq);
      }
      return rows;
    },
    async getDataById(entityType, id, requestingUser = null, options = {}) {
      if (!shouldBridgeSchoolPersons(entityType, requestingUser, options)) {
        return coreDataService.getDataById(entityType, id, requestingUser, options);
      }
      const schoolIdentityLookupService = require('./schoolIdentityLookupService');
      const targetId = normalizeId(id);
      if (!targetId) return null;
      const payload = await schoolIdentityLookupService.listSchoolPersonRecords({
        reqUser: requestingUser,
        q: targetId,
        query: { q: targetId, limit: 1000 },
        requireSchoolRole: false
      });
      const rows = payload?.allRows || payload?.rows || [];
      return rows.find((row) => normalizeId(row?.id || row?.personId) === targetId) || null;
    }
  };
  return wrappedDataService;
}

function requireCoreModule(relativeModulePath = '') {
  const normalized = String(relativeModulePath || '').trim().replace(/\\/g, '/');
  const coreModule = requireCoreModuleRaw(normalized);
  if (normalized === 'MVC/services/dataService') {
    return getWrappedDataService(coreModule);
  }
  return coreModule;
}

const { requireAuth } = requireCoreModuleRaw('MVC/middleware/authMiddleware');
const { requireAccess, requireAccessAny } = requireCoreModuleRaw('MVC/middleware/accessMiddleware');
const { trackActionState } = requireCoreModuleRaw('MVC/middleware/actionStateMiddleware');

module.exports = {
  requireCoreModule,
  requireAuth,
  requireAccess,
  requireAccessAny,
  trackActionState,
  constants
};
