const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/websitePolicyController');
const { requireAuth } = require('../middleware/authMiddleware');
const adminApproval = require('../middleware/adminApproval'); // Ensure only admins access this

router.get('/', requireAuth, ctrl.showPolicyForm);
router.post('/', requireAuth, adminApproval, ctrl.updatePolicy);

module.exports = router;