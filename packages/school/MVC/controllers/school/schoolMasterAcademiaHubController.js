const masterAcademiaHubService = require('../../services/school/schoolMasterAcademiaHubService');
const taskService = require('../../services/school/taskService');

exports.showMasterAcademiaHubPage = async (req, res) => {
  try {
    const modules = await masterAcademiaHubService.resolveAccessibleModules(req);
    const defaultModule = modules[0] || null;

    res.render('school/masterAcademiaHub', {
      title: 'Master Academia Hub',
      modules,
      defaultType: defaultModule ? defaultModule.type : '',
      canManageAllTasks: taskService.isAdminViewer(req.user),
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

exports.getTaskCount = async (req, res) => {
  try {
    const result = await masterAcademiaHubService.getTaskSummary(req);
    res.json({ status: 'success', ...result });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      status: 'error',
      message: error.message || 'Unable to load task count.'
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

exports.lockWorkspaceSessions = async (req, res) => {
  try {
    const result = await masterAcademiaHubService.lockWorkspaceSessions(req.body || {}, req);
    res.json({
      status: 'success',
      message: `${result.locked} session(s) locked.${result.alreadyLocked ? ` ${result.alreadyLocked} already locked.` : ''}`,
      result
    });
  } catch (error) {
    const statusCode = error.statusCode || 400;
    res.status(statusCode).json({
      status: 'error',
      message: error.message || 'Unable to lock selected sessions.'
    });
  }
};

exports.updateWorkspaceSession = async (req, res) => {
  try {
    const result = await masterAcademiaHubService.updateWorkspaceSession(req.body || {}, req);
    res.json({
      status: 'success',
      message: 'Session updated.',
      result
    });
  } catch (error) {
    const statusCode = error.statusCode || 400;
    res.status(statusCode).json({
      status: 'error',
      message: error.message || 'Unable to update session.'
    });
  }
};
