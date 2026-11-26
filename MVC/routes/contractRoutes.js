// MVC/routes/contractRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/contractController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess } = require('../middleware/accessMiddleware');
const { trackActionState } = require('../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');

router.get('/',
  requireAuth,
  requireAccess(SECTIONS.CONTRACTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.CONTRACTS, OPERATIONS.READ_ALL),
  ctrl.listContracts);

router.get('/new',
  requireAuth,
  requireAccess(SECTIONS.CONTRACTS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.CONTRACTS, OPERATIONS.CREATE, { keepActive: true }),
  ctrl.showAddForm);
router.post('/new',
  requireAuth,
  requireAccess(SECTIONS.CONTRACTS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.CONTRACTS, OPERATIONS.CREATE),
  ctrl.addContract);

router.get('/edit/:id',
  requireAuth,
  requireAccess(SECTIONS.CONTRACTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.CONTRACTS, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.showEditForm);
router.post('/edit/:id',
  requireAuth,
  requireAccess(SECTIONS.CONTRACTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.CONTRACTS, OPERATIONS.UPDATE),
  ctrl.editContract);

router.get('/delete/:id',
  requireAuth,
  requireAccess(SECTIONS.CONTRACTS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.CONTRACTS, OPERATIONS.DELETE),
  ctrl.deleteContract);
router.delete('/delete/:id',
  requireAuth,
  requireAccess(SECTIONS.CONTRACTS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.CONTRACTS, OPERATIONS.DELETE),
  ctrl.deleteContract);

module.exports = router;