const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/activityQuota/packageManagerController');
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_PACKAGE_MANAGER, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_PACKAGE_MANAGER, OPERATIONS.READ_ALL),
  ctrl.listAssignments);

router.get('/picker/packages',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_PACKAGE_MANAGER, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_PACKAGE_MANAGER, OPERATIONS.READ_ALL),
  ctrl.pickerPackages);

router.get('/picker/users',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_PACKAGE_MANAGER, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_PACKAGE_MANAGER, OPERATIONS.READ_ALL),
  ctrl.pickerUsers);

router.get('/new',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_PACKAGE_MANAGER, OPERATIONS.CREATE),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_PACKAGE_MANAGER, OPERATIONS.CREATE),
  ctrl.showForm);

router.post('/new',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_PACKAGE_MANAGER, OPERATIONS.CREATE),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_PACKAGE_MANAGER, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.saveAssignment);

router.get('/edit/:id',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_PACKAGE_MANAGER, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_PACKAGE_MANAGER, OPERATIONS.UPDATE),
  ctrl.showForm);

router.post('/edit/:id',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_PACKAGE_MANAGER, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_PACKAGE_MANAGER, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveAssignment);

router.get('/delete/:id',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_PACKAGE_MANAGER, OPERATIONS.DELETE),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_PACKAGE_MANAGER, OPERATIONS.DELETE),
  ctrl.removeAssignment);

router.delete('/delete/:id',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_PACKAGE_MANAGER, OPERATIONS.DELETE),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_PACKAGE_MANAGER, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.removeAssignment);

module.exports = router;

