const {
  requireAuth,
  requireAccess,
  trackActionState,
  upload,
  resolveActivityQuotaPolicy
} = require('./pteCoreContracts');
const pteUploadContext = require('../../middleware/pteUploadContextMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

module.exports = {
  requireAuth,
  requireAccess,
  trackActionState,
  upload,
  pteUploadContext,
  resolveActivityQuotaPolicy,
  SECTIONS,
  OPERATIONS
};
