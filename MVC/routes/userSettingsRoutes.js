const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/userSettingsController');
const generalExportCtrl = require('../controllers/generalExportController');
const adminApproval = require('../middleware/adminApproval');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess } = require('../middleware/accessMiddleware');
const { trackActionState } = require('../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');

const USER_SETTINGS_SEC = SECTIONS.USER_SETTINGS || 'USER_SETTINGS';

router.get('/',
  requireAuth,
  requireAccess(USER_SETTINGS_SEC, OPERATIONS.READ_ALL),
  trackActionState(USER_SETTINGS_SEC, OPERATIONS.READ_ALL),
  ctrl.listAll
);

router.get('/picker/users',
  requireAuth,
  requireAccess(USER_SETTINGS_SEC, OPERATIONS.READ_ALL),
  trackActionState(USER_SETTINGS_SEC, OPERATIONS.READ_ALL),
  ctrl.pickerUsers
);

router.get('/edit/:userId',
  requireAuth,
  requireAccess(USER_SETTINGS_SEC, OPERATIONS.UPDATE),
  trackActionState(USER_SETTINGS_SEC, OPERATIONS.UPDATE),
  ctrl.showEditForm
);

router.post('/edit/:userId',
  requireAuth,
  requireAccess(USER_SETTINGS_SEC, OPERATIONS.UPDATE),
  trackActionState(USER_SETTINGS_SEC, OPERATIONS.UPDATE),
  ctrl.editItem
);

router.get('/delete/:userId',
  requireAuth,
  requireAccess(USER_SETTINGS_SEC, OPERATIONS.DELETE),
  trackActionState(USER_SETTINGS_SEC, OPERATIONS.DELETE),
  ctrl.deleteItem
);

router.post('/export',
  requireAuth,
  requireAccess(USER_SETTINGS_SEC, OPERATIONS.EXPORT),
  trackActionState(USER_SETTINGS_SEC, OPERATIONS.EXPORT),
  adminApproval,
  generalExportCtrl.performExport
);

router.get('/:userId',
  requireAuth,
  requireAccess(USER_SETTINGS_SEC, OPERATIONS.READ),
  trackActionState(USER_SETTINGS_SEC, OPERATIONS.READ),
  ctrl.getItem
);

module.exports = router;
