const express = require('express');
const router = express.Router();
const withdrawalController = require('../controllers/school/withdrawalController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

const SECTION = SECTIONS.SCHOOL_WITHDRAWAL;

router.get('/',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.READ_ALL),
  trackActionState(SECTION, OPERATIONS.READ_ALL),
  withdrawalController.showDashboard
);

router.get('/list',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.READ_ALL),
  trackActionState(SECTION, OPERATIONS.READ_ALL),
  withdrawalController.showWithdrawalList
);

router.get('/new',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.CREATE),
  trackActionState(SECTION, OPERATIONS.CREATE),
  withdrawalController.showNewWithdrawalWizard
);

router.get('/detail/:id',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.READ),
  trackActionState(SECTION, OPERATIONS.CREATE),
  withdrawalController.showWithdrawalDetail
);

router.get('/finalize/:id',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.CREATE),
  trackActionState(SECTION, OPERATIONS.CREATE),
  withdrawalController.showProgramFinalizeForm
);

router.get('/api/student/:studentId/status',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.READ),
  trackActionState(SECTION, OPERATIONS.READ),
  withdrawalController.apiGetStudentStatus
);

router.get('/api/student/:studentId/enrollments',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.READ),
  trackActionState(SECTION, OPERATIONS.READ),
  withdrawalController.apiGetStudentEnrollments
);

router.get('/api/reasons',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.READ),
  trackActionState(SECTION, OPERATIONS.READ),
  withdrawalController.apiGetWithdrawalReasons
);

router.post('/api/class/preview',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.READ),
  trackActionState(SECTION, OPERATIONS.READ),
  withdrawalController.apiPreviewClassWithdrawal
);

router.post('/api/class/execute',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.CREATE),
  trackActionState(SECTION, OPERATIONS.CREATE, { requireToken: true }),
  withdrawalController.apiExecuteClassWithdrawal
);

router.post('/api/term/preview',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.READ),
  trackActionState(SECTION, OPERATIONS.READ),
  withdrawalController.apiPreviewTermWithdrawal
);

router.post('/api/term/execute',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.CREATE),
  trackActionState(SECTION, OPERATIONS.CREATE, { requireToken: true }),
  withdrawalController.apiExecuteTermWithdrawal
);

router.post('/api/program/preview',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.READ),
  trackActionState(SECTION, OPERATIONS.READ),
  withdrawalController.apiPreviewProgramWithdrawal
);

router.post('/api/program/execute',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.CREATE),
  trackActionState(SECTION, OPERATIONS.CREATE, { requireToken: true }),
  withdrawalController.apiExecuteProgramWithdrawal
);

router.post('/api/:id/finalize',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.CREATE),
  trackActionState(SECTION, OPERATIONS.CREATE, { requireToken: true }),
  withdrawalController.apiFinalizeWithdrawal
);

router.post('/api/:id/reject',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.CREATE),
  trackActionState(SECTION, OPERATIONS.CREATE, { requireToken: true }),
  withdrawalController.apiRejectWithdrawal
);

module.exports = router;
