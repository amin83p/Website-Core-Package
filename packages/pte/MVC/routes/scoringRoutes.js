const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/scoringController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./pteRouteDependencies');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.PTE_SCORING_DEFAULTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_SCORING_DEFAULTS, OPERATIONS.READ_ALL),
  (req, res) => res.redirect('/pte/scoring/defaults'));

router.get('/defaults',
  requireAccess(SECTIONS.PTE_SCORING_DEFAULTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_SCORING_DEFAULTS, OPERATIONS.READ_ALL),
  ctrl.showDefaultsPage);

router.get('/defaults/profile',
  requireAccess(SECTIONS.PTE_SCORING_DEFAULTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_SCORING_DEFAULTS, OPERATIONS.READ_ALL),
  ctrl.getTypeDefaults);

router.post('/defaults/profile',
  requireAccess(SECTIONS.PTE_SCORING_DEFAULTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_SCORING_DEFAULTS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.updateTypeDefaults);

module.exports = router;
