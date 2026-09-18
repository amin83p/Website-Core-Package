'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const notificationCenterOperationPolicyService = require('./notificationCenterOperationPolicyService');
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
  if (!user) {
    return {
      ...notificationCenterOperationPolicyService.EMPTY_ACCESS_FLAGS,
      evaluations: {}
    };
  }

  const [read, readAll, update, configure, upload, del] = await Promise.all([
    evaluateOperation(user, OPERATIONS.READ, ipAddress),
    evaluateOperation(user, OPERATIONS.READ_ALL, ipAddress),
    evaluateOperation(user, OPERATIONS.UPDATE, ipAddress),
    evaluateOperation(user, OPERATIONS.CONFIGURE, ipAddress),
    evaluateOperation(user, OPERATIONS.UPLOAD, ipAddress),
    evaluateOperation(user, OPERATIONS.DELETE, ipAddress)
  ]);

  const [
    readPolicy,
    readAllPolicy,
    updatePolicy,
    configurePolicy,
    uploadPolicy,
    deletePolicy
  ] = await Promise.all([
    notificationCenterOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.READ, evaluation: read }),
    notificationCenterOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.READ_ALL, evaluation: readAll }),
    notificationCenterOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.UPDATE, evaluation: update }),
    notificationCenterOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.CONFIGURE, evaluation: configure }),
    notificationCenterOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.UPLOAD, evaluation: upload }),
    notificationCenterOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.DELETE, evaluation: del })
  ]);

  const adminFlags = {
    read: readPolicy.adminBypass === true,
    readAll: readAllPolicy.adminBypass === true,
    update: updatePolicy.adminBypass === true,
    configure: configurePolicy.adminBypass === true,
    upload: uploadPolicy.adminBypass === true,
    delete: deletePolicy.adminBypass === true
  };

  const evaluations = {
    read: readPolicy,
    readAll: readAllPolicy,
    update: updatePolicy,
    configure: configurePolicy,
    upload: uploadPolicy,
    del: deletePolicy
  };

  return {
    ...notificationCenterOperationPolicyService.deriveAccessFlags(evaluations, adminFlags),
    evaluations
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
