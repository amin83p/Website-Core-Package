// MVC/routes/newsRoutes.js
const express = require('express');
const router = express.Router();
const controller = require('../controllers/newsController');
// ✅ IMPORT UPLOAD FACTORY
const upload = require('../middleware/upload'); 
const { requireAuth } = require('../middleware/authMiddleware');
/* ============================================================
   PUBLIC / FEED ROUTES
============================================================ */

// Main News Feed (Public + Context Aware)
router.get('/', 
    // We do NOT strictly require auth here because we want public news to be visible
    // The controller handles filtering based on whether req.user exists.
    (req, res, next) => {
        // Optional: Middleware to soft-auth if token exists in cookie but header missing
        // (Assuming app.js handles softAuth globally)
        next();
    },
    controller.feed
);

// View Single Article (ID or Slug)
router.get(['/article/:idOrSlug','/manage/article/:idOrSlug'] , controller.viewArticle);
/* ============================================================
   ADMIN / MANAGEMENT ROUTES
============================================================ */

router.get('/center', requireAuth, controller.showCenter);
router.get('/manage', requireAuth, controller.listAdmin);

// ✅ NEW: API Route for Media Manager Uploads
// This enforces the 'news' folder configuration
router.post('/api/upload', 
    requireAuth, 
    upload('news').array('files', 10), // Use the factory: upload('news')
    controller.uploadMedia
);

// Create New
router.get('/manage/new', requireAuth, controller.showForm);
router.post('/manage/new', requireAuth, upload('news').array('attachments', 10), controller.saveNews);

// Edit Existing
router.get('/manage/edit/:id', requireAuth, controller.showForm);
router.post('/manage/edit/:id', requireAuth, upload('news').array('attachments', 10), controller.saveNews);

// Delete
router.get('/manage/delete/:id', requireAuth, controller.deleteNews);

// Stats
router.get('/manage/stats/:id', requireAuth, controller.showStats);

module.exports = router;