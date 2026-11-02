'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/logArchiveController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess } = require('../middleware/accessMiddleware');
const { trackActionState } = require('../middleware/actionStateMiddleware');
const adminApproval = require('../middleware/adminApproval');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');

router.get('/',
  requireAuth,
  requireAccess(SECTIONS.LOGS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.LOGS, OPERATIONS.READ_ALL),
  ctrl.viewLogArchiveExtractor
);

router.get('/status',
  requireAuth,
  requireAccess(SECTIONS.LOGS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.LOGS, OPERATIONS.READ_ALL),
  ctrl.fetchLogArchiveStatus
);

router.post('/export',
  requireAuth,
  requireAccess(SECTIONS.LOGS, OPERATIONS.EXPORT),
  trackActionState(SECTIONS.LOGS, OPERATIONS.EXPORT),
  adminApproval,
  ctrl.exportLogArchive
);

// Analyzer shell only (HTML/JS). No POST/upload route — archives are parsed in the browser.
router.get('/analyze',
  requireAuth,
  requireAccess(SECTIONS.LOGS, OPERATIONS.READ_ALL),
  ctrl.viewLogArchiveAnalyzer
);

router.get('/user-timeline',
  requireAuth,
  requireAccess(SECTIONS.LOGS, OPERATIONS.READ_ALL),
  ctrl.viewLogArchiveUserTimeline
);

module.exports = router;
