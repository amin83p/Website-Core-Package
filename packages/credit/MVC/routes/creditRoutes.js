const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/creditController');
const {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
} = require('./creditRouteDependencies');

function withAccess(sectionId, operationId, options = {}) {
  return [
    requireAccess(sectionId, operationId),
    trackActionState(sectionId, operationId, options)
  ];
}

router.use(requireAuth);

router.get(
  '/',
  ...withAccess(SECTIONS.CREDIT_LOANS, OPERATIONS.READ_ALL),
  ctrl.showDashboard
);
router.get('/requests', ...withAccess(SECTIONS.CREDIT_REQUESTS, OPERATIONS.READ_ALL), (req, res) => {
  res.redirect('/credit/customers');
});
router.get('/installments', ...withAccess(SECTIONS.CREDIT_INSTALLMENTS, OPERATIONS.READ_ALL), (req, res) => {
  res.redirect('/credit/customers');
});

router.get('/customers', ...withAccess(SECTIONS.CREDIT_CUSTOMERS, OPERATIONS.READ_ALL), ctrl.listCustomers);
router.get('/customers/new', ...withAccess(SECTIONS.CREDIT_CUSTOMERS, OPERATIONS.CREATE), ctrl.showForm);
router.post('/customers/new', ...withAccess(SECTIONS.CREDIT_CUSTOMERS, OPERATIONS.CREATE), ctrl.saveCustomer);
router.get('/customers/edit/:id', ...withAccess(SECTIONS.CREDIT_CUSTOMERS, OPERATIONS.UPDATE), ctrl.showForm);
router.post('/customers/edit/:id', ...withAccess(SECTIONS.CREDIT_CUSTOMERS, OPERATIONS.UPDATE), ctrl.saveCustomer);
router.get('/customers/delete/:id', ...withAccess(SECTIONS.CREDIT_CUSTOMERS, OPERATIONS.DELETE), ctrl.deleteCustomer);
router.delete('/customers/delete/:id', ...withAccess(SECTIONS.CREDIT_CUSTOMERS, OPERATIONS.DELETE), ctrl.deleteCustomer);

module.exports = router;
