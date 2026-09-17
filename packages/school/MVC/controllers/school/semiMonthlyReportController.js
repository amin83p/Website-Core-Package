'use strict';

const semiMonthlyReportPolicyModel = require('../../models/school/semiMonthlyReportPolicyModel');
const semiMonthlyReportPolicyService = require('../../services/school/semiMonthlyReportPolicyService');
const schoolSemiMonthlyReportService = require('../../services/school/schoolSemiMonthlyReportService');
const schoolSemiMonthlyReportExportService = require('../../services/school/schoolSemiMonthlyReportExportService');
const studentAttendanceReportService = require('../../services/school/studentAttendanceReportService');
const reportViewService = require('../../services/school/reportViewService');

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
      canExportReport
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function getSemiMonthlyReportData(req, res) {
  try {
    const payload = await schoolSemiMonthlyReportService.buildSemiMonthlyReportPayload(req);
    res.json({
      status: 'success',
      ...payload
    });
  } catch (error) {
    res.status(Number(error?.statusCode) || 400).json({
      status: 'error',
      message: error.message || 'Could not load semi-monthly report.'
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
    const plan = await schoolSemiMonthlyReportExportService.buildSemiMonthlyReportExportPlan(req);
    return res.json({ status: 'success', plan });
  } catch (error) {
    return res.status(Number(error?.statusCode) || 400).json({
      status: 'error',
      message: error.message || 'Could not build semi-monthly export plan.'
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
  getExportPlan,
  exportSelections
};
