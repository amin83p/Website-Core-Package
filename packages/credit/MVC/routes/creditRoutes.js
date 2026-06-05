const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/creditController');
const { requireAuth } = require('./creditRouteDependencies');

router.use(requireAuth);

router.get('/', ctrl.showDashboard);
router.get('/requests', (req, res) => {
  res.redirect('/credit/customers');
});
router.get('/installments', (req, res) => {
  res.redirect('/credit/customers');
});

router.get('/customers', ctrl.listCustomers);
router.get('/customers/new', ctrl.showForm);
router.post('/customers/new', ctrl.saveCustomer);
router.get('/customers/edit/:id', ctrl.showForm);
router.post('/customers/edit/:id', ctrl.saveCustomer);
router.get('/customers/delete/:id', ctrl.deleteCustomer);
router.delete('/customers/delete/:id', ctrl.deleteCustomer);

module.exports = router;
