const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/activityQuota/consumptionDefinitionController');
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_RULES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_RULES, OPERATIONS.READ_ALL),
  ctrl.listDefinitions);

router.get('/picker/users',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_RULES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_RULES, OPERATIONS.READ_ALL),
  ctrl.pickerUsers);

router.get('/picker/sections',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_RULES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_RULES, OPERATIONS.READ_ALL),
  ctrl.pickerSections);

router.get('/picker/operations',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_RULES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_RULES, OPERATIONS.READ_ALL),
  ctrl.pickerOperations);

router.get('/picker/events',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_RULES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_RULES, OPERATIONS.READ_ALL),
  ctrl.pickerEventTypes);

router.get('/new',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_RULES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_RULES, OPERATIONS.CREATE),
  ctrl.showForm);

router.post('/new',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_RULES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_RULES, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.saveDefinition);

router.get('/edit/:id',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_RULES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_RULES, OPERATIONS.UPDATE),
  ctrl.showForm);

router.post('/edit/:id',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_RULES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_RULES, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveDefinition);

router.get('/delete/:id',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_RULES, OPERATIONS.DELETE),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_RULES, OPERATIONS.DELETE),
  ctrl.deleteDefinition);

router.post('/delete/:id',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_RULES, OPERATIONS.DELETE),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_RULES, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteDefinition);

router.delete('/delete/:id',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_RULES, OPERATIONS.DELETE),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_RULES, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteDefinition);

module.exports = router;
