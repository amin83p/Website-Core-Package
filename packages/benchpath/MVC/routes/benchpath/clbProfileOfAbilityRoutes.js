const { requireCoreModule } = require('../../services/benchpath/benchpathCoreModuleResolver');
const { createReferenceCatalogRouter } = require('./referenceCatalogRouteFactory');
const { SECTIONS } = requireCoreModule('config/accessConstants');

module.exports = createReferenceCatalogRouter('profileOfAbility', SECTIONS.BENCHPATH_CLB_PROFILE_OF_ABILITY);
