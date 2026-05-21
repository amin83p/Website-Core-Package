const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/school/transactionsManagerController');
const { requireAuth } = require('../../middleware/authMiddleware');
const { requireAccess } = require('../../middleware/accessMiddleware');
const { trackActionState } = require('../../middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

router.use(requireAuth);

router.get('/',
  requireAccess(SECTIONS.SCHOOL_TRANSACTIONS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_TRANSACTIONS, OPERATIONS.READ_ALL),
  ctrl.listTransactions);

router.get('/statement',
  requireAccess(SECTIONS.SCHOOL_TRANSACTIONS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_TRANSACTIONS, OPERATIONS.READ_ALL),
  ctrl.showStatement);

router.get('/new',
  requireAccess(SECTIONS.SCHOOL_TRANSACTIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TRANSACTIONS, OPERATIONS.CREATE),
  ctrl.showForm);

router.post('/new',
  requireAccess(SECTIONS.SCHOOL_TRANSACTIONS, OPERATIONS.CREATE),
  trackActionState(SECTIONS.SCHOOL_TRANSACTIONS, OPERATIONS.CREATE, { requireToken: true }),
  ctrl.saveTransaction);

router.get('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_TRANSACTIONS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_TRANSACTIONS, OPERATIONS.UPDATE),
  ctrl.showForm);

router.post('/edit/:id',
  requireAccess(SECTIONS.SCHOOL_TRANSACTIONS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_TRANSACTIONS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveTransaction);

router.post('/post/:id',
  requireAccess(SECTIONS.SCHOOL_TRANSACTIONS, OPERATIONS.UPDATE),
  trackActionState(SECTIONS.SCHOOL_TRANSACTIONS, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.postDraftTransaction);

router.get('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_TRANSACTIONS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_TRANSACTIONS, OPERATIONS.DELETE),
  ctrl.deleteTransaction);

router.delete('/delete/:id',
  requireAccess(SECTIONS.SCHOOL_TRANSACTIONS, OPERATIONS.DELETE),
  trackActionState(SECTIONS.SCHOOL_TRANSACTIONS, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteTransaction);

module.exports = router;
