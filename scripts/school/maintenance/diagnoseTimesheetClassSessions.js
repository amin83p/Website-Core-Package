/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const ROOT_DIR = path.join(__dirname, '../../..');

function loadEnv() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const text = String(line || '').trim();
    if (!text || text.startsWith('#')) continue;
    const index = text.indexOf('=');
    if (index < 1) continue;
    const key = text.slice(0, index).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    process.env[key] = text.slice(index + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}

function parseArgs(argv) {
  const out = { classToken: '', personToken: '', periodStart: '', periodEnd: '' };
  argv.forEach((arg) => {
    const m = String(arg).match(/^--([^=]+)=(.*)$/);
    if (!m) return;
    if (m[1] === 'classId') out.classToken = m[2].trim();
    if (m[1] === 'personId') out.personToken = m[2].trim();
    if (m[1] === 'periodStart') out.periodStart = m[2].trim();
    if (m[1] === 'periodEnd') out.periodEnd = m[2].trim();
  });
  return out;
}

function isPmSession(row) {
  const start = String(row?.startTime || '').trim();
  const m = start.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) >= 12;
}

(async () => {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  if (!args.classToken) {
    console.error('Usage: node scripts/school/maintenance/diagnoseTimesheetClassSessions.js --classId=498837 [--personId=...] [--periodStart=YYYY-MM-DD] [--periodEnd=YYYY-MM-DD]');
    process.exit(1);
  }

  const { resolveDataBackendConfig } = require('../../../config/dataBackend');
  const { connectMongo, disconnectMongo, getMongoCollection } = require('../../../MVC/infrastructure/mongo/mongoConnection');
  const { normalizeMongoDocument } = require('../../../MVC/repositories/backend/mongoRepositoryUtils');
  const sessionDeliveryTeamService = require('../../../packages/school/MVC/services/school/sessionDeliveryTeamService');
  const sessionStatusPolicyService = require('../../../packages/school/MVC/services/school/sessionStatusPolicyService');
  const timesheetParametersPolicyModel = require('../../../packages/school/MVC/models/school/timesheetParametersPolicyModel');
  const timesheetParametersPolicyService = require('../../../packages/school/MVC/services/school/timesheetParametersPolicyService');
  const classEnrollmentReadService = require('../../../packages/school/MVC/services/school/classEnrollmentReadService');
  const timesheetSessionStudentLabelService = require('../../../packages/school/MVC/services/school/timesheetSessionStudentLabelService');
  const classSessionCapacityService = require('../../../packages/school/MVC/services/school/classSessionCapacityService');

  const cfg = resolveDataBackendConfig(process.env);
  await connectMongo({ uri: cfg.mongo.uri });
  const classesCol = getMongoCollection('schoolClasses');
  const periodsCol = getMongoCollection('schoolClassEnrollmentPeriods');

  const token = args.classToken;
  const classQuery = {
    $or: [
      { id: token },
      { publicId: token },
      { title: { $regex: token, $options: 'i' } },
      { name: { $regex: token, $options: 'i' } }
    ]
  };
  const classDocs = await classesCol.find(classQuery).limit(5).toArray();
  if (!classDocs.length) {
    console.log(JSON.stringify({ ok: false, message: 'No class matched token', token }, null, 2));
    await disconnectMongo();
    process.exit(2);
  }

  const reqUser = { id: 'diagnostic-script', role: 'admin', orgId: classDocs[0].orgId };
  const statusMeta = await sessionStatusPolicyService.getClientStatusMeta(classDocs[0].orgId, { includeInactive: true });
  const statusMap = sessionStatusPolicyService.getStatusMetaMap(statusMeta);
  const policy = await timesheetParametersPolicyModel.getPolicyForOrg(classDocs[0].orgId);

  for (const raw of classDocs) {
    const classRow = normalizeMongoDocument(raw);
    const sessions = Array.isArray(classRow.sessions) ? classRow.sessions : [];
    const orgId = classRow.orgId;
    const enrollmentPeriods = await periodsCol.find({ classId: classRow.id, orgId }).toArray();
    const canonicalCount = enrollmentPeriods.length;
    const studentsCol = getMongoCollection('schoolStudents');
    const studentDocs = await studentsCol.find({ orgId }).limit(5000).toArray();
    const students = studentDocs.map((row) => normalizeMongoDocument(row));
    const rollingApplicabilityByClassId = classSessionCapacityService.getClassRegistrationModeKey(classRow) === 'rolling'
      ? await classSessionCapacityService.buildRollingApplicabilityByClassId(
        [classRow],
        {
          sessionsByClassId: new Map([[String(classRow.id), sessions]]),
          students,
          activeOrgId: orgId,
          reqUser
        }
      )
      : new Map();

    const filtered = sessions.filter((s) => {
      if (!args.periodStart || !args.periodEnd) return true;
      const d = String(s.date || '').trim();
      return d >= args.periodStart && d <= args.periodEnd;
    });

    const rows = [];
    for (const session of filtered) {
      const sessionId = String(session.sessionId || session.id || '').trim();
      const date = String(session.date || '').trim();
      const mainTeacher = sessionDeliveryTeamService.getSessionMainTeacherId(session);
      const onDelivery = args.personToken
        ? sessionDeliveryTeamService.isPersonOnSessionDelivery(session, args.personToken)
        : null;
      const isFinal = sessionStatusPolicyService.isFinalStatusByMap(statusMap, {
        status: session.status,
        notes: session.notes
      });
      const timesheetHours = sessionStatusPolicyService.calculateTimesheetHoursByMap(statusMap, {
        status: session.status,
        notes: session.notes,
        durationHours: Number.parseFloat(session.durationHours) || 0,
        session: session
      });
      const rosterCount = Array.isArray(session.roster) ? session.roster.length : 0;
      let enrolledActive = null;
      let enrolledPlanned = null;
      if (date) {
        const activeSnap = await classEnrollmentReadService.listActiveStudentIdsForClass({
          classId: classRow.id,
          classItem: classRow,
          reqUser,
          activeOrgId: orgId,
          sessionDates: [date],
          startDate: date,
          endDate: date,
          canonicalStatuses: ['active']
        });
        const plannedSnap = await classEnrollmentReadService.listActiveStudentIdsForClass({
          classId: classRow.id,
          classItem: classRow,
          reqUser,
          activeOrgId: orgId,
          sessionDates: [date],
          startDate: date,
          endDate: date,
          canonicalStatuses: ['active', 'planned']
        });
        enrolledActive = activeSnap.studentIds instanceof Set ? activeSnap.studentIds.size : 0;
        enrolledPlanned = plannedSnap.studentIds instanceof Set ? plannedSnap.studentIds.size : 0;
      }
      const pseudoEntry = {
        sessionId,
        classId: classRow.id,
        enrolledStudentCount: enrolledActive,
        hours: timesheetHours,
        timesheetHours,
        isFinalStatus: isFinal
      };
      let expectedEnrollmentCount = null;
      if (date) {
        expectedEnrollmentCount = await timesheetSessionStudentLabelService.resolveExpectedEnrollmentCountForSession({
          classData: classRow,
          sessionRow: session,
          studentToPersonMap: timesheetSessionStudentLabelService.buildStudentToPersonMap(students),
          statusMap,
          rollingApplicabilityByClassId,
          termEnrollmentCache: new Map(),
          activeOrgId: orgId,
          reqUser
        });
        pseudoEntry.enrolledStudentCount = expectedEnrollmentCount;
      }
      const hiddenByPolicy = timesheetParametersPolicyService.applyEmptyEnrollmentSessionsPolicy(
        [pseudoEntry],
        policy
      ).length === 0 && Number(expectedEnrollmentCount ?? enrolledActive) === 0;

      rows.push({
        sessionId,
        date,
        startTime: session.startTime,
        endTime: session.endTime,
        isPm: isPmSession(session),
        status: session.status,
        isFinalStatus: isFinal,
        timesheetHours,
        mainTeacherId: mainTeacher,
        onDeliveryForPerson: onDelivery,
        rosterCount,
        enrolledStudentCountActive: enrolledActive,
        enrolledStudentCountActiveOrPlanned: enrolledPlanned,
        expectedEnrollmentCountForSession: expectedEnrollmentCount,
        canonicalEnrollmentPeriodCount: canonicalCount,
        wouldHideByEmptyEnrollmentPolicy: hiddenByPolicy,
        merged: session?.merged?.isMergedSession === true,
        mergedPartner: session?.mergedPartner?.ignoreScheduleConflict === true
      });
    }

    console.log(JSON.stringify({
      ok: true,
      class: {
        id: classRow.id,
        title: classRow.title || classRow.name,
        orgId,
        registrationMode: classRow.registrationMode,
        instructorIds: (classRow.instructors || []).map((i) => i.personId || i.id)
      },
      timesheetEmptyEnrollmentPolicy: policy?.emptyEnrollmentSessions || 'hide',
      sessionCount: rows.length,
      pmSessions: rows.filter((r) => r.isPm === true),
      amSessions: rows.filter((r) => r.isPm === false),
      unknownTimeSessions: rows.filter((r) => r.isPm == null),
      allSessions: rows
    }, null, 2));
  }

  await disconnectMongo();
})().catch(async (error) => {
  console.error(error);
  try {
    const { disconnectMongo } = require('../../../MVC/infrastructure/mongo/mongoConnection');
    await disconnectMongo();
  } catch (_) {}
  process.exit(1);
});
