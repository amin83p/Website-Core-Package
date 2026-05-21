// MVC/routes/school/staffRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/school/staffController');
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_STAFF, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_STAFF, OPERATIONS.READ_ALL),
  ctrl.listStaff);

router.get('/archived',
  requireAccess(SECTIONS.SCHOOL_STAFF, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_STAFF, OPERATIONS.READ_ALL),
  ctrl.listArchivedStaff);

router.post('/recover/:id',
  requireAccess(SECTIONS.SCHOOL_STAFF, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_STAFF, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.recoverStaff);

router.get('/new',
  requireAccess(SECTIONS.SCHOOL_STAFF, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_STAFF, OPERATIONS.CREATE),
  ctrl.showForm);

router.post('/new',
  requireAccess(SECTIONS.SCHOOL_STAFF, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_STAFF, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.saveStaff);

router.get('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_STAFF, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_STAFF, OPERATIONS.UPDATE),
  ctrl.showForm);

router.post('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_STAFF, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_STAFF, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveStaff);

router.get('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_STAFF, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_STAFF, OPERATIONS.DELETE),
  ctrl.deleteStaff);

router.delete('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_STAFF, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_STAFF, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteStaff);

module.exports = router;
