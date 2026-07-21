const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/school/reportController');
const { requireCoreModule } = require('../services/school/schoolCoreContracts');
const upload = requireCoreModule('MVC/middleware/upload');
const { requireAuth } = requireCoreModule('MVC/middleware/authMiddleware');
const { requireAccess } = requireCoreModule('MVC/middleware/accessMiddleware');
const { trackActionState } = requireCoreModule('MVC/middleware/actionStateMiddleware');
const accessService = requireCoreModule('MVC/services/security/index');
const adminAuthorityService = requireCoreModule('MVC/services/adminAuthorityService');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const reportIntegrityService = require('../services/school/reportIntegrityService');
const { SECTIONS, OPERATIONS } = require('./schoolRouteDependencies');
const REPORT_NAV_SECTION = SECTIONS.SCHOOL_REPORTS;
const REPORT_TEMPLATE_SECTION = SECTIONS.SCHOOL_REPORTS_TEMPLATE;
const REPORT_ASSIGNMENT_SECTION = SECTIONS.SCHOOL_REPORTS_ASSIGNMENT;
const REPORT_INSTANCE_SECTION = SECTIONS.SCHOOL_REPORTS_INSTANCES;
const reportAssignmentMutationActionState = {
  requireToken: true,
  allowOperationTokenFallback: true,
  allowInactiveTokenFallback: true
};
const reportTemplateCreateActionState = {
  requireToken: true,
  allowOperationTokenFallback: true
};
const reportAssignmentBulkActionState = {
  requireToken: false,
  keepActive: true
};

router.use(requireAuth);

function sendReportInstanceAccessRequired(req, res, reason) {
  const payload = {
    status: 'access_required',
    message: 'You do not have access to this area yet. If you need it for your work, please contact your administrator or support team to request access.',
    reason: reason || 'Report instance access is required.',
    accessRequest: {
      sectionId: REPORT_INSTANCE_SECTION,
      operationId: OPERATIONS.UPDATE,
      path: req.originalUrl || req.url || ''
    }
  };
  if (req.headers['x-ajax-request'] || req.xhr || req.headers.accept?.includes('json')) {
    return res.status(403).json(payload);
  }
  return res.status(403).render('error', {
    title: 'Access Needed',
    statusCode: 403,
    message: payload.message,
    user: req.user,
    accessRequest: payload.accessRequest
  });
}

function attachAccessEvaluation(req, res, evaluation) {
  req.accessLimits = evaluation?.limits || {};
  req.adminContext = evaluation?.adminContext || req.adminContext || null;
  res.locals.adminContext = req.adminContext;
  req.accessScope = evaluation?.scopeId || req.accessScope || '';
}

async function requireReportInstanceEditorAccess(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ status: 'error', message: 'Authentication required before access check.' });
    if (adminAuthorityService.isSuperAdmin(req.user) || req.adminContext?.isSuperAdmin) {
      req.accessLimits = {};
      req.adminContext = req.adminContext || adminAuthorityService.resolveAdminAuthority({
        user: req.user,
        sectionId: REPORT_INSTANCE_SECTION,
        operationId: OPERATIONS.UPDATE
      });
      res.locals.adminContext = req.adminContext;
      req.accessScope = req.accessScope || '';
      return next();
    }

    const updateEvaluation = await accessService.evaluateAccess({
      user: req.user,
      sectionId: REPORT_INSTANCE_SECTION,
      operationId: OPERATIONS.UPDATE,
      ipAddress: req.ip
    });
    if (updateEvaluation?.allowed) {
      attachAccessEvaluation(req, res, updateEvaluation);
      return next();
    }

    const createEvaluation = await accessService.evaluateAccess({
      user: req.user,
      sectionId: REPORT_INSTANCE_SECTION,
      operationId: OPERATIONS.CREATE,
      ipAddress: req.ip
    });
    if (!createEvaluation?.allowed) {
      return sendReportInstanceAccessRequired(req, res, updateEvaluation?.reason || createEvaluation?.reason);
    }

    const instance = await reportIntegrityService.getAccessibleInstanceOrThrow(req.params.id, req.user);
    const viewerPersonId = toPublicId(req.user?.personId || req.user?.id || '');
    const isAssignedTeacher = viewerPersonId && idsEqual(instance?.teacherId, viewerPersonId);
    const isAssignedStudent = viewerPersonId && idsEqual(instance?.studentId, viewerPersonId);
    if (!isAssignedTeacher && !isAssignedStudent) {
      return sendReportInstanceAccessRequired(req, res, 'Only the assigned teacher/student or a report instance editor can edit this report instance.');
    }

    attachAccessEvaluation(req, res, createEvaluation);
    req.reportInstanceParticipantAccess = true;
    return next();
  } catch (error) {
    return sendReportInstanceAccessRequired(req, res, error?.message || 'Report instance access is required.');
  }
}

async function requireReportMatrixEditorAccess(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ status: 'error', message: 'Authentication required before access check.' });
    if (adminAuthorityService.isSuperAdmin(req.user) || req.adminContext?.isSuperAdmin) {
      req.accessLimits = {};
      req.adminContext = req.adminContext || adminAuthorityService.resolveAdminAuthority({
        user: req.user,
        sectionId: REPORT_INSTANCE_SECTION,
        operationId: OPERATIONS.UPDATE
      });
      res.locals.adminContext = req.adminContext;
      return next();
    }

    const updateEvaluation = await accessService.evaluateAccess({
      user: req.user,
      sectionId: REPORT_INSTANCE_SECTION,
      operationId: OPERATIONS.UPDATE,
      ipAddress: req.ip
    });
    if (updateEvaluation?.allowed) {
      attachAccessEvaluation(req, res, updateEvaluation);
      return next();
    }

    const createEvaluation = await accessService.evaluateAccess({
      user: req.user,
      sectionId: REPORT_INSTANCE_SECTION,
      operationId: OPERATIONS.CREATE,
      ipAddress: req.ip
    });
    if (!createEvaluation?.allowed) {
      return sendReportInstanceAccessRequired(req, res, updateEvaluation?.reason || createEvaluation?.reason);
    }

    const input = req.method === 'GET' ? (req.query || {}) : (req.body || {});
    const resolved = await reportIntegrityService.resolveStartInstanceContext({
      assignmentId: req.params.assignmentId,
      assignmentRowId: input.assignmentRowId || input.rowId || '',
      reqUser: req.user,
      requestedTeacherId: input.teacherId || '',
      fallbackTeacherId: req.user?.personId || req.user?.id || '',
      requestedStudentId: input.studentId || ''
    });
    const viewerPersonId = toPublicId(req.user?.personId || req.user?.id || '');
    if (!viewerPersonId || !idsEqual(resolved.teacherId, viewerPersonId)) {
      return sendReportInstanceAccessRequired(req, res, 'Only the assigned teacher or a report instance editor can use this report matrix.');
    }

    attachAccessEvaluation(req, res, createEvaluation);
    req.reportInstanceParticipantAccess = true;
    return next();
  } catch (error) {
    return sendReportInstanceAccessRequired(req, res, error?.message || 'Report matrix access is required.');
  }
}

router.get('/',
  requireAccess(REPORT_NAV_SECTION, OPERATIONS.READ_ALL),
  trackActionState(REPORT_NAV_SECTION, OPERATIONS.READ_ALL),
  ctrl.showHome);

// Template Designer
router.get('/templates',
  requireAccess(REPORT_TEMPLATE_SECTION, OPERATIONS.READ_ALL),
  trackActionState(REPORT_TEMPLATE_SECTION, OPERATIONS.READ_ALL),
  ctrl.listTemplates);

router.get('/templates/new',
  requireAccess(REPORT_TEMPLATE_SECTION, OPERATIONS.CREATE),
  trackActionState(REPORT_TEMPLATE_SECTION, OPERATIONS.CREATE),
  ctrl.showTemplateForm);

router.post('/templates/new',
  requireAccess(REPORT_TEMPLATE_SECTION, OPERATIONS.CREATE),
  upload('school-reports').any(),
  trackActionState(REPORT_TEMPLATE_SECTION, OPERATIONS.CREATE, reportTemplateCreateActionState),
  ctrl.saveTemplate);
router.get('/templates/copy/:id',
  requireAccess(REPORT_TEMPLATE_SECTION, OPERATIONS.CREATE),
  trackActionState(REPORT_TEMPLATE_SECTION, OPERATIONS.CREATE),
  ctrl.showTemplateCopyForm);

router.get('/templates/edit/:id',
  requireAccess(REPORT_TEMPLATE_SECTION, OPERATIONS.UPDATE),
  trackActionState(REPORT_TEMPLATE_SECTION, OPERATIONS.UPDATE),
  ctrl.showTemplateForm);

router.post('/templates/edit/:id',
  requireAccess(REPORT_TEMPLATE_SECTION, OPERATIONS.UPDATE),
  upload('school-reports').any(),
  trackActionState(REPORT_TEMPLATE_SECTION, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.saveTemplate);

router.get('/templates/delete/:id',
  requireAccess(REPORT_TEMPLATE_SECTION, OPERATIONS.DELETE),
  trackActionState(REPORT_TEMPLATE_SECTION, OPERATIONS.DELETE),
  ctrl.deleteTemplate);

router.delete('/templates/delete/:id',
  requireAccess(REPORT_TEMPLATE_SECTION, OPERATIONS.DELETE),
  trackActionState(REPORT_TEMPLATE_SECTION, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteTemplate);

// Assignments
router.get('/assignments',
  requireAccess(REPORT_ASSIGNMENT_SECTION, OPERATIONS.READ_ALL),
  trackActionState(REPORT_ASSIGNMENT_SECTION, OPERATIONS.READ_ALL),
  ctrl.listAssignments);

router.get('/assignments/new',
  requireAccess(REPORT_ASSIGNMENT_SECTION, OPERATIONS.CREATE),
  trackActionState(REPORT_ASSIGNMENT_SECTION, OPERATIONS.CREATE),
  ctrl.showAssignmentForm);

router.post('/assignments/new',
  requireAccess(REPORT_ASSIGNMENT_SECTION, OPERATIONS.CREATE),
  trackActionState(REPORT_ASSIGNMENT_SECTION, OPERATIONS.CREATE, reportAssignmentMutationActionState),
  ctrl.saveAssignment);

router.post('/assignments/generate-target-rows',
  requireAccess(REPORT_ASSIGNMENT_SECTION, OPERATIONS.CREATE),
  trackActionState(REPORT_ASSIGNMENT_SECTION, OPERATIONS.CREATE, reportAssignmentBulkActionState),
  ctrl.generateAssignmentTargetRows);

router.post('/assignments/preview-target-rows',
  requireAccess(REPORT_ASSIGNMENT_SECTION, OPERATIONS.CREATE),
  trackActionState(REPORT_ASSIGNMENT_SECTION, OPERATIONS.CREATE, reportAssignmentBulkActionState),
  ctrl.previewAssignmentTargetRows);

router.get('/assignments/edit/:id',
  requireAccess(REPORT_ASSIGNMENT_SECTION, OPERATIONS.UPDATE),
  trackActionState(REPORT_ASSIGNMENT_SECTION, OPERATIONS.UPDATE),
  ctrl.showAssignmentForm);

router.post('/assignments/edit/:id',
  requireAccess(REPORT_ASSIGNMENT_SECTION, OPERATIONS.UPDATE),
  trackActionState(REPORT_ASSIGNMENT_SECTION, OPERATIONS.UPDATE, reportAssignmentMutationActionState),
  ctrl.saveAssignment);

router.post('/assignments/edit/:id/preview-target-rows',
  requireAccess(REPORT_ASSIGNMENT_SECTION, OPERATIONS.UPDATE),
  trackActionState(REPORT_ASSIGNMENT_SECTION, OPERATIONS.UPDATE, reportAssignmentBulkActionState),
  ctrl.previewAssignmentTargetRows);

router.post('/assignments/edit/:id/generate-target-rows',
  requireAccess(REPORT_ASSIGNMENT_SECTION, OPERATIONS.UPDATE),
  trackActionState(REPORT_ASSIGNMENT_SECTION, OPERATIONS.UPDATE, reportAssignmentBulkActionState),
  ctrl.generateAssignmentTargetRows);

router.get('/assignments/delete/:id',
  requireAccess(REPORT_ASSIGNMENT_SECTION, OPERATIONS.DELETE),
  trackActionState(REPORT_ASSIGNMENT_SECTION, OPERATIONS.DELETE),
  ctrl.deleteAssignment);

router.delete('/assignments/delete/:id',
  requireAccess(REPORT_ASSIGNMENT_SECTION, OPERATIONS.DELETE),
  trackActionState(REPORT_ASSIGNMENT_SECTION, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteAssignment);

router.get('/assignments/:id/delete-preview',
  requireAccess(REPORT_ASSIGNMENT_SECTION, OPERATIONS.DELETE),
  trackActionState(REPORT_ASSIGNMENT_SECTION, OPERATIONS.DELETE, { keepActive: true }),
  ctrl.getAssignmentDeletePreview);

// Instances
router.get('/instances',
  requireAccess(REPORT_INSTANCE_SECTION, OPERATIONS.READ_ALL),
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.READ_ALL),
  ctrl.listInstances);

router.get('/person-reports',
  requireAccess(REPORT_INSTANCE_SECTION, OPERATIONS.READ_ALL),
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.READ_ALL),
  ctrl.listPersonReports);

router.get('/instances/matrix/:assignmentId',
  requireReportMatrixEditorAccess,
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.UPDATE),
  ctrl.showReportMatrix);

router.post('/instances/matrix/:assignmentId/save-row',
  requireReportMatrixEditorAccess,
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.UPDATE, {
    requireToken: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.saveReportMatrixRow);

router.post('/instances/matrix/:assignmentId/save-all',
  requireReportMatrixEditorAccess,
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.UPDATE, {
    requireToken: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.saveReportMatrixRows);

router.get('/instances/matrix/:assignmentId/prefill-preview',
  requireReportMatrixEditorAccess,
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.previewReportMatrixPrefill);

router.post('/instances/matrix/:assignmentId/prefill-apply',
  requireReportMatrixEditorAccess,
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.UPDATE, { requireToken: true, allowOperationTokenFallback: true, allowInactiveTokenFallback: true }),
  ctrl.applyReportMatrixPrefill);

router.get('/instances/matrix/:assignmentId/export-docx-preview',
  requireAccess(REPORT_INSTANCE_SECTION, OPERATIONS.EXPORT),
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.EXPORT),
  ctrl.previewReportMatrixDocxExport);

router.get('/instances/matrix/:assignmentId/export',
  requireAccess(REPORT_INSTANCE_SECTION, OPERATIONS.EXPORT),
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.EXPORT),
  ctrl.exportReportMatrix);

router.post('/instances/matrix/:assignmentId/export',
  requireAccess(REPORT_INSTANCE_SECTION, OPERATIONS.EXPORT),
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.EXPORT),
  ctrl.exportReportMatrix);

router.get('/instances/start/:assignmentId',
  requireAccess(REPORT_INSTANCE_SECTION, OPERATIONS.CREATE),
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.CREATE),
  ctrl.startInstance);

router.get('/instances/edit/:id',
  requireReportInstanceEditorAccess,
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.UPDATE),
  ctrl.showInstanceEditor);

router.get('/instances/edit-v2/:id',
  requireReportInstanceEditorAccess,
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.UPDATE),
  ctrl.showInstanceEditorV2);

router.post('/instances/edit/:id',
  requireReportInstanceEditorAccess,
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.UPDATE, {
    requireToken: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.saveInstance);

router.get('/instances/edit/:id/prefill-preview',
  requireReportInstanceEditorAccess,
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.UPDATE, { keepActive: true }),
  ctrl.previewInstancePrefillRefresh);

router.post('/instances/edit/:id/prefill-apply',
  requireReportInstanceEditorAccess,
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.UPDATE, {
    requireToken: true,
    keepActive: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.applyInstancePrefillRefresh);

router.post('/instances/lock/:id',
  requireAccess(REPORT_INSTANCE_SECTION, OPERATIONS.UPDATE),
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.UPDATE, { requireToken: true }),
  ctrl.lockInstance);

router.post('/instances/reopen/:id',
  requireAccess(REPORT_INSTANCE_SECTION, OPERATIONS.UPDATE),
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.UPDATE, {
    keepActive: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.reopenInstance);

router.post('/instances/unlock/:id',
  requireAccess(REPORT_INSTANCE_SECTION, OPERATIONS.UPDATE),
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.UPDATE, {
    keepActive: true,
    allowOperationTokenFallback: true,
    allowInactiveTokenFallback: true
  }),
  ctrl.unlockInstance);

router.get('/instances/delete/:id',
  requireAccess(REPORT_INSTANCE_SECTION, OPERATIONS.DELETE),
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.DELETE),
  ctrl.deleteInstance);

router.delete('/instances/delete/:id',
  requireAccess(REPORT_INSTANCE_SECTION, OPERATIONS.DELETE),
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.DELETE, { requireToken: true }),
  ctrl.deleteInstance);

router.get('/instances/export/:id/docx-preview',
  requireAccess(REPORT_INSTANCE_SECTION, OPERATIONS.EXPORT),
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.EXPORT),
  ctrl.previewInstanceDocxExport);

router.get('/instances/export/:id',
  requireAccess(REPORT_INSTANCE_SECTION, OPERATIONS.EXPORT),
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.EXPORT),
  ctrl.exportInstance);

router.post('/instances/export/:id',
  requireAccess(REPORT_INSTANCE_SECTION, OPERATIONS.EXPORT),
  trackActionState(REPORT_INSTANCE_SECTION, OPERATIONS.EXPORT),
  ctrl.exportInstance);

module.exports = router;
