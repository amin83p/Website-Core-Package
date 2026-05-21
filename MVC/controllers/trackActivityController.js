const { Parser } = require('json2csv');
const dataService = require('../services/dataService');
const trackActivityService = require('../services/security/trackActivityService');

function cleanText(value, max = 220) {
  if (value === undefined || value === null) return '';
  const text = String(value).trim();
  return text.length > max ? text.slice(0, max) : text;
}

function toSafeCsvExportRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((event) => ({
    Timestamp: cleanText(event.occurredAtDisplay, 120),
    Source: cleanText(event.sourceLabel || event.source, 40),
    Activity: cleanText(event.summary, 420),
    Status: cleanText(event.statusRaw, 80),
    User: cleanText(event.actorPrimary, 180),
    User_ID: cleanText(event.userId, 120),
    Username: cleanText(event.username, 140),
    Display_Name: cleanText(event.displayName, 180),
    Org_Name: cleanText(event.orgName, 180),
    Org_ID: cleanText(event.orgId, 120),
    Section: cleanText(event.sectionName, 180),
    Section_ID: cleanText(event.sectionId, 120),
    Operation: cleanText(event.operationName, 180),
    Operation_ID: cleanText(event.operationId, 120),
    Request_ID: cleanText(event.requestId, 160),
    Context: cleanText(event.contextLine, 240),
    Action_State_Linked: event.hasActionState ? 'YES' : 'NO',
    Action_State_Status: cleanText(event.actionState?.statusRaw, 80),
    Action_State_ID: cleanText(event.actionState?.recordId || event.actionStateId, 160),
    Record_Source_ID: cleanText(event.recordId, 160)
  }));
}

function sanitizeCsvRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const out = {};
    Object.entries(row || {}).forEach(([key, value]) => {
      out[key] = trackActivityService.sanitizeCsvCellForSpreadsheet(value);
    });
    return out;
  });
}

async function viewTrackActivity(req, res) {
  try {
    const [sections, operations, organizations] = await Promise.all([
      dataService.fetchData('sections', { sort: 'name' }, req.user),
      dataService.fetchData('operations', { sort: 'name' }, req.user),
      dataService.fetchData('organizations', { sort: 'name' }, req.user)
    ]);

    const filters = trackActivityService.buildDefaultPageFilters(req.query || {});
    const canPickUsers = trackActivityService.hasAdminPower(req.user);
    let selectedUserSummary = '';
    if (!canPickUsers) {
      filters.userId = cleanText(req.user?.id, 120);
      selectedUserSummary = cleanText(req.user?.displayName || req.user?.name || req.user?.username || filters.userId, 180);
    } else if (filters.userId) {
      const selectedUser = await dataService.getDataById('users', filters.userId, req.user).catch(() => null);
      selectedUserSummary = cleanText(
        selectedUser?.displayName
          || selectedUser?.name
          || selectedUser?.username
          || selectedUser?.email
          || filters.userId,
        180
      );
    }

    return res.render('security/trackActivityList', {
      title: 'Track Activity',
      tableName: null,
      newUrl: 'security/track-activity',
      print: true,
      user: req.user || null,
      filters,
      summary: {
        totalEvents: 0,
        logCount: 0,
        actionStateLinkedCount: 0,
        successCount: 0,
        failureCount: 0,
        uniqueUserCount: 0,
        uniqueRequestCount: 0
      },
      sections: Array.isArray(sections) ? sections : [],
      operations: Array.isArray(operations) ? operations : [],
      organizations: Array.isArray(organizations) ? organizations : [],
      maxRangeDays: trackActivityService.MAX_RANGE_DAYS,
      canPickUsers,
      selectedUserSummary
    });
  } catch (error) {
    console.error('Track Activity View Error:', error);
    return res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load Track Activity.',
      user: req.user || null
    });
  }
}

async function fetchTrackActivityTimelineData(req, res) {
  try {
    const report = await trackActivityService.fetchTrackActivityHourlyTimeline(req.query || {}, req.user);
    return res.json({
      status: 'success',
      ...report
    });
  } catch (error) {
    console.error('Track Activity Timeline Data Error:', error);
    const message = error.message || 'Failed to load timeline data.';
    const statusCode = /outside your access scope/i.test(message) ? 403 : 500;
    return res.status(statusCode).json({
      status: 'error',
      message
    });
  }
}

async function fetchTrackActivityDetail(req, res) {
  try {
    const payload = {
      ...(req.query || {}),
      ...(req.body || {})
    };
    const details = await trackActivityService.fetchTrackActivityDetails(payload, req.user);
    return res.json({
      status: 'success',
      ...details
    });
  } catch (error) {
    console.error('Track Activity Detail Error:', error);
    const message = error.message || 'Failed to load timeline detail.';
    const statusCode = /outside your access scope/i.test(message) ? 403 : 500;
    return res.status(statusCode).json({
      status: 'error',
      message
    });
  }
}

async function fetchTrackActivityUsers(req, res) {
  try {
    const users = await trackActivityService.fetchTrackActivityUsers(req.query || {}, req.user);
    return res.json({
      status: 'success',
      results: Array.isArray(users.rows) ? users.rows : [],
      pagination: {
        currentPage: 1,
        totalPages: 1,
        totalItems: Array.isArray(users.rows) ? users.rows.length : 0,
        limit: Array.isArray(users.rows) ? users.rows.length : 0
      }
    });
  } catch (error) {
    console.error('Track Activity Users Error:', error);
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to load users.'
    });
  }
}

async function exportTrackActivity(req, res) {
  try {
    const format = cleanText(req.body?.format, 20).toLowerCase();
    if (format !== 'csv' && format !== 'json') {
      return res.status(400).json({ status: 'error', message: 'Invalid export format specified.' });
    }

    const report = await trackActivityService.fetchTrackActivity(req.body || {}, req.user, { includeAllRows: true });
    const exportRows = toSafeCsvExportRows(report.rows);
    const filename = `track_activity_${new Date().toISOString().slice(0, 10)}`;

    if (format === 'csv') {
      const safeRows = sanitizeCsvRows(exportRows);
      const fields = [
        'Timestamp',
        'Source',
        'Activity',
        'Status',
        'User',
        'User_ID',
        'Username',
        'Display_Name',
        'Org_Name',
        'Org_ID',
        'Section',
        'Section_ID',
        'Operation',
        'Operation_ID',
        'Request_ID',
        'Context',
        'Action_State_Linked',
        'Action_State_Status',
        'Action_State_ID',
        'Record_Source_ID'
      ];
      const parser = new Parser({ fields });
      const csv = parser.parse(safeRows);
      res.header('Content-Type', 'text/csv');
      res.attachment(`${filename}.csv`);
      return res.send(csv);
    }

    res.header('Content-Type', 'application/json');
    res.attachment(`${filename}.json`);
    return res.send(JSON.stringify(exportRows, null, 2));
  } catch (error) {
    console.error('Track Activity Export Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
}

module.exports = {
  viewTrackActivity,
  fetchTrackActivityTimelineData,
  fetchTrackActivityDetail,
  fetchTrackActivityUsers,
  exportTrackActivity
};
