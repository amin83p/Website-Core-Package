const { createReferenceCatalogRouter } = require('./referenceCatalogRouteFactory');
const { SECTIONS } = require('../../../config/accessConstants');

module.exports = createReferenceCatalogRouter('competencyAreas', SECTIONS.BENCHPATH_CLB_COMPETENCY_AREAS);
