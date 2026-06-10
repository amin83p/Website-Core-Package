const {
  requireAuth,
  requireAccess,
  requireAccessAny,
  trackActionState
} = require('./schoolCoreContracts');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

module.exports = {
  requireAuth,
  requireAccess,
  requireAccessAny,
  trackActionState,
  SECTIONS,
  OPERATIONS
};
