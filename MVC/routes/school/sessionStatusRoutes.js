const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/school/sessionStatusController');
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_SESSION_STATUSES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SESSION_STATUSES, OPERATIONS.READ_ALL),
  ctrl.listSessionStatuses);

router.get('/new',
  requireAccess(SECTIONS.SCHOOL_SESSION_STATUSES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_SESSION_STATUSES, OPERATIONS.CREATE),
  ctrl.showCreateForm);

router.post('/new',
  requireAccess(SECTIONS.SCHOOL_SESSION_STATUSES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_SESSION_STATUSES, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.saveSessionStatus);

router.get('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_SESSION_STATUSES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SESSION_STATUSES, OPERATIONS.UPDATE),
  ctrl.showEditForm);

router.post('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_SESSION_STATUSES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SESSION_STATUSES, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveSessionStatus);

router.get('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_SESSION_STATUSES, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_SESSION_STATUSES, OPERATIONS.DELETE),
  ctrl.deleteSessionStatus);

router.delete('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_SESSION_STATUSES, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_SESSION_STATUSES, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteSessionStatus);

module.exports = router;
