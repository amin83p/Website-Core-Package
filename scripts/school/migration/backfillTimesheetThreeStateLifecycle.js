/* eslint-disable no-console */
const fs = require('fs').promises;
const path = require('path');
const { resolveDataBackendConfig } = require('../../../config/dataBackend');
const { setActiveDataBackendConfig } = require('../../../MVC/infrastructure/runtime/dataBackendRuntime');
const { connectMongo, disconnectMongo, getMongoCollection } = require('../../../MVC/infrastructure/mongo/mongoConnection');

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

function buildTimesheetLifecycleBackfillPatch(row = {}) {
  const status = String(row?.status || '').trim().toLowerCase();
  if (status !== 'approved') return null;
  const reviewVersion = Math.max(
    1,
    Number.parseInt(String(row?.reviewVersion || row?.submissionSnapshot?.reviewVersion || 0), 10) || 0
  );
  const reviewedAt = String(row?.approvedAt || row?.audit?.lastUpdateDateTime || row?.submissionSnapshot?.submittedAt || '').trim();
  const reviewedBy = String(row?.approvedBy || row?.audit?.lastUpdateUser || '').trim();
  return {
    status: 'submitted',
    reviewVersion,
    managerReview: {
      status: 'approved',
      reviewVersion,
      ...(reviewedAt ? { reviewedAt } : {}),
      ...(reviewedBy ? { reviewedBy } : {})
    },
    ...(row?.submissionSnapshot && typeof row.submissionSnapshot === 'object'
      ? {
          submissionSnapshot: {
            ...row.submissionSnapshot,
            reviewVersion,
            lastModifiedAt: String(row.submissionSnapshot.lastModifiedAt || reviewedAt || row.submissionSnapshot.submittedAt || '')
          }
        }
      : {})
  };
}

async function runJson({ apply, orgId }) {
  const dataPath = path.join(__dirname, '../../../data/school/timesheets.json');
  let rows = [];
  try {
    rows = JSON.parse(await fs.readFile(dataPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let candidates = 0;
  const nextRows = (Array.isArray(rows) ? rows : []).map((row) => {
    if (orgId && String(row?.orgId || '') !== orgId) return row;
    const patch = buildTimesheetLifecycleBackfillPatch(row);
    if (!patch) return row;
    candidates += 1;
    return { ...row, ...patch };
  });
  if (apply && candidates) await fs.writeFile(dataPath, `${JSON.stringify(nextRows, null, 2)}\n`, 'utf8');
  return { backend: 'json', scanned: rows.length, candidates, modified: apply ? candidates : 0 };
}

async function runMongo({ apply, orgId }, backend) {
  const uri = String(backend?.mongo?.uri || '').trim();
  if (!uri) throw new Error('Mongo backfill requires a configured Mongo URI.');
  await connectMongo({ uri });
  const collection = getMongoCollection('schoolTimesheets');
  const filter = { status: 'approved', ...(orgId ? { orgId } : {}) };
  const rows = await collection.find(filter).toArray();
  const operations = rows.map((row) => ({
    updateOne: {
      filter: { _id: row._id },
      update: { $set: buildTimesheetLifecycleBackfillPatch(row) }
    }
  }));
  let modified = 0;
  if (apply && operations.length) {
    const result = await collection.bulkWrite(operations, { ordered: false });
    modified = Number(result?.modifiedCount || 0);
  }
  return { backend: 'mongo', scanned: rows.length, candidates: operations.length, modified };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const backendConfig = resolveDataBackendConfig(process.env, { preferredMode: args.backend || undefined });
  const resolved = { ...backendConfig, mode: args.backend || backendConfig.mode };
  setActiveDataBackendConfig(resolved);
  const summary = resolved.mode === 'mongo'
    ? await runMongo(args, resolved)
    : await runJson(args);
  const report = { mode: args.apply ? 'apply' : 'dry_run', orgId: args.orgId || null, ...summary };
  console.log('[BackfillTimesheetThreeStateLifecycle] Completed.');
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
      console.error(`[BackfillTimesheetThreeStateLifecycle] Failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = {
  parseArgs,
  buildTimesheetLifecycleBackfillPatch,
  main
};
