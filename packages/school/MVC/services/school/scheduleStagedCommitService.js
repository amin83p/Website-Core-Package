'use strict';

const schoolDataService = require('./schoolDataService');
const scheduleAccessService = require('./scheduleAccessService');
const rollingEnrollmentSessionAlignmentService = require('./rollingEnrollmentSessionAlignmentService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

function normalizeId(value) {
  return String(value || '').trim();
}

function isUserInstructorOnClass(classData, personId) {
  const pid = normalizeId(personId);
  if (!pid) return false;
  const rows = Array.isArray(classData?.instructors) ? classData.instructors : [];
  return rows.some((row) => (
    idsEqual(row?.personId, pid)
    && String(row?.status || 'active').trim().toLowerCase() !== 'inactive'
  ));
}

async function assertMasterScheduleStagedCommitAccess(req, { classId, personId }) {
  const capabilities = await scheduleAccessService.buildScheduleCapabilities(req.user, {
    accessScope: req?.accessScope || '',
    ipAddress: req?.ip || ''
  });
  if (!capabilities.canDragCreateSessions) {
    const error = new Error('You do not have permission to save staged sessions from Master Schedule.');
    error.step = 'saveSessions';
    throw error;
  }
  const accessContext = schoolDataService.buildRouteAccessContext(req);
  const classData = await schoolDataService.getDataById('classes', classId, req.user, accessContext);
  if (!classData) {
    const error = new Error('Class not found.');
    error.step = 'saveSessions';
    throw error;
  }
  if (!isUserInstructorOnClass(classData, personId)) {
    const error = new Error('Selected person is not an instructor on this class.');
    error.step = 'sessionConflicts';
    throw error;
  }
  return { accessContext, classData, capabilities };
}

async function precheckStagedSessionsForCommit({
  classData,
  personId,
  pendingStagedSessions,
  reqUser
}) {
  if (!Array.isArray(pendingStagedSessions) || !pendingStagedSessions.length) {
    const error = new Error('No staged sessions to save.');
    error.step = 'sessionConflicts';
    throw error;
  }

  const duplicateClassConflicts = await rollingEnrollmentSessionAlignmentService.findDuplicateClassSessionConflicts({
    classData,
    sessionsToAdd: pendingStagedSessions,
    reqUser
  });
  if (duplicateClassConflicts.length) {
    const error = new Error(rollingEnrollmentSessionAlignmentService.buildDuplicateClassDateMessage(duplicateClassConflicts));
    error.step = 'sessionConflicts';
    error.remediation = 'Remove or reschedule the conflicting staged sessions, or delete the existing class sessions on those dates before saving.';
    throw error;
  }

  const sessionConflictDetectionService = require('./sessionConflictDetectionService');
  const conflictResult = await sessionConflictDetectionService.evaluateMasterScheduleStagedSessionConflicts({
    classData,
    proposedSessions: pendingStagedSessions,
    teacherId: personId,
    reqUser
  });
  if (conflictResult.hasConflicts) {
    const error = new Error(sessionConflictDetectionService.buildConflictBlockingMessage(conflictResult.allConflicts));
    error.step = 'sessionConflicts';
    error.remediation = 'Adjust staged session times or resolve overlapping instructor/student schedule conflicts, then try again.';
    throw error;
  }

  return { ok: true };
}

async function commitStagedSessionsToClass({
  classData,
  pendingStagedSessions,
  extendCycleEndDate,
  reqUser
}) {
  return rollingEnrollmentSessionAlignmentService.commitStagedSessions({
    classData,
    sessionsToAdd: pendingStagedSessions,
    extendCycleEndDate: extendCycleEndDate === true,
    reqUser
  });
}

module.exports = {
  assertMasterScheduleStagedCommitAccess,
  isUserInstructorOnClass,
  precheckStagedSessionsForCommit,
  commitStagedSessionsToClass
};
