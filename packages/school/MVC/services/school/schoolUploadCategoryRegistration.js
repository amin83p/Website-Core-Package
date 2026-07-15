const schoolUploadPathUtils = require('../../utils/schoolUploadPathUtils');
const { requireCoreModule } = require('./schoolCoreContracts');

const uploadCategoryResolverService = requireCoreModule('MVC/services/uploadCategoryResolverService');

function registerSchoolUploadCategoryResolvers() {
  if (
    !uploadCategoryResolverService
    || typeof uploadCategoryResolverService.registerUploadCategoryResolver !== 'function'
  ) {
    throw new Error('Core upload category resolver service is not available.');
  }

  uploadCategoryResolverService.registerUploadCategoryResolver('students', ({ req = {} } = {}) => (
    schoolUploadPathUtils.buildStudentCategory({
      personId: req.body?.personId || req.params?.personId || req.params?.id
    })
  ));

  uploadCategoryResolverService.registerUploadCategoryResolver('school-students', ({ req = {} } = {}) => (
    schoolUploadPathUtils.buildStudentCategory({
      personId: req.body?.personId || req.params?.personId || req.params?.id
    })
  ));

  uploadCategoryResolverService.registerUploadCategoryResolver('school-teachers', ({ req = {} } = {}) => (
    schoolUploadPathUtils.buildTeacherCategory({
      personId: req.body?.personId || req.params?.personId || req.params?.id
    })
  ));

  uploadCategoryResolverService.registerUploadCategoryResolver('school-staff', ({ req = {} } = {}) => (
    schoolUploadPathUtils.buildStaffCategory({
      personId: req.body?.personId || req.params?.personId || req.params?.id
    })
  ));

  uploadCategoryResolverService.registerUploadCategoryResolver('school-reports', () => (
    schoolUploadPathUtils.buildReportTemplatesCategory()
  ));

  uploadCategoryResolverService.registerUploadCategoryResolver('school-exams', ({ req = {} } = {}) => (
    schoolUploadPathUtils.buildExamMediaCategory({
      templateId: req.body?.templateId || req.params?.templateId || 'template_unsaved',
      questionId: req.body?.questionId || req.params?.questionId || 'question_unsaved'
    })
  ));

  uploadCategoryResolverService.registerUploadCategoryResolver('school-class-workspace', ({ req = {} } = {}) => (
    schoolUploadPathUtils.buildClassWorkspaceCategory({
      classId: req.params?.id || req.params?.classId || req.body?.classId,
      sessionId: req.params?.sessionId || req.body?.sessionId,
      studentPersonId: req.body?.studentPersonId || req.body?.personId,
      kind: req.body?.kind || req.query?.kind
    })
  ));

  uploadCategoryResolverService.registerUploadCategoryResolver('school-subject-workspace', ({ req = {} } = {}) => (
    schoolUploadPathUtils.buildSubjectWorkspaceCategory({
      subjectId: req.params?.id || req.params?.subjectId || req.body?.subjectId
    })
  ));
}

module.exports = {
  registerSchoolUploadCategoryResolvers
};
