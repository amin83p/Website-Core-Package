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
const { resolveDataBackendConfig } = require('../../../config/dataBackend');
const { setActiveDataBackendConfig } = require('../../../MVC/infrastructure/runtime/dataBackendRuntime');
const { connectMongo, disconnectMongo, getMongoCollection } = require('../../../MVC/infrastructure/mongo/mongoConnection');
const { normalizeMongoDocument } = require('../../../MVC/repositories/backend/mongoRepositoryUtils');
const statutoryHolidayWorkSessionService = require('../../../packages/school/MVC/services/school/statutoryHolidayWorkSessionService');
const statutoryHolidayEligibilityService = require('../../../packages/school/MVC/services/school/statutoryHolidayEligibilityService');
const timesheetParametersPolicyService = require('../../../packages/school/MVC/services/school/timesheetParametersPolicyService');
const activityService = require('../../../packages/school/MVC/services/school/activityService');

const REQ_USER = { id: 'MAINTENANCE', activeOrgId: '', scope: { canViewAll: true } };

function parseArgs(argv = []) {
  const flags = new Set(argv.filter((arg) => /^--/.test(arg)));
  const value = (name) => {
    const token = argv.find((arg) => String(arg || '').startsWith(`${name}=`));
    return token ? String(token.slice(name.length + 1)).trim() : '';
  };
  return {
    apply: flags.has('--apply'),
    orgId: value('--org'),
    activityId: value('--activity'),
    personId: value('--person'),
    personName: value('--person-name')
  };
}

async function resolvePolicyActivityId(orgId) {
  const collection = getMongoCollection('schoolTimesheetParametersPolicy');
  const doc = normalizeMongoDocument(await collection.findOne({ id: 'timesheet-parameters-policy' }));
  const row = doc?.byOrgId?.[orgId] || doc?.byOrgId?.SYSTEM || {};
  const policy = timesheetParametersPolicyService.resolvePolicy(
    timesheetParametersPolicyService.normalizePolicyFromStored(row)
  );
  return statutoryHolidayEligibilityService.resolveStatHolidayActivityId(policy);
}

async function findActivityCandidates(orgId, activityId = '') {
  const collection = getMongoCollection('schoolActivities');
  if (activityId) {
    const row = normalizeMongoDocument(await collection.findOne({ id: activityId, orgId }));
    return row ? [row] : [];
  }
  const rows = await collection.find({
    orgId,
    title: { $regex: /statutory holiday/i }
  }).toArray();
  return rows.map((row) => normalizeMongoDocument(row));
}

async function findPersonIdByName(orgId, personName = '') {
  const token = String(personName || '').trim().toLowerCase();
  if (!token) return '';
  const teachers = getMongoCollection('schoolTeachers');
  const staff = getMongoCollection('schoolStaff');
  const teacherRows = await teachers.find({ orgId }).toArray();
  for (const row of teacherRows) {
    const doc = normalizeMongoDocument(row);
    const haystack = [
      doc?.displayName,
      doc?.name,
      `${doc?.firstName || ''} ${doc?.lastName || ''}`,
      doc?.person?.displayName
    ].join(' ').toLowerCase();
    if (haystack.includes(token)) return String(doc?.id || doc?.personId || '').trim();
  }
  const staffRows = await staff.find({ orgId }).toArray();
  for (const row of staffRows) {
    const doc = normalizeMongoDocument(row);
    const haystack = [
      doc?.displayName,
      doc?.name,
      `${doc?.firstName || ''} ${doc?.lastName || ''}`,
      doc?.person?.displayName
    ].join(' ').toLowerCase();
    if (haystack.includes(token)) return String(doc?.id || doc?.personId || '').trim();
  }
  return '';
}

function summarizeAssignees(activity) {
  const entries = activityService.getActivityEntries(activity);
  const summary = [];
  entries.forEach((entry) => {
    const assignees = activityService.normalizeActivityAssigneeRows(entry.assignees);
    assignees.forEach((assignee) => {
      summary.push({
        date: entry?.date,
        personId: assignee?.personId,
        personName: assignee?.personName,
        paidHours: assignee?.paidHours,
        statHolidayId: assignee?.statHolidayId || entry?.statHolidayId,
        statHolidayPeriodId: assignee?.statHolidayPeriodId
      });
    });
  });
  return summary;
}

async function main(argv = process.argv.slice(2)) {
  loadEnv();
  const args = parseArgs(argv);
  const backendConfig = resolveDataBackendConfig(process.env);
  setActiveDataBackendConfig(backendConfig);
  if (backendConfig.mode !== 'mongo') {
    throw new Error('This maintenance script requires DATA_BACKEND=mongo.');
  }
  await connectMongo({ uri: backendConfig.mongo.uri });

  const orgId = args.orgId || process.env.SCHOOL_MAINTENANCE_ORG_ID || '';
  if (!orgId) throw new Error('Provide --org=<orgId>.');

  REQ_USER.activeOrgId = orgId;
  const policyActivityId = await resolvePolicyActivityId(orgId);
  const activityId = args.activityId || policyActivityId;
  const candidates = await findActivityCandidates(orgId, activityId);
  if (!candidates.length) {
    throw new Error(`No statutory holiday activity found for org ${orgId}.`);
  }

  let personId = args.personId;
  if (!personId && args.personName) {
    personId = await findPersonIdByName(orgId, args.personName);
    if (!personId) throw new Error(`Could not resolve person id for name "${args.personName}".`);
  }

  const reports = [];
  for (const candidate of candidates) {
    const before = summarizeAssignees(candidate);
    const report = {
      activityId: candidate.id,
      title: candidate.title,
      beforeCount: before.length,
      before,
      personId: personId || null
    };
    if (args.apply) {
      const outcome = await statutoryHolidayWorkSessionService.cleanupStatHolidayActivityAssignees({
        orgId,
        activityId: candidate.id,
        personId,
        reqUser: REQ_USER
      });
      const refreshed = await activityService.getActivity(candidate.id, REQ_USER);
      report.outcome = outcome;
      report.afterCount = summarizeAssignees(refreshed).length;
    }
    reports.push(report);
  }

  console.log('[CleanStatutoryHolidayActivityAssignees] Completed.');
  console.log(JSON.stringify({
    mode: args.apply ? 'apply' : 'dry_run',
    orgId,
    activityId: activityId || null,
    personId: personId || null,
    reports
  }, null, 2));
  return reports;
}

if (require.main === module) {
  main()
    .then(async () => {
      await disconnectMongo().catch(() => {});
      process.exit(0);
    })
    .catch(async (error) => {
      await disconnectMongo().catch(() => {});
      console.error(`[CleanStatutoryHolidayActivityAssignees] Failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = { parseArgs, main };
