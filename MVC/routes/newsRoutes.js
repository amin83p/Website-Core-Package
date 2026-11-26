// MVC/routes/newsRoutes.js
const express = require('express');
const router = express.Router();
const controller = require('../controllers/newsController');
const upload = require('../middleware/upload');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess } = require('../middleware/accessMiddleware');
const { trackActionState } = require('../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');

/* ============================================================
   PUBLIC / FEED ROUTES
============================================================ */

router.get('/',
  (req, res, next) => {
    next();
  },
  controller.feed);

router.get(['/article/:idOrSlug', '/manage/article/:idOrSlug'], controller.viewArticle);

/* ============================================================
   ADMIN / MANAGEMENT ROUTES
============================================================ */

function newsAccess(op, options) {
  return [
    requireAuth,
    requireAccess(SECTIONS.NEWS, op),
    trackActionState(SECTIONS.NEWS, op, options || {})
  ];
}

router.get('/center', ...newsAccess(OPERATIONS.READ_ALL), controller.showCenter);
router.get('/manage', ...newsAccess(OPERATIONS.READ_ALL), controller.listAdmin);

router.get('/api/unread', ...newsAccess(OPERATIONS.READ_ALL, { requireToken: false }), controller.getUnreadArticlesApi);
router.get('/api/media/library', ...newsAccess(OPERATIONS.READ_ALL, { requireToken: false }), controller.listNewsMediaLibrary);
router.get('/api/notify/roles', ...newsAccess(OPERATIONS.UPDATE, { requireToken: false }), controller.getNotifyRoles);
router.post('/api/notify/recipients', ...newsAccess(OPERATIONS.UPDATE), controller.postNotifyRecipients);

router.post('/api/upload',
  ...newsAccess(OPERATIONS.UPDATE),
  upload('news').array('files', 10),
  controller.uploadMedia);

router.get('/manage/new', ...newsAccess(OPERATIONS.CREATE, { keepActive: true }), controller.showForm);
router.post('/manage/new',
  ...newsAccess(OPERATIONS.CREATE),
  upload('news').array('attachments', 10),
  controller.saveNews);
router.post('/manage/preview', ...newsAccess(OPERATIONS.CREATE), controller.previewDraft);

router.get('/manage/edit/:id', ...newsAccess(OPERATIONS.UPDATE, { keepActive: true }), controller.showForm);
router.post('/manage/edit/:id',
  ...newsAccess(OPERATIONS.UPDATE),
  upload('news').array('attachments', 10),
  controller.saveNews);

router.get('/manage/delete/:id', ...newsAccess(OPERATIONS.DELETE), controller.deleteNews);
router.get('/manage/stats/:id', ...newsAccess(OPERATIONS.READ_ALL), controller.showStats);

module.exports = router;