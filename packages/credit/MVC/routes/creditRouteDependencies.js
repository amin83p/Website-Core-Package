const {
  requireCoreModule,
  requireAuth
} = require('../services/credit/creditCoreContracts');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');

const { requireAccess } = requireCoreModule('MVC/middleware/accessMiddleware');
const { trackActionState } = requireCoreModule('MVC/middleware/actionStateMiddleware');

module.exports = {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
};
