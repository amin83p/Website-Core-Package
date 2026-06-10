const masterHubService = require('../../services/school/schoolMasterHubService');

exports.showMasterHubPage = async (req, res) => {
  try {
    const modules = await masterHubService.resolveAccessibleModules(req);
    const defaultModule = modules[0] || null;

    res.render('school/masterHub', {
      title: 'School Master Hub',
      modules,
      defaultType: defaultModule ? defaultModule.type : '',
      user: req.user
    });
  } catch (error) {
    res.status(500).render('error', {
      title: 'School Master Hub',
      error,
      message: error.message,
      user: req.user
    });
  }
};

exports.listPeoplePanel = async (req, res) => {
  try {
    const type = String(req.query.type || '').trim().toLowerCase();
    const result = await masterHubService.getPeoplePanelRows(type, req.query, req);
    res.json({ status: 'success', ...result });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      status: 'error',
      message: error.message || 'Unable to load School Master Hub list.'
    });
  }
};
