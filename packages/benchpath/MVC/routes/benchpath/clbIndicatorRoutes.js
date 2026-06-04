const { requireCoreModule } = require('../../services/benchpath/benchpathCoreModuleResolver');
const { createReferenceCatalogRouter } = require('./referenceCatalogRouteFactory');
const { SECTIONS } = requireCoreModule('config/accessConstants');

module.exports = createReferenceCatalogRouter('indicators', SECTIONS.BENCHPATH_CLB_INDICATORS);
