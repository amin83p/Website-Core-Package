const { requireAuth } = require('../../../../../MVC/middleware/authMiddleware');
const { requireAccess } = require('../../../../../MVC/middleware/accessMiddleware');
const { trackActionState } = require('../../../../../MVC/middleware/actionStateMiddleware');
const upload = require('../../../../../MVC/middleware/upload');
const pteUploadContext = require('../../middleware/pteUploadContextMiddleware');
const { resolveActivityQuotaPolicy } = require('../../../../../MVC/middleware/activityQuotaMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../../../config/accessConstants');

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
