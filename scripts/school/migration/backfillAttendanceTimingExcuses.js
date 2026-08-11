/* eslint-disable no-console */
const { resolveDataBackendConfig } = require('../../../config/dataBackend');
const { setActiveDataBackendConfig } = require('../../../MVC/infrastructure/runtime/dataBackendRuntime');
const { connectMongo, disconnectMongo } = require('../../../MVC/infrastructure/mongo/mongoConnection');
const schoolDataService = require('../../../packages/school/MVC/services/school/schoolDataService');

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

function parseNonNegativeMinutes(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function backfillRosterRow(row = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return { row, changed: false };
  }
  const next = { ...row };
  let changed = false;

  if (parseNonNegativeMinutes(next.lateMinutes) > 0 && next.lateExcused === undefined) {
    next.lateExcused = false;
    changed = true;
  }
  if (parseNonNegativeMinutes(next.earlyLeaveMinutes) > 0 && next.earlyLeaveExcused === undefined) {
    next.earlyLeaveExcused = false;
    changed = true;
  }

  return { row: changed ? next : row, changed };
}

function backfillClassSessions(sessions = []) {
  let scannedRosterRows = 0;
  let changedRosterRows = 0;
  const nextSessions = (Array.isArray(sessions) ? sessions : []).map((session) => {
    const roster = Array.isArray(session?.roster) ? session.roster : [];
    let sessionChanged = false;
    const nextRoster = roster.map((row) => {
      scannedRosterRows += 1;
      const result = backfillRosterRow(row);
      if (result.changed) {
        changedRosterRows += 1;
        sessionChanged = true;
      }
      return result.row;
    });
    return sessionChanged ? { ...session, roster: nextRoster } : session;
  });

  return {
    sessions: nextSessions,
    scannedRosterRows,
    changedRosterRows
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

async function runBackfill({ apply = false, orgId = '' } = {}) {
  const classes = await listClasses({ orgId });
  const summary = {
    scannedClasses: 0,
    changedClasses: 0,
    scannedRosterRows: 0,
    changedRosterRows: 0
  };

  for (const classRow of Array.isArray(classes) ? classes : []) {
    const classId = String(classRow?.id || '').trim();
    if (!classId) continue;
    summary.scannedClasses += 1;
    // eslint-disable-next-line no-await-in-loop
    const sessions = await schoolDataService.getClassSessions(classId, null);
    const result = backfillClassSessions(sessions);
    summary.scannedRosterRows += result.scannedRosterRows;
    summary.changedRosterRows += result.changedRosterRows;
    if (!result.changedRosterRows) continue;
    summary.changedClasses += 1;
    if (apply) {
      // eslint-disable-next-line no-await-in-loop
      await schoolDataService.saveClassSessions(classId, result.sessions, null);
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
    if (!uri) throw new Error('Mongo backfill requires a configured Mongo URI.');
    await connectMongo({ uri });
  }

  const summary = await runBackfill(args);
  const report = {
    mode: args.apply ? 'apply' : 'dry_run',
    orgId: args.orgId || null,
    backend: resolved.mode,
    ...summary,
    modifiedRosterRows: args.apply ? summary.changedRosterRows : 0
  };
  console.log('[BackfillAttendanceTimingExcuses] Completed.');
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
      console.error(`[BackfillAttendanceTimingExcuses] Failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = {
  parseArgs,
  backfillRosterRow,
  backfillClassSessions,
  runBackfill,
  main
};
