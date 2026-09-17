'use strict';

const semiMonthlyReportPolicyModel = require('../../models/school/semiMonthlyReportPolicyModel');
const semiMonthlyReportPolicyService = require('../../services/school/semiMonthlyReportPolicyService');
const schoolSemiMonthlyReportService = require('../../services/school/schoolSemiMonthlyReportService');
const studentAttendanceReportService = require('../../services/school/studentAttendanceReportService');

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
      configuredTemplateCount: (policy.reportTemplateIds || []).length
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

module.exports = {
  showSemiMonthlyReportPage,
  getSemiMonthlyReportData
};
