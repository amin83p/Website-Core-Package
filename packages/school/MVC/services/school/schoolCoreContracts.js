const { requireCoreModule } = require('./schoolCoreModuleResolver');

const { requireAuth } = requireCoreModule('MVC/middleware/authMiddleware');
const { requireAccess } = requireCoreModule('MVC/middleware/accessMiddleware');
const { trackActionState } = requireCoreModule('MVC/middleware/actionStateMiddleware');
const constants = requireCoreModule('config/constants');

module.exports = {
  requireCoreModule,
  requireAuth,
  requireAccess,
  trackActionState,
  constants
};
