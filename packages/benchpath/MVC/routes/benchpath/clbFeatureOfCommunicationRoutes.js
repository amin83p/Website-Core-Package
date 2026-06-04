const { requireCoreModule } = require('../../services/benchpath/benchpathCoreModuleResolver');
const { createReferenceCatalogRouter } = require('./referenceCatalogRouteFactory');
const { SECTIONS } = requireCoreModule('config/accessConstants');

module.exports = createReferenceCatalogRouter('featuresOfCommunication', SECTIONS.BENCHPATH_CLB_FEATURES_OF_COMMUNICATION);
