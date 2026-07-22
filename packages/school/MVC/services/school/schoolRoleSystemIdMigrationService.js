const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { requireCoreModule, resolveCoreRoot } = require('./schoolCoreModuleResolver');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { runByRepositoryBackend } = requireCoreModule('MVC/repositories/backend/repositoryBackendSelector');
const { getMongoCollection, withMongoTransaction, getMongoTransactionCapability } = requireCoreModule('MVC/infrastructure/mongo/mongoConnection');
const { generateRoleSystemIdCandidate } = require('./roleSystemIdGenerator');

const DATA_DIR = path.join(resolveCoreRoot(), 'data/school');
const ID_PATTERN = /^(TCH|STF)\d{5}$/;
const ROLE_CONFIG = Object.freeze({
  teacher: { prefix: 'TCH', entityFile: 'teachers.json', collection: 'schoolTeachers', label: 'Teacher', accountField: 'teacherAccountId', accountCodePrefix: 'TCH_', redirectBase: '/school/teachers/edit/' },
  staff: { prefix: 'STF', entityFile: 'staff.json', collection: 'schoolStaff', label: 'Staff', accountField: 'staffAccountId', accountCodePrefix: 'STF_', redirectBase: '/school/staff/edit/' }
});
const REFERENCE_REGISTRY = Object.freeze([
  { key: 'accounts', file: 'accounts.json', collection: 'schoolAccounts' },
  { key: 'classes', file: 'classes.json', collection: 'schoolClasses' },
  { key: 'activities', file: 'activities.json', collection: 'schoolActivities' },
  { key: 'tasks', file: 'tasks.json', collection: 'schoolTasks' },
  { key: 'leaveRequests', file: 'leaveRequests.json', collection: 'schoolLeaveRequests' },
  { key: 'sessionStudentCases', file: 'sessionStudentCases.json', collection: 'schoolSessionStudentCases' },
  { key: 'timesheets', file: 'timesheets.json', collection: 'schoolTimesheets' },
  { key: 'payRates', file: 'payRates.json', collection: 'schoolPayRates' },
  { key: 'reportAssignments', file: 'reportAssignments.json', collection: 'schoolReportAssignments' },
  { key: 'reportInstances', file: 'reportInstances.json', collection: 'schoolReportInstances' },
  { key: 'teacherSchedules', file: 'teacher_schedules.json', collection: 'schoolTeacherSchedules' }
]);
const REFERENCE_KEYS = Object.freeze({
  teacher: new Set(['teacherId', 'teacherIds', 'teacherPersonId', 'deliveredBy', 'substituteTeacherId', 'personId', 'assignedPersonId', 'targetPersonId']),
  staff: new Set(['staffId', 'staffIds', 'staffPersonId', 'requesterPersonId', 'personId', 'assignedPersonId', 'targetPersonId'])
});
const generateCandidate = generateRoleSystemIdCandidate;

function configFor(roleType) {
  const config = ROLE_CONFIG[String(roleType || '').trim().toLowerCase()];
  if (!config) throw new Error('Unsupported School role ID migration type.');
  return config;
}

function idsEqual(a, b) { return String(a || '') === String(b || ''); }
function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date || value._bsontype || typeof value.toHexString === 'function') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}

function transformValue(value, roleType, oldId, newId, countRef) {
  if (Array.isArray(value)) return value.map((item) => transformValue(item, roleType, oldId, newId, countRef));
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date || value._bsontype || typeof value.toHexString === 'function') return value;
  const allowed = REFERENCE_KEYS[roleType];
  const output = {};
  for (const [key, raw] of Object.entries(value)) {
    if (allowed.has(key) && idsEqual(raw, oldId)) {
      output[key] = newId;
      countRef.count += 1;
    } else if (allowed.has(key) && Array.isArray(raw)) {
      output[key] = raw.map((item) => {
        if (!idsEqual(item, oldId)) return transformValue(item, roleType, oldId, newId, countRef);
        countRef.count += 1;
        return newId;
      });
    } else {
      output[key] = transformValue(raw, roleType, oldId, newId, countRef);
    }
  }
  return output;
}

function transformDataset(key, value, roleType, oldId, newId, orgId, sourceRole) {
  const config = configFor(roleType);
  const countRef = { count: 0 };
  let output = clone(value);
  if (key === roleType) {
    output = (Array.isArray(output) ? output : []).map((row) => {
      if (!idsEqual(row?.id, oldId) || !idsEqual(row?.orgId, orgId)) return row;
      countRef.count += 1;
      return { ...row, id: newId };
    });
    return { value: output, count: countRef.count };
  }
  if (key === 'accounts') {
    const linkedAccountId = String(sourceRole?.[config.accountField] || '');
    output = (Array.isArray(output) ? output : []).map((row) => {
      if (!linkedAccountId || !idsEqual(row?.id, linkedAccountId) || !idsEqual(row?.orgId, orgId)) return row;
      const next = { ...row };
      const oldCode = config.accountCodePrefix + oldId;
      if (String(next.code || '') === oldCode) { next.code = config.accountCodePrefix + newId; countRef.count += 1; }
      const descriptionPatterns = roleType === 'teacher'
        ? [[`Auto-created for teacher ${oldId}.`, `Auto-created for teacher ${newId}.`]]
        : [
            [`Auto-created for staff ${oldId}.`, `Auto-created for staff ${newId}.`],
            [`Auto-created for generated sample staff ${oldId}.`, `Auto-created for generated sample staff ${newId}.`]
          ];
      const descriptionMatch = descriptionPatterns.find(([before]) => String(next.description || '') === before);
      if (descriptionMatch) {
        next.description = descriptionMatch[1];
        countRef.count += 1;
      }
      return next;
    });
    return { value: output, count: countRef.count };
  }
  if (Array.isArray(output)) {
    output = output.map((row) => {
      const rowOrgId = row?.orgId ?? row?.organizationId;
      if (rowOrgId && !idsEqual(rowOrgId, orgId)) return row;
      return transformValue(row, roleType, oldId, newId, countRef);
    });
  } else if (key !== 'teacherSchedules') {
    const rowOrgId = output?.orgId ?? output?.organizationId;
    if (!rowOrgId || idsEqual(rowOrgId, orgId)) output = transformValue(output, roleType, oldId, newId, countRef);
  }
  if (key === 'teacherSchedules' && output && !Array.isArray(output) && typeof output === 'object' && Object.prototype.hasOwnProperty.call(output, oldId)) {
    output[newId] = output[oldId];
    delete output[oldId];
    countRef.count += 1;
  }
  return { value: output, count: countRef.count };
}

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(path.join(DATA_DIR, file), 'utf8') || '[]'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

async function loadJson(roleType) {
  const config = configFor(roleType);
  const entries = [{ key: roleType, file: config.entityFile }, ...REFERENCE_REGISTRY];
  const datasets = {};
  for (const entry of entries) datasets[entry.key] = await readJson(entry.file);
  return { entries, datasets };
}

function preflight(rows, roleType, oldId, newId, orgId) {
  const config = configFor(roleType);
  if (!oldId || !newId) throw new Error('Current and replacement System Record IDs are required.');
  if (oldId === newId) throw new Error('The replacement System Record ID must be different.');
  if (!ID_PATTERN.test(newId) || !newId.startsWith(config.prefix)) throw new Error(`Use the ${config.prefix}##### System Record ID format.`);
  const source = (Array.isArray(rows) ? rows : []).filter((row) => idsEqual(row?.id, oldId) && idsEqual(row?.orgId, orgId));
  if (source.length !== 1) throw new Error(`${config.label} not found in the active organization.`);
  if ((Array.isArray(rows) ? rows : []).some((row) => idsEqual(row?.id, newId))) throw new Error('The requested System Record ID already exists.');
  return source[0];
}

function buildChanges(entries, datasets, roleType, oldId, newId, orgId, sourceRole) {
  const counts = {};
  const changed = {};
  for (const entry of entries) {
    const result = transformDataset(entry.key, datasets[entry.key], roleType, oldId, newId, orgId, sourceRole);
    counts[entry.key] = result.count;
    changed[entry.key] = result.value;
  }
  return { counts, totalUpdates: Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0), changed };
}

async function previewRoleSystemId({ roleType, oldId, orgId }) {
  return runByRepositoryBackend({}, {
    json: async () => { const loaded = await loadJson(roleType); const source = preflight(loaded.datasets[roleType], roleType, oldId, generateCandidate(roleType), orgId); const impact = buildChanges(loaded.entries, loaded.datasets, roleType, oldId, '__PREVIEW__', orgId, source); return { roleType, oldId, counts: impact.counts, totalUpdates: impact.totalUpdates }; },
    mongo: async () => {
      const loaded = await loadMongo(roleType);
      const source = preflight(loaded.datasets[roleType], roleType, oldId, generateCandidate(roleType), orgId);
      const impact = buildChanges(loaded.entries, loaded.datasets, roleType, oldId, '__PREVIEW__', orgId, source);
      return { roleType, oldId, counts: impact.counts, totalUpdates: impact.totalUpdates };
    }
  }, `school.${roleType}.systemId.preview`);
}

async function generateRoleSystemId(roleType) {
  const config = configFor(roleType);
  return runByRepositoryBackend({}, {
    json: async () => generateCandidate(roleType, new Set((await readJson(config.entityFile)).map((row) => String(row?.id || '')))),
    mongo: async () => generateCandidate(roleType, new Set((await getMongoCollection(config.collection).find({}, { projection: { id: 1 } }).toArray()).map((row) => String(row?.id || ''))))
  }, `school.${roleType}.systemId.generate`);
}

async function migrateJson(input) {
  return queueWrite(async () => {
    const loaded = await loadJson(input.roleType);
    const source = preflight(loaded.datasets[input.roleType], input.roleType, input.oldId, input.newId, input.orgId);
    const impact = buildChanges(loaded.entries, loaded.datasets, input.roleType, input.oldId, input.newId, input.orgId, source);
    const written = [];
    try {
      for (const entry of loaded.entries) {
        const target = path.join(DATA_DIR, entry.file);
        const temp = target + `.role-id-${process.pid}-${Date.now()}.tmp`;
        await fs.writeFile(temp, JSON.stringify(impact.changed[entry.key], null, 2));
        await fs.rename(temp, target);
        written.push(entry);
      }
      const verified = await loadJson(input.roleType);
      const rows = verified.datasets[input.roleType];
      if ((Array.isArray(rows) ? rows : []).filter((row) => idsEqual(row?.id, input.newId) && idsEqual(row?.orgId, input.orgId)).length !== 1) throw new Error('Post-migration verification failed.');
      const verifiedSource = (Array.isArray(rows) ? rows : []).find((row) => idsEqual(row?.id, input.newId) && idsEqual(row?.orgId, input.orgId));
      const remaining = buildChanges(verified.entries, verified.datasets, input.roleType, input.oldId, '__VERIFY__', input.orgId, verifiedSource);
      if (remaining.totalUpdates !== 0) throw new Error('Post-migration verification found remaining old-ID references.');
      const auditFile = path.join(DATA_DIR, 'schoolRoleSystemIdMigrations.json');
      const auditRows = await readJson('schoolRoleSystemIdMigrations.json');
      auditRows.push({ id: 'ROLEID-' + Date.now(), ...input, counts: impact.counts, totalUpdates: impact.totalUpdates, backend: 'json', transactionMode: 'file-rollback', status: 'success', createdAt: new Date().toISOString() });
      await fs.writeFile(auditFile, JSON.stringify(auditRows, null, 2));
      return resultPayload(input, impact, 'file-rollback', 'not_required');
    } catch (error) {
      for (const entry of written.reverse()) await fs.writeFile(path.join(DATA_DIR, entry.file), JSON.stringify(loaded.datasets[entry.key], null, 2)).catch(() => {});
      throw error;
    }
  });
}

async function loadMongo(roleType, session) {
  const config = configFor(roleType);
  const entries = [{ key: roleType, collection: config.collection }, ...REFERENCE_REGISTRY];
  const datasets = {};
  for (const entry of entries) datasets[entry.key] = await getMongoCollection(entry.collection).find({}, { session }).toArray();
  return { entries, datasets };
}

async function applyMongoChanges(loaded, impact, session, backups = []) {
  for (const entry of loaded.entries) {
    const beforeRows = loaded.datasets[entry.key];
    const afterRows = impact.changed[entry.key];
    for (let index = 0; index < beforeRows.length; index += 1) {
      if (JSON.stringify(beforeRows[index]) === JSON.stringify(afterRows[index])) continue;
      const after = { ...afterRows[index], _id: beforeRows[index]._id };
      backups.push({ collection: entry.collection, before: beforeRows[index], after });
      await getMongoCollection(entry.collection).replaceOne({ _id: beforeRows[index]._id }, after, session ? { session } : {});
    }
  }
}

function resultPayload(input, impact, transactionMode, rollbackStatus, migrationId = '') {
  const config = configFor(input.roleType);
  return { roleType: input.roleType, oldId: input.oldId, newId: input.newId, counts: impact.counts, totalUpdates: impact.totalUpdates, transactionMode, rollbackStatus, migrationId: migrationId || `${config.prefix}ID-${Date.now()}`, auditOutcome: 'recorded', redirectTo: config.redirectBase + encodeURIComponent(input.newId) };
}

async function migrateMongo(input) {
  const capability = await getMongoTransactionCapability();
  if (capability.supported) return withMongoTransaction(async (session) => {
    const loaded = await loadMongo(input.roleType, session);
    const source = preflight(loaded.datasets[input.roleType], input.roleType, input.oldId, input.newId, input.orgId);
    const impact = buildChanges(loaded.entries, loaded.datasets, input.roleType, input.oldId, input.newId, input.orgId, source);
    await applyMongoChanges(loaded, impact, session);
    const verified = await loadMongo(input.roleType, session);
    const verifiedSource = verified.datasets[input.roleType].find((row) => idsEqual(row?.id, input.newId) && idsEqual(row?.orgId, input.orgId));
    const remaining = buildChanges(verified.entries, verified.datasets, input.roleType, input.oldId, '__VERIFY__', input.orgId, verifiedSource);
    if (!verifiedSource || remaining.totalUpdates !== 0) throw new Error('Post-migration verification failed.');
    await getMongoCollection('schoolRoleSystemIdMigrations').insertOne({ id: 'ROLEID-' + Date.now(), ...input, counts: impact.counts, totalUpdates: impact.totalUpdates, backend: 'mongo', transactionMode: 'native', status: 'success', createdAt: new Date().toISOString() }, { session });
    return resultPayload(input, impact, 'native', 'not_required');
  });
  const migrationId = 'ROLEID-' + Date.now() + '-' + crypto.randomBytes(5).toString('hex');
  const loaded = await loadMongo(input.roleType);
  const source = preflight(loaded.datasets[input.roleType], input.roleType, input.oldId, input.newId, input.orgId);
  const impact = buildChanges(loaded.entries, loaded.datasets, input.roleType, input.oldId, input.newId, input.orgId, source);
  const backups = [];
  try {
    await getMongoCollection('schoolRoleSystemIdMigrationJournals').insertOne({ id: migrationId, ...input, status: 'applying', createdAt: new Date().toISOString() });
    await applyMongoChanges(loaded, impact, null, backups);
    const verified = await loadMongo(input.roleType);
    const verifiedSource = verified.datasets[input.roleType].find((row) => idsEqual(row?.id, input.newId) && idsEqual(row?.orgId, input.orgId));
    const remaining = buildChanges(verified.entries, verified.datasets, input.roleType, input.oldId, '__VERIFY__', input.orgId, verifiedSource);
    if (!verifiedSource || remaining.totalUpdates !== 0) throw new Error('Post-migration verification failed.');
    await getMongoCollection('schoolRoleSystemIdMigrations').insertOne({ id: migrationId, ...input, counts: impact.counts, totalUpdates: impact.totalUpdates, backend: 'mongo', transactionMode: 'compensating', status: 'success', createdAt: new Date().toISOString() });
    await getMongoCollection('schoolRoleSystemIdMigrationJournals').updateOne({ id: migrationId }, { $set: { status: 'success', completedAt: new Date().toISOString() } });
    return resultPayload(input, impact, 'compensating', 'not_required', migrationId);
  } catch (error) {
    let rollbackStatus = 'completed';
    for (const backup of backups.reverse()) {
      try { await getMongoCollection(backup.collection).replaceOne({ _id: backup.before._id }, backup.before); }
      catch (_rollbackError) { rollbackStatus = 'recovery_required'; }
    }
    const wrapped = new Error(rollbackStatus === 'completed' ? 'The migration failed, but all changes were restored.' : `Migration ${migrationId} requires administrator recovery.`);
    wrapped.status = 409; wrapped.migrationId = migrationId; wrapped.rollbackStatus = rollbackStatus;
    throw wrapped;
  }
}

async function migrateRoleSystemId(input = {}) {
  const roleType = String(input.roleType || '').trim().toLowerCase();
  configFor(roleType);
  return runByRepositoryBackend(input.options || {}, {
    json: async () => migrateJson({ ...input, roleType }),
    mongo: async () => migrateMongo({ ...input, roleType })
  }, `school.${roleType}.systemId.migrate`);
}

async function getMigrationCapability() {
  return runByRepositoryBackend({}, {
    json: async () => ({ topology: 'json', transactionMode: 'file-rollback' }),
    mongo: async () => {
      const capability = await getMongoTransactionCapability();
      return { topology: capability.topology, transactionMode: capability.supported ? 'native' : 'compensating' };
    }
  }, 'school.roleSystemId.capability');
}

module.exports = { ROLE_CONFIG, REFERENCE_REGISTRY, generateCandidate, transformDataset, previewRoleSystemId, generateRoleSystemId, migrateRoleSystemId, getMigrationCapability };
