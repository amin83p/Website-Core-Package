const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/pte/aiProviderController');
const usageCtrl = require('../../controllers/pte/aiTokenUsageController');
const scoringSettingsCtrl = require('../../controllers/pte/aiScoringSettingsController');
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.PTE_AI_PROVIDER_KEYS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_AI_PROVIDER_KEYS, OPERATIONS.READ_ALL),
  (req, res) => res.redirect('/pte/ai-assisst/api-providers')
);

router.get('/api-providers',
  requireAccess(SECTIONS.PTE_AI_PROVIDER_KEYS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_AI_PROVIDER_KEYS, OPERATIONS.READ_ALL),
  ctrl.showApiProviderList
);

router.get('/token-usage',
  requireAccess(SECTIONS.PTE_AI_TOKEN_USAGE, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_AI_TOKEN_USAGE, OPERATIONS.READ_ALL),
  usageCtrl.listTokenUsage
);

router.get('/token-usage/picker/users',
  requireAccess(SECTIONS.PTE_AI_TOKEN_USAGE, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_AI_TOKEN_USAGE, OPERATIONS.READ_ALL),
  usageCtrl.pickerUsageUsers
);

router.get('/token-usage/billing',
  requireAccess(SECTIONS.PTE_AI_TOKEN_USAGE, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_AI_TOKEN_USAGE, OPERATIONS.READ_ALL),
  usageCtrl.showTokenUsageBilling
);

router.get('/token-usage/billing/picker/organizations',
  requireAccess(SECTIONS.PTE_AI_TOKEN_USAGE, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_AI_TOKEN_USAGE, OPERATIONS.READ_ALL),
  usageCtrl.pickerUsageBillingOrganizations
);

router.get('/scoring-settings',
  requireAccess(SECTIONS.PTE_AI_SCORING_SETTINGS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_AI_SCORING_SETTINGS, OPERATIONS.READ_ALL),
  scoringSettingsCtrl.showScoringSettingsPage
);

router.get('/scoring-settings/help',
  requireAccess(SECTIONS.PTE_AI_SCORING_SETTINGS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_AI_SCORING_SETTINGS, OPERATIONS.READ_ALL),
  scoringSettingsCtrl.showScoringSettingsHelpPage
);

router.get('/scoring-settings/api',
  requireAccess(SECTIONS.PTE_AI_SCORING_SETTINGS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_AI_SCORING_SETTINGS, OPERATIONS.READ_ALL),
  scoringSettingsCtrl.getScoringSettingsApi
);

router.post('/scoring-settings/api',
  requireAccess(SECTIONS.PTE_AI_SCORING_SETTINGS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_AI_SCORING_SETTINGS, OPERATIONS.UPDATE, { requireToken: false }),
  scoringSettingsCtrl.saveScoringSettingApi
);

router.post('/scoring-settings/api/delete/:id',
  requireAccess(SECTIONS.PTE_AI_SCORING_SETTINGS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.PTE_AI_SCORING_SETTINGS, OPERATIONS.DELETE, { requireToken: false }),
  scoringSettingsCtrl.deleteScoringSettingApi
);

router.get('/token-usage/:id',
  requireAccess(SECTIONS.PTE_AI_TOKEN_USAGE, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_AI_TOKEN_USAGE, OPERATIONS.READ_ALL),
  usageCtrl.showTokenUsageDetail
);

router.get('/api-providers/new',
  requireAccess(SECTIONS.PTE_AI_PROVIDER_KEYS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.PTE_AI_PROVIDER_KEYS, OPERATIONS.CREATE, { keepActive: true }),
  ctrl.showAddApiProviderForm
);

router.post('/api-providers/new',
  requireAccess(SECTIONS.PTE_AI_PROVIDER_KEYS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.PTE_AI_PROVIDER_KEYS, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.addApiProvider
);

router.get('/api-providers/edit/:id',
  requireAccess(SECTIONS.PTE_AI_PROVIDER_KEYS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_AI_PROVIDER_KEYS, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.showEditApiProviderForm
);

router.post('/api-providers/edit/:id',
  requireAccess(SECTIONS.PTE_AI_PROVIDER_KEYS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_AI_PROVIDER_KEYS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.editApiProvider
);

router.post('/api-providers/delete/:id',
  requireAccess(SECTIONS.PTE_AI_PROVIDER_KEYS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.PTE_AI_PROVIDER_KEYS, OPERATIONS.DELETE, { requireToken: false }),
  ctrl.deleteApiProvider
);

router.post('/api-providers/default',
  requireAccess(SECTIONS.PTE_AI_PROVIDER_KEYS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_AI_PROVIDER_KEYS, OPERATIONS.UPDATE, { requireToken: false }),
  ctrl.setDefaultApiProvider
);

// Compatibility shim: prefer package-owned route implementation.
module.exports = require('../../../packages/pte/MVC/routes/aiAssistRoutes');
