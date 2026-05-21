// MVC/routes/contactRoutes.js
const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/contactController');
const upload = require('../middleware/upload');

const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess } = require('../middleware/accessMiddleware');
const { trackActionState } = require('../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');

/* =========================================================
   PUBLIC: Contact page + submit (JSON + attachments)
   ========================================================= */

// Contact page
router.get('/', ctrl.showContactPage);

// Submit endpoint used by your frontend script:
// - If no files: application/json
// - If files: multipart/form-data with "payload" + files[]
router.post(
  '/api/submit',
  upload('contacts', true, true).array('files', 1),
  ctrl.submitContact
);
router.post('/api/track', ctrl.trackMessage);
/* =========================================================
   ADMIN: Contact messages management pages
   (mirrors scopes/tasks route structure)
   ========================================================= */

// List messages (renders views/contact/messages.ejs)
router.get(
  '/messages',
  requireAuth,
  requireAccess(SECTIONS.CONTACT_MESSAGES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.CONTACT_MESSAGES, OPERATIONS.READ_ALL),
  ctrl.listMessages
);

// View a single message (renders views/contact/messageView.ejs)
router.get(
  '/messages/:id',
  requireAuth,
  requireAccess(SECTIONS.CONTACT_MESSAGES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.CONTACT_MESSAGES, OPERATIONS.UPDATE),
  ctrl.viewMessage
);

// Delete message (AJAX-friendly GET like your scopes delete route)
router.get(
  '/messages/delete/:id',
  requireAuth,
  requireAccess(SECTIONS.CONTACT_MESSAGES, OPERATIONS.DELETE),
  trackActionState(SECTIONS.CONTACT_MESSAGES, OPERATIONS.DELETE),
  ctrl.deleteMessage
);

// Reviewer update: status + note (AJAX JSON)
router.post(
  '/messages/review/update',
  requireAuth,
  requireAccess(SECTIONS.CONTACT_MESSAGES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.CONTACT_MESSAGES, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.updateReviewFields
);

// Optional: attachment download (if you implement it)
router.get(
  '/messages/:id/attachments/:fileName',
  requireAuth,
  requireAccess(SECTIONS.CONTACT_MESSAGES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.CONTACT_MESSAGES, OPERATIONS.READ_ALL, { keepActive: true }),
  ctrl.downloadAttachment
);

module.exports = router;
