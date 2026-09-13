/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { resolveDataBackendConfig } = require('../../../config/dataBackend');
const { setActiveDataBackendConfig } = require('../../../MVC/infrastructure/runtime/dataBackendRuntime');
const { connectMongo, disconnectMongo, getMongoCollection } = require('../../../MVC/infrastructure/mongo/mongoConnection');
const { normalizeMongoDocument, resolveMongoIdFilter } = require('../../../MVC/repositories/backend/mongoRepositoryUtils');
const schoolDataService = require('../../../packages/school/MVC/services/school/schoolDataService');
const activityService = require('../../../packages/school/MVC/services/school/activityService');
const activityAssigneeTimingService = require('../../../packages/school/MVC/services/school/activityAssigneeTimingService');

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

function backfillActivityDocument(activity = {}) {
  let scannedAssignees = 0;
  let changedAssignees = 0;
  const entries = activityService.getActivityEntries(activity).map((entry) => {
    const assignees = activityService.normalizeActivityAssigneeRows(entry.assignees);
    let entryChanged = false;
    const nextAssignees = assignees.map((assignee) => {
      scannedAssignees += 1;
      if (activityAssigneeTimingService.assigneeTimingMatchesRule(assignee, entry)) {
        return assignee;
      }
      changedAssignees += 1;
      entryChanged = true;
      return activityAssigneeTimingService.backfillAssigneeTiming(assignee, entry);
    });
    return entryChanged ? { ...entry, assignees: nextAssignees } : entry;
  });
  const changed = changedAssignees > 0;
  return {
    activity: changed ? { ...activity, entries } : activity,
    scannedAssignees,
    changedAssignees,
    changed
  };
}

async function listActivities({ orgId }) {
  const query = {
    page: 1,
    limit: 10000,
    ...(orgId ? { orgId__eq: orgId } : {})
  };
  return schoolDataService.fetchData('activities', query, null, { includeVoided: true });
}

async function runJsonBackfill({ apply = false, orgId = '' } = {}) {
  const activities = await listActivities({ orgId });
  const summary = {
    scannedActivities: 0,
    changedActivities: 0,
    scannedAssignees: 0,
    changedAssignees: 0
  };

  for (const activity of Array.isArray(activities) ? activities : []) {
    const activityId = String(activity?.id || '').trim();
    if (!activityId) continue;
    summary.scannedActivities += 1;
    const result = backfillActivityDocument(activity);
    summary.scannedAssignees += result.scannedAssignees;
    summary.changedAssignees += result.changedAssignees;
    if (!result.changed) continue;
    summary.changedActivities += 1;
    if (apply) {
      // eslint-disable-next-line no-await-in-loop
      await schoolDataService.updateData('activities', activityId, {
        ...result.activity,
        entries: result.activity.entries,
        attendees: activityService.flattenActivityAssignees(result.activity.entries)
      }, null);
    }
  }

  return summary;
}

async function runMongoBackfill({ apply = false, orgId = '' } = {}) {
  const collection = getMongoCollection('schoolActivities');
  const query = orgId ? { orgId } : {};
  const cursor = collection.find(query);
  const summary = {
    scannedActivities: 0,
    changedActivities: 0,
    scannedAssignees: 0,
    changedAssignees: 0
  };

  while (await cursor.hasNext()) {
    const activity = normalizeMongoDocument(await cursor.next());
    summary.scannedActivities += 1;
    const result = backfillActivityDocument(activity);
    summary.scannedAssignees += result.scannedAssignees;
    summary.changedAssignees += result.changedAssignees;
    if (!result.changed) continue;
    summary.changedActivities += 1;
    if (apply) {
      // eslint-disable-next-line no-await-in-loop
      const updateResult = await collection.updateOne(
        resolveMongoIdFilter(activity.id),
        {
          $set: {
            entries: result.activity.entries,
            attendees: activityService.flattenActivityAssignees(result.activity.entries),
            updatedAt: new Date().toISOString()
          }
        }
      );
      if (!updateResult?.matchedCount) {
        throw new Error(`Failed to update activity ${activity.id}: no matching document.`);
      }
    }
  }

  return summary;
}

async function main(argv = process.argv.slice(2)) {
  loadEnv();
  const args = parseArgs(argv);
  const backendConfig = resolveDataBackendConfig(process.env, { preferredMode: args.backend || undefined });
  const resolved = { ...backendConfig, mode: args.backend || backendConfig.mode };
  setActiveDataBackendConfig(resolved);
  if (resolved.mode === 'mongo') {
    const uri = String(resolved?.mongo?.uri || '').trim();
    if (!uri) throw new Error('Mongo backfill requires a configured Mongo URI.');
    await connectMongo({ uri });
  }

  const summary = resolved.mode === 'mongo'
    ? await runMongoBackfill(args)
    : await runJsonBackfill(args);
  const report = {
    mode: args.apply ? 'apply' : 'dry_run',
    orgId: args.orgId || null,
    backend: resolved.mode,
    ...summary,
    modifiedAssignees: args.apply ? summary.changedAssignees : 0
  };
  console.log('[BackfillActivityAssigneeTiming] Completed.');
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
      console.error(`[BackfillActivityAssigneeTiming] Failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = {
  parseArgs,
  backfillActivityDocument,
  runJsonBackfill,
  runMongoBackfill,
  main
};
