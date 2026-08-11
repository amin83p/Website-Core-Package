'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/libraryLocationController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

router.use(requireAuth);

const locationMutationActionState = {
  requireToken: true,
  allowOperationTokenFallback: true,
  allowInactiveTokenFallback: true
};

router.get('/api/assignable-spots',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_COPIES, OPERATIONS.READ_ALL),
  ctrl.apiAssignableSpots);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_LOCATIONS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_LOCATIONS, OPERATIONS.READ_ALL),
  ctrl.listLocations);

router.get('/new',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_LOCATIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_LOCATIONS, OPERATIONS.CREATE),
  ctrl.showCreateForm);

router.post('/new',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_LOCATIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_LOCATIONS, OPERATIONS.CREATE, locationMutationActionState),
  ctrl.saveLocation);

router.get('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_LOCATIONS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_LOCATIONS, OPERATIONS.UPDATE),
  ctrl.showEditForm);

router.post('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_LOCATIONS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_LOCATIONS, OPERATIONS.UPDATE, locationMutationActionState),
  ctrl.saveLocation);

router.post('/deactivate/:id',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_LOCATIONS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_LOCATIONS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.deactivateLocation);

router.post('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_LOCATIONS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_LOCATIONS, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteLocation);

module.exports = router;
