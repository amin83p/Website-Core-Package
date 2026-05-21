const express = require('express');
const router = express.Router();
const { SECTIONS } = require('../../../config/accessConstants');

router.use((req, res, next) => {
  res.locals.ieltsSectionDashboardHref = `/dashboard/section-nav/${encodeURIComponent(SECTIONS.IELTS)}`;
  next();
});

router.use(require('./ieltsRoutes'));

module.exports = router;
