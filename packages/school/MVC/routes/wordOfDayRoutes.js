const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/wordOfDayController');
const { requireCoreModule } = require('../services/school/schoolCoreContracts');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');
const { SCHOOL_UPLOAD_FOLDERS } = require('../../config/accessConstants');

const upload = requireCoreModule('MVC/middleware/upload');
const { attachWordOfDayAccess } = require('./wordOfDayRouteGuards');
const SECTION = SECTIONS.SCHOOL_WORD_OF_DAY;

router.use(requireAuth);
router.use(attachWordOfDayAccess);

const mutationActionState = Object.freeze({
  requireToken: true,
  keepActive: true,
  allowOperationTokenFallback: true,
  allowSectionTokenFallback: true,
  allowInactiveTokenFallback: true
});

router.get('/',
  requireAccess(SECTION, OPERATIONS.READ),
  trackActionState(SECTION, OPERATIONS.READ),
  ctrl.showList);

router.get('/new',
  requireAccess(SECTION, OPERATIONS.CREATE),
  trackActionState(SECTION, OPERATIONS.CREATE),
  ctrl.showNewForm);

router.post('/new',
  requireAccess(SECTION, OPERATIONS.CREATE),
  trackActionState(SECTION, OPERATIONS.CREATE, mutationActionState),
  ctrl.createEntry);

router.get('/edit/:id',
  requireAccess(SECTION, OPERATIONS.UPDATE),
  trackActionState(SECTION, OPERATIONS.UPDATE),
  ctrl.showEditForm);

router.post('/edit/:id',
  requireAccess(SECTION, OPERATIONS.UPDATE),
  trackActionState(SECTION, OPERATIONS.UPDATE, mutationActionState),
  ctrl.updateEntry);

router.get('/detail/:id',
  requireAccess(SECTION, OPERATIONS.READ),
  trackActionState(SECTION, OPERATIONS.READ),
  ctrl.showDetail);

router.post('/api/:id/submit',
  requireAccess(SECTION, OPERATIONS.UPDATE),
  trackActionState(SECTION, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
  ctrl.submitEntry);

router.post('/api/:id/approve',
  requireAccess(SECTION, OPERATIONS.RESOLVE),
  trackActionState(SECTION, OPERATIONS.RESOLVE, { requireToken: false, keepActive: true }),
  ctrl.approveEntry);

router.post('/api/:id/reject',
  requireAccess(SECTION, OPERATIONS.RESOLVE),
  trackActionState(SECTION, OPERATIONS.RESOLVE, { requireToken: false, keepActive: true }),
  ctrl.rejectEntry);

router.post('/api/:id/reopen',
  requireAccess(SECTION, OPERATIONS.RESOLVE),
  trackActionState(SECTION, OPERATIONS.RESOLVE, { requireToken: false, keepActive: true }),
  ctrl.reopenEntry);

router.post('/api/:id/hold',
  requireAccess(SECTION, OPERATIONS.RESOLVE),
  trackActionState(SECTION, OPERATIONS.RESOLVE, { requireToken: false, keepActive: true }),
  ctrl.holdEntry);

router.post('/api/:id/archive',
  requireAccess(SECTION, OPERATIONS.RESOLVE),
  trackActionState(SECTION, OPERATIONS.RESOLVE, { requireToken: false, keepActive: true }),
  ctrl.archiveEntry);

router.post('/api/:id/delete',
  requireAccess(SECTION, OPERATIONS.DELETE),
  trackActionState(SECTION, OPERATIONS.DELETE, { requireToken: false, keepActive: true }),
  ctrl.deleteEntry);

router.post('/api/media/upload',
  requireAccess(SECTION, OPERATIONS.UPDATE),
  upload(SCHOOL_UPLOAD_FOLDERS.WORD_OF_DAY, true).single('file'),
  trackActionState(SECTION, OPERATIONS.UPDATE, { requireToken: false, keepActive: true }),
  ctrl.uploadMedia);

router.get('/api/daily',
  requireAccess(SECTION, OPERATIONS.READ),
  trackActionState(SECTION, OPERATIONS.READ, { keepActive: true }),
  ctrl.getDailyWidgetPayload);

router.post('/api/check-duplicate',
  requireAccess(SECTION, OPERATIONS.CREATE),
  trackActionState(SECTION, OPERATIONS.CREATE, { requireToken: false, keepActive: true }),
  ctrl.checkDuplicateWord);

module.exports = router;