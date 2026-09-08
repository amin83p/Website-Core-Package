'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const attendanceOperationPolicyService = require('./attendanceOperationPolicyService');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');

const accessService = requireCoreModule('MVC/services/security/index');

async function evaluateAttendanceOperation(user, operationId, ipAddress, sectionId = SECTIONS.SCHOOL_ATTENDANCES) {
  if (!user) {
    return { allowed: false, reason: 'Authentication required.' };
  }
  try {
    return await accessService.evaluateAccess({
      user,
      sectionId,
      operationId,
      ipAddress
    });
  } catch (error) {
    return {
      allowed: false,
      reason: error?.message || 'Attendance access evaluation failed.'
    };
  }
}

async function buildAttendanceAccess(user, ipAddress) {
  if (!user) {
    return {
      ...attendanceOperationPolicyService.EMPTY_ACCESS_FLAGS,
      evaluations: {},
      adminFlags: {}
    };
  }

  const [
    read,
    readAll,
    update,
    del,
    upload,
    exportEval,
    printEval
  ] = await Promise.all([
    evaluateAttendanceOperation(user, OPERATIONS.READ, ipAddress),
    evaluateAttendanceOperation(user, OPERATIONS.READ_ALL, ipAddress),
    evaluateAttendanceOperation(user, OPERATIONS.UPDATE, ipAddress),
    evaluateAttendanceOperation(user, OPERATIONS.DELETE, ipAddress),
    evaluateAttendanceOperation(user, OPERATIONS.UPLOAD, ipAddress),
    evaluateAttendanceOperation(user, OPERATIONS.EXPORT, ipAddress),
    evaluateAttendanceOperation(user, OPERATIONS.PRINT, ipAddress)
  ]);

  const [
    readPolicy,
    readAllPolicy,
    updatePolicy,
    deletePolicy,
    uploadPolicy,
    exportPolicy,
    printPolicy
  ] = await Promise.all([
    attendanceOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.READ, evaluation: read }),
    attendanceOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.READ_ALL, evaluation: readAll }),
    attendanceOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.UPDATE, evaluation: update }),
    attendanceOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.DELETE, evaluation: del }),
    attendanceOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.UPLOAD, evaluation: upload }),
    attendanceOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.EXPORT, evaluation: exportEval }),
    attendanceOperationPolicyService.applyOperationPolicy({ user, operationId: OPERATIONS.PRINT, evaluation: printEval })
  ]);

  const adminFlags = {
    read: readPolicy.adminBypass === true,
    readAll: readAllPolicy.adminBypass === true,
    update: updatePolicy.adminBypass === true,
    delete: deletePolicy.adminBypass === true,
    upload: uploadPolicy.adminBypass === true,
    export: exportPolicy.adminBypass === true,
    print: printPolicy.adminBypass === true
  };

  const evaluations = {
    read: { ...read, allowed: readPolicy.allowed, scopeId: readPolicy.scopeId || read.scopeId },
    readAll: { ...readAll, allowed: readAllPolicy.allowed, scopeId: readAllPolicy.scopeId || readAll.scopeId },
    update: { ...update, allowed: updatePolicy.allowed, scopeId: updatePolicy.scopeId || update.scopeId },
    del: { ...del, allowed: deletePolicy.allowed, scopeId: deletePolicy.scopeId || del.scopeId },
    upload: { ...upload, allowed: uploadPolicy.allowed, scopeId: uploadPolicy.scopeId || upload.scopeId },
    export: { ...exportEval, allowed: exportPolicy.allowed, scopeId: exportPolicy.scopeId || exportEval.scopeId },
    print: { ...printEval, allowed: printPolicy.allowed, scopeId: printPolicy.scopeId || printEval.scopeId }
  };

  const flags = attendanceOperationPolicyService.deriveAccessFlags(evaluations, adminFlags);

  return {
    ...flags,
    evaluations,
    adminFlags
  };
}

async function buildAttendanceReportAccess(user, ipAddress) {
  if (!user) {
    return {
      canOpenReport: false,
      canGenerateReport: false,
      canExportReport: false
    };
  }

  const [read, readAll, exportEval] = await Promise.all([
    evaluateAttendanceOperation(user, OPERATIONS.READ, ipAddress, SECTIONS.SCHOOL_ATTENDANCE_REPORT),
    evaluateAttendanceOperation(user, OPERATIONS.READ_ALL, ipAddress, SECTIONS.SCHOOL_ATTENDANCE_REPORT),
    evaluateAttendanceOperation(user, OPERATIONS.EXPORT, ipAddress, SECTIONS.SCHOOL_ATTENDANCE_REPORT)
  ]);

  const [readPolicy, readAllPolicy, exportPolicy] = await Promise.all([
    attendanceOperationPolicyService.applyOperationPolicy({
      user,
      operationId: OPERATIONS.READ,
      evaluation: read,
      sectionId: SECTIONS.SCHOOL_ATTENDANCE_REPORT
    }),
    attendanceOperationPolicyService.applyOperationPolicy({
      user,
      operationId: OPERATIONS.READ_ALL,
      evaluation: readAll,
      sectionId: SECTIONS.SCHOOL_ATTENDANCE_REPORT
    }),
    attendanceOperationPolicyService.applyOperationPolicy({
      user,
      operationId: OPERATIONS.EXPORT,
      evaluation: exportEval,
      sectionId: SECTIONS.SCHOOL_ATTENDANCE_REPORT
    })
  ]);

  const adminRead = readPolicy.adminBypass === true;
  const adminReadAll = readAllPolicy.adminBypass === true;
  const adminExport = exportPolicy.adminBypass === true;

  return {
    canOpenReport: Boolean(adminRead || readPolicy.allowed),
    canGenerateReport: Boolean(
      adminReadAll
      || (readAllPolicy.allowed && attendanceOperationPolicyService.normalizeScopeMode(readAll.scopeId) === 'organization')
    ),
    canExportReport: Boolean(
      adminExport
      || (exportPolicy.allowed && attendanceOperationPolicyService.canExportOrPrintAtScope(exportEval.scopeId))
    ),
    evaluations: { read, readAll, export: exportEval }
  };
}

function assertAttendanceAccessFlag(access, flagName, message) {
  if (!access?.[flagName]) {
    const error = new Error(message || 'You do not have permission for this attendance action.');
    error.statusCode = 403;
    throw error;
  }
}

module.exports = {
  evaluateAttendanceOperation,
  buildAttendanceAccess,
  buildAttendanceReportAccess,
  assertAttendanceAccessFlag
};
