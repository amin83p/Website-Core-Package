'use strict';

const studentCaseAccessService = require('./studentCaseAccessService');
const studentCaseOperationPolicyService = require('./studentCaseOperationPolicyService');
const { OPERATIONS } = require('../../../config/accessConstants');

async function getStudentCaseAccessForRequest(user, ipAddress) {
  return studentCaseAccessService.buildStudentCaseAccess(user, ipAddress);
}

module.exports = {
  getStudentCaseAccessForRequest,
  studentCaseAccessService,
  studentCaseOperationPolicyService,
  OPERATIONS
};
