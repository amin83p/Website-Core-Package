const express = require('express');
const router = express.Router();

const ctrl = require('../../controllers/benchpath/benchpathToolsController');
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.BENCHPATH, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.BENCHPATH, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.showToolsPage);

router.post('/dry-run',
  requireAccess(SECTIONS.BENCHPATH, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.BENCHPATH, OPERATIONS.UPDATE, { requireToken: true, keepActive: true }),
  ctrl.runDryRun);

router.post('/apply',
  requireAccess(SECTIONS.BENCHPATH, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.BENCHPATH, OPERATIONS.UPDATE, { requireToken: true, keepActive: true }),
  ctrl.applyMigration);

router.get('/reports/:fileName',
  requireAccess(SECTIONS.BENCHPATH, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.BENCHPATH, OPERATIONS.READ_ALL),
  ctrl.downloadReport);

module.exports = router;
