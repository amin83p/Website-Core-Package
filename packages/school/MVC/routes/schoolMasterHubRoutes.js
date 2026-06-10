const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/schoolMasterHubController');
const {
  requireAuth,
  requireAccessAny,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

const PEOPLE_READ_SECTIONS = Object.freeze([
  SECTIONS.SCHOOL_STUDENTS,
  SECTIONS.SCHOOL_TEACHERS,
  SECTIONS.SCHOOL_STAFF
]);

router.use(requireAuth);

router.get('/',
  requireAccessAny(PEOPLE_READ_SECTIONS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_MASTER_HUB, OPERATIONS.READ_ALL),
  ctrl.showMasterHubPage);

router.get('/api/list',
  requireAccessAny(PEOPLE_READ_SECTIONS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_MASTER_HUB, OPERATIONS.READ_ALL),
  ctrl.listPeoplePanel);

module.exports = router;
