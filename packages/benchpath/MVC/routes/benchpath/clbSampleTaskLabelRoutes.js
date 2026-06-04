const { createReferenceCatalogRouter } = require('./referenceCatalogRouteFactory');
const { SECTIONS } = require('../../../config/accessConstants');

module.exports = createReferenceCatalogRouter('sampleTaskLabels', SECTIONS.BENCHPATH_CLB_SAMPLE_TASK_LABELS);
