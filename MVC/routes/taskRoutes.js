// MVC/routes/taskRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/taskController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAccess } = require('../middleware/accessMiddleware');
const { trackActionState } = require('../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');
const upload = require('../middleware/upload');

// ... (List routes) ...
router.get('/', requireAuth, 
    requireAccess(SECTIONS.TASKS, OPERATIONS.READ), 
    trackActionState(SECTIONS.TASKS, OPERATIONS.READ), 
    ctrl.listTasks);

// ... (Create routes) ...
router.get('/new', requireAuth, 
    requireAccess(SECTIONS.TASKS, OPERATIONS.CREATE), 
    trackActionState(SECTIONS.TASKS, OPERATIONS.CREATE), 
    ctrl.showAddTaskForm);
router.post('/new', requireAuth, 
    requireAccess(SECTIONS.TASKS, OPERATIONS.CREATE), 
    trackActionState(SECTIONS.TASKS, OPERATIONS.CREATE), 
    ctrl.createTask);

// ... (Edit routes) ...
router.get('/edit/:id', requireAuth, 
    requireAccess(SECTIONS.TASKS, OPERATIONS.UPDATE), 
    trackActionState(SECTIONS.TASKS, OPERATIONS.UPDATE), 
    ctrl.showEditTaskForm);
router.post('/edit/:id', requireAuth, 
    requireAccess(SECTIONS.TASKS, OPERATIONS.UPDATE), 
    trackActionState(SECTIONS.TASKS, OPERATIONS.UPDATE), 
    ctrl.editTask);

// ... (Delete) ...
router.get('/delete/:id', requireAuth, 
    requireAccess(SECTIONS.TASKS, OPERATIONS.DELETE), 
    trackActionState(SECTIONS.TASKS, OPERATIONS.DELETE), 
    ctrl.deleteTask);

// Actions
router.post('/deliverable/upload', 
    requireAuth, 
    requireAccess(SECTIONS.TASKS, OPERATIONS.UPDATE), 
    trackActionState(SECTIONS.TASKS, OPERATIONS.UPDATE, { keepActive: true }), 
    upload('tasks', true).single('file'), 
    ctrl.uploadDeliverable
);

router.post('/deliverable/delete', 
    requireAuth, 
    requireAccess(SECTIONS.TASKS, OPERATIONS.UPDATE), 
    trackActionState(SECTIONS.TASKS, OPERATIONS.UPDATE, { keepActive: true }), 
    ctrl.deleteDeliverable
);

router.get('/:id', requireAuth, 
    requireAccess(SECTIONS.TASKS, OPERATIONS.UPDATE), 
    trackActionState(SECTIONS.TASKS, OPERATIONS.UPDATE), 
    ctrl.viewTask);

router.post('/checkpoint/status', requireAuth, 
    requireAccess(SECTIONS.TASKS, OPERATIONS.UPDATE), 
    trackActionState(SECTIONS.TASKS, OPERATIONS.UPDATE, { keepActive: true }),
    ctrl.updateCheckpointStatus);

router.post('/checkpoint/update', requireAuth, 
    requireAccess(SECTIONS.TASKS, OPERATIONS.UPDATE), 
    trackActionState(SECTIONS.TASKS, OPERATIONS.UPDATE, { keepActive: true }),
    ctrl.updateCheckpointProperties);

router.post('/comment/add', requireAuth, 
    requireAccess(SECTIONS.TASKS, OPERATIONS.UPDATE), 
    trackActionState(SECTIONS.TASKS, OPERATIONS.UPDATE, { keepActive: true }),
    upload('tasks', true).single('file'), 
    ctrl.addComment);

    router.post('/comment/delete', requireAuth, 
    requireAccess(SECTIONS.TASKS, OPERATIONS.UPDATE), 
    trackActionState(SECTIONS.TASKS, OPERATIONS.UPDATE, { keepActive: true }),
    ctrl.deleteComment);

module.exports = router;