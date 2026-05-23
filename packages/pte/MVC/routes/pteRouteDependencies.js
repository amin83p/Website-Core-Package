const { requireAuth } = require('../../../../MVC/middleware/authMiddleware');
const { requireAccess } = require('../../../../MVC/middleware/accessMiddleware');
const { trackActionState } = require('../../../../MVC/middleware/actionStateMiddleware');
const { SECTIONS, OPERATIONS } = require('../../../../config/accessConstants');

module.exports = {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
};
