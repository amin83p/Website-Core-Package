'use strict';

const classConductReportService = require('../../services/school/classConductReportService');
const conductRatingScaleService = require('../../services/school/conductRatingScaleService');
const conductRatingScalePolicyModel = require('../../models/school/conductRatingScalePolicyModel');
const { resolveSelectedStudents } = require('../../services/school/studentAttendanceReportService');
const enrollmentClaimDisplayService = require('../../services/school/enrollmentClaimDisplayService');
const schoolRollingEnrollmentAccessService = require('../../services/school/schoolRollingEnrollmentAccessService');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

function parseStudentIds(raw = '') {
  return String(raw || '')
    .split(/[,|]/)
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

async function showClassConductReportPage(req, res) {
  try {
    const q = req.query || {};
    const initialStartDate = String(q.startDate || '').trim();
    const initialEndDate = String(q.endDate || '').trim();
    const initialStudentIds = parseStudentIds(q.studentIds || q.personIds);
    let initialStudents = [];
    if (initialStudentIds.length) {
      try {
        initialStudents = await resolveSelectedStudents(req, initialStudentIds);
      } catch (_) {
        initialStudents = [];
      }
    }

    const activeOrgId = String(req.user?.activeOrgId || '').trim();
    const orgPolicy = activeOrgId
      ? await conductRatingScalePolicyModel.getPolicyForOrg(activeOrgId)
      : {};
    const conductRatingScaleResolved = conductRatingScaleService.resolvePolicy(orgPolicy);
    const canShowEnrollmentClaims = await enrollmentClaimDisplayService.canShowOnSectionPage(
      req.user,
      SECTIONS.SCHOOL_CLASS_CONDUCT_REPORT,
      { operationId: OPERATIONS.READ, ipAddress: req.ip }
    );
    const canOpenRollingEnrollment = await schoolRollingEnrollmentAccessService.canAccessRollingEnrollment(req.user);

    res.render('school/report/classConductReport', {
      title: 'Class Conduct Report',
      includeModal: true,
      includePrintManager: true,
      user: req.user,
      actionStateId: req.actionStateId,
      tableName: 'Class_Conduct_Report',
      initialStartDate,
      initialEndDate,
      initialStudentIds,
      initialStudents,
      canShowEnrollmentClaims,
      conductRatingScaleResolved,
      canOpenRollingEnrollment
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function getClassConductReportData(req, res) {
  try {
    const payload = await classConductReportService.buildClassConductReportPayload(req);
    return res.json({ status: 'success', ...payload });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message || 'Failed to load class conduct report.' });
  }
}

async function startClassConductReportDataJob(req, res) {
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
      const reportPayload = await classConductReportService.buildClassConductReportPayload(fauxReq, {
        onProgress: ({ processed, total, phase }) => {
          sarExportJobService.updateJobProgress(runningJob.id, {
            processedItems: processed,
            totalItems: total,
            phase: phase || 'classMatrix'
          });
        }
      });
      return { reportPayload };
    });
    return res.status(202).json({
      status: 'accepted',
      async: true,
      job: sarExportJobService.toPublicJob(job),
      pollUrl: `/school/class-conduct-report/api/report-jobs/${job.id}`
    });
  } catch (error) {
    return res.status(Number(error?.statusCode) || 400).json({
      status: 'error',
      message: error.message || 'Could not start report load.'
    });
  }
}

async function getClassConductReportDataJob(req, res) {
  try {
    const sarExportJobService = require('../../services/school/sarExportJobService');
    const jobId = String(req.params?.jobId || '').trim();
    const job = sarExportJobService.getJobForUser(jobId, req.user);
    if (job.jobType !== 'report') {
      return res.status(404).json({ status: 'error', message: 'Report job was not found.' });
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
      message: error.message || 'Could not read report job.'
    });
  }
}

module.exports = {
  showClassConductReportPage,
  getClassConductReportData,
  startClassConductReportDataJob,
  getClassConductReportDataJob
};
