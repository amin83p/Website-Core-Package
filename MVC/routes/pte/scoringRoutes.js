const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/pte/scoringController');
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.PTE_SCORING_DEFAULTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_SCORING_DEFAULTS, OPERATIONS.READ_ALL),
  (req, res) => res.redirect('/pte/scoring/defaults')
);

router.get('/defaults',
  requireAccess(SECTIONS.PTE_SCORING_DEFAULTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_SCORING_DEFAULTS, OPERATIONS.READ_ALL),
  ctrl.showDefaultsPage
);

router.get('/defaults/profile',
  requireAccess(SECTIONS.PTE_SCORING_DEFAULTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_SCORING_DEFAULTS, OPERATIONS.READ_ALL),
  ctrl.getTypeDefaults
);

router.post('/defaults/profile',
  requireAccess(SECTIONS.PTE_SCORING_DEFAULTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_SCORING_DEFAULTS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.updateTypeDefaults
);

// Compatibility shim: prefer package-owned route implementation.
module.exports = require('../../../packages/pte/MVC/routes/scoringRoutes');
