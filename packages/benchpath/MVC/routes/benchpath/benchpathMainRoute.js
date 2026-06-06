const express = require('express');
const router = express.Router();

router.use((req, res, next) => {
  res.locals.packageId = res.locals.packageId || 'benchpath';
  res.locals.packageName = res.locals.packageName || 'BenchPath';
  res.locals.packageMountPath = res.locals.packageMountPath || '/benchpath';
  next();
});

router.use('/sources', require('./sourceRoutes'));
router.use('/source-fragments', require('./sourceFragmentRoutes'));
router.use('/clb-framework', require('./clbFrameworkRoutes'));
router.use('/clb-stages', require('./clbStageRoutes'));
router.use('/clb-skills', require('./clbSkillRoutes'));
router.use('/clb-competency-areas', require('./clbCompetencyAreaRoutes'));
router.use('/clb-benchmarks', require('./clbBenchmarkRoutes'));
router.use('/clb-competencies', require('./clbCompetencyRoutes'));
router.use('/clb-indicators', require('./clbIndicatorRoutes'));
router.use('/clb-profile-of-ability', require('./clbProfileOfAbilityRoutes'));
router.use('/clb-features-of-communication', require('./clbFeatureOfCommunicationRoutes'));
router.use('/clb-sample-task-labels', require('./clbSampleTaskLabelRoutes'));
router.use('/tasks', require('./taskRoutes'));
router.use('/tools', require('./benchpathToolsRoutes'));
router.use('/', require('./benchpathRoutes'));

router.packageId = 'benchpath';
router.packageName = 'BenchPath';
router.mountPath = '/benchpath';

module.exports = router;
