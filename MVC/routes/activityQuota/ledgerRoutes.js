const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/activityQuota/ledgerController');
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_LEDGER, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_LEDGER, OPERATIONS.READ_ALL),
  ctrl.listLedger);

router.get('/picker/users',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_LEDGER, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_LEDGER, OPERATIONS.READ_ALL),
  ctrl.listUsersPicker);

router.get('/picker/organizations',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_LEDGER, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_LEDGER, OPERATIONS.READ_ALL),
  ctrl.listOrganizationsPicker);

router.get('/picker/sections',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_LEDGER, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_LEDGER, OPERATIONS.READ_ALL),
  ctrl.listSectionsPicker);

router.get('/picker/operations',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_LEDGER, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_LEDGER, OPERATIONS.READ_ALL),
  ctrl.listOperationsPicker);

router.get('/picker/source-event-types',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_LEDGER, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_LEDGER, OPERATIONS.READ_ALL),
  ctrl.listSourceEventTypesPicker);

router.get('/picker/source-event-ids',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_LEDGER, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_LEDGER, OPERATIONS.READ_ALL),
  ctrl.listSourceEventIdsPicker);

router.post('/bulk-delete',
  requireAccess(SECTIONS.ACTIVITY_QUOTA_LEDGER, OPERATIONS.DELETE),
  trackActionState(SECTIONS.ACTIVITY_QUOTA_LEDGER, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.bulkDeleteLedger);

module.exports = router;
