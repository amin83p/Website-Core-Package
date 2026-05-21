// MVC/routes/newsletterRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/newsletterController');
const upload = require('../middleware/upload'); // ✅ Usage based on your operationRoutes.js

const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess } = require('../middleware/accessMiddleware');
const { trackActionState } = require('../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');

// Public API
router.post('/api/subscribe', ctrl.apiSubscribe);
router.post('/api/unsubscribe', ctrl.apiUnsubscribe);
router.get(['/unsubscribe/:id','/unsubscribe'], ctrl.showUnsubscribePage);

// ✅ NEW: Import Page
router.get(
  '/admin/import',
  requireAuth,
  requireAccess(SECTIONS.SUBSCRIPTIONS, OPERATIONS.CREATE),
  ctrl.showImportPage
);

// ✅ NEW: Import Action
router.post(
  '/admin/import',
  requireAuth,
  requireAccess(SECTIONS.SUBSCRIPTIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SUBSCRIPTIONS, OPERATIONS.IMPORT),
  upload('imports').single('importFile'), // Handles multipart/form-data
  ctrl.processImport
);

// Admin UI (List)
router.get(
  '/admin',
  requireAuth,
  requireAccess(SECTIONS.SUBSCRIPTIONS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SUBSCRIPTIONS, OPERATIONS.READ_ALL),
  ctrl.listAdmin
);

// Update
router.post(
  '/admin/update/:id',
  requireAuth,
  requireAccess(SECTIONS.SUBSCRIPTIONS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SUBSCRIPTIONS, OPERATIONS.UPDATE),
  ctrl.updateAdmin
);

// Delete
router.get(
  '/admin/delete/:id',
  requireAuth,
  requireAccess(SECTIONS.SUBSCRIPTIONS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SUBSCRIPTIONS, OPERATIONS.DELETE),
  ctrl.deleteAdmin
);

// ✅ NEW: Add Subscriber Form
router.get(
  '/admin/new',
  requireAuth,
  requireAccess(SECTIONS.SUBSCRIPTIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SUBSCRIPTIONS, OPERATIONS.CREATE, { keepActive: true }),
  ctrl.showAddForm
);

// ✅ NEW: Add Subscriber Action
router.post(
  '/admin/new',
  requireAuth,
  requireAccess(SECTIONS.SUBSCRIPTIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SUBSCRIPTIONS, OPERATIONS.CREATE),
  ctrl.addSubscription
);

module.exports = router;