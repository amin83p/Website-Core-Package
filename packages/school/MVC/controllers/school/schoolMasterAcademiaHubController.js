const masterAcademiaHubService = require('../../services/school/schoolMasterAcademiaHubService');

exports.showMasterAcademiaHubPage = async (req, res) => {
  try {
    const modules = await masterAcademiaHubService.resolveAccessibleModules(req);
    const defaultModule = modules[0] || null;

    res.render('school/masterAcademiaHub', {
      title: 'Master Academia Hub',
      modules,
      defaultType: defaultModule ? defaultModule.type : '',
      user: req.user
    });
  } catch (error) {
    res.status(500).render('error', {
      title: 'Master Academia Hub',
      error,
      message: error.message,
      user: req.user
    });
  }
};

exports.listPeoplePanel = async (req, res) => {
  try {
    const type = String(req.query.type || '').trim().toLowerCase();
    const result = await masterAcademiaHubService.getPeoplePanelRows(type, req.query, req);
    res.json({ status: 'success', ...result });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      status: 'error',
      message: error.message || 'Unable to load Master Academia Hub list.'
    });
  }
};

exports.getNotificationCount = async (req, res) => {
  try {
    const result = await masterAcademiaHubService.getNotificationSummary(req);
    res.json({ status: 'success', ...result });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      status: 'error',
      message: error.message || 'Unable to load notification count.'
    });
  }
};

exports.getWorkspaceSection = async (req, res) => {
  try {
    const sectionKey = String(req.params.sectionKey || '').trim().toLowerCase();
    const result = await masterAcademiaHubService.getWorkspaceSection(sectionKey, req.query, req);
    res.json({ status: 'success', ...result });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      status: 'error',
      message: error.message || 'Unable to load this Master Academia Hub section.'
    });
  }
};
