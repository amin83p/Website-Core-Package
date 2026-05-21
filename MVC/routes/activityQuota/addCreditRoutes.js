const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/activityQuota/addCreditController');
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.READ_ALL),
  ctrl.listCredits);

router.get('/groups',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.READ_ALL),
  ctrl.listGroups);

router.get('/groups/edit/:id',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.UPDATE),
  ctrl.showGroupForm);

router.post('/groups/edit/:id',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveGroup);

router.get('/groups/delete/:id',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.DELETE),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.DELETE),
  ctrl.deleteGroup);

router.delete('/groups/delete/:id',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.DELETE),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteGroup);

router.get('/form-options',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.READ_ALL),
  ctrl.getFormOptions);

router.get('/picker/users',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.READ_ALL),
  ctrl.pickerUsers);

router.get('/picker/sections',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.READ_ALL),
  ctrl.pickerSections);

router.get('/picker/operations',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.READ_ALL),
  ctrl.pickerOperations);

router.get('/new',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.CREATE),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.CREATE),
  ctrl.showForm);

router.post('/new',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.CREATE),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.saveCredit);

router.get('/edit/:id',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.UPDATE),
  ctrl.showForm);

router.post('/edit/:id',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveCredit);

router.get('/delete/:id',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.DELETE),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.DELETE),
  ctrl.deleteCredit);

router.delete('/delete/:id',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.DELETE),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteCredit);

module.exports = router;
