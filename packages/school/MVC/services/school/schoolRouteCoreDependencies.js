const {
  requireAuth,
  requireAccess,
  trackActionState
} = require('./schoolCoreContracts');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

module.exports = {
  requireAuth,
  requireAccess,
  trackActionState,
  SECTIONS,
  OPERATIONS
};
