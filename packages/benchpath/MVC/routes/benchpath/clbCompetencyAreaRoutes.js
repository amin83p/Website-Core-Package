const { requireCoreModule } = require('../../services/benchpath/benchpathCoreModuleResolver');
const { createReferenceCatalogRouter } = require('./referenceCatalogRouteFactory');
const { SECTIONS } = requireCoreModule('config/accessConstants');

module.exports = createReferenceCatalogRouter('competencyAreas', SECTIONS.BENCHPATH_CLB_COMPETENCY_AREAS);
