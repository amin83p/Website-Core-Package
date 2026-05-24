const path = require('path');
const crypto = require('crypto');

const paginate = require('../../../../MVC/utils/paginationHelper');
const pteUploadPathUtils = require('../../../../MVC/utils/pteUploadPathUtils');
const coreFilesService = require('../../../../MVC/services/coreFilesService');
const uploadMiddleware = require('../../../../MVC/middleware/upload');
const {
  isAjax,
  buildDataServiceQuery,
  inferSearchableFields
} = require('../../../../MVC/utils/generalTools');
const settingService = require('../../../../MVC/services/settingService');

module.exports = {
  path,
  crypto,
  paginate,
  pteUploadPathUtils,
  coreFilesService,
  uploadMiddleware,
  isAjax,
  buildDataServiceQuery,
  inferSearchableFields,
  settingService
};
