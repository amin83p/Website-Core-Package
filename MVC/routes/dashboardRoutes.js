// MVC/routes/dashboardRoutes.js
const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { requireAuth } = require('../middleware/authMiddleware');
const adminCheckersService = require('../services/adminChekersService');

function redirectNonAdminToPteHub(req, res, next) {
  const isAdminUser = adminCheckersService.isAdmin(req.user)
    || adminCheckersService.isOrgAdmin(req.user)
    || Boolean(String(req.user?.systemAccessProfileId || '').trim());
  if (!isAdminUser) return res.redirect('/pte/dashboard');
  return next();
}

router.get('/', requireAuth, redirectNonAdminToPteHub, dashboardController.showDashboard);

router.get('/bootstrap-setup', requireAuth, dashboardController.showBootstrapSetup);

router.get('/section-nav/:sectionKey', requireAuth, dashboardController.showSectionNav);

router.get('/section/:sectionId', requireAuth, dashboardController.showSectionSubDashboard);

router.get('/all-sections', requireAuth, dashboardController.getAllAccessibleSections);

router.get('/quick-menu', requireAuth,(req, res, next) => {
  res.setHeader('Warning', '299 - "Deprecated API: /dashboard/quick-menu will be removed soon. Use /sections/quick-menu"');
  console.log('[dashboard][warn] Deprecated route accessed:', req.originalUrl);
  next();
}, dashboardController.getQuickMenu);



module.exports = router;
