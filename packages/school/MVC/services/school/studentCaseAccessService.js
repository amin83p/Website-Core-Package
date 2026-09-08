'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const studentCaseOperationPolicyService = require('./studentCaseOperationPolicyService');
const schoolRecordAccessService = require('./schoolRecordAccessService');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

const accessService = requireCoreModule('MVC/services/security/index');

async function evaluateStudentCaseOperation(user, operationId, ipAddress) {
  if (!user) {
    return { allowed: false, reason: 'Authentication required.' };
  }
  try {
    return await accessService.evaluateAccess({
      user,
      sectionId: SECTIONS.SCHOOL_SESSION_STUDENT_CASES,
      operationId,
      ipAddress
    });
  } catch (error) {
    return {
      allowed: false,
      reason: error?.message || 'Student case access evaluation failed.'
    };
  }
}

async function buildStudentCaseAccess(user, ipAddress) {
  if (!user) {
    return {
      ...studentCaseOperationPolicyService.EMPTY_ACCESS_FLAGS,
      evaluations: {},
      adminFlags: {}
    };
  }

  const [
    read,
    readAll,
    create,
    update,
    resolveEval,
    del,
    configure
  ] = await Promise.all([
    evaluateStudentCaseOperation(user, OPERATIONS.READ, ipAddress),
    evaluateStudentCaseOperation(user, OPERATIONS.READ_ALL, ipAddress),
    evaluateStudentCaseOperation(user, OPERATIONS.CREATE, ipAddress),
    evaluateStudentCaseOperation(user, OPERATIONS.UPDATE, ipAddress),
    evaluateStudentCaseOperation(user, OPERATIONS.RESOLVE, ipAddress),
    evaluateStudentCaseOperation(user, OPERATIONS.DELETE, ipAddress),
    evaluateStudentCaseOperation(user, OPERATIONS.CONFIGURE, ipAddress)
  ]);

  const [
    readPolicy,
    readAllPolicy,
    createPolicy,
    updatePolicy,
    resolvePolicy,
    deletePolicy,
    configurePolicy
  ] = await Promise.all([
    studentCaseOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.READ, evaluation: read }),
    studentCaseOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.READ_ALL, evaluation: readAll }),
    studentCaseOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.CREATE, evaluation: create }),
    studentCaseOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.UPDATE, evaluation: update }),
    studentCaseOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.RESOLVE, evaluation: resolveEval }),
    studentCaseOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.DELETE, evaluation: del }),
    studentCaseOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.CONFIGURE, evaluation: configure })
  ]);

  const adminFlags = {
    read: readPolicy.adminBypass === true,
    readAll: readAllPolicy.adminBypass === true,
    create: createPolicy.adminBypass === true,
    update: updatePolicy.adminBypass === true,
    resolve: resolvePolicy.adminBypass === true,
    delete: deletePolicy.adminBypass === true,
    configure: configurePolicy.adminBypass === true
  };

  const evaluations = {
    read: { ...read, allowed: readPolicy.allowed, scopeId: readPolicy.scopeId || read.scopeId },
    readAll: { ...readAll, allowed: readAllPolicy.allowed, scopeId: readAllPolicy.scopeId || readAll.scopeId },
    create: { ...create, allowed: createPolicy.allowed, scopeId: createPolicy.scopeId || create.scopeId },
    update: { ...update, allowed: updatePolicy.allowed, scopeId: updatePolicy.scopeId || update.scopeId },
    resolve: { ...resolveEval, allowed: resolvePolicy.allowed, scopeId: resolvePolicy.scopeId || resolveEval.scopeId },
    del: { ...del, allowed: deletePolicy.allowed, scopeId: deletePolicy.scopeId || del.scopeId },
    configure: { ...configure, allowed: configurePolicy.allowed, scopeId: configurePolicy.scopeId || configure.scopeId }
  };

  const flags = studentCaseOperationPolicyService.deriveAccessFlags(evaluations, adminFlags);

  return {
    ...flags,
    evaluations,
    adminFlags
  };
}

function resolveSectionScopeIdFromAccess(access = {}) {
  return access.createScopeId
    || access.updateScopeId
    || access.resolveScopeId
    || access.deleteScopeId
    || access.readAllScopeId
    || access.readScopeId
    || null;
}

function buildStudentCaseSectionAccessContext(user, accessFlags = {}) {
  const scopeId = resolveSectionScopeIdFromAccess(accessFlags);
  return schoolRecordAccessService.resolveAccessFromUser(user, { scopeId: scopeId || '' });
}

function assertStudentCaseAccessFlag(access, flagName, message) {
  if (!access?.[flagName]) {
    const error = new Error(message || 'You do not have permission for this student case action.');
    error.statusCode = 403;
    throw error;
  }
}

async function userCanOpenStudentCaseSection(user, ipAddress) {
  const access = await buildStudentCaseAccess(user, ipAddress);
  return Boolean(access.canOpenList);
}

module.exports = {
  evaluateStudentCaseOperation,
  buildStudentCaseAccess,
  userCanOpenStudentCaseSection,
  resolveSectionScopeIdFromAccess,
  buildStudentCaseSectionAccessContext,
  assertStudentCaseAccessFlag
};
