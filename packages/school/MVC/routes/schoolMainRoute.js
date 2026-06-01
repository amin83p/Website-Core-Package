const express = require('express');

const router = express.Router();
const { requireAuth, SECTIONS } = require('./schoolRouteDependencies');

router.get('/', requireAuth, (req, res) => {
  res.redirect(`/dashboard/section-nav/${encodeURIComponent(SECTIONS.SCHOOL || 'SCHOOL')}`);
});

module.exports = router;
