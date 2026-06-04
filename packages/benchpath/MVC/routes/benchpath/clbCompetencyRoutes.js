const { requireCoreModule } = require('../../services/benchpath/benchpathCoreModuleResolver');
const { createReferenceCatalogRouter } = require('./referenceCatalogRouteFactory');
const { SECTIONS } = requireCoreModule('config/accessConstants');

module.exports = createReferenceCatalogRouter('competencies', SECTIONS.BENCHPATH_CLB_COMPETENCIES);
