'use strict';

const logArchiveStatusService = require('../services/logArchive/logArchiveStatusService');
const logArchiveExportService = require('../services/logArchive/logArchiveExportService');
const logArchiveDeleteService = require('../services/logArchive/logArchiveDeleteService');

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

function parseArchiveDeleteBody(body = {}) {
  const src = body && typeof body === 'object' ? body : {};
  return {
    startDate: src.startDate,
    endDate: src.endDate,
    includeLogs: src.includeLogs === true || src.includeLogs === 'true',
    includeActionStates: src.includeActionStates === true || src.includeActionStates === 'true',
    localVerification: src.localVerification && typeof src.localVerification === 'object'
      ? src.localVerification
      : null
  };
}

function mapDeleteError(error, res) {
  const code = error.code || 'DELETE_FAILED';
  const status = code === 'INVALID_RANGE' || code === 'NO_COLLECTIONS'
    ? 400
    : (code === 'DELETE_BUSY' ? 429 : (String(code).startsWith('LOCAL_') ? 403 : 500));
  return res.status(status).json({
    status: 'error',
    code,
    message: error.message || 'Archive delete failed.',
    verification: error.verification || undefined
  });
}

async function previewLogArchiveDelete(req, res) {
  try {
    const timezone = resolveTimezone(req);
    const body = parseArchiveDeleteBody(req.body);
    const result = await logArchiveDeleteService.previewArchiveRangeDelete({
      ...body,
      timezone,
      requestUser: req.user
    });
    return res.json({
      status: 'success',
      data: {
        preview: result.preview,
        verification: result.verification
      }
    });
  } catch (error) {
    console.error('Log archive delete preview error:', error);
    return mapDeleteError(error, res);
  }
}

async function deleteLogArchiveRecords(req, res) {
  try {
    const timezone = resolveTimezone(req);
    const body = parseArchiveDeleteBody(req.body);
    if (!body.localVerification) {
      return res.status(400).json({
        status: 'error',
        code: 'LOCAL_PROOF_REQUIRED',
        message: 'Local archive verification is required before deleting records.'
      });
    }
    const result = await logArchiveDeleteService.deleteArchiveRangeRecords({
      ...body,
      timezone,
      requestUser: req.user
    });
    return res.json({
      status: 'success',
      data: result
    });
  } catch (error) {
    console.error('Log archive delete error:', error);
    return mapDeleteError(error, res);
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
  previewLogArchiveDelete,
  deleteLogArchiveRecords,
  viewLogArchiveAnalyzer,
  viewLogArchiveUserTimeline
};
