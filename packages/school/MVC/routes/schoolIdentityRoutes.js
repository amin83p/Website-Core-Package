const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/schoolIdentityController');
const linkedPersonCtrl = require('../controllers/school/schoolLinkedPersonProfileController');
const {
  requireAuth,
  requireAccess,
  requireAccessAny,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

const SCHOOL_IDENTITY_READ_SECTIONS = [
  SECTIONS.SCHOOL,
  SECTIONS.SCHOOL_SESSIONS,
  SECTIONS.SCHOOL_CLASSES,
  SECTIONS.SCHOOL_TASKS,
  SECTIONS.SCHOOL_ACTIVITIES,
  SECTIONS.SCHOOL_SCHEDULES,
  SECTIONS.SCHOOL_ATTENDANCES,
  SECTIONS.SCHOOL_TIMESHEETS,
  SECTIONS.SCHOOL_TIMESHEET_MANAGEMENT,
  SECTIONS.SCHOOL_REPORTS,
  SECTIONS.SCHOOL_REPORTS_TEMPLATE,
  SECTIONS.SCHOOL_REPORTS_ASSIGNMENT,
  SECTIONS.SCHOOL_REPORTS_INSTANCES,
  SECTIONS.SCHOOL_EXAMS,
  SECTIONS.SCHOOL_EXAMS_TEMPLATE,
  SECTIONS.SCHOOL_EXAMS_ALLOCATION,
  SECTIONS.SCHOOL_EXAMS_TAKING,
  SECTIONS.SCHOOL_EXAMS_REVIEW,
  SECTIONS.SCHOOL_PROGRAMS,
  SECTIONS.SCHOOL_PROGRAM_REGISTRATIONS,
  SECTIONS.SCHOOL_PRIOR_SUBJECT_CREDITS,
  SECTIONS.SCHOOL_TERM_REGISTRATIONS,
  SECTIONS.SCHOOL_ACADEMIC_LEDGER,
  SECTIONS.SCHOOL_WITHDRAWAL,
  SECTIONS.SCHOOL_LEAVE_REQUESTS,
  SECTIONS.SCHOOL_STUDENTS,
  SECTIONS.SCHOOL_TEACHERS,
  SECTIONS.SCHOOL_STAFF
].filter(Boolean);

const LINK_TYPE_SECTION_MAP = Object.freeze({
  student: SECTIONS.SCHOOL_STUDENTS,
  teacher: SECTIONS.SCHOOL_TEACHERS,
  staff: SECTIONS.SCHOOL_STAFF
});

const linkedPersonProfileMutationActionState = Object.freeze({
  requireToken: false,
  keepActive: true
});

function resolveLinkedPersonSectionId(req) {
  const linkType = String(req.query?.linkType || req.body?.linkType || '').trim().toLowerCase();
  return LINK_TYPE_SECTION_MAP[linkType] || SECTIONS.SCHOOL_STUDENTS;
}

function trackLinkedPersonProfileRead(req, res, next) {
  const sectionId = resolveLinkedPersonSectionId(req);
  return trackActionState(sectionId, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true })(req, res, next);
}

function trackLinkedPersonProfilePatch(req, res, next) {
  const sectionId = resolveLinkedPersonSectionId(req);
  return trackActionState(sectionId, OPERATIONS.UPDATE, linkedPersonProfileMutationActionState)(req, res, next);
}

router.use(requireAuth);

router.get('/api/persons',
  requireAccessAny(SCHOOL_IDENTITY_READ_SECTIONS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL || SECTIONS.SCHOOL_SESSIONS, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.listSchoolPersons);

router.get('/api/users',
  requireAccessAny(SCHOOL_IDENTITY_READ_SECTIONS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL || SECTIONS.SCHOOL_SESSIONS, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.listSchoolUsers);

router.get('/api/taggable-users',
  requireAccessAny([
    SECTIONS.SCHOOL_SESSIONS,
    SECTIONS.SCHOOL_ATTENDANCES,
    SECTIONS.SCHOOL_TASKS,
    SECTIONS.SCHOOL_ACTIVITIES
  ].filter(Boolean), OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }),
  ctrl.listTaggableUsers);

router.get('/api/linked-person/:personId',
  requireAccessAny(SCHOOL_IDENTITY_READ_SECTIONS, OPERATIONS.READ_ALL),
  trackLinkedPersonProfileRead,
  linkedPersonCtrl.getLinkedPersonProfile);

router.patch('/api/linked-person/:personId',
  requireAccessAny(SCHOOL_IDENTITY_READ_SECTIONS, OPERATIONS.READ_ALL),
  trackLinkedPersonProfilePatch,
  linkedPersonCtrl.patchLinkedPersonProfile);

module.exports = router;
