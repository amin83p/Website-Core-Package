const {
  paginate,
  buildDataServiceQuery,
  inferSearchableFields,
  isAjax
} = require('./pte/coreHelpers');
const { coreFilesService } = require('../services/coreFilesService');
const uploadMiddleware = require('../middleware/upload');
const pteUploadContext = require('../middleware/pteUploadContextMiddleware');
const {
  securityService,
  adminChekersService
} = require('../services/pte/pteCoreContracts');
const pteAttemptLedgerService = require('../services/pte/pteAttemptLedgerService');
const pteSmartPracticeService = require('../services/pte/pteSmartPracticeService');
const pteQuestionVersionRepository = require('../repositories/pteQuestionVersionRepository');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');

module.exports = {
  paginate,
  isAjax,
  buildDataServiceQuery,
  inferSearchableFields,
  coreFilesService,
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
