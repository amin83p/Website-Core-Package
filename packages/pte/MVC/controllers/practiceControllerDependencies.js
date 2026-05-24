const { paginate, buildDataServiceQuery, inferSearchableFields, isAjax } = require('./pte/coreHelpers');
const pathResolver = require('../../../../MVC/utils/pathResolver');
const uploadMiddleware = require('../../../../MVC/middleware/upload');
const pteUploadContext = require('../../../../MVC/middleware/pteUploadContextMiddleware');
const securityService = require('../../../../MVC/services/security');
const adminChekersService = require('../../../../MVC/services/adminChekersService');
const pteAttemptLedgerService = require('../services/pte/pteAttemptLedgerService');
const pteSmartPracticeService = require('../services/pte/pteSmartPracticeService');
const pteQuestionVersionRepository = require('../repositories/pteQuestionVersionRepository');
const { SECTIONS, OPERATIONS } = require('../../../../config/accessConstants');

module.exports = {
  paginate,
  isAjax,
  buildDataServiceQuery,
  inferSearchableFields,
  pathResolver,
  uploadMiddleware,
  pteUploadContext,
  securityService,
  adminChekersService,
  pteAttemptLedgerService,
  pteSmartPracticeService,
  pteQuestionVersionRepository,
  SECTIONS,
  OPERATIONS
};
