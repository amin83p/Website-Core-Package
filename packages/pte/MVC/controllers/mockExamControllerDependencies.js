const { coreFilesService } = require('../services/coreFilesService');
const uploadMiddleware = require('../middleware/upload');
const pteAttemptLedgerService = require('../services/pte/pteAttemptLedgerService');
const pteMockExamDataService = require('../services/pte/pteMockExamDataService');
const pteQuestionVersionRepository = require('../repositories/pteQuestionVersionRepository');

module.exports = {
  coreFilesService,
  uploadMiddleware,
  pteAttemptLedgerService,
  pteMockExamDataService,
  pteQuestionVersionRepository
};
