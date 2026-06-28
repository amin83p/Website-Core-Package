const express = require('express');
const router = express.Router();
const taskController = require('../controllers/school/taskController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

const SECTION = SECTIONS.SCHOOL_TASKS;

router.get('/',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.READ_ALL),
  trackActionState(SECTION, OPERATIONS.READ_ALL),
  taskController.showList
);

router.get('/list',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.READ_ALL),
  trackActionState(SECTION, OPERATIONS.READ_ALL),
  taskController.showList
);

router.get('/routing',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.UPDATE),
  trackActionState(SECTION, OPERATIONS.UPDATE),
  taskController.showRouting
);

router.get('/detail/:id',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.READ),
  trackActionState(SECTION, OPERATIONS.READ),
  taskController.showDetail
);

router.get('/api/eligible-persons',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.READ_ALL),
  trackActionState(SECTION, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  taskController.listEligiblePersons
);

router.post('/api/:id/status',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.UPDATE),
  trackActionState(SECTION, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
  taskController.updateStatus
);

router.post('/api/:id/assign',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.UPDATE),
  trackActionState(SECTION, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
  taskController.reassignTask
);

router.post('/api/:id/delete',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.DELETE),
  trackActionState(SECTION, OPERATIONS.DELETE, { requireToken: false, keepActive: true }),
  taskController.deleteTask
);

router.post('/api/routing',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.UPDATE),
  trackActionState(SECTION, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
  taskController.saveRoutingRule
);

router.post('/api/:id/assignments',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.UPDATE),
  trackActionState(SECTION, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
  taskController.addAssignment
);

router.post('/api/:id/assignments/:assignmentId',
  requireAuth,
  requireAccess(SECTION, OPERATIONS.UPDATE),
  trackActionState(SECTION, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
  taskController.updateAssignment
);

module.exports = router;
