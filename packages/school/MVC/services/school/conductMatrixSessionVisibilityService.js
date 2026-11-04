'use strict';

const { requireCoreModule } = require('./schoolCoreContracts');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const reportAssignmentSessionUtils = requireCoreModule('MVC/utils/reportAssignmentSessionUtils');
const sessionConductService = require('./sessionConductService');
const conductMatrixService = require('./conductMatrixService');
const schoolDataService = require('./schoolDataService');
const schoolRecordAccessService = require('./schoolRecordAccessService');

async function setSessionConductReportStepEnabled(req, { classId, sessionId, enabled }) {
  const cleanClassId = String(classId || '').trim();
  const cleanSessionId = String(sessionId || '').trim();
  if (!cleanClassId || !cleanSessionId) {
    throw new Error('Class ID and session ID are required.');
  }
  const wantEnabled = enabled === true
    || String(enabled || '').trim().toLowerCase() === 'true'
    || String(enabled || '').trim() === '1';

  const classData = await schoolDataService.getDataById('classes', cleanClassId, req.user);
  if (!classData) throw new Error('Class not found.');
  schoolRecordAccessService.assertClassAccessible(
    classData,
    schoolRecordAccessService.resolveAccessFromRequest(req)
  );

  const sessions = await schoolDataService.getClassSessions(cleanClassId, req.user);
  const sessionIndex = (Array.isArray(sessions) ? sessions : []).findIndex((row) => (
    String(row?.sessionId || row?.id || '').trim() === cleanSessionId
  ));
  if (sessionIndex === -1) throw new Error('Session not found.');

  const session = sessions[sessionIndex];
  const assignments = await schoolDataService.fetchAllData('reportAssignments', {}, req.user);
  const conductRequiredForReports = conductMatrixService.resolveSessionConductRequired(
    assignments,
    session,
    cleanClassId
  );
  if (!wantEnabled && conductRequiredForReports) {
    throw new Error('This session requires class conduct for reports and cannot be hidden.');
  }

  session.conductReportStepEnabled = wantEnabled;
  if (!wantEnabled) {
    session.conductReportStepEnabled = false;
  }
  sessions[sessionIndex] = session;
  await schoolDataService.saveClassSessions(cleanClassId, sessions, req.user);

  return {
    classId: cleanClassId,
    sessionId: cleanSessionId,
    conductReportStepEnabled: sessionConductService.parseConductReportStepEnabled(session),
    conductRequiredForReports
  };
}

module.exports = {
  setSessionConductReportStepEnabled
};
