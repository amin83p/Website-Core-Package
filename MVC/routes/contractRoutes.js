// MVC/routes/contractRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/contractController');
const { requireAuth } = require('../middleware/authMiddleware');
// Assuming you have access middleware, add it here if needed
// const { requireAccess } = require('../middleware/accessMiddleware');

router.get('/', requireAuth, ctrl.listContracts);

router.get('/new', requireAuth, ctrl.showAddForm);
router.post('/new', requireAuth, ctrl.addContract);

router.get('/edit/:id', requireAuth, ctrl.showEditForm);
router.post('/edit/:id', requireAuth, ctrl.editContract);

// Support both for compatibility
router.get('/delete/:id', requireAuth, ctrl.deleteContract);
router.delete('/delete/:id', requireAuth, ctrl.deleteContract);

module.exports = router;