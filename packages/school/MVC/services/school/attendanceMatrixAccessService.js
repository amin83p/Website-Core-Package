'use strict';

const schoolAdminAccessService = require('./schoolAdminAccessService');
const { requireCoreModule } = require('./schoolCoreContracts');
const accessService = requireCoreModule('MVC/services/security');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

async function userCanOpenAttendanceMatrix(user, ipAddress) {
  if (!user) return false;
  if (await schoolAdminAccessService.isAttendancesAdminViewerAsync(user)) return true;
  try {
    const evaluation = await accessService.evaluateAccess({
      user,
      sectionId: SECTIONS.SCHOOL_ATTENDANCES,
      operationId: OPERATIONS.UPDATE,
      ipAddress
    });
    return evaluation?.allowed === true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  userCanOpenAttendanceMatrix
};
