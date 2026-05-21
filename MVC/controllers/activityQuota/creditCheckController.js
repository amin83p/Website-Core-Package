const creditCheckDataService = require('../../services/activityQuota/creditCheckDataService');
const activityQuotaUiService = require('../../services/activityQuota/activityQuotaUiService');
const {
  isAjax,
  buildDataServiceQuery
} = require('../../utils/generalTools');

async function showCreditCheck(req, res) {
  try {
    const payload = await creditCheckDataService.getCreditCheck(req.query || {}, req.user, {
      scopeId: req.accessScope
    });

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        results: payload
      });
    }

    const pageActions = await activityQuotaUiService.buildPageActions(req, {
      exclude: ['creditCheck'],
      dashboardHref: res.locals.activityQuotaSectionDashboardHref
    });

    return res.render('activityQuota/creditCheck/creditCheck', {
      title: 'Activity Quota Credit Check',
      tableName: 'Activity_Quota_Credit_Check',
      creditCheck: payload,
      pageActions,
      filters: req.query || {},
      includeModal: true,
      user: req.user || null,
      actionStateId: req.actionStateId || ''
    });
  } catch (error) {
    if (isAjax(req)) {
      return res.status(400).json({
        status: 'error',
        message: error.message || 'Failed to load activity quota credit check.'
      });
    }

    return res.status(400).render('error', {
      title: 'Error',
      message: error.message || 'Failed to load activity quota credit check.',
      user: req.user || null
    });
  }
}

async function pickerUsers(req, res) {
  try {
    const query = await buildDataServiceQuery(
      req.query || {},
      creditCheckDataService.PICKER_USER_QUERY_OPTIONS
    );
    const results = await creditCheckDataService.listTargetUsersPicker(query, req.user, {
      scopeId: req.accessScope
    });
    return res.json({
      status: 'success',
      results: Array.isArray(results?.results) ? results.results : [],
      pagination: results?.pagination || null
    });
  } catch (error) {
    return res.status(400).json({
      status: 'error',
      message: error.message || 'Failed to load user picker.'
    });
  }
}

module.exports = {
  showCreditCheck,
  pickerUsers
};
