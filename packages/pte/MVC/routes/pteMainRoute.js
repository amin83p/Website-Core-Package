const express = require('express');

const router = express.Router();
const { SECTIONS, OPERATIONS } = require('../../../../config/accessConstants');
const infoController = require('../controllers/infoController');
const userDashboardController = require('../controllers/userDashboardController');
const publicPageSettingsController = require('../controllers/publicPageSettingsController');
const publicJoinController = require('../controllers/publicJoinController');
const { requireAuth } = require('../../../../MVC/middleware/authMiddleware');
const { requireAccess } = require('../../../../MVC/middleware/accessMiddleware');
const { trackActionState } = require('../../../../MVC/middleware/actionStateMiddleware');

router.use((req, res, next) => {
  res.locals.pteSectionDashboardHref = `/dashboard/section-nav/${encodeURIComponent(SECTIONS.PTE || 'PTE')}`;
  res.locals.ptePeopleSectionDashboardHref = `/dashboard/section-nav/${encodeURIComponent(SECTIONS.PTE_PEOPLE || 'PTE_PEOPLE')}`;
  next();
});

router.get('/', infoController.showPteTestInfo);
router.get('/dashboard', requireAuth, userDashboardController.showDashboard);

router.get('/test-info', infoController.showPteTestInfo);
router.get('/join', publicJoinController.showPtePublicJoinForm);
router.post('/join', publicJoinController.processPtePublicJoin);
router.get('/packages', infoController.showPublicPackages);
router.post('/packages/:packageId/select', requireAuth, infoController.selectPublicPackage);
router.get('/public-page',
  requireAuth,
  requireAccess(SECTIONS.PTE_PUBLIC_PAGE, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.PTE_PUBLIC_PAGE, OPERATIONS.READ_ALL),
  publicPageSettingsController.showSettingsPage
);
router.post('/public-page/mutation-token/update',
  requireAuth,
  requireAccess(SECTIONS.PTE_PUBLIC_PAGE, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_PUBLIC_PAGE, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
  publicPageSettingsController.issueMutationToken
);
router.post('/public-page',
  requireAuth,
  requireAccess(SECTIONS.PTE_PUBLIC_PAGE, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.PTE_PUBLIC_PAGE, OPERATIONS.UPDATE, {
    requireToken: false
  }),
  publicPageSettingsController.saveSettingsPage
);

router.use('/students', require('./studentRoutes'));
router.use('/public-applicants', require('./publicApplicantRoutes'));
router.use('/teachers', require('./teacherRoutes'));
router.use('/questions-bank', require('./questionBankRoutes'));
router.use('/tests', require('./testRoutes'));
router.use('/courses', require('./courseRoutes'));
router.use('/ai-assisst', require('./aiAssistRoutes'));
router.use('/scoring', require('./scoringRoutes'));
router.use('/practice', require('./practiceRoutes'));
router.use('/feedback', require('./feedbackRoutes'));
router.use('/attempt', require('./attemptRoutes'));

module.exports = router;
