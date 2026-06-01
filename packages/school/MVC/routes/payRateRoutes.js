const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/payRateController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

router.use(requireAuth);

router.get('/api/eligible-persons',
  requireAccess(SECTIONS.SCHOOL_PAY_RATES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_PAY_RATES, OPERATIONS.READ_ALL),
  ctrl.eligiblePersons);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_PAY_RATES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_PAY_RATES, OPERATIONS.READ_ALL),
  ctrl.listPayRates);

router.get('/new',
  requireAccess(SECTIONS.SCHOOL_PAY_RATES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_PAY_RATES, OPERATIONS.CREATE),
  ctrl.showCreateForm);
router.post('/new',
  requireAccess(SECTIONS.SCHOOL_PAY_RATES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_PAY_RATES, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.savePayRate);

router.get('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_PAY_RATES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_PAY_RATES, OPERATIONS.UPDATE),
  ctrl.showEditForm);
router.post('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_PAY_RATES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_PAY_RATES, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.savePayRate);

router.get('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_PAY_RATES, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_PAY_RATES, OPERATIONS.DELETE),
  ctrl.deletePayRate);

router.delete('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_PAY_RATES, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_PAY_RATES, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deletePayRate);

module.exports = router;
