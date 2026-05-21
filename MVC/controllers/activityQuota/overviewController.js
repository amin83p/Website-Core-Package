const overviewDataService = require('../../services/activityQuota/overviewDataService');
const activityQuotaUiService = require('../../services/activityQuota/activityQuotaUiService');
const { isAjax } = require('../../utils/generalTools');

async function showOverview(req, res) {
  try {
    const overview = await overviewDataService.getOverview(req.query || {}, req.user, {
      scopeId: req.accessScope
    });

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        results: overview
      });
    }

    const pageActions = await activityQuotaUiService.buildPageActions(req, {
      exclude: ['overview'],
      dashboardHref: res.locals.activityQuotaSectionDashboardHref
    });

    return res.render('activityQuota/overview/overview', {
      title: 'Activity Quota Overview',
      overview,
      pageActions,
      includeModal: true,
      user: req.user || null,
      actionStateId: req.actionStateId || ''
    });
  } catch (error) {
    if (isAjax(req)) {
      return res.status(400).json({
        status: 'error',
        message: error.message || 'Failed to load activity quota overview.'
      });
    }

    return res.status(400).render('error', {
      title: 'Error',
      message: error.message || 'Failed to load activity quota overview.',
      user: req.user || null
    });
  }
}

module.exports = {
  showOverview
};
