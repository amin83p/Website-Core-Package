const express = require('express');
const router = express.Router();
const { requireAuth, SECTIONS } = require('./schoolRouteDependencies');

// Package-owned /school entrypoint aligned with quick-menu navigator behavior.
router.get('/',
  requireAuth,
  (req, res) => {
    res.redirect(`/dashboard/section-nav/${encodeURIComponent(SECTIONS.SCHOOL)}`);
  });

module.exports = router;
