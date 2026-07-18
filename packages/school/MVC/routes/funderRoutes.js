const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/funderController');
const { requireAuth, requireAccess, trackActionState, SECTIONS, OPERATIONS } = require('./schoolRouteDependencies');

router.use(requireAuth);
router.get('/', requireAccess(SECTIONS.SCHOOL_FUNDERS, OPERATIONS.READ_ALL), trackActionState(SECTIONS.SCHOOL_FUNDERS, OPERATIONS.READ_ALL), ctrl.listFunders);
router.get('/api/eligible-persons', requireAccess(SECTIONS.SCHOOL_FUNDERS, OPERATIONS.CREATE), trackActionState(SECTIONS.SCHOOL_FUNDERS, OPERATIONS.CREATE, { requireToken: false, keepActive: true }), ctrl.listEligiblePersons);
router.get('/api/eligible-accounts', requireAccess(SECTIONS.SCHOOL_FUNDERS, OPERATIONS.READ_ALL), trackActionState(SECTIONS.SCHOOL_FUNDERS, OPERATIONS.READ_ALL, { requireToken: false, keepActive: true }), ctrl.listEligibleAccounts);
router.get('/new', requireAccess(SECTIONS.SCHOOL_FUNDERS, OPERATIONS.CREATE), trackActionState(SECTIONS.SCHOOL_FUNDERS, OPERATIONS.CREATE), ctrl.showForm);
router.post('/new', requireAccess(SECTIONS.SCHOOL_FUNDERS, OPERATIONS.CREATE), trackActionState(SECTIONS.SCHOOL_FUNDERS, OPERATIONS.CREATE, { requireToken: true }), ctrl.saveFunder);
router.get('/edit/:id', requireAccess(SECTIONS.SCHOOL_FUNDERS, OPERATIONS.UPDATE), trackActionState(SECTIONS.SCHOOL_FUNDERS, OPERATIONS.UPDATE), ctrl.showForm);
router.post('/edit/:id', requireAccess(SECTIONS.SCHOOL_FUNDERS, OPERATIONS.UPDATE), trackActionState(SECTIONS.SCHOOL_FUNDERS, OPERATIONS.UPDATE, { requireToken: true }), ctrl.saveFunder);
router.post('/:id/create-account', requireAccess(SECTIONS.SCHOOL_FUNDERS, OPERATIONS.UPDATE), trackActionState(SECTIONS.SCHOOL_FUNDERS, OPERATIONS.UPDATE, { requireToken: true }), ctrl.createAccount);
router.get('/delete/:id', requireAccess(SECTIONS.SCHOOL_FUNDERS, OPERATIONS.DELETE), trackActionState(SECTIONS.SCHOOL_FUNDERS, OPERATIONS.DELETE), ctrl.deleteFunder);
router.delete('/delete/:id', requireAccess(SECTIONS.SCHOOL_FUNDERS, OPERATIONS.DELETE), trackActionState(SECTIONS.SCHOOL_FUNDERS, OPERATIONS.DELETE, { requireToken: true }), ctrl.deleteFunder);
module.exports = router;
