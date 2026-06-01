const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/termController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_TERMS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_TERMS, OPERATIONS.READ_ALL),
  ctrl.listTerms);

router.get('/new',
  requireAccess(SECTIONS.SCHOOL_TERMS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TERMS, OPERATIONS.CREATE),
  ctrl.showForm);

router.get('/new-wizard',
  requireAccess(SECTIONS.SCHOOL_TERMS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TERMS, OPERATIONS.CREATE),
  ctrl.showAddWizardForm);

router.post('/new',
  requireAccess(SECTIONS.SCHOOL_TERMS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TERMS, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.saveTerm);

router.get('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_TERMS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_TERMS, OPERATIONS.UPDATE),
  ctrl.showForm);

router.get('/edit-wizard/:id',
  requireAccess(SECTIONS.SCHOOL_TERMS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_TERMS, OPERATIONS.UPDATE),
  ctrl.showEditWizardForm);

router.post('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_TERMS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_TERMS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveTerm);

router.get('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_TERMS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_TERMS, OPERATIONS.DELETE),
  ctrl.deleteTerm);

router.delete('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_TERMS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_TERMS, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteTerm);

module.exports = router;
