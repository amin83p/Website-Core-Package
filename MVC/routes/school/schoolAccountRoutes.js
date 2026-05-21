// MVC/routes/school/schoolAccountRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/school/schoolAccountController');
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_ACCOUNTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_ACCOUNTS, OPERATIONS.READ_ALL),
  ctrl.listAccounts);

router.get('/archived',
  requireAccess(SECTIONS.SCHOOL_ACCOUNTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_ACCOUNTS, OPERATIONS.READ_ALL),
  ctrl.listArchivedAccounts);

router.post('/recover/:id',
  requireAccess(SECTIONS.SCHOOL_ACCOUNTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_ACCOUNTS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.recoverAccount);

router.post('/api/sync-owner-names',
  requireAccess(SECTIONS.SCHOOL_ACCOUNTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_ACCOUNTS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.syncOwnerAccountNamesFromPersons);

router.get('/help',
  requireAccess(SECTIONS.SCHOOL_ACCOUNTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_ACCOUNTS, OPERATIONS.READ_ALL),
  ctrl.showHelp);

router.get('/new',
  requireAccess(SECTIONS.SCHOOL_ACCOUNTS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_ACCOUNTS, OPERATIONS.CREATE),
  ctrl.showForm);

router.get('/new-wizard',
  requireAccess(SECTIONS.SCHOOL_ACCOUNTS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_ACCOUNTS, OPERATIONS.CREATE),
  ctrl.showAddWizardForm);

router.post('/new',
  requireAccess(SECTIONS.SCHOOL_ACCOUNTS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_ACCOUNTS, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.saveAccount);

router.get('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_ACCOUNTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_ACCOUNTS, OPERATIONS.UPDATE),
  ctrl.showForm);

router.get('/edit-wizard/:id',
  requireAccess(SECTIONS.SCHOOL_ACCOUNTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_ACCOUNTS, OPERATIONS.UPDATE),
  ctrl.showEditWizardForm);

router.post('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_ACCOUNTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_ACCOUNTS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveAccount);

router.get('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_ACCOUNTS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_ACCOUNTS, OPERATIONS.DELETE),
  ctrl.deleteAccount);

router.delete('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_ACCOUNTS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_ACCOUNTS, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteAccount);

module.exports = router;
