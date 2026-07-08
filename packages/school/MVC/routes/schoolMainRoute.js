const express = require('express');

const router = express.Router();
const { SECTIONS } = require('./schoolRouteDependencies');
const { registerSchoolUploadCategoryResolvers } = require('../services/school/schoolUploadCategoryRegistration');
const schoolStudentProfileLinkService = require('../services/school/schoolStudentProfileLinkService');

const SCHOOL_MOUNT_GUARD_KEY = '__schoolMainRouteMounted';

registerSchoolUploadCategoryResolvers();

router.use((req, _res, next) => {
  if (req?.[SCHOOL_MOUNT_GUARD_KEY]) return next('router');
  req[SCHOOL_MOUNT_GUARD_KEY] = true;
  next();
});

router.use((req, res, next) => {
  res.locals.schoolSectionDashboardHref = `/dashboard/section-nav/${encodeURIComponent(SECTIONS.SCHOOL || 'SCHOOL')}`;
  next();
});

router.use(async (req, res, next) => {
  try {
    res.locals.canOpenStudentProfile = await schoolStudentProfileLinkService.evaluateCanOpenStudentProfile(req.user, req.ip);
  } catch (_err) {
    res.locals.canOpenStudentProfile = false;
  }
  next();
});

router.use('/master-hub', require('./schoolMasterAcademiaHubRoutes'));
router.use('/identity', require('./schoolIdentityRoutes'));
router.use('/students', require('./studentRoutes'));
router.use('/teachers', require('./teacherRoutes'));
router.use('/staff', require('./staffRoutes'));
router.use('/programs', require('./programRoutes'));
router.use('/transactionTemplates', require('./transactionTemplateRoutes'));
router.use('/transactionDefinitions', require('./transactionDefinitionRoutes'));
router.use('/feeDefinitions', require('./transactionDefinitionRoutes'));
router.use('/accounts', require('./schoolAccountRoutes'));
router.use('/transactions', require('./transactionsManagerRoutes'));
router.use('/academic-ledger', require('./academicLedgerRoutes'));
router.use('/sample-data', require('./sampleDataRoutes'));
router.use('/departments', require('./departmentRoutes'));
router.use('/activities', require('./activityRoutes'));
router.use('/subjects', require('./subjectRoutes'));
router.use('/terms', require('./termRoutes'));
router.use('/payRates', require('./payRateRoutes'));
router.use('/session-statuses', require('./sessionStatusRoutes'));
router.use('/timesheetPeriods', require('./timesheetPeriodRoutes'));
router.use('/timesheets', require('./timesheetRoutes'));
router.use('/classes', require('./classRoutes'));
router.use('/calendar', require('./calendarRoutes'));
router.use('/schedules', require('./scheduleRoutes'));
router.use('/attendances', require('./attendanceRoutes'));
router.use('/grades-matrix', require('./gradesMatrixRoutes'));
router.use('/holidays', require('./holidayRoutes'));
router.use('/sessions', require('./sessionRoutes'));
router.use('/reports', require('./reportRoutes'));
router.use('/exams', require('./examRoutes'));
router.use('/leave-requests', require('./leaveRequestRoutes'));
router.use('/tasks', require('./taskRoutes'));
router.use('/withdrawal', require('./withdrawalRoutes'));
router.use('/', require('./schoolRoutes'));

module.exports = router;

