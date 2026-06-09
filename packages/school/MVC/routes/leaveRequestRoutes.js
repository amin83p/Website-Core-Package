const express = require('express');
const router = express.Router();
const leaveRequestController = require('../controllers/school/leaveRequestController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

const SECTION = SECTIONS.SCHOOL_LEAVE_REQUESTS;

router.get('/',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.READ_ALL),
  trackActionState(SECTION, OPERATIONS.READ_ALL),
  leaveRequestController.showList
);

router.get('/list',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.READ_ALL),
  trackActionState(SECTION, OPERATIONS.READ_ALL),
  leaveRequestController.showList
);

router.get('/new',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.CREATE),
  trackActionState(SECTION, OPERATIONS.CREATE),
  leaveRequestController.showNewForm
);

router.post('/new',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.CREATE),
  trackActionState(SECTION, OPERATIONS.CREATE, { requireToken: true }),
  leaveRequestController.createRequest
);

router.get('/detail/:id',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.READ),
  trackActionState(SECTION, OPERATIONS.READ),
  leaveRequestController.showDetail
);

router.get('/edit/:id',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.UPDATE),
  trackActionState(SECTION, OPERATIONS.UPDATE),
  leaveRequestController.showEditForm
);

router.post('/edit/:id',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.UPDATE),
  trackActionState(SECTION, OPERATIONS.UPDATE, { requireToken: true }),
  leaveRequestController.updateRequest
);

router.post('/api/:id/approve',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.UPDATE),
  trackActionState(SECTION, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
  leaveRequestController.approveRequest
);

router.post('/api/:id/reject',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.UPDATE),
  trackActionState(SECTION, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
  leaveRequestController.rejectRequest
);

router.post('/api/:id/cancel',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.UPDATE),
  trackActionState(SECTION, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
  leaveRequestController.cancelRequest
);

router.post('/api/:id/delete',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.DELETE),
  trackActionState(SECTION, OPERATIONS.DELETE, { requireToken: false, keepActive: true }),
  leaveRequestController.deleteRequest
);

module.exports = router;
