const { requireCoreModule } = require('../../services/benchpath/benchpathCoreModuleResolver');
const { createReferenceCatalogRouter } = require('./referenceCatalogRouteFactory');
const { SECTIONS } = require('../../../config/accessConstants');

module.exports = createReferenceCatalogRouter('competencies', SECTIONS.BENCHPATH_CLB_COMPETENCIES);
