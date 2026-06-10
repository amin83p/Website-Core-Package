const { requireCoreModule } = require('./schoolCoreModuleResolver');

const { requireAuth } = requireCoreModule('MVC/middleware/authMiddleware');
const { requireAccess, requireAccessAny } = requireCoreModule('MVC/middleware/accessMiddleware');
const { trackActionState } = requireCoreModule('MVC/middleware/actionStateMiddleware');
const constants = requireCoreModule('config/constants');

module.exports = {
  requireCoreModule,
  requireAuth,
  requireAccess,
  requireAccessAny,
  trackActionState,
  constants
};
