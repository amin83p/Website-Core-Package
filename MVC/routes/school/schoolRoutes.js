// MVC/routes/school/schoolRoutes.js
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../middleware/authMiddleware');
const { SECTIONS } = require('../../../config/accessConstants');

// Root /school → same destination as quick menu: section-nav sub-dashboard for navigator SCHOOL.
// Do not use requireAccess(..., READ_ALL): navigator sections have no operations array entry;
// access is enforced on /dashboard/section-nav/:key via hasSectionAccess (child visibility).
router.get('/',
  requireAuth,
  (req, res) => {
    res.redirect(`/dashboard/section-nav/${encodeURIComponent(SECTIONS.SCHOOL)}`);
  });

module.exports = router;
