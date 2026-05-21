// MVC/routes/restrictedRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/restrictedController');

router.get('/time-restricted', ctrl.timeRestricted);
router.get('/user-restricted', ctrl.userRestricted);

module.exports = router;