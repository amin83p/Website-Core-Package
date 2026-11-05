'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/enrollmentClaimController');
const { requireAuth } = require('./schoolRouteDependencies');

router.use(requireAuth);

router.post('/api/window', ctrl.postEnrollmentClaimsWindow);

module.exports = router;
