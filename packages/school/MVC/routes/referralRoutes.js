const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/referralController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_REFERRALS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_REFERRALS, OPERATIONS.READ_ALL),
  ctrl.listReferrals);

router.get('/archived',
  requireAccess(SECTIONS.SCHOOL_REFERRALS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_REFERRALS, OPERATIONS.READ_ALL),
  ctrl.listArchivedReferrals);

router.get('/api/eligible-persons',
  requireAccess(SECTIONS.SCHOOL_REFERRALS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_REFERRALS, OPERATIONS.CREATE, { requireToken: false, keepActive: true }),
  ctrl.listEligiblePersons);

router.get('/api/name-matches',
  requireAccess(SECTIONS.SCHOOL_REFERRALS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_REFERRALS, OPERATIONS.CREATE, { requireToken: false, keepActive: true }),
  ctrl.listNameMatches);

router.post('/api/quick-create',
  requireAccess(SECTIONS.SCHOOL_REFERRALS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_REFERRALS, OPERATIONS.CREATE, { requireToken: false, keepActive: true }),
  ctrl.saveReferral);

router.post('/recover/:id',
  requireAccess(SECTIONS.SCHOOL_REFERRALS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_REFERRALS, OPERATIONS.UPDATE, {
    requireToken: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.recoverReferral);

router.get('/archive/:id',
  requireAccess(SECTIONS.SCHOOL_REFERRALS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_REFERRALS, OPERATIONS.DELETE),
  ctrl.archiveReferral);

router.post('/archive/:id',
  requireAccess(SECTIONS.SCHOOL_REFERRALS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_REFERRALS, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.archiveReferral);

router.get('/new',
  requireAccess(SECTIONS.SCHOOL_REFERRALS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_REFERRALS, OPERATIONS.CREATE),
  ctrl.showForm);

router.post('/new',
  requireAccess(SECTIONS.SCHOOL_REFERRALS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_REFERRALS, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.saveReferral);

router.get('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_REFERRALS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_REFERRALS, OPERATIONS.UPDATE),
  ctrl.showForm);

router.post('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_REFERRALS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_REFERRALS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveReferral);

module.exports = router;