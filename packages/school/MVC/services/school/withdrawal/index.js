// MVC/services/school/withdrawal/index.js

const withdrawalPolicyService = require('./withdrawalPolicyService');
const classWithdrawalService = require('./classWithdrawalService');
const termWithdrawalService = require('./termWithdrawalService');
const programWithdrawalService = require('./programWithdrawalService');
const withdrawalSettlementService = require('./withdrawalSettlementService');
const withdrawalWorkflowService = require('./withdrawalWorkflowService');

module.exports = {
  withdrawalPolicyService,
  classWithdrawalService,
  termWithdrawalService,
  programWithdrawalService,
  withdrawalSettlementService,
  withdrawalWorkflowService
};

