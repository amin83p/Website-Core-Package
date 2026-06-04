const { createReferenceCatalogRouter } = require('./referenceCatalogRouteFactory');
const { SECTIONS } = require('../../../config/accessConstants');

module.exports = createReferenceCatalogRouter('featuresOfCommunication', SECTIONS.BENCHPATH_CLB_FEATURES_OF_COMMUNICATION);
