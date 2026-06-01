// MVC/routes/school/programRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/programController');
const programRegistrationCtrl = require('../controllers/school/programRegistrationController');
const studentProgramPriorSubjectCtrl = require('../controllers/school/studentProgramPriorSubjectController');
const termRegistrationCtrl = require('../controllers/school/termRegistrationController');
const { requireCoreModule } = require('../services/school/schoolCoreContracts');
const { requireAuth } = requireCoreModule('MVC/middleware/authMiddleware');
const { requireAccess } = requireCoreModule('MVC/middleware/accessMiddleware');
const { trackActionState } = requireCoreModule('MVC/middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('./schoolRouteDependencies');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_PROGRAMS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_PROGRAMS, OPERATIONS.READ_ALL),
  ctrl.listPrograms);

router.get('/api/eligible-administrators',
  requireAccess(SECTIONS.SCHOOL_PROGRAMS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_PROGRAMS, OPERATIONS.READ_ALL),
  ctrl.listEligibleAdministrators);

router.get('/register-students',
  requireAccess(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.CREATE, { keepActive: true }),
  programRegistrationCtrl.showBatchRegistrationPage);

router.get('/register-students-wizard',
  requireAccess(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.CREATE, { keepActive: true }),
  programRegistrationCtrl.showBatchRegistrationWizardPage);

router.get('/registrations',
  requireAccess(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.READ_ALL, { keepActive: true }),
  programRegistrationCtrl.listRegistrations);

router.get('/registrations/:id',
  requireAccess(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.READ_ALL, { keepActive: true }),
  programRegistrationCtrl.showRegistrationDetails);

router.get('/prior-subject-credits',
  requireAccess(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.READ_ALL, { keepActive: true }),
  studentProgramPriorSubjectCtrl.showPage);

router.get('/prior-subject-credits/delete/:id',
  requireAccess(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.DELETE, { keepActive: true }),
  studentProgramPriorSubjectCtrl.deleteRecordByIdParam);

router.get('/prior-subject-credits/api/student-programs',
  requireAccess(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.READ_ALL, { keepActive: true }),
  studentProgramPriorSubjectCtrl.listStudentRegisteredPrograms);

router.get('/prior-subject-credits/api/records',
  requireAccess(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.READ_ALL, { keepActive: true }),
  studentProgramPriorSubjectCtrl.listRecords);

router.post('/prior-subject-credits/api/batch',
  requireAccess(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.CREATE, { requireToken: true, keepActive: true }),
  studentProgramPriorSubjectCtrl.createBatch);

router.post('/prior-subject-credits/api/revoke',
  requireAccess(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.UPDATE, { requireToken: true, keepActive: true }),
  studentProgramPriorSubjectCtrl.revokeRecord);

router.post('/prior-subject-credits/api/delete',
  requireAccess(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.DELETE, { requireToken: true, keepActive: true }),
  studentProgramPriorSubjectCtrl.deleteRecord);

router.post('/register-students/preview',
  requireAccess(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.CREATE, { requireToken: false, keepActive: true }),
  programRegistrationCtrl.previewBatchRegistration);

router.post('/register-students/apply',
  requireAccess(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.CREATE, { requireToken: true }),
  programRegistrationCtrl.applyBatchRegistration);

router.post('/register-students/draft/:id/transactions',
  requireAccess(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.CREATE, { requireToken: false }),
  programRegistrationCtrl.updateDraftTransactions);

router.post('/register-students/approve/:id',
  requireAccess(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.CREATE, { requireToken: false }),
  programRegistrationCtrl.approveRegistration);

router.post('/register-students/rollback/:id',
  requireAccess(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS, OPERATIONS.CREATE, { requireToken: false }),
  programRegistrationCtrl.rollbackRegistration);

router.get('/register-terms/program-registrations',
  requireAccess(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE, { keepActive: true }),
  termRegistrationCtrl.listProgramRegistrationOptions);

router.get('/register-terms/eligible-classes',
  requireAccess(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE, { keepActive: true }),
  termRegistrationCtrl.listEligibleClasses);

router.get('/register-terms/available-terms',
  requireAccess(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE, { keepActive: true }),
  termRegistrationCtrl.listAvailableTerms);

router.get('/register-terms',
  requireAccess(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE, { keepActive: true }),
  termRegistrationCtrl.showRegistrationPage);

router.get('/register-terms-wizard',
  requireAccess(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE, { keepActive: true }),
  termRegistrationCtrl.showRegistrationWizardPage);

router.get('/register-terms-batch-wizard',
  requireAccess(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE, { keepActive: true }),
  termRegistrationCtrl.showBatchRegistrationWizardPage);

router.get('/register-terms-batch/program-options',
  requireAccess(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE, { keepActive: true }),
  termRegistrationCtrl.listBatchProgramOptions);

router.get('/register-terms-batch/students',
  requireAccess(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE, { keepActive: true }),
  termRegistrationCtrl.listBatchStudents);

router.get('/register-terms-batch/classes',
  requireAccess(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE, { keepActive: true }),
  termRegistrationCtrl.listBatchClasses);

router.get('/term-registrations',
  requireAccess(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.READ_ALL, { keepActive: true }),
  termRegistrationCtrl.listRegistrations);

router.get('/term-registrations/:id',
  requireAccess(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.READ_ALL, { keepActive: true }),
  termRegistrationCtrl.showRegistrationDetails);

router.post('/register-terms/preview',
  requireAccess(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE, { requireToken: false, keepActive: true }),
  termRegistrationCtrl.previewRegistration);

router.post('/register-terms/apply',
  requireAccess(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE, { requireToken: true }),
  termRegistrationCtrl.applyRegistration);

router.post('/register-terms-batch/preview',
  requireAccess(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE, { requireToken: false, keepActive: true }),
  termRegistrationCtrl.previewBatchRegistration);

router.post('/register-terms-batch/apply',
  requireAccess(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE, { requireToken: true }),
  termRegistrationCtrl.applyBatchRegistration);

router.post('/register-terms/draft/:id/transactions',
  requireAccess(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE, { requireToken: false }),
  termRegistrationCtrl.updateDraftTransactions);

router.post('/register-terms/approve/:id',
  requireAccess(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE, { requireToken: false }),
  termRegistrationCtrl.approveRegistration);

router.post('/register-terms/rollback/:id',
  requireAccess(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TERM_REGISTRATIONS, OPERATIONS.CREATE, { requireToken: false }),
  termRegistrationCtrl.rollbackRegistration);

router.get('/new',
  requireAccess(SECTIONS.SCHOOL_PROGRAMS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_PROGRAMS, OPERATIONS.CREATE),
  ctrl.showForm);

router.get('/new-wizard',
  requireAccess(SECTIONS.SCHOOL_PROGRAMS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_PROGRAMS, OPERATIONS.CREATE),
  ctrl.showAddWizardForm);

router.post('/new',
  requireAccess(SECTIONS.SCHOOL_PROGRAMS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_PROGRAMS, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.saveProgram);

router.get('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_PROGRAMS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_PROGRAMS, OPERATIONS.UPDATE),
  ctrl.showForm);

router.get('/edit-wizard/:id',
  requireAccess(SECTIONS.SCHOOL_PROGRAMS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_PROGRAMS, OPERATIONS.UPDATE),
  ctrl.showEditWizardForm);

router.post('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_PROGRAMS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_PROGRAMS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveProgram);

router.post('/apply-transactions/:id',
  requireAccess(SECTIONS.SCHOOL_PROGRAMS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_PROGRAMS, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.applyProgramTransactionsForStudent);

router.get('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_PROGRAMS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_PROGRAMS, OPERATIONS.DELETE),
  ctrl.deleteProgram);

router.delete('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_PROGRAMS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_PROGRAMS, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteProgram);

module.exports = router;
