'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/skillController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./schoolRouteDependencies');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_SKILLS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SKILLS, OPERATIONS.READ_ALL),
  ctrl.listSkills);

router.get('/new',
  requireAccess(SECTIONS.SCHOOL_SKILLS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_SKILLS, OPERATIONS.CREATE),
  ctrl.showCreateForm);

router.post('/new',
  requireAccess(SECTIONS.SCHOOL_SKILLS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_SKILLS, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.saveSkill);

router.get('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_SKILLS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SKILLS, OPERATIONS.UPDATE),
  ctrl.showEditForm);

router.post('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_SKILLS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_SKILLS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveSkill);

router.get('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_SKILLS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_SKILLS, OPERATIONS.DELETE),
  ctrl.deleteSkill);

router.delete('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_SKILLS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_SKILLS, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteSkill);

module.exports = router;
