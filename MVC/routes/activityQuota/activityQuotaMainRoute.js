const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/authMiddleware');
const { SECTIONS } = require('../../../packages/activityQuota/config/accessConstants');

router.use((req, res, next) => {
  res.locals.activityQuotaSectionDashboardHref = `/dashboard/section-nav/${encodeURIComponent(SECTIONS.ACTIVITY_QUOTA)}`;
  next();
});

router.get('/', requireAuth, (req, res) => {
  return res.redirect('/activity-quota/overview');
});

router.use('/overview', require('./overviewRoutes'));
router.use('/credit-check', require('./creditCheckRoutes'));
router.use('/ledger', require('./ledgerRoutes'));
router.use('/rules', require('./consumptionDefinitionRoutes'));
router.use('/add-credit', require('./addCreditRoutes'));
router.use('/packages', require('./packageRoutes'));
router.use('/package-manager', require('./packageManagerRoutes'));

module.exports = router;
