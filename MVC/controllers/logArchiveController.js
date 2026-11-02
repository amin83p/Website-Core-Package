'use strict';

const logArchiveStatusService = require('../services/logArchive/logArchiveStatusService');
const logArchiveExportService = require('../services/logArchive/logArchiveExportService');

function resolveTimezone(req) {
  return String(req.orgTimeZone || req.user?.activeOrgTimeZone || 'UTC').trim() || 'UTC';
}

async function viewLogArchiveExtractor(req, res) {
  try {
    const timezone = resolveTimezone(req);
    const status = await logArchiveStatusService.buildArchiveStatusDashboard({
      timezone,
      scope: { canViewAll: true }
    });
    return res.render('admin/logArchiveExtractor', {
      title: 'Log Archive Extractor',
      user: req.user,
      status,
      timezone,
      includeModal: true
    });
  } catch (error) {
    console.error('Log archive extractor view error:', error);
    return res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load log archive extractor.',
      user: req.user || null
    });
  }
}

async function fetchLogArchiveStatus(req, res) {
  try {
    const timezone = resolveTimezone(req);
    const status = await logArchiveStatusService.buildArchiveStatusDashboard({
      timezone,
      scope: { canViewAll: true }
    });
    return res.json({ status: 'success', data: status });
  } catch (error) {
    console.error('Log archive status error:', error);
    return res.status(500).json({ status: 'error', message: error.message || 'Failed to load archive status.' });
  }
}

async function exportLogArchive(req, res) {
  try {
    const timezone = resolveTimezone(req);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await logArchiveExportService.buildActivityArchiveZip({
      startDate: body.startDate,
      endDate: body.endDate,
      includeLogs: body.includeLogs !== 'false' && body.includeLogs !== false,
      includeActionStates: body.includeActionStates !== 'false' && body.includeActionStates !== false,
      includeDecryptedSnapshots: body.includeDecryptedSnapshots === true || body.includeDecryptedSnapshots === 'true',
      timezone,
      requestUser: req.user
    });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    res.setHeader('X-Archive-Export-Id', result.manifest.exportId);
    return res.send(result.buffer);
  } catch (error) {
    console.error('Log archive export error:', error);
    const code = error.code === 'EXPORT_BUSY' ? 429 : (error.code === 'INVALID_RANGE' ? 400 : 500);
    return res.status(code).json({
      status: 'error',
      code: error.code || 'EXPORT_FAILED',
      message: error.message || 'Archive export failed.'
    });
  }
}

async function viewLogArchiveAnalyzer(req, res) {
  try {
    const timezone = resolveTimezone(req);
    return res.render('admin/logArchiveAnalyzer', {
      title: 'Local Archive Analyzer',
      user: req.user,
      maxMergeLimit: 50000,
      timezone,
      includeModal: true
    });
  } catch (error) {
    console.error('Log archive analyzer view error:', error);
    return res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load local archive analyzer.',
      user: req.user || null
    });
  }
}

async function viewLogArchiveUserTimeline(req, res) {
  try {
    const timezone = resolveTimezone(req);
    return res.render('admin/logArchiveUserTimeline', {
      title: 'User Activity Timeline (Local Archive)',
      user: req.user,
      timezone,
      windowDays: 3,
      includeModal: true
    });
  } catch (error) {
    console.error('Log archive user timeline view error:', error);
    return res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load user activity timeline.',
      user: req.user || null
    });
  }
}

module.exports = {
  viewLogArchiveExtractor,
  fetchLogArchiveStatus,
  exportLogArchive,
  viewLogArchiveAnalyzer,
  viewLogArchiveUserTimeline
};
