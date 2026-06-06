const { requireCoreModule } = require('../../services/benchpath/benchpathCoreModuleResolver');
const { createReferenceCatalogRouter } = require('./referenceCatalogRouteFactory');
const { SECTIONS } = require('../../../config/accessConstants');

module.exports = createReferenceCatalogRouter('indicators', SECTIONS.BENCHPATH_CLB_INDICATORS);
