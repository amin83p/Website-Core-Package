'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/schoolAiAssistController');
const { requireAuth, requireAccess, requireAccessAny, trackActionState, SECTIONS, OPERATIONS } = require('./schoolRouteDependencies');

const requireAiServiceDefinitionsRead = requireAccessAny(
  [
    SECTIONS.SCHOOL_AI_SERVICE_DEFINITIONS,
    SECTIONS.SCHOOL_AI_PROVIDER_KEYS,
    SECTIONS.SCHOOL_AI_SERVICE_ASSIGNMENTS
  ],
  OPERATIONS.READ_ALL
);

const requireAiServiceDefinitionsUpdate = requireAccessAny(
  [
    SECTIONS.SCHOOL_AI_SERVICE_DEFINITIONS,
    SECTIONS.SCHOOL_AI_PROVIDER_KEYS,
    SECTIONS.SCHOOL_AI_SERVICE_ASSIGNMENTS
  ],
  OPERATIONS.UPDATE
);

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_AI_PROVIDER_KEYS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_AI_PROVIDER_KEYS, OPERATIONS.READ_ALL),
  (req, res) => res.redirect('/school/ai-assist/providers')
);

router.get('/providers',
  requireAccess(SECTIONS.SCHOOL_AI_PROVIDER_KEYS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_AI_PROVIDER_KEYS, OPERATIONS.READ_ALL),
  ctrl.listProviders
);

router.get('/providers/new',
  requireAccess(SECTIONS.SCHOOL_AI_PROVIDER_KEYS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_AI_PROVIDER_KEYS, OPERATIONS.CREATE, { keepActive: true }),
  ctrl.showCreateProvider
);

router.post('/providers/new',
  requireAccess(SECTIONS.SCHOOL_AI_PROVIDER_KEYS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_AI_PROVIDER_KEYS, OPERATIONS.CREATE, { requireToken: false }),
  ctrl.createProvider
);

router.get('/providers/edit/:id',
  requireAccess(SECTIONS.SCHOOL_AI_PROVIDER_KEYS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_AI_PROVIDER_KEYS, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.showEditProvider
);

router.post('/providers/edit/:id',
  requireAccess(SECTIONS.SCHOOL_AI_PROVIDER_KEYS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_AI_PROVIDER_KEYS, OPERATIONS.UPDATE, { requireToken: false }),
  ctrl.updateProvider
);

router.post('/providers/delete/:id',
  requireAccess(SECTIONS.SCHOOL_AI_PROVIDER_KEYS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_AI_PROVIDER_KEYS, OPERATIONS.DELETE, { requireToken: false }),
  ctrl.deleteProvider
);

router.get('/providers/delete/:id',
  requireAccess(SECTIONS.SCHOOL_AI_PROVIDER_KEYS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_AI_PROVIDER_KEYS, OPERATIONS.DELETE, { requireToken: false }),
  ctrl.deleteProvider
);

router.post('/providers/default',
  requireAccess(SECTIONS.SCHOOL_AI_PROVIDER_KEYS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_AI_PROVIDER_KEYS, OPERATIONS.UPDATE, { requireToken: false }),
  ctrl.setDefaultProvider
);

router.post('/providers/draft/vendor-models',
  requireAccess(SECTIONS.SCHOOL_AI_PROVIDER_KEYS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_AI_PROVIDER_KEYS, OPERATIONS.CREATE, { requireToken: false }),
  ctrl.listProviderVendorModels
);

router.post('/providers/:id/vendor-models',
  requireAccess(SECTIONS.SCHOOL_AI_PROVIDER_KEYS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_AI_PROVIDER_KEYS, OPERATIONS.UPDATE, { requireToken: false }),
  ctrl.listProviderVendorModels
);

router.get('/service-assignments',
  requireAccess(SECTIONS.SCHOOL_AI_SERVICE_ASSIGNMENTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_AI_SERVICE_ASSIGNMENTS, OPERATIONS.READ_ALL),
  ctrl.showServiceAssignments
);

router.post('/service-assignments/:serviceKey',
  requireAccess(SECTIONS.SCHOOL_AI_SERVICE_ASSIGNMENTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_AI_SERVICE_ASSIGNMENTS, OPERATIONS.UPDATE, { requireToken: false }),
  ctrl.saveServiceAssignment
);

router.get('/service-definitions',
  requireAiServiceDefinitionsRead,
  trackActionState(SECTIONS.SCHOOL_AI_SERVICE_DEFINITIONS, OPERATIONS.READ_ALL),
  ctrl.listServiceDefinitions
);

router.get('/service-definitions/:serviceKey/edit',
  requireAiServiceDefinitionsUpdate,
  trackActionState(SECTIONS.SCHOOL_AI_SERVICE_DEFINITIONS, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.showEditServiceDefinition
);

router.post('/service-definitions/:serviceKey',
  requireAiServiceDefinitionsUpdate,
  trackActionState(SECTIONS.SCHOOL_AI_SERVICE_DEFINITIONS, OPERATIONS.UPDATE, { requireToken: false }),
  ctrl.saveServiceDefinition
);

router.post('/service-definitions/:serviceKey/output-fields/analyze',
  requireAiServiceDefinitionsUpdate,
  trackActionState(SECTIONS.SCHOOL_AI_SERVICE_DEFINITIONS, OPERATIONS.UPDATE, { requireToken: false }),
  ctrl.analyzeServiceOutputFields
);

router.post('/service-definitions/:serviceKey/output-fields/apply',
  requireAiServiceDefinitionsUpdate,
  trackActionState(SECTIONS.SCHOOL_AI_SERVICE_DEFINITIONS, OPERATIONS.UPDATE, { requireToken: false }),
  ctrl.applyServiceOutputFieldsSync
);

router.post('/services/:serviceKey/run',
  requireAiServiceDefinitionsRead,
  trackActionState(SECTIONS.SCHOOL_AI_SERVICE_DEFINITIONS, OPERATIONS.READ_ALL, { requireToken: false }),
  ctrl.runSchoolAiService
);

router.get('/token-usage/limits',
  requireAccess(SECTIONS.SCHOOL_AI_USAGE_LIMITS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_AI_USAGE_LIMITS, OPERATIONS.READ_ALL),
  ctrl.listUsageLimits
);

router.get('/token-usage/limits/new',
  requireAccess(SECTIONS.SCHOOL_AI_USAGE_LIMITS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_AI_USAGE_LIMITS, OPERATIONS.CREATE, { keepActive: true }),
  ctrl.showCreateUsageLimit
);

router.post('/token-usage/limits/new',
  requireAccess(SECTIONS.SCHOOL_AI_USAGE_LIMITS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_AI_USAGE_LIMITS, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.createUsageLimit
);

router.get('/token-usage/limits/edit/:id',
  requireAccess(SECTIONS.SCHOOL_AI_USAGE_LIMITS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_AI_USAGE_LIMITS, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.showEditUsageLimit
);

router.post('/token-usage/limits/edit/:id',
  requireAccess(SECTIONS.SCHOOL_AI_USAGE_LIMITS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_AI_USAGE_LIMITS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.updateUsageLimit
);

router.post('/token-usage/limits/delete/:id',
  requireAccess(SECTIONS.SCHOOL_AI_USAGE_LIMITS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_AI_USAGE_LIMITS, OPERATIONS.DELETE, { requireToken: false }),
  ctrl.deleteUsageLimit
);

router.get('/token-usage/limits/delete/:id',
  requireAccess(SECTIONS.SCHOOL_AI_USAGE_LIMITS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_AI_USAGE_LIMITS, OPERATIONS.DELETE, { requireToken: false }),
  ctrl.deleteUsageLimit
);

router.get('/token-usage',
  requireAccess(SECTIONS.SCHOOL_AI_TOKEN_USAGE, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_AI_TOKEN_USAGE, OPERATIONS.READ_ALL),
  ctrl.listTokenUsage
);

router.get('/token-usage/:id',
  requireAccess(SECTIONS.SCHOOL_AI_TOKEN_USAGE, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_AI_TOKEN_USAGE, OPERATIONS.READ_ALL),
  ctrl.showTokenUsageDetail
);

module.exports = router;