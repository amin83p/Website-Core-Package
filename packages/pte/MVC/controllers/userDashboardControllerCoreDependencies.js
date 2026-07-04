const { accessUiService } = require('../services/pte/pteCoreContracts');
const pteAccessConstants = require('../../config/accessConstants');
const activityQuotaAccessConstants = require('../../../../packages/activityQuota/config/accessConstants');

const SECTIONS = Object.freeze({
  ...(pteAccessConstants.SECTIONS || {}),
  ...(activityQuotaAccessConstants.ACTIVITY_QUOTA_SECTIONS || {})
});
const OPERATIONS = pteAccessConstants.OPERATIONS;

module.exports = {
  accessUiService,
  SECTIONS,
  OPERATIONS
};
