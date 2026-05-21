const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/roleController');
const rolesImportController = require('../controllers/rolesImportController');
const upload = require('../middleware/upload');
const generalExportCtrl = require('../controllers/generalExportController');
const adminApproval = require('../middleware/adminApproval');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess } = require('../middleware/accessMiddleware');
const { trackActionState } = require('../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');

router.post(
  '/import',
  requireAuth,
  requireAccess(SECTIONS.ROLES, OPERATIONS.IMPORT),
  trackActionState(SECTIONS.ROLES, OPERATIONS.IMPORT),
  adminApproval,
  upload('imports').single('importFile'),
  rolesImportController.startImport
);

router.get(
  '/import/stream/:jobId',
  requireAuth,
  requireAccess(SECTIONS.ROLES, OPERATIONS.IMPORT),
  rolesImportController.streamImportStatus
);

router.post(
  '/import/abort/:jobId',
  requireAuth,
  requireAccess(SECTIONS.ROLES, OPERATIONS.IMPORT),
  rolesImportController.abortImport
);

router.get(
  '/import/report/:jobId',
  requireAuth,
  requireAccess(SECTIONS.ROLES, OPERATIONS.IMPORT),
  rolesImportController.downloadImportReport
);

router.post(
  '/export',
  requireAuth,
  requireAccess(SECTIONS.ROLES, OPERATIONS.EXPORT),
  trackActionState(SECTIONS.ROLES, OPERATIONS.EXPORT),
  adminApproval,
  generalExportCtrl.performExport
);

router.get(
  '/',
  requireAuth,
  requireAccess(SECTIONS.ROLES, OPERATIONS.READ),
  trackActionState(SECTIONS.ROLES, OPERATIONS.READ),
  ctrl.listRoles
);

router.get(
  '/new',
  requireAuth,
  requireAccess(SECTIONS.ROLES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.ROLES, OPERATIONS.CREATE, { keepActive: true }),
  ctrl.showAddRoleForm
);

router.post(
  '/new',
  requireAuth,
  requireAccess(SECTIONS.ROLES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.ROLES, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.addRole
);

router.get(
  '/edit/:id',
  requireAuth,
  requireAccess(SECTIONS.ROLES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.ROLES, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.showEditRoleForm
);

router.post(
  '/edit/:id',
  requireAuth,
  requireAccess(SECTIONS.ROLES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.ROLES, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.editRole
);

router.get(
  '/delete/:id',
  requireAuth,
  requireAccess(SECTIONS.ROLES, OPERATIONS.DELETE),
  trackActionState(SECTIONS.ROLES, OPERATIONS.DELETE),
  ctrl.deleteRole
);

module.exports = router;
