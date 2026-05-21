const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/trackActivityController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess } = require('../middleware/accessMiddleware');
const { trackActionState } = require('../middleware/actionStateMiddleware');
const adminApproval = require('../middleware/adminApproval');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');

router.get('/track-activity',
  requireAuth,
  requireAccess(SECTIONS.TRACK_ACTIVITY, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.TRACK_ACTIVITY, OPERATIONS.READ_ALL),
  ctrl.viewTrackActivity
);

router.get('/track-activity/data',
  requireAuth,
  requireAccess(SECTIONS.TRACK_ACTIVITY, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.TRACK_ACTIVITY, OPERATIONS.READ_ALL),
  ctrl.fetchTrackActivityTimelineData
);

router.get('/track-activity/details',
  requireAuth,
  requireAccess(SECTIONS.TRACK_ACTIVITY, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.TRACK_ACTIVITY, OPERATIONS.READ_ALL),
  ctrl.fetchTrackActivityDetail
);

router.get('/track-activity/users',
  requireAuth,
  requireAccess(SECTIONS.TRACK_ACTIVITY, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.TRACK_ACTIVITY, OPERATIONS.READ_ALL),
  ctrl.fetchTrackActivityUsers
);

router.post('/track-activity/export',
  requireAuth,
  requireAccess(SECTIONS.TRACK_ACTIVITY, OPERATIONS.EXPORT),
  trackActionState(SECTIONS.TRACK_ACTIVITY, OPERATIONS.EXPORT),
  adminApproval,
  ctrl.exportTrackActivity
);

module.exports = router;
