'use strict';

const uploadStoragePolicy = require('../services/uploadStoragePolicyService');

/**
 * When true, public GET /uploads must not serve from local disk before remote storage.
 */
function shouldServePublicUploadsFromRemoteOnly() {
  return uploadStoragePolicy.preferRemoteUploadReads();
}

module.exports = {
  shouldServePublicUploadsFromRemoteOnly
};
