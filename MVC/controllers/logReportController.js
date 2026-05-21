// MVC/controllers/logReportController.js
const dataService = require('../services/dataService');
const { checkAdminVerificationCode } = require('../utils/encyptors');
const { Parser } = require('json2csv');
const { toPublicId } = require('../utils/idAdapter');

function cleanText(value, max = 220) {
  if (value === undefined || value === null) return '';
  const text = String(value).trim();
  return text.length > max ? text.slice(0, max) : text;
}

function isSystemActor(log = {}) {
  const actorType = cleanText(log.actorType || log?.details?.actor?.actorType, 40).toLowerCase();
  if (actorType === 'system') return true;
  const userId = cleanText(log.userId || log?.details?.actor?.userId, 120).toLowerCase();
  return userId === 'system' || userId === 'sys';
}

function buildLookupMap(rows = []) {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const id = toPublicId(row?.id);
    if (id) map.set(id, row);
  });
  return map;
}

function resolveSectionInfo(log = {}, sectionMap = new Map()) {
  const sectionId = cleanText(log.sectionId, 120);
  if (sectionId === '000000') {
    return { id: sectionId, name: 'SYSTEM' };
  }

  const row = sectionMap.get(toPublicId(sectionId)) || null;
  const sectionName = cleanText(row?.name, 180) || sectionId || 'N/A';
  return { id: sectionId, name: sectionName };
}

function resolveOperationInfo(log = {}, operationMap = new Map()) {
  const operationId = cleanText(log.operationId, 120);
  const row = operationMap.get(toPublicId(operationId)) || null;
  const operationName = cleanText(row?.name, 180) || operationId || 'N/A';
  return { id: operationId, name: operationName };
}

function resolveOrganizationDisplayName(org = {}) {
  return cleanText(org?.identity?.displayName || org?.name, 180);
}

function resolveLogIdentity(log = {}, userMap = new Map(), orgMap = new Map()) {
  const actor = (log && typeof log.details?.actor === 'object') ? log.details.actor : {};
  const userId = cleanText(log.userId || actor.userId, 120);
  const username = cleanText(log.username || actor.username, 140);
  const displayName = cleanText(log.displayName || actor.displayName, 180);
  const orgId = cleanText(log.orgId || actor.orgId, 120);
  const knownUser = userId ? userMap.get(toPublicId(userId)) : null;
  const knownUsername = cleanText(knownUser?.username, 140);
  const knownDisplayName = cleanText(knownUser?.name || knownUser?.displayName, 180);
  const knownOrg = orgId ? orgMap.get(toPublicId(orgId)) : null;
  const knownOrgName = resolveOrganizationDisplayName(knownOrg);

  const system = isSystemActor(log);
  const primary = system
    ? 'System'
    : (displayName || knownDisplayName || username || knownUsername || (userId ? `User ${userId}` : 'User'));

  const secondaryParts = [];
  const resolvedUsername = username || knownUsername;
  if (resolvedUsername && resolvedUsername.toLowerCase() !== primary.toLowerCase()) {
    secondaryParts.push(`@${resolvedUsername}`);
  }
  if (userId && userId.toLowerCase() !== 'system') secondaryParts.push(`ID: ${userId}`);
  if (knownOrgName && orgId) secondaryParts.push(`Org: ${knownOrgName} (${orgId})`);
  else if (knownOrgName) secondaryParts.push(`Org: ${knownOrgName}`);
  else if (orgId) secondaryParts.push(`Org: ${orgId}`);

  return {
    isSystem: system,
    primary,
    secondary: secondaryParts.join(' | '),
    userId,
    username: resolvedUsername,
    displayName: displayName || knownDisplayName || '',
    orgId,
    orgName: knownOrgName
  };
}

function estimateLogVolumeKB(log) {
  try {
    const bytes = Buffer.byteLength(JSON.stringify(log || {}), 'utf8');
    const kb = bytes / 1024;
    return Number.isFinite(kb) ? kb : 0;
  } catch (_) {
    return 0;
  }
}

async function buildUserMapForLogs(logs = [], requestUser = null) {
  const userIds = Array.from(new Set((Array.isArray(logs) ? logs : [])
    .map((log) => toPublicId(log?.userId || log?.details?.actor?.userId))
    .filter((id) => id && id.toLowerCase() !== 'system')));

  if (userIds.length === 0) return new Map();

  const rows = await dataService.fetchData('users', { id__in: userIds.join(',') }, requestUser);
  return new Map((Array.isArray(rows) ? rows : [])
    .map((row) => [toPublicId(row?.id), row])
    .filter(([id]) => !!id));
}

/* ============================================================
   VIEW: View Activity Logs
============================================================ */
async function viewActivityLog(req, res) {
  try {
    const { sectionId, operationId, userId, startDate, endDate, q, type, page, limit, rateLimitGroup } = req.query;
    const normalizedRateGroup = String(rateLimitGroup || '').trim().toLowerCase();

    const query = {
      q,
      type,
      sectionId,
      operationId,
      userId,
      startDate,
      endDate,
      page,
      limit
    };
    if (normalizedRateGroup) {
      query['details.rateLimitGroup__eq'] = normalizedRateGroup;
    }

    const paged = await dataService.fetchDataPaged('logs', query, req.user);
    const pageLogs = Array.isArray(paged?.rows) ? paged.rows : [];
    const pagination = paged?.pagination || null;

    const summary = pageLogs.reduce((acc, log) => {
      const status = String(log?.status || '').trim().toLowerCase();
      acc.pageLogs += 1;
      acc.totalVolumeKB += estimateLogVolumeKB(log);
      if (status === 'success' || status === 'completed') acc.successCount += 1;
      if (status === 'failure' || status === 'error' || status === 'failed') acc.failureCount += 1;
      if (status === 'denied' || status === 'blocked') acc.deniedCount += 1;
      return acc;
    }, {
      pageLogs: 0,
      totalLogs: Number(pagination?.totalItems || 0),
      totalVolumeKB: 0,
      successCount: 0,
      failureCount: 0,
      deniedCount: 0
    });

    const [sections, operations, organizations, userMap] = await Promise.all([
      dataService.fetchData('sections', {}, req.user),
      dataService.fetchData('operations', {}, req.user),
      dataService.fetchData('organizations', {}, req.user),
      buildUserMapForLogs(pageLogs, req.user)
    ]);
    const sectionMap = buildLookupMap(sections);
    const operationMap = buildLookupMap(operations);
    const orgMap = buildLookupMap(organizations);

    const enrichedLogs = pageLogs.map((log) => {
      const sectionInfo = resolveSectionInfo(log, sectionMap);
      const operationInfo = resolveOperationInfo(log, operationMap);
      const identity = resolveLogIdentity(log, userMap, orgMap);
      const sectionDisplay = sectionInfo.id && sectionInfo.name && sectionInfo.name !== sectionInfo.id
        ? `${sectionInfo.name} (${sectionInfo.id})`
        : sectionInfo.name;
      const operationDisplay = operationInfo.id && operationInfo.name && operationInfo.name !== operationInfo.id
        ? `${operationInfo.name} (${operationInfo.id})`
        : operationInfo.name;

      return {
        ...log,
        sectionName: sectionInfo.name,
        sectionDisplay,
        operationName: operationInfo.name,
        operationDisplay,
        formattedDate: new Date(log.timestamp).toLocaleString(),
        rateLimitGroup: log?.details?.rateLimitGroup || '',
        actorIdentity: identity
      };
    });

    const knownRateGroups = ['auth', 'picker', 'write', 'heavy', 'global'];
    const discoveredGroups = Array.from(new Set(pageLogs
      .map((log) => String(log?.details?.rateLimitGroup || '').trim().toLowerCase())
      .filter(Boolean)));
    const rateGroupOptions = Array.from(new Set([...knownRateGroups, ...discoveredGroups]));

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', data: enrichedLogs, pagination, summary });
    }

    res.render('admin/activityReport', {
      title: 'Activity Logs',
      tableName: 'Activity_Logs',
      newUrl: 'logs',
      logs: enrichedLogs,
      sections,
      operations,
      print: true,
      includeModal: true,
      includeModal_Table: true,
      pagination,
      summary,
      filters: req.query,
      rateGroupOptions,
      user: req.user || null
    });
  } catch (error) {
    console.error('Log Report Error:', error);
    if (req.headers['x-ajax-request']) {
      return res.status(500).json({ status: 'error', message: error.message });
    }
    res.status(500).render('error', { title: 'Error', message: 'Failed to load activity logs.', user: req.user || null });
  }
}

/* ============================================================
   ACTION: Export Logs
============================================================ */
async function exportActivityLog(req, res) {
  try {
    const { format, sectionId, operationId, userId, startDate, endDate } = req.body;

    const query = { sectionId, operationId, userId, startDate, endDate };
    const logs = await dataService.fetchData('logs', query, req.user);
    const [sections, operations, organizations, userMap] = await Promise.all([
      dataService.fetchData('sections', {}, req.user),
      dataService.fetchData('operations', {}, req.user),
      dataService.fetchData('organizations', {}, req.user),
      buildUserMapForLogs(logs, req.user)
    ]);
    const sectionMap = buildLookupMap(sections);
    const operationMap = buildLookupMap(operations);
    const orgMap = buildLookupMap(organizations);

    const enrichedLogs = logs.map((log) => {
      const sectionInfo = resolveSectionInfo(log, sectionMap);
      const operationInfo = resolveOperationInfo(log, operationMap);
      const identity = resolveLogIdentity(log, userMap, orgMap);

      return {
        Timestamp: new Date(log.timestamp).toLocaleString(),
        User: identity.primary,
        User_ID: identity.userId || '',
        Username: identity.username || '',
        Org_Name: identity.orgName || '',
        Org_ID: identity.orgId || 'N/A',
        Section: sectionInfo.name,
        Section_ID: sectionInfo.id || '',
        Operation: operationInfo.name,
        Operation_ID: operationInfo.id || '',
        Status: log.status,
        Request_ID: log.requestId || log.details?.requestId || '',
        IP_Address: log.details?.ip || '',
        Target_URL: log.details?.url || '',
        Error_Msg: log.details?.errorMessage || ''
      };
    });

    const filename = `activity_logs_${new Date().toISOString().slice(0, 10)}`;

    if (format === 'csv') {
      const json2csvParser = new Parser();
      const csv = json2csvParser.parse(enrichedLogs);
      res.header('Content-Type', 'text/csv');
      res.attachment(`${filename}.csv`);
      return res.send(csv);
    }

    if (format === 'json') {
      res.header('Content-Type', 'application/json');
      res.attachment(`${filename}.json`);
      return res.send(JSON.stringify(enrichedLogs, null, 2));
    }

    return res.status(400).json({ status: 'error', message: 'Invalid export format specified.' });
  } catch (error) {
    console.error('Export Log Error:', error);
    res.status(500).json({ status: 'error', message: `Export failed: ${error.message}` });
  }
}

/* ============================================================
   DELETE: Single Log
============================================================ */
async function deleteLog(req, res) {
  try {
    const results = await dataService.deleteData('logs', req.params.id, req.user);

    if (req.headers['x-ajax-request']) return res.json({ status: 'success', results, message: 'Log deleted.' });
    res.redirect('/logs');
  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(500).json({ status: 'error', message: error.message });
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

/* ============================================================
   DELETE: All Logs (Protected)
============================================================ */
async function deleteAllLog(req, res) {
  try {
    if (!checkAdminVerificationCode(req)) {
      throw new Error('Security Violation: High Privilege Access requested without valid Admin Verification.');
    }

    await dataService.deleteAllLogs(req.user);

    if (req.headers['x-ajax-request']) return res.json({ status: 'success', message: 'All logs cleared.' });
    res.redirect('/logs');
  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(500).json({ status: 'error', message: error.message });
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

module.exports = {
  viewActivityLog,
  exportActivityLog,
  deleteLog,
  deleteAllLog
};
