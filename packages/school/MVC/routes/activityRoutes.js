const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/activityController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

router.use(requireAuth);

router.get('/api/eligible-persons',
  requireAccess(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.eligiblePersons);

router.get('/categories',
  requireAccess(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.READ_ALL),
  ctrl.listCategories);
router.get('/categories/new',
  requireAccess(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.CREATE),
  ctrl.showCategoryForm);
router.post('/categories/new',
  requireAccess(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.saveCategory);
router.get('/categories/edit/:id',
  requireAccess(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.UPDATE),
  ctrl.showCategoryForm);
router.post('/categories/edit/:id',
  requireAccess(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveCategory);
router.delete('/categories/delete/:id',
  requireAccess(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.DELETE, {
    requireToken: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.deleteCategory);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.READ_ALL),
  ctrl.listActivities);
router.get('/new',
  requireAccess(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.CREATE),
  ctrl.showCreateForm);
router.post('/new',
  requireAccess(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.saveActivity);
router.get('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.UPDATE),
  ctrl.showEditForm);
router.post('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveActivity);
router.delete('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.DELETE, {
    requireToken: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.deleteActivity);

router.get('/:activityId/work-sessions/manage',
  requireAccess(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
  ctrl.manageWorkSessionsOverview);
router.get('/:activityId/work-sessions/api/overview',
  requireAccess(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.getWorkSessionsOverviewJson);
router.get('/:activityId/work-sessions/:entryId/api/context',
  requireAccess(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
  ctrl.getWorkSessionContextJson);
router.get('/:activityId/work-sessions/:entryId/manage',
  requireAccess(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
  ctrl.manageWorkSession);
router.post('/:activityId/work-sessions/:entryId/save',
  requireAccess(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.UPDATE, {
    requireToken: true,
    keepActive: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true,
    allowSectionTokenFallback: true
  }),
  ctrl.saveWorkSessionAssignee);
router.post('/:activityId/work-sessions/:entryId/complete',
  requireAccess(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_ACTIVITIES, OPERATIONS.UPDATE, {
    requireToken: true,
    keepActive: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true,
    allowSectionTokenFallback: true
  }),
  ctrl.completeWorkSessionAssignee);

module.exports = router;

