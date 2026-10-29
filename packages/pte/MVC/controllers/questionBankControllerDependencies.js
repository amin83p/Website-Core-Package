const path = require('path');
const crypto = require('crypto');

const {
  paginate,
  buildDataServiceQuery,
  inferSearchableFields,
  isAjax
} = require('./pte/coreHelpers');
const pteUploadPathUtils = require('../utils/pteUploadPathUtils');
const { coreFilesService } = require('../services/coreFilesService');
const uploadMiddleware = require('../middleware/upload');
const {
  settingService,
  adminChekersService,
  uploadStorageService
} = require('../services/pte/pteCoreContracts');
const pteUploadStorageHelper = require('../services/pte/pteUploadStorageHelper');
const pteQuestionBankDataService = require('../services/pte/pteQuestionBankDataService');
const questionBankAiAutofillService = require('../services/pte/questionBankAiAutofillService');
const pteQuestionScoringProfileService = require('../services/pte/pteQuestionScoringProfileService');

module.exports = {
  path,
  crypto,
  paginate,
  isAjax,
  buildDataServiceQuery,
  inferSearchableFields,
  pteUploadPathUtils,
  coreFilesService,
  uploadStorage: uploadStorageService,
  pteUploadStorageHelper,
  uploadMiddleware,
  settingService,
  pteQuestionBankDataService,
  questionBankAiAutofillService,
  pteQuestionScoringProfileService,
  adminChekersService
};
