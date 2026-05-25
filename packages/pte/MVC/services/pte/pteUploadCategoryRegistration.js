const pteUploadPathUtils = require('../../utils/pteUploadPathUtils');
const { uploadCategoryResolverService } = require('./pteCoreDependencies');

function registerPteUploadCategoryResolvers() {
  if (
    !uploadCategoryResolverService
    || typeof uploadCategoryResolverService.registerUploadCategoryResolver !== 'function'
  ) {
    throw new Error('Core upload category resolver service is not available.');
  }

  uploadCategoryResolverService.registerUploadCategoryResolver('pte-question-bank', () => (
    pteUploadPathUtils.buildQuestionBankCategory()
  ));

  uploadCategoryResolverService.registerUploadCategoryResolver('pte-students', ({ req = {}, isDynamic = false } = {}) => (
    pteUploadPathUtils.buildStudentCategory({
      bucket: req.pteStorageContext?.bucket,
      itemId:
        req.params?.id ||
        req.body?.studentId ||
        req.body?.mediaItemId ||
        req.body?.applicantId ||
        req.body?.personId ||
        'item_unsaved',
      includeItemFolder: isDynamic !== false
    })
  ));

  uploadCategoryResolverService.registerUploadCategoryResolver('pte-attempts', ({ req = {} } = {}) => (
    pteUploadPathUtils.buildAttemptCategory({
      bucket: req.pteStorageContext?.bucket,
      userId: req.pteStorageContext?.userId || req.user?.id || req.body?.userId,
      practiceName: req.pteStorageContext?.practiceName || req.body?.practiceName || req.body?.practiceId,
      testName: req.pteStorageContext?.testName || req.body?.testName || req.body?.examName,
      sessionId:
        req.pteStorageContext?.sessionId ||
        req.params?.sessionId ||
        req.body?.sessionId ||
        req.body?.attemptSessionId ||
        req.body?.practiceId ||
        req.body?.examId,
      itemId:
        req.pteStorageContext?.itemId ||
        req.params?.itemId ||
        req.body?.itemId ||
        req.body?.attemptItemId ||
        req.body?.questionId
    })
  ));
}

module.exports = {
  registerPteUploadCategoryResolvers
};
