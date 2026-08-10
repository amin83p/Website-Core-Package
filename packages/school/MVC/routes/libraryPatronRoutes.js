'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/libraryPatronController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

router.use(requireAuth);

router.post('/api/resolve',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_CIRCULATION, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.apiResolvePatron);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_PATRONS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_PATRONS, OPERATIONS.READ_ALL),
  ctrl.listPatrons);

router.get('/new',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_PATRONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_PATRONS, OPERATIONS.CREATE),
  ctrl.showCreateForm);

router.post('/new',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_PATRONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_PATRONS, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.savePatron);

router.get('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_PATRONS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_PATRONS, OPERATIONS.UPDATE),
  ctrl.showEditForm);

router.post('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_PATRONS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_PATRONS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.savePatron);

module.exports = router;
