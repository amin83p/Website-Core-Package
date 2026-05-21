const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/activityQuota/packageController');
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_PACKAGE, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_PACKAGE, OPERATIONS.READ_ALL),
  ctrl.listPackages);

router.get('/picker/users',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_PACKAGE, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_PACKAGE, OPERATIONS.READ_ALL),
  ctrl.pickerUsers);

router.get('/picker/sections',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_PACKAGE, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_PACKAGE, OPERATIONS.READ_ALL),
  ctrl.pickerSections);

router.get('/picker/operations',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_PACKAGE, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_PACKAGE, OPERATIONS.READ_ALL),
  ctrl.pickerOperations);

router.get('/picker/access-profiles',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_PACKAGE, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_PACKAGE, OPERATIONS.READ_ALL),
  ctrl.pickerAccessProfiles);

router.get('/picker/roles',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_PACKAGE, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_PACKAGE, OPERATIONS.READ_ALL),
  ctrl.pickerRoles);

router.get('/picker/packages',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_PACKAGE, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_PACKAGE, OPERATIONS.READ_ALL),
  ctrl.pickerPackages);

router.get('/api/template/:id',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_PACKAGE, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_PACKAGE, OPERATIONS.READ_ALL),
  ctrl.getPackageTemplate);

router.get('/new',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_PACKAGE, OPERATIONS.CREATE),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_PACKAGE, OPERATIONS.CREATE),
  ctrl.showForm);

router.post('/new',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_PACKAGE, OPERATIONS.CREATE),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_PACKAGE, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.savePackage);

router.get('/edit/:id',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_PACKAGE, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_PACKAGE, OPERATIONS.UPDATE),
  ctrl.showForm);

router.post('/edit/:id',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_PACKAGE, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_PACKAGE, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.savePackage);

router.get('/delete/:id',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_PACKAGE, OPERATIONS.DELETE),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_PACKAGE, OPERATIONS.DELETE),
  ctrl.deletePackage);

router.delete('/delete/:id',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_PACKAGE, OPERATIONS.DELETE),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_PACKAGE, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deletePackage);

module.exports = router;
