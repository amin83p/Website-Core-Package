/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.resolve(__dirname, '../..');
const PAYLOAD_WARN_CHARS = 15000;

function loadLocalEnvFile() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) return;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) return;
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
}

function inferDbName(uri) {
  try {
    return new URL(uri).pathname.replace(/^\//, '').split('/')[0] || '';
  } catch (_) {
    return '';
  }
}

function resolveDataBackendMode() {
  const mode = String(process.env.DATA_BACKEND || 'json').trim().toLowerCase();
  return mode === 'mongo' ? 'mongo' : 'json';
}

async function bootstrapDataBackend() {
  if (resolveDataBackendMode() !== 'mongo') {
    return { disconnect: async () => {} };
  }
  const { connectMongo, disconnectMongo } = require('../../MVC/infrastructure/mongo/mongoConnection');
  const uri = String(process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();
  if (!uri) {
    throw new Error('DATA_BACKEND=mongo but no MONGODB_URI (or legacy MONGO_URI) is configured.');
  }
  const dbName = String(
    process.env.MONGODB_DB
    || process.env.MONGO_DB
    || inferDbName(uri)
    || 'app'
  ).trim();
  await connectMongo({ uri, dbName });
  return {
    disconnect: async () => {
      await disconnectMongo().catch(() => {});
    }
  };
}

function parseArgs(argv = []) {
  const orgIdArg = argv.find((value) => String(value || '').startsWith('--org-id='));
  return {
    help: argv.includes('--help') || argv.includes('-h'),
    json: argv.includes('--json'),
    orgId: orgIdArg ? String(orgIdArg).slice('--org-id='.length).trim() : ''
  };
}

function printHelp() {
  console.log('School ID integrity audit (read-only)');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/school/audit-school-id-integrity.js --org-id=ORG_ID [--json]');
  console.log('');
  console.log('Reports duplicate session/class/timesheet/activity/MAN IDs and oversized class payloads.');
}

function cleanId(value) {
  return String(value || '').trim();
}

function groupDuplicateIds(rows = [], getId) {
  const buckets = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const id = cleanId(typeof getId === 'function' ? getId(row) : row?.id);
    if (!id) return;
    if (!buckets.has(id)) buckets.set(id, []);
    buckets.get(id).push(row);
  });
  return Array.from(buckets.entries())
    .filter(([, group]) => group.length > 1)
    .map(([id, group]) => ({ id, count: group.length, sample: group.slice(0, 3) }));
}

function auditClassSessions(classRow, sessionIdService) {
  const classId = cleanId(classRow?.id);
  const sessions = Array.isArray(classRow?.sessions) ? classRow.sessions : [];
  const duplicateSessionIds = sessionIdService.findDuplicateSessionIds(sessions);
  const nonClassScoped = sessions
    .map((row) => sessionIdService.resolveSessionId(row))
    .filter((sessionId) => sessionId && !sessionIdService.isClassScopedSessionId(sessionId, classId));
  return {
    classId,
    classTitle: String(classRow?.title || classId).trim(),
    sessionCount: sessions.length,
    duplicateSessionIds,
    nonClassScopedCount: nonClassScoped.length,
    nonClassScopedSample: nonClassScoped.slice(0, 5)
  };
}

function estimateClassPayloadSizes(classRow) {
  const classId = cleanId(classRow?.id);
  const fields = {
    sessions: classRow?.sessions,
    curriculum: classRow?.curriculum,
    enrollment: classRow?.enrollment,
    instructors: classRow?.instructors,
    pricing: classRow?.pricing,
    evaluation: classRow?.evaluation
  };
  const oversized = [];
  Object.entries(fields).forEach(([field, value]) => {
    if (value === undefined || value === null) return;
    const size = JSON.stringify(value).length;
    if (size >= PAYLOAD_WARN_CHARS) {
      oversized.push({ field, chars: size });
    }
  });
  return oversized.length ? { classId, classTitle: String(classRow?.title || classId).trim(), oversized } : null;
}

function auditActivityEntries(activityRow) {
  const activityId = cleanId(activityRow?.id);
  const entries = Array.isArray(activityRow?.entries) ? activityRow.entries : [];
  const entryIds = entries.map((row) => cleanId(row?.entryId || row?.id)).filter(Boolean);
  const buckets = new Map();
  entryIds.forEach((entryId) => {
    buckets.set(entryId, (buckets.get(entryId) || 0) + 1);
  });
  const duplicates = Array.from(buckets.entries())
    .filter(([, count]) => count > 1)
    .map(([entryId, count]) => ({ entryId, count }));
  if (!duplicates.length) return null;
  return {
    activityId,
    title: String(activityRow?.title || activityId).trim(),
    duplicates
  };
}

function collectManSessionIds(timesheets = []) {
  const manIds = [];
  (Array.isArray(timesheets) ? timesheets : []).forEach((timesheet) => {
    const entries = Array.isArray(timesheet?.entries) ? timesheet.entries : [];
    entries.forEach((entry) => {
      const sessionId = cleanId(entry?.sessionId || entry?.materializedSessionId);
      if (sessionId.startsWith('MAN_') || sessionId.startsWith('MAN-')) {
        manIds.push({ sessionId, timesheetId: cleanId(timesheet?.id), classId: cleanId(entry?.classId) });
      }
    });
  });
  return manIds;
}

async function auditOrg(orgId) {
  const sessionIdService = require('../../packages/school/MVC/services/school/sessionIdService');
  const schoolDataService = require('../../packages/school/MVC/services/school/schoolDataService');
  const maintenanceUser = { id: 'SYS_AUDIT', activeOrgId: orgId };
  const accessContext = { scopeId: 'SCP_ORG' };

  const [classes, timesheets, activities] = await Promise.all([
    schoolDataService.fetchData('classes', { orgId__eq: orgId, page: 1, limit: 10000 }, maintenanceUser, accessContext),
    schoolDataService.fetchData('timesheets', { orgId__eq: orgId, page: 1, limit: 10000 }, maintenanceUser, accessContext),
    schoolDataService.fetchData('activities', { orgId__eq: orgId, page: 1, limit: 10000 }, maintenanceUser, accessContext)
  ]);

  const classRows = Array.isArray(classes) ? classes : [];
  const sessionAudits = classRows.map((row) => auditClassSessions(row, sessionIdService));
  const classesWithDuplicateSessions = sessionAudits.filter((row) => row.duplicateSessionIds.length > 0);
  const classesWithLegacySessions = sessionAudits.filter((row) => row.nonClassScopedCount > 0);
  const oversizedClassPayloads = classRows
    .map(estimateClassPayloadSizes)
    .filter(Boolean);

  const duplicateClassIds = groupDuplicateIds(classRows, (row) => row?.id);
  const duplicateTimesheetIds = groupDuplicateIds(timesheets, (row) => row?.id);
  const duplicateActivityIds = groupDuplicateIds(activities, (row) => row?.id);

  const manRows = collectManSessionIds(timesheets);
  const duplicateManIds = groupDuplicateIds(manRows, (row) => row?.sessionId);

  const activityEntryAudits = (Array.isArray(activities) ? activities : [])
    .map(auditActivityEntries)
    .filter(Boolean);

  return {
    orgId,
    scanned: {
      classes: classRows.length,
      timesheets: Array.isArray(timesheets) ? timesheets.length : 0,
      activities: Array.isArray(activities) ? activities.length : 0
    },
    classesWithDuplicateSessions: classesWithDuplicateSessions.map((row) => ({
      classId: row.classId,
      classTitle: row.classTitle,
      duplicateSessionIds: row.duplicateSessionIds
    })),
    classesWithLegacySessions: classesWithLegacySessions.map((row) => ({
      classId: row.classId,
      classTitle: row.classTitle,
      nonClassScopedCount: row.nonClassScopedCount,
      nonClassScopedSample: row.nonClassScopedSample
    })),
    duplicateClassIds,
    duplicateTimesheetIds,
    duplicateActivityIds,
    duplicateManSessionIds: duplicateManIds,
    manSessionCount: manRows.length,
    activitiesWithDuplicateEntries: activityEntryAudits,
    oversizedClassPayloads,
    issueCount: (
      classesWithDuplicateSessions.length
      + classesWithLegacySessions.length
      + duplicateClassIds.length
      + duplicateTimesheetIds.length
      + duplicateActivityIds.length
      + duplicateManIds.length
      + activityEntryAudits.length
      + oversizedClassPayloads.length
    )
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.orgId) {
    printHelp();
    throw new Error('--org-id is required.');
  }

  loadLocalEnvFile();
  process.chdir(ROOT_DIR);

  const backend = await bootstrapDataBackend();
  try {
    const report = await auditOrg(args.orgId);

    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(`School ID integrity audit for org ${args.orgId}`);
    console.log(`Scanned: ${report.scanned.classes} classes, ${report.scanned.timesheets} timesheets, ${report.scanned.activities} activities`);
    console.log(`Total issue buckets: ${report.issueCount}`);
    console.log('');
    console.log(`Classes with duplicate session IDs: ${report.classesWithDuplicateSessions.length}`);
    report.classesWithDuplicateSessions.forEach((row) => {
      console.log(`  - ${row.classId} (${row.classTitle}): ${row.duplicateSessionIds.join(', ')}`);
    });
    console.log(`Classes with non-class-scoped session IDs: ${report.classesWithLegacySessions.length}`);
    report.classesWithLegacySessions.forEach((row) => {
      console.log(`  - ${row.classId} (${row.classTitle}): ${row.nonClassScopedCount} legacy id(s)`);
    });
    console.log(`Duplicate class IDs: ${report.duplicateClassIds.length}`);
    console.log(`Duplicate timesheet IDs: ${report.duplicateTimesheetIds.length}`);
    console.log(`Duplicate activity IDs: ${report.duplicateActivityIds.length}`);
    console.log(`Manual session IDs (MAN_*): ${report.manSessionCount} total, ${report.duplicateManSessionIds.length} duplicate id bucket(s)`);
    console.log(`Activities with duplicate entry IDs: ${report.activitiesWithDuplicateEntries.length}`);
    report.activitiesWithDuplicateEntries.forEach((row) => {
      console.log(`  - ${row.activityId} (${row.title}): ${row.duplicates.map((d) => `${d.entryId}×${d.count}`).join(', ')}`);
    });
    console.log(`Oversized class payloads (>=${PAYLOAD_WARN_CHARS} chars): ${report.oversizedClassPayloads.length}`);
    report.oversizedClassPayloads.forEach((row) => {
      console.log(`  - ${row.classId} (${row.classTitle}): ${row.oversized.map((f) => `${f.field}=${f.chars}`).join(', ')}`);
    });
  } finally {
    await backend.disconnect();
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
