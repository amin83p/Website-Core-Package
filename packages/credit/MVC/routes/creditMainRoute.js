const express = require('express');

const router = express.Router();

router.use('/', require('./creditRoutes'));

module.exports = router;

