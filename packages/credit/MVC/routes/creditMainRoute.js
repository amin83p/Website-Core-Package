const express = require('express');

const router = express.Router();

router.use((req, res, next) => {
  res.locals.packageId = res.locals.packageId || 'credit';
  res.locals.packageName = res.locals.packageName || 'Credit';
  res.locals.packageMountPath = res.locals.packageMountPath || '/credit';
  next();
});

router.use('/', require('./creditRoutes'));

router.packageId = 'credit';
router.packageName = 'Credit';
router.mountPath = '/credit';

module.exports = router;
