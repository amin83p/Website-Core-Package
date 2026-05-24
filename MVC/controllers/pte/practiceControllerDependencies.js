const { paginate, buildDataServiceQuery, inferSearchableFields, isAjax } = require('./coreHelpers');
const pathResolver = require('../../utils/pathResolver');
const uploadMiddleware = require('../../middleware/upload');
const pteUploadContext = require('../../middleware/pteUploadContextMiddleware');
const securityService = require('../../services/security');
const adminChekersService = require('../../services/adminChekersService');
const pteAttemptLedgerService = require('../../services/pte/pteAttemptLedgerService');
const pteSmartPracticeService = require('../../services/pte/pteSmartPracticeService');
const pteQuestionVersionRepository = require('../../repositories/pteQuestionVersionRepository');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

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
