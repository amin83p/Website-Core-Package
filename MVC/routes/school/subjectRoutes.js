// MVC/routes/school/subjectRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/school/subjectController');
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

router.use(requireAuth);

// List Subjects
router.get('/',
  requireAccess(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.READ_ALL),
  ctrl.listSubjects);

// Add Subject
router.get('/new',
  requireAccess(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.CREATE),
  ctrl.showAddForm);

router.get('/new-wizard',
  requireAccess(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.CREATE),
  ctrl.showAddWizardForm);
router.post('/new',
  requireAccess(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.addSubject);

// Edit Subject
router.get('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.UPDATE),
  ctrl.showEditForm);

router.get('/edit-wizard/:id',
  requireAccess(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.UPDATE),
  ctrl.showEditWizardForm);
router.post('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.editSubject);

// Delete Subject - Support both GET and DELETE for compatibility
router.get('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.DELETE),
  ctrl.deleteSubject);
router.delete('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_SUBJECTS, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteSubject);

module.exports = router;
