'use strict';

const semiMonthlyReportPolicyModel = require('../../models/school/semiMonthlyReportPolicyModel');
const semiMonthlyReportPolicyService = require('../../services/school/semiMonthlyReportPolicyService');
const schoolSemiMonthlyReportService = require('../../services/school/schoolSemiMonthlyReportService');
const schoolSemiMonthlyReportByFunderService = require('../../services/school/schoolSemiMonthlyReportByFunderService');
const schoolSemiMonthlyReportExportService = require('../../services/school/schoolSemiMonthlyReportExportService');
const studentAttendanceReportService = require('../../services/school/studentAttendanceReportService');
const reportViewService = require('../../services/school/reportViewService');
const reportFunderDocxService = require('../../services/school/reportFunderDocxService');

function parseIdListParam(value = '') {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/[,|]/)
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

async function showSemiMonthlyReportPage(req, res) {
  try {
    const q = req.query || {};
    const initialStartDate = String(q.startDate || '').trim();
    const initialEndDate = String(q.endDate || '').trim();
    const initialStudentIds = parseIdListParam(q.studentIds || q.personIds || '');
    let initialStudents = [];
    if (initialStudentIds.length) {
      initialStudents = await studentAttendanceReportService.resolveSelectedStudents(req, initialStudentIds);
    }
    const activeOrgId = String(req.user?.activeOrgId || '').trim();
    const policy = semiMonthlyReportPolicyService.resolvePolicy(activeOrgId
      ? await semiMonthlyReportPolicyModel.getPolicyForOrg(activeOrgId)
      : {});
    const canExportReport = await reportViewService.canExportReportInstance(req.user);
    const configuredOverallCount = semiMonthlyReportPolicyService.normalizeIdList(
      policy.overallReportTemplateIds
    ).length;
    const activeFunders = activeOrgId
      ? await reportFunderDocxService.loadActiveFunderOptions(req.user, activeOrgId).catch(() => [])
      : [];
    const funderPickerOptions = reportFunderDocxService.buildFunderPickerOptions(activeFunders);
    res.render('school/report/semiMonthlyReportViewer', {
      title: 'School Semi-Monthly Report',
      includeModal: true,
      user: req.user,
      actionStateId: req.actionStateId,
      tableName: 'School_Semi_Monthly_Report',
      initialStartDate,
      initialEndDate,
      initialStudentIds,
      initialStudents,
      configuredTemplateCount: (policy.reportTemplateIds || []).length,
      configuredOverallCount,
      canExportReport,
      funderPickerOptions
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function getSemiMonthlyReportData(req, res) {
  try {
    const payload = await buildSemiMonthlyReportResponsePayload(req);
    res.json(payload);
  } catch (error) {
    res.status(Number(error?.statusCode) || 400).json({
      status: 'error',
      message: error.message || 'Could not load semi-monthly report.'
    });
  }
}

async function buildSemiMonthlyReportResponsePayload(req, options = {}) {
  const payload = await schoolSemiMonthlyReportService.buildSemiMonthlyReportPayload(req, options);
  let exportPreview = null;
  const canExportReport = await reportViewService.canExportReportInstance(req.user);
  if (canExportReport) {
    try {
      exportPreview = await schoolSemiMonthlyReportExportService.buildSemiMonthlyReportExportPreview(req, {
        existingPayload: payload
      });
    } catch (_previewError) {
      exportPreview = null;
    }
  }
  return {
    status: 'success',
    ...payload,
    exportPreview
  };
}

async function startSemiMonthlyReportDataJob(req, res) {
  try {
    const sarExportJobService = require('../../services/school/sarExportJobService');
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const fauxReq = {
      user: req.user,
      query: {
        startDate: body.startDate || req.query?.startDate,
        endDate: body.endDate || req.query?.endDate,
        studentIds: body.studentIds || req.query?.studentIds
      }
    };
    const job = sarExportJobService.createJob({
      userId: req.user?.id || req.user?.userId,
      activeOrgId: req.user?.activeOrgId,
      jobType: 'report',
      totalItems: 0
    });
    sarExportJobService.startJob(job.id, async (runningJob) => {
      const reportPayload = await buildSemiMonthlyReportResponsePayload(fauxReq, {
        onProgress: ({ processed, total, phase }) => {
          sarExportJobService.updateJobProgress(runningJob.id, {
            processedItems: processed,
            totalItems: total,
            phase: phase || 'classes'
          });
        }
      });
      return { reportPayload };
    });
    return res.status(202).json({
      status: 'accepted',
      async: true,
      job: sarExportJobService.toPublicJob(job),
      pollUrl: `/school/reports/semi-monthly/api/report-jobs/${job.id}`
    });
  } catch (error) {
    return res.status(Number(error?.statusCode) || 400).json({
      status: 'error',
      message: error.message || 'Could not start report load.'
    });
  }
}

async function getSemiMonthlyReportJob(req, res) {
  try {
    const sarExportJobService = require('../../services/school/sarExportJobService');
    const jobId = String(req.params?.jobId || '').trim();
    const job = sarExportJobService.getJobForUser(jobId, req.user);
    if (job.jobType !== 'report') {
      return res.status(404).json({
        status: 'error',
        message: 'Report job was not found or has expired.'
      });
    }
    const reportPayload = job.status === 'complete'
      ? sarExportJobService.getJobResultPayload(job)
      : null;
    return res.json({
      status: 'success',
      job: sarExportJobService.toPublicJob(job),
      reportPayload: reportPayload ? { status: 'success', ...reportPayload } : null
    });
  } catch (error) {
    return res.status(Number(error?.statusCode) || 400).json({
      status: 'error',
      message: error.message || 'Could not load report job status.'
    });
  }
}

async function getExportPlan(req, res) {
  try {
    const canExportReport = await reportViewService.canExportReportInstance(req.user);
    if (!canExportReport) {
      return res.status(403).json({
        status: 'error',
        message: 'You do not have permission to export report instances.'
      });
    }
    const plan = await schoolSemiMonthlyReportExportService.buildSemiMonthlyReportExportPreview(req);
    return res.json({ status: 'success', plan });
  } catch (error) {
    return res.status(Number(error?.statusCode) || 400).json({
      status: 'error',
      message: error.message || 'Could not build semi-monthly export plan.'
    });
  }
}

async function getFunderStudentSelection(req, res) {
  try {
    const payload = await schoolSemiMonthlyReportByFunderService.buildFunderStudentSelectionPayload(req);
    return res.json({
      status: 'success',
      ...payload
    });
  } catch (error) {
    return res.status(Number(error?.statusCode) || 400).json({
      status: 'error',
      message: error.message || 'Could not load students for funder.'
    });
  }
}

async function exportSelections(req, res) {
  try {
    const canExportReport = await reportViewService.canExportReportInstance(req.user);
    if (!canExportReport) {
      return res.status(403).json({
        status: 'error',
        message: 'You do not have permission to export report instances.'
      });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const fauxReq = {
      user: req.user,
      body,
      query: {
        startDate: body.startDate || req.query?.startDate,
        endDate: body.endDate || req.query?.endDate,
        studentIds: body.studentIds || req.query?.studentIds
      }
    };
    const result = await schoolSemiMonthlyReportExportService.exportSemiMonthlyReportSelections(fauxReq);
    const buffer = Buffer.isBuffer(result.buffer)
      ? result.buffer
      : Buffer.from(result.buffer || []);
    if (!buffer.length) {
      throw new Error('Export completed but no file data was produced.');
    }
    res.setHeader('Content-Type', result.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${String(result.fileName || 'semi_monthly_export').replace(/"/g, '')}"`);
    return res.send(buffer);
  } catch (error) {
    return res.status(Number(error?.statusCode) || 400).json({
      status: 'error',
      message: error.message || 'Could not export semi-monthly reports.'
    });
  }
}

module.exports = {
  showSemiMonthlyReportPage,
  getSemiMonthlyReportData,
  startSemiMonthlyReportDataJob,
  getSemiMonthlyReportJob,
  getFunderStudentSelection,
  getExportPlan,
  exportSelections
};
