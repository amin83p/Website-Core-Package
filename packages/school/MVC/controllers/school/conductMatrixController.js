'use strict';

const { loadGradesMatrixSharedContext } = require('./gradesMatrixController');
const conductMatrixService = require('../../services/school/conductMatrixService');
const conductMatrixSessionVisibilityService = require('../../services/school/conductMatrixSessionVisibilityService');
const classConductAssignmentWizardService = require('../../services/school/classConductAssignmentWizardService');
const conductRatingScalePolicyModel = require('../../models/school/conductRatingScalePolicyModel');
const schoolDataService = require('../../services/school/schoolDataService');
const conductRatingScaleService = require('../../services/school/conductRatingScaleService');
const { userCanOpenAttendanceMatrix } = require('../../services/school/attendanceMatrixAccessService');
const enrollmentClaimDisplayService = require('../../services/school/enrollmentClaimDisplayService');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

async function resolveConductPolicyForRequest(req, classData) {
  const orgId = String(req.user?.activeOrgId || classData?.orgId || '').trim();
  const orgPolicy = await conductRatingScalePolicyModel.getPolicyForOrg(orgId);
  return conductRatingScaleService.resolvePolicy(orgPolicy);
}

async function showConductMatrixPage(req, res) {
  try {
    const q = req.query || {};
    const initialClassId = String(q.classId || '').trim();
    const initialStartDate = String(q.startDate || '').trim();
    const initialEndDate = String(q.endDate || '').trim();
    const initialRange = String(q.range || '').trim();
    let initialClassName = String(q.className || '').trim();
    if (initialClassId && !initialClassName) {
      try {
        const classRow = await schoolDataService.getDataById('classes', initialClassId, req.user);
        if (classRow?.title) initialClassName = String(classRow.title).trim();
      } catch (_) {
        /* ignore */
      }
    }

    const canOpenAttendanceMatrix = await userCanOpenAttendanceMatrix(req.user, req.ip);
    const canShowEnrollmentClaims = await enrollmentClaimDisplayService.canShowOnSectionPage(
      req.user,
      SECTIONS.SCHOOL_CLASS_CONDUCT_MATRIX,
      { operationId: OPERATIONS.READ_ALL, ipAddress: req.ip }
    );
    let conductRatingScaleResolved = conductRatingScaleService.resolvePolicy({});
    if (initialClassId) {
      try {
        const classRow = await schoolDataService.getDataById('classes', initialClassId, req.user);
        conductRatingScaleResolved = await resolveConductPolicyForRequest(req, classRow);
      } catch (_) {
        /* ignore */
      }
    }

    res.render('school/report/conductMatrix', {
      title: 'Class Conduct Matrix',
      includeModal: true,
      includePrintManager: true,
      user: req.user,
      actionStateId: req.actionStateId,
      tableName: 'Class_Conduct_Matrix',
      initialClassId,
      initialClassName,
      initialStartDate,
      initialEndDate,
      initialRange,
      canOpenAttendanceMatrix,
      canShowEnrollmentClaims,
      conductRatingScaleResolved
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function getConductMatrixData(req, res) {
  try {
    const query = {
      classId: String(req.query?.classId || '').trim(),
      startDate: String(req.query?.startDate || '').trim(),
      endDate: String(req.query?.endDate || '').trim()
    };
    if (!query.classId) {
      return res.status(400).json({ status: 'error', message: 'Class ID is required.' });
    }

    const matrixContext = await loadGradesMatrixSharedContext(req, query);
    const conductPolicy = await resolveConductPolicyForRequest(req, matrixContext.classData);
    const payload = await conductMatrixService.buildConductMatrixPayload(
      req,
      query,
      matrixContext,
      conductPolicy
    );

    return res.json({
      status: 'success',
      ...payload,
      conductPolicy: conductRatingScaleService.resolvePolicy(conductPolicy)
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message || 'Failed to load conduct matrix.' });
  }
}

async function postSessionConductVisibility(req, res) {
  try {
    const classId = String(req.body?.classId || '').trim();
    const sessionId = String(req.body?.sessionId || '').trim();
    const enabled = req.body?.enabled;
    const result = await conductMatrixSessionVisibilityService.setSessionConductReportStepEnabled(req, {
      classId,
      sessionId,
      enabled
    });
    const showEnabled = result.conductReportStepEnabled === true;
    const message = showEnabled
      ? 'This session will show class conduct on Manage Session → Reports. Reload that page if it is already open.'
      : 'Class conduct was hidden for this session on Manage Session → Reports.';
    return res.json({ status: 'success', message, data: result });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message || 'Failed to update session visibility.' });
  }
}

async function showConductAssignmentWizard(req, res) {
  try {
    res.render('school/report/classConductAssignmentWizard', {
      title: 'Class Conduct Assignment Wizard',
      user: req.user,
      actionStateId: req.actionStateId,
      includeModal: true
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function postConductAssignmentProgramCount(req, res) {
  try {
    const data = await classConductAssignmentWizardService.countProgramClasses({
      programId: req.body?.programId,
      classCapacityTarget: req.body?.classCapacityTarget,
      reqUser: req.user
    });
    return res.json({ status: 'success', data });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message || 'Unable to count classes.' });
  }
}

async function postConductAssignmentPreview(req, res) {
  try {
    const programIds = Array.isArray(req.body?.programIds)
      ? req.body.programIds
      : String(req.body?.programIds || '').split(',').map((v) => v.trim()).filter(Boolean);
    const data = await classConductAssignmentWizardService.previewRows({
      programIds,
      classCapacityTarget: req.body?.classCapacityTarget,
      anchorDate: req.body?.anchorDate,
      reqUser: req.user
    });
    return res.json({ status: 'success', data });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message || 'Unable to preview class sessions.' });
  }
}

async function postConductAssignmentApply(req, res) {
  try {
    const selections = Array.isArray(req.body?.selections) ? req.body.selections : [];
    const data = await classConductAssignmentWizardService.applySelections({
      selections,
      reqUser: req.user,
      req
    });
    return res.json({ status: 'success', data });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message || 'Unable to apply class conduct assignments.' });
  }
}

module.exports = {
  showConductMatrixPage,
  getConductMatrixData,
  postSessionConductVisibility,
  showConductAssignmentWizard,
  postConductAssignmentProgramCount,
  postConductAssignmentPreview,
  postConductAssignmentApply
};
