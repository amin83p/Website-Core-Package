const workSessionExplorerService = require('../../services/school/workSessionExplorerService');

function resLocalSchoolDashboard(res) {
  return res?.locals?.schoolSectionDashboardHref || '/dashboard/section-nav/SCHOOL';
}

async function showWorkSessionExplorerPage(req, res) {
  try {
    const workSessionExplorerAccess = await workSessionExplorerService.buildWorkSessionExplorerViewer(req);
    res.render('school/activity/workSessionExplorerList', {
      title: 'Work Session Explorer',
      tableName: 'Work_Session_Explorer',
      newUrl: 'school/work-sessions',
      includeModal: true,
      includeModal_Table: true,
      print: true,
      user: req.user,
      actionStateId: req.actionStateId,
      workSessionExplorerAccess,
      schoolSectionDashboardHref: resLocalSchoolDashboard(res),
      searchableFields: [
        'activityTitle',
        'sessionTitle',
        'personName',
        'date',
        'startTime',
        'endTime',
        'statusLabel',
        'evaluationTypeLabel'
      ]
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function getWorkSessionsApi(req, res) {
  try {
    const result = await workSessionExplorerService.listWorkSessions(req, req.query);
    res.json({
      status: 'success',
      data: result.data,
      pagination: result.pagination,
      viewer: result.viewer
    });
  } catch (error) {
    res.status(400).json({ status: 'error', message: error.message });
  }
}

module.exports = {
  showWorkSessionExplorerPage,
  getWorkSessionsApi
};
