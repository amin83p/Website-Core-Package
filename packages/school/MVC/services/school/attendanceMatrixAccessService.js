'use strict';

const attendanceAccessService = require('./attendanceAccessService');
const attendanceOperationPolicyService = require('./attendanceOperationPolicyService');
const { OPERATIONS } = require('../../../config/accessConstants');

async function userCanOpenAttendanceMatrix(user, ipAddress) {
  const access = await attendanceAccessService.buildAttendanceAccess(user, ipAddress);
  return Boolean(access.canOpenMatrix);
}

async function userCanMarkAttendanceExcused(user, ipAddress) {
  const access = await attendanceAccessService.buildAttendanceAccess(user, ipAddress);
  return Boolean(access.canMarkExcused);
}

async function getAttendanceAccessForRequest(user, ipAddress) {
  return attendanceAccessService.buildAttendanceAccess(user, ipAddress);
}

module.exports = {
  userCanOpenAttendanceMatrix,
  userCanMarkAttendanceExcused,
  getAttendanceAccessForRequest,
  attendanceOperationPolicyService,
  OPERATIONS
};
