const { applyGenericFilter } = require('../../../../MVC/utils/queryEngine');
const { assertQueryableCrudRepository } = require('../../../../MVC/repositories/contracts/crudRepositoryContract');
const { runByRepositoryBackend } = require('../../../../MVC/repositories/backend/repositoryBackendSelector');
const { getMongoCollection } = require('../../../../MVC/infrastructure/mongo/mongoConnection');
const { toPublicId, idsEqual } = require('../../../../MVC/utils/idAdapter');
const { decrypt } = require('../../../../MVC/utils/encyptors');
const {
  buildMongoFilterFromQuery,
  buildMongoSortFromQuery,
  resolveMongoPagination,
  normalizeMongoDocument,
  combineMongoFilters,
  resolveMongoIdFilter
} = require('../../../../MVC/repositories/backend/mongoRepositoryUtils');
const actionStateChangeTrackerService = require('../../../../MVC/services/actionStateChangeTrackerService');

module.exports = {
  applyGenericFilter,
  assertQueryableCrudRepository,
  runByRepositoryBackend,
  getMongoCollection,
  toPublicId,
  idsEqual,
  decrypt,
  buildMongoFilterFromQuery,
  buildMongoSortFromQuery,
  resolveMongoPagination,
  normalizeMongoDocument,
  combineMongoFilters,
  resolveMongoIdFilter,
  actionStateChangeTrackerService
};
