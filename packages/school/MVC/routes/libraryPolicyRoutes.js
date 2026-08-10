'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/libraryPolicyController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_POLICIES, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_POLICIES, OPERATIONS.READ_ALL),
  ctrl.listPolicies);

router.get('/edit/:role',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_POLICIES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_POLICIES, OPERATIONS.UPDATE),
  ctrl.showEditForm);

router.post('/edit/:role',
  requireAccess(SECTIONS.SCHOOL_LIBRARY_POLICIES, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_LIBRARY_POLICIES, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.savePolicy);

module.exports = router;
