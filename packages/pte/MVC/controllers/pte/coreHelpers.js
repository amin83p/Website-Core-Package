const pteCoreHelpersDependencies = require('./pteCoreHelpersDependencies');

function buildPteAccessContext(req) {
  return {
    scopeId: req?.accessScope,
    adminContext: req?.adminContext || null,
    orgTimeZone: req?.orgTimeZone || req?.user?.activeOrgTimeZone || ''
  };
}

module.exports = {
  paginate: pteCoreHelpersDependencies.paginate,
  buildDataServiceQuery: pteCoreHelpersDependencies.buildDataServiceQuery,
  inferSearchableFields: pteCoreHelpersDependencies.inferSearchableFields,
  isAjax: pteCoreHelpersDependencies.isAjax,
  adminChekersService: pteCoreHelpersDependencies.adminChekersService,
  toPublicId: pteCoreHelpersDependencies.toPublicId,
  buildPteAccessContext
};
