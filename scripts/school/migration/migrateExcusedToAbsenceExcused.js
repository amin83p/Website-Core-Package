/* eslint-disable no-console */
const { resolveDataBackendConfig } = require('../../../config/dataBackend');
const { setActiveDataBackendConfig } = require('../../../MVC/infrastructure/runtime/dataBackendRuntime');
const { connectMongo, disconnectMongo, getMongoCollection } = require('../../../MVC/infrastructure/mongo/mongoConnection');
const schoolDataService = require('../../../packages/school/MVC/services/school/schoolDataService');
const attendanceMatrixMetricsService = require('../../../packages/school/MVC/services/school/attendanceMatrixMetricsService');

const { ATTENDANCE_STATUS } = attendanceMatrixMetricsService;

function parseArgs(argv = []) {
  const flags = new Set(argv.filter((arg) => /^--/.test(arg)));
  const value = (name) => {
    const token = argv.find((arg) => String(arg || '').startsWith(`${name}=`));
    return token ? String(token.slice(name.length + 1)).trim() : '';
  };
  return {
    apply: flags.has('--apply'),
    orgId: value('--org'),
    backend: value('--backend').toLowerCase()
  };
}

function migrateRosterRow(row = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return { row, changed: false };
  }
  const attendance = attendanceMatrixMetricsService.normalizeAttendanceStatusForSave(row.attendance, '');
  let changed = false;
  const next = { ...row };

  if (attendance === ATTENDANCE_STATUS.EXCUSED) {
    next.attendance = ATTENDANCE_STATUS.ABSENT;
    next.absenceExcused = true;
    changed = true;
  }

  const absentFields = attendanceMatrixMetricsService.normalizeAbsenceExcusedFields(next);
  if (next.absenceExcused !== absentFields.absenceExcused) {
    next.absenceExcused = absentFields.absenceExcused;
    changed = true;
  }

  return { row: changed ? next : row, changed };
}

function migrateClassSessions(sessions = []) {
  let scannedRosterRows = 0;
  let changedRosterRows = 0;
  let excusedRowsMigrated = 0;
  const nextSessions = (Array.isArray(sessions) ? sessions : []).map((session) => {
    const roster = Array.isArray(session?.roster) ? session.roster : [];
    let sessionChanged = false;
    const nextRoster = roster.map((row) => {
      scannedRosterRows += 1;
      const beforeAttendance = attendanceMatrixMetricsService.normalizeAttendanceStatusForSave(row?.attendance, '');
      const result = migrateRosterRow(row);
      if (result.changed) {
        changedRosterRows += 1;
        sessionChanged = true;
        if (beforeAttendance === ATTENDANCE_STATUS.EXCUSED) excusedRowsMigrated += 1;
      }
      return result.row;
    });
    return sessionChanged ? { ...session, roster: nextRoster } : session;
  });

  return {
    sessions: nextSessions,
    scannedRosterRows,
    changedRosterRows,
    excusedRowsMigrated
  };
}

function migrateEnabledAttendanceStatuses(enabledStatuses) {
  if (!Array.isArray(enabledStatuses)) return { value: enabledStatuses, changed: false };
  const filtered = enabledStatuses.filter((item) => {
    const st = attendanceMatrixMetricsService.normalizeAttendanceStatusForSave(item, '');
    return st && st !== ATTENDANCE_STATUS.EXCUSED;
  });
  const changed = filtered.length !== enabledStatuses.length;
  return { value: changed ? filtered : enabledStatuses, changed };
}

function migrateClassDocument(classRow = {}) {
  const sessionsResult = migrateClassSessions(classRow?.sessions);
  const enabledResult = migrateEnabledAttendanceStatuses(classRow?.enabledAttendanceStatuses);
  const changed = sessionsResult.changedRosterRows > 0 || enabledResult.changed;
  const next = changed ? { ...classRow } : classRow;
  if (sessionsResult.changedRosterRows > 0) next.sessions = sessionsResult.sessions;
  if (enabledResult.changed) next.enabledAttendanceStatuses = enabledResult.value;
  return {
    classRow: next,
    scannedRosterRows: sessionsResult.scannedRosterRows,
    changedRosterRows: sessionsResult.changedRosterRows,
    excusedRowsMigrated: sessionsResult.excusedRowsMigrated,
    enabledStatusesStripped: enabledResult.changed ? 1 : 0,
    changed
  };
}

async function listClasses({ orgId }) {
  const query = {
    page: 1,
    limit: 10000,
    ...(orgId ? { orgId__eq: orgId } : {})
  };
  return schoolDataService.fetchData('classes', query, null, { includeVoided: true });
}

async function runMigration({ apply = false, orgId = '' } = {}) {
  const classes = await listClasses({ orgId });
  const summary = {
    scannedClasses: 0,
    changedClasses: 0,
    scannedRosterRows: 0,
    changedRosterRows: 0,
    excusedRowsMigrated: 0,
    classesWithEnabledStatusStripped: 0,
    perClass: []
  };

  for (const classRow of Array.isArray(classes) ? classes : []) {
    const classId = String(classRow?.id || '').trim();
    if (!classId) continue;
    summary.scannedClasses += 1;
    // eslint-disable-next-line no-await-in-loop
    const sessions = await schoolDataService.getClassSessions(classId, null);
    const result = migrateClassDocument({ ...classRow, sessions });
    summary.scannedRosterRows += result.scannedRosterRows;
    summary.changedRosterRows += result.changedRosterRows;
    summary.excusedRowsMigrated += result.excusedRowsMigrated;
    if (result.enabledStatusesStripped) summary.classesWithEnabledStatusStripped += 1;
    if (!result.changed) continue;
    summary.changedClasses += 1;
    summary.perClass.push({
      classId,
      orgId: String(classRow?.orgId || '').trim(),
      title: String(classRow?.title || '').trim(),
      changedRosterRows: result.changedRosterRows,
      excusedRowsMigrated: result.excusedRowsMigrated,
      enabledStatusesStripped: result.enabledStatusesStripped
    });
    if (apply) {
      // eslint-disable-next-line no-await-in-loop
      await schoolDataService.saveClassSessions(classId, result.classRow.sessions, null);
      if (result.enabledStatusesStripped) {
        // eslint-disable-next-line no-await-in-loop
        await schoolDataService.updateData('classes', classId, {
          enabledAttendanceStatuses: result.classRow.enabledAttendanceStatuses
        }, null);
      }
    }
  }

  return summary;
}

async function runMongoMigration({ apply = false, orgId = '' } = {}) {
  const collection = getMongoCollection('schoolClasses');
  const query = orgId ? { orgId } : {};
  const cursor = collection.find(query);
  const summary = {
    scannedClasses: 0,
    changedClasses: 0,
    scannedRosterRows: 0,
    changedRosterRows: 0,
    excusedRowsMigrated: 0,
    classesWithEnabledStatusStripped: 0,
    perClass: []
  };

  while (await cursor.hasNext()) {
    const classRow = await cursor.next();
    summary.scannedClasses += 1;
    const result = migrateClassDocument(classRow);
    summary.scannedRosterRows += result.scannedRosterRows;
    summary.changedRosterRows += result.changedRosterRows;
    summary.excusedRowsMigrated += result.excusedRowsMigrated;
    if (result.enabledStatusesStripped) summary.classesWithEnabledStatusStripped += 1;
    if (!result.changed) continue;
    summary.changedClasses += 1;
    summary.perClass.push({
      classId: String(classRow?.id || classRow?._id || '').trim(),
      orgId: String(classRow?.orgId || '').trim(),
      title: String(classRow?.title || '').trim(),
      changedRosterRows: result.changedRosterRows,
      excusedRowsMigrated: result.excusedRowsMigrated,
      enabledStatusesStripped: result.enabledStatusesStripped
    });
    if (apply) {
      const update = {
        sessions: result.classRow.sessions,
        updatedAt: new Date().toISOString()
      };
      if (result.enabledStatusesStripped) {
        update.enabledAttendanceStatuses = result.classRow.enabledAttendanceStatuses;
      }
      // eslint-disable-next-line no-await-in-loop
      await collection.updateOne({ _id: classRow._id }, { $set: update });
    }
  }

  return summary;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const backendConfig = resolveDataBackendConfig(process.env, { preferredMode: args.backend || undefined });
  const resolved = { ...backendConfig, mode: args.backend || backendConfig.mode };
  setActiveDataBackendConfig(resolved);
  if (resolved.mode === 'mongo') {
    const uri = String(resolved?.mongo?.uri || '').trim();
    if (!uri) throw new Error('Mongo migration requires a configured Mongo URI.');
    await connectMongo({ uri });
  }

  const summary = resolved.mode === 'mongo'
    ? await runMongoMigration(args)
    : await runMigration(args);
  const report = {
    mode: args.apply ? 'apply' : 'dry_run',
    orgId: args.orgId || null,
    backend: resolved.mode,
    ...summary,
    modifiedRosterRows: args.apply ? summary.changedRosterRows : 0
  };
  console.log('[MigrateExcusedToAbsenceExcused] Completed.');
  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (require.main === module) {
  main()
    .then(async () => {
      await disconnectMongo().catch(() => {});
      process.exit(0);
    })
    .catch(async (error) => {
      await disconnectMongo().catch(() => {});
      console.error(`[MigrateExcusedToAbsenceExcused] Failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = {
  parseArgs,
  migrateRosterRow,
  migrateClassSessions,
  migrateClassDocument,
  runMigration,
  runMongoMigration,
  main
};
