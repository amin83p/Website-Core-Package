'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/packageEvolutionController');
const { requireAuth } = require('../middleware/authMiddleware');

function requireEvolutionViewer(req, res, next) {
  const packageEvolutionAccessService = require('../services/packageEvolutionAccessService');
  if (!packageEvolutionAccessService.canViewPackageEvolution(req.user)) {
    if (req.headers.accept?.includes('application/json') || req.xhr) {
      return res.status(403).json({ status: 'error', message: 'Access denied.' });
    }
    return res.status(403).render('error', {
      title: 'Access denied',
      message: 'You do not have access to package evolution timeline.',
      user: req.user
    });
  }
  return next();
}

router.get('/', requireAuth, requireEvolutionViewer, ctrl.showTimeline);
router.get('/api/timeline', requireAuth, requireEvolutionViewer, ctrl.getTimelineApi);

module.exports = router;