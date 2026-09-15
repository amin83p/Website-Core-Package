'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const schoolAdminAccessService = require('./schoolAdminAccessService');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

const accessService = requireCoreModule('MVC/services/security/index');

async function evaluateOperation(user, operationId, ipAddress) {
  if (!user) return { allowed: false, reason: 'Authentication required.' };
  try {
    return await accessService.evaluateAccess({
      user,
      sectionId: SECTIONS.SCHOOL_NOTIFICATION_CENTER,
      operationId,
      ipAddress
    });
  } catch (error) {
    return { allowed: false, reason: error?.message || 'Access evaluation failed.' };
  }
}

async function buildAccessFlags(user, ipAddress) {
  const [read, readAll, update, configure, upload] = await Promise.all([
    evaluateOperation(user, OPERATIONS.READ, ipAddress),
    evaluateOperation(user, OPERATIONS.READ_ALL, ipAddress),
    evaluateOperation(user, OPERATIONS.UPDATE, ipAddress),
    evaluateOperation(user, OPERATIONS.CONFIGURE, ipAddress),
    evaluateOperation(user, OPERATIONS.UPLOAD, ipAddress)
  ]);
  return {
    canOpen: read.allowed === true,
    canViewRuns: readAll.allowed === true,
    canRunNow: update.allowed === true,
    canConfigure: configure.allowed === true,
    canDispatch: upload.allowed === true,
    isAdminViewer: schoolAdminAccessService.isAdminForRequest(user, SECTIONS.SCHOOL_NOTIFICATION_CENTER, OPERATIONS.READ_ALL)
  };
}

function isConfigureViewer(user) {
  return schoolAdminAccessService.isAdminForRequest(user, SECTIONS.SCHOOL_NOTIFICATION_CENTER, OPERATIONS.CONFIGURE);
}

module.exports = {
  evaluateOperation,
  buildAccessFlags,
  isConfigureViewer
};
