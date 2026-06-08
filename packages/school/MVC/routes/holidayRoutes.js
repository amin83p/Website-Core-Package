const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/holidayController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_HOLIDAYS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_HOLIDAYS, OPERATIONS.READ_ALL),
  ctrl.listHolidays);

router.get('/api/range',
  requireAccess(SECTIONS.SCHOOL_HOLIDAYS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_HOLIDAYS, OPERATIONS.READ_ALL),
  ctrl.listHolidaysInRange);

router.post('/save',
  requireAccess(SECTIONS.SCHOOL_HOLIDAYS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_HOLIDAYS, OPERATIONS.UPDATE, {
    requireToken: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.saveHoliday);

router.get('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_HOLIDAYS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_HOLIDAYS, OPERATIONS.DELETE),
  ctrl.deleteHoliday);

router.delete('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_HOLIDAYS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_HOLIDAYS, OPERATIONS.DELETE, {
    requireToken: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.deleteHoliday);

module.exports = router;
