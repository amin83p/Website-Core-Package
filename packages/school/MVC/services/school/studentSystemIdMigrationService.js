const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { requireCoreModule, resolveCoreRoot } = require('./schoolCoreModuleResolver');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { runByRepositoryBackend } = requireCoreModule('MVC/repositories/backend/repositoryBackendSelector');
const {
  getMongoCollection,
  withMongoTransaction,
  getMongoTransactionCapability
} = requireCoreModule('MVC/infrastructure/mongo/mongoConnection');
const { LOCK_COLLECTION } = require('./studentSystemIdMigrationLockService');
const { generateStudentSystemIdCandidate } = require('./studentSystemIdGenerator');

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const DATA_DIR = path.join(resolveCoreRoot(), 'data/school');
const AUDIT_FILE = 'studentSystemIdMigrations.json';
const MONGO_AUDIT_COLLECTION = 'schoolStudentSystemIdMigrations';
const MONGO_JOURNAL_COLLECTION = 'schoolStudentSystemIdMigrationJournals';
const MONGO_BACKUP_COLLECTION = 'schoolStudentSystemIdMigrationBackups';
const LOCK_TTL_MS = 5 * 60 * 1000;

const REFERENCE_REGISTRY = Object.freeze([
  { key: 'students', file: 'students.json', collection: 'schoolStudents', label: 'Students' },
  { key: 'studentProgramRegistrations', file: 'studentProgramRegistrations.json', collection: 'schoolStudentProgramRegistrations', label: 'Program registrations' },
  { key: 'studentTermRegistrations', file: 'studentTermRegistrations.json', collection: 'schoolStudentTermRegistrations', label: 'Term registrations' },
  { key: 'studentProgramPriorSubjects', file: 'studentProgramPriorSubjects.json', collection: 'schoolStudentProgramPriorSubjects', label: 'Prior subjects' },
  { key: 'classEnrollmentPeriods', file: 'classEnrollmentPeriods.json', collection: 'schoolClassEnrollmentPeriods', label: 'Enrollment periods' },
  { key: 'classes', file: 'classes.json', collection: 'schoolClasses', label: 'Legacy class rosters' },
  { key: 'academicLedger', file: 'academicLedger.json', collection: 'schoolAcademicLedger', label: 'Academic ledger' },
  { key: 'academicSnapshots', file: 'academicSnapshots.json', collection: 'schoolAcademicSnapshots', label: 'Academic snapshots' },
  { key: 'globalTransactions', file: 'globalTransactionLedger.json', collection: 'schoolGlobalTransactions', label: 'Financial transactions' },
  { key: 'withdrawals', file: 'withdrawals.json', collection: 'schoolWithdrawals', label: 'Withdrawals' },
  { key: 'reportInstances', file: 'reportInstances.json', collection: 'schoolReportInstances', label: 'Report instances' },
  { key: 'reportAssignments', file: 'reportAssignments.json', collection: 'schoolReportAssignments', label: 'Report assignments' },
  { key: 'examAllocations', file: 'examAllocations.json', collection: 'schoolExamAllocations', label: 'Exam allocations' },
  { key: 'examAssignments', file: 'examAssignments.json', collection: 'schoolExamAssignments', label: 'Exam assignments' },
  { key: 'examAttempts', file: 'examAttempts.json', collection: 'schoolExamAttempts', label: 'Exam attempts' },
  { key: 'examAnswers', file: 'examAnswers.json', collection: 'schoolExamAnswers', label: 'Exam answers' }
]);

const DIRECT_STUDENT_ID_KEYS = new Set([
  'studentProgramRegistrations', 'studentTermRegistrations', 'studentProgramPriorSubjects',
  'classEnrollmentPeriods', 'academicLedger', 'academicSnapshots', 'withdrawals',
  'reportInstances', 'examAssignments', 'examAttempts', 'examAnswers'
]);

function cleanId(value) {
  const id = String(value || '').trim();
  if (!id || id.length > 40 || !ID_PATTERN.test(id)) throw new Error('System Record ID must use 1-40 letters, numbers, underscores, or hyphens.');
  return id;
}

function idsEqual(left, right) {
  return String(left || '') === String(right || '');
}

function replaceArrayValue(values, oldId, newId) {
  if (!Array.isArray(values)) return { value: values, count: 0 };
  let count = 0;
  const value = values.map((item) => {
    if (!idsEqual(item, oldId)) return item;
    count += 1;
    return newId;
  });
  return { value, count };
}

function transformRows(key, inputRows, oldId, newId, orgId = '') {
  const rows = Array.isArray(inputRows) ? inputRows : [];
  let count = 0;
  const output = rows.map((source) => {
    const row = source && typeof source === 'object' ? { ...source } : source;
    if (!row || typeof row !== 'object') return row;
    const rowOrgId = String(row.orgId || '').trim();
    const inScope = !orgId || !rowOrgId || idsEqual(rowOrgId, orgId);
    if (!inScope) return row;

    if (key === 'students' && idsEqual(row.id, oldId)) {
      row.id = newId;
      count += 1;
    }
    if (DIRECT_STUDENT_ID_KEYS.has(key) && idsEqual(row.studentId, oldId)) {
      row.studentId = newId;
      count += 1;
    }
    if (key === 'classes') {
      const sourceStudents = row.enrollment && Array.isArray(row.enrollment.students) ? row.enrollment.students : [];
      const students = sourceStudents.map((student) => (student && typeof student === 'object' ? { ...student } : student));
      if (row.enrollment) row.enrollment = { ...row.enrollment, students };
      students.forEach((student) => {
        if (student && idsEqual(student.studentId, oldId)) {
          student.studentId = newId;
          count += 1;
        }
      });
    }
    if (key === 'academicSnapshots' && idsEqual(source?.studentId, oldId)) {
      const expectedId = 'ASNP-' + oldId + '-' + String(source.programId || '');
      if (idsEqual(source.id, expectedId)) row.id = 'ASNP-' + newId + '-' + String(source.programId || '');
    }
    if (key === 'globalTransactions' && row.party && idsEqual(row.party.studentId, oldId)) {
      row.party = { ...row.party, studentId: newId };
      count += 1;
    }
    if (key === 'withdrawals') {
      const sourceRemoved = row.rosterImpact && Array.isArray(row.rosterImpact.removedEnrollments)
        ? row.rosterImpact.removedEnrollments : [];
      const removed = sourceRemoved.map((entry) => (entry && typeof entry === 'object' ? { ...entry } : entry));
      if (row.rosterImpact) row.rosterImpact = { ...row.rosterImpact, removedEnrollments: removed };
      removed.forEach((entry) => {
        if (entry && idsEqual(entry.studentId, oldId)) {
          entry.studentId = newId;
          count += 1;
        }
      });
    }
    if (key === 'reportInstances' && idsEqual(row.targetKey, 'student:' + oldId)) {
      row.targetKey = 'student:' + newId;
      count += 1;
    }
    if (key === 'reportAssignments') {
      const replaced = replaceArrayValue(row.targetStudentIds, oldId, newId);
      row.targetStudentIds = replaced.value;
      count += replaced.count;
    }
    if (key === 'examAllocations' && row.extensions) {
      const replaced = replaceArrayValue(row.extensions.exemptStudentIds, oldId, newId);
      row.extensions = { ...row.extensions, exemptStudentIds: replaced.value };
      count += replaced.count;
    }
    return row;
  });
  return { rows: output, count };
}

function countReferences(key, rows, targetId, orgId = '') {
  return transformRows(key, rows, targetId, '__COUNT_ONLY__', orgId).count;
}

const generateCandidate = generateStudentSystemIdCandidate;

async function readJsonRows(file) {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, file), 'utf8');
    const rows = JSON.parse(raw || '[]');
    if (!Array.isArray(rows)) throw new Error(file + ' must contain a JSON array.');
    return { raw, rows };
  } catch (error) {
    if (error.code === 'ENOENT') return { raw: '[]', rows: [] };
    throw error;
  }
}

async function loadJsonDatasets() {
  const datasets = {};
  for (const entry of REFERENCE_REGISTRY) {
    // eslint-disable-next-line no-await-in-loop
    datasets[entry.key] = await readJsonRows(entry.file);
  }
  return datasets;
}

function buildImpact(datasets, oldId, orgId) {
  const counts = {};
  REFERENCE_REGISTRY.forEach((entry) => {
    counts[entry.key] = countReferences(entry.key, datasets[entry.key]?.rows || datasets[entry.key] || [], oldId, orgId);
  });
  return {
    counts,
    totalUpdates: Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0),
    collections: REFERENCE_REGISTRY.map((entry) => ({ key: entry.key, label: entry.label, count: counts[entry.key] || 0 }))
  };
}

async function loadMongoDatasets(session) {
  const datasets = {};
  for (const entry of REFERENCE_REGISTRY) {
    // eslint-disable-next-line no-await-in-loop
    datasets[entry.key] = await getMongoCollection(entry.collection).find({}, { session }).toArray();
  }
  return datasets;
}

function assertPreflight(datasets, oldId, newId, orgId) {
  const students = datasets.students?.rows || datasets.students || [];
  const source = students.filter((row) => idsEqual(row.id, oldId) && (!orgId || idsEqual(row.orgId, orgId)));
  if (source.length !== 1) throw new Error('Student record was not found in the active organization.');
  if (students.some((row) => idsEqual(row.id, newId))) throw new Error('The requested System Record ID already exists.');
}

async function previewStudentSystemId(oldIdInput, orgIdInput, options = {}) {
  const oldId = cleanId(oldIdInput);
  const orgId = String(orgIdInput || '').trim();
  return runByRepositoryBackend(options, {
    json: async () => {
      const datasets = await loadJsonDatasets();
      const students = datasets.students.rows;
      if (!students.some((row) => idsEqual(row.id, oldId) && idsEqual(row.orgId, orgId))) throw new Error('Student not found.');
      return { oldId, ...buildImpact(datasets, oldId, orgId) };
    },
    mongo: async () => {
      const datasets = await loadMongoDatasets(options.session);
      if (!(datasets.students || []).some((row) => idsEqual(row.id, oldId) && idsEqual(row.orgId, orgId))) throw new Error('Student not found.');
      return { oldId, ...buildImpact(datasets, oldId, orgId) };
    }
  }, 'school.studentSystemId.preview');
}

async function generateStudentSystemId(options = {}) {
  return runByRepositoryBackend(options, {
    json: async () => {
      const { rows } = await readJsonRows('students.json');
      return generateCandidate(new Set(rows.map((row) => String(row.id || ''))));
    },
    mongo: async () => {
      const rows = await getMongoCollection('schoolStudents').find({}, { projection: { id: 1 } }).toArray();
      return generateCandidate(new Set(rows.map((row) => String(row.id || ''))));
    }
  }, 'school.studentSystemId.generate');
}

async function migrateJson(oldId, newId, orgId, actor) {
  return queueWrite(async () => {
    const datasets = await loadJsonDatasets();
    assertPreflight(datasets, oldId, newId, orgId);
    const impact = buildImpact(datasets, oldId, orgId);
    const token = crypto.randomBytes(6).toString('hex');
    const staged = [];
    const backups = [];
    try {
      for (const entry of REFERENCE_REGISTRY) {
        const source = datasets[entry.key];
        const transformed = transformRows(entry.key, source.rows, oldId, newId, orgId);
        if (!transformed.count) continue;
        const target = path.join(DATA_DIR, entry.file);
        const temp = target + '.rename-' + token + '.tmp';
        const backup = target + '.rename-' + token + '.bak';
        // eslint-disable-next-line no-await-in-loop
        await fs.writeFile(temp, JSON.stringify(transformed.rows, null, 2));
        staged.push({ target, temp, backup, entry });
      }
      for (const item of staged) {
        // eslint-disable-next-line no-await-in-loop
        await fs.rename(item.target, item.backup);
        backups.push(item);
        // eslint-disable-next-line no-await-in-loop
        await fs.rename(item.temp, item.target);
      }
      const verified = await loadJsonDatasets();
      const remaining = buildImpact(verified, oldId, orgId);
      const newStudents = verified.students.rows.filter((row) => idsEqual(row.id, newId) && idsEqual(row.orgId, orgId));
      if (remaining.totalUpdates !== 0 || newStudents.length !== 1) throw new Error('Post-migration verification failed.');
      const audit = { id: 'SSID-' + Date.now() + '-' + token, oldId, newId, orgId, actor, backend: 'json', counts: impact.counts, totalUpdates: impact.totalUpdates, status: 'success', createdAt: new Date().toISOString() };
      const auditPath = path.join(DATA_DIR, AUDIT_FILE);
      const auditRows = (await readJsonRows(AUDIT_FILE)).rows;
      auditRows.push(audit);
      await fs.writeFile(auditPath, JSON.stringify(auditRows, null, 2));
      for (const item of backups) await fs.unlink(item.backup).catch(() => {});
      return { oldId, newId, ...impact, auditId: audit.id, redirectTo: '/school/students/edit/' + encodeURIComponent(newId) };
    } catch (error) {
      for (const item of [...backups].reverse()) {
        await fs.unlink(item.target).catch(() => {});
        await fs.rename(item.backup, item.target).catch(() => {});
      }
      for (const item of staged) await fs.unlink(item.temp).catch(() => {});
      throw error;
    }
  });
}

async function migrateMongoNative(oldId, newId, orgId, actor, topology = 'replicaSet') {
  return withMongoTransaction(async (session) => {
    const datasets = await loadMongoDatasets(session);
    assertPreflight(datasets, oldId, newId, orgId);
    const impact = buildImpact(datasets, oldId, orgId);
    for (const entry of REFERENCE_REGISTRY) {
      const original = datasets[entry.key] || [];
      const transformed = transformRows(entry.key, original, oldId, newId, orgId);
      if (!transformed.count) continue;
      for (let index = 0; index < original.length; index += 1) {
        if (JSON.stringify(original[index]) === JSON.stringify(transformed.rows[index])) continue;
        const replacement = { ...transformed.rows[index], _id: original[index]._id };
        // eslint-disable-next-line no-await-in-loop
        await getMongoCollection(entry.collection).replaceOne({ _id: original[index]._id }, replacement, { session });
      }
    }
    const audit = { id: 'SSID-' + Date.now() + '-' + crypto.randomBytes(6).toString('hex'), oldId, newId, orgId, actor, backend: 'mongo', topology, transactionMode: 'native', rollbackStatus: 'not_required', counts: impact.counts, totalUpdates: impact.totalUpdates, status: 'success', createdAt: new Date().toISOString() };
    await getMongoCollection(MONGO_AUDIT_COLLECTION).insertOne(audit, { session });
    const verified = await loadMongoDatasets(session);
    const remaining = buildImpact(verified, oldId, orgId);
    const newStudents = verified.students.filter((row) => idsEqual(row.id, newId) && idsEqual(row.orgId, orgId));
    if (remaining.totalUpdates !== 0 || newStudents.length !== 1) throw new Error('Post-migration verification failed.');
    return { oldId, newId, ...impact, auditId: audit.id, migrationId: audit.id, transactionMode: 'native', rollbackStatus: 'not_required', redirectTo: '/school/students/edit/' + encodeURIComponent(newId) };
  });
}

function comparableDocument(value) {
  return JSON.stringify(value, (_key, item) => {
    if (item && typeof item.toHexString === 'function') return item.toHexString();
    return item;
  });
}

function documentsEqual(left, right) {
  return comparableDocument(left) === comparableDocument(right);
}

function replacementFilter(document = {}) {
  const { _id, ...body } = document;
  return { _id, ...body };
}

async function acquireMongoMigrationLock({ migrationId, oldId, newId, orgId, actor }) {
  const locks = getMongoCollection(LOCK_COLLECTION);
  const lockId = orgId + ':' + oldId;
  const now = new Date();
  await locks.deleteOne({ _id: lockId, expiresAt: { $lte: now } });
  try {
    await locks.insertOne({
      _id: lockId, migrationId, oldId, newId, orgId, actor,
      createdAt: now,
      expiresAt: new Date(now.getTime() + LOCK_TTL_MS)
    });
  } catch (error) {
    if (Number(error?.code) === 11000) {
      const lockError = new Error('A Student System Record ID migration is already in progress for this student.');
      lockError.code = 'STUDENT_ID_MIGRATION_IN_PROGRESS';
      lockError.status = 409;
      throw lockError;
    }
    throw error;
  }
  return { lockId, migrationId };
}

async function releaseMongoMigrationLock(lock = {}) {
  if (!lock.lockId || !lock.migrationId) return;
  await getMongoCollection(LOCK_COLLECTION).deleteOne({ _id: lock.lockId, migrationId: lock.migrationId });
}

async function refreshMongoMigrationLock(lock = {}) {
  if (!lock.lockId || !lock.migrationId) return;
  const result = await getMongoCollection(LOCK_COLLECTION).updateOne(
    { _id: lock.lockId, migrationId: lock.migrationId },
    { $set: { expiresAt: new Date(Date.now() + LOCK_TTL_MS), heartbeatAt: new Date() } }
  );
  if (result.matchedCount !== 1) throw new Error('The Student System Record ID migration lock was lost.');
}

async function rollbackStandaloneMigration(journal) {
  const migrationId = String(journal?.id || journal?.migrationId || '').trim();
  const backups = await getMongoCollection(MONGO_BACKUP_COLLECTION)
    .find({ migrationId }).sort({ sequence: -1 }).toArray();
  const failures = [];
  let restored = 0;
  await getMongoCollection(MONGO_JOURNAL_COLLECTION).updateOne(
    { id: migrationId },
    { $set: { status: 'rolling_back', rollbackStartedAt: new Date().toISOString() } }
  );
  for (const backup of backups) {
    const collection = getMongoCollection(backup.collection);
    // eslint-disable-next-line no-await-in-loop
    const current = await collection.findOne({ _id: backup.sourceId });
    if (documentsEqual(current, backup.before)) continue;
    if (!documentsEqual(current, backup.after)) {
      failures.push(`${backup.collection}:${String(backup.sourceId)}`);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const result = await collection.replaceOne(replacementFilter(backup.after), backup.before);
    if (result.matchedCount !== 1) failures.push(`${backup.collection}:${String(backup.sourceId)}`);
    else restored += 1;
  }
  for (const backup of backups) {
    // eslint-disable-next-line no-await-in-loop
    const restoredDocument = await getMongoCollection(backup.collection).findOne({ _id: backup.sourceId });
    if (!documentsEqual(restoredDocument, backup.before)) {
      const key = `${backup.collection}:${String(backup.sourceId)}`;
      if (!failures.includes(key)) failures.push(key);
    }
  }
  const rollbackStatus = failures.length ? 'recovery_required' : 'completed';
  await getMongoCollection(MONGO_JOURNAL_COLLECTION).updateOne(
    { id: migrationId },
    { $set: { status: failures.length ? 'recovery_required' : 'rolled_back', rollbackStatus, rollbackFailures: failures, restoredCount: restored, completedAt: new Date().toISOString() } }
  );
  if (!failures.length) await getMongoCollection(MONGO_BACKUP_COLLECTION).deleteMany({ migrationId });
  return { rollbackStatus, failures, restored };
}

async function recoverInterruptedMongoMigration({ oldId, newId, orgId }) {
  const journal = await getMongoCollection(MONGO_JOURNAL_COLLECTION).findOne({
    orgId,
    status: { $in: ['prepared', 'applying', 'verifying', 'rolling_back', 'recovery_required'] },
    $or: [{ oldId }, { newId: oldId }, { oldId: newId }, { newId }]
  });
  if (!journal) return null;
  const recovery = await rollbackStandaloneMigration(journal);
  if (recovery.rollbackStatus !== 'completed') {
    const error = new Error(`A previous Student System Record ID migration requires administrator recovery. Migration ID: ${journal.id}.`);
    error.code = 'STUDENT_ID_MIGRATION_RECOVERY_REQUIRED';
    error.status = 409;
    error.migrationId = journal.id;
    error.rollbackStatus = recovery.rollbackStatus;
    throw error;
  }
  return { migrationId: journal.id, ...recovery };
}

async function migrateMongoStandalone(oldId, newId, orgId, actor) {
  const migrationId = 'SSID-' + Date.now() + '-' + crypto.randomBytes(6).toString('hex');
  let lock = null;
  let journal = null;
  let successAuditInserted = false;
  try {
    lock = await acquireMongoMigrationLock({ migrationId, oldId, newId, orgId, actor });
    await recoverInterruptedMongoMigration({ oldId, newId, orgId });
    const datasets = await loadMongoDatasets();
    assertPreflight(datasets, oldId, newId, orgId);
    const impact = buildImpact(datasets, oldId, orgId);
    const backups = [];
    let sequence = 0;
    for (const entry of REFERENCE_REGISTRY) {
      const original = datasets[entry.key] || [];
      const transformed = transformRows(entry.key, original, oldId, newId, orgId);
      for (let index = 0; index < original.length; index += 1) {
        if (documentsEqual(original[index], transformed.rows[index])) continue;
        backups.push({
          _id: migrationId + ':' + String(sequence), migrationId, sequence,
          key: entry.key, collection: entry.collection, sourceId: original[index]._id,
          before: original[index], after: { ...transformed.rows[index], _id: original[index]._id }
        });
        sequence += 1;
      }
    }
    journal = {
      id: migrationId, oldId, newId, orgId, actor, backend: 'mongo', topology: 'standalone',
      transactionMode: 'compensating', status: 'prepared', rollbackStatus: 'not_started',
      counts: impact.counts, totalUpdates: impact.totalUpdates, backupCount: backups.length,
      createdAt: new Date().toISOString()
    };
    await getMongoCollection(MONGO_JOURNAL_COLLECTION).insertOne(journal);
    if (backups.length) await getMongoCollection(MONGO_BACKUP_COLLECTION).insertMany(backups);
    await getMongoCollection(MONGO_JOURNAL_COLLECTION).updateOne({ id: migrationId }, { $set: { status: 'applying', startedAt: new Date().toISOString() } });
    for (const backup of backups) {
      // eslint-disable-next-line no-await-in-loop
      await refreshMongoMigrationLock(lock);
      // eslint-disable-next-line no-await-in-loop
      const result = await getMongoCollection(backup.collection).replaceOne(replacementFilter(backup.before), backup.after);
      if (result.matchedCount !== 1) throw new Error(`A concurrent update was detected in ${backup.collection}; migration was stopped.`);
    }
    await getMongoCollection(MONGO_JOURNAL_COLLECTION).updateOne({ id: migrationId }, { $set: { status: 'verifying' } });
    const verified = await loadMongoDatasets();
    const remaining = buildImpact(verified, oldId, orgId);
    const newStudents = verified.students.filter((row) => idsEqual(row.id, newId) && idsEqual(row.orgId, orgId));
    if (remaining.totalUpdates !== 0 || newStudents.length !== 1) throw new Error('Post-migration verification failed.');
    const audit = { ...journal, status: 'success', rollbackStatus: 'not_required', verified: true, completedAt: new Date().toISOString() };
    await getMongoCollection(MONGO_AUDIT_COLLECTION).insertOne(audit);
    successAuditInserted = true;
    await getMongoCollection(MONGO_JOURNAL_COLLECTION).updateOne({ id: migrationId }, { $set: { status: 'success', rollbackStatus: 'not_required', verified: true, completedAt: audit.completedAt } });
    await getMongoCollection(MONGO_BACKUP_COLLECTION).deleteMany({ migrationId });
    return { oldId, newId, ...impact, auditId: migrationId, migrationId, transactionMode: 'compensating', rollbackStatus: 'not_required', topology: 'standalone', redirectTo: '/school/students/edit/' + encodeURIComponent(newId) };
  } catch (error) {
    if (!journal) throw error;
    let rollback = { rollbackStatus: 'not_started', failures: [] };
    if (journal) rollback = await rollbackStandaloneMigration(journal).catch((rollbackError) => ({ rollbackStatus: 'recovery_required', failures: [rollbackError.message] }));
    if (successAuditInserted) await getMongoCollection(MONGO_AUDIT_COLLECTION).deleteOne({ id: migrationId }).catch(() => {});
    const message = rollback.rollbackStatus === 'completed'
      ? 'The Student System Record ID migration failed, but all changes were restored.'
      : `The Student System Record ID migration could not be safely completed. Administrator recovery is required${migrationId ? ` (Migration ID: ${migrationId})` : ''}.`;
    const wrapped = new Error(message);
    wrapped.code = rollback.rollbackStatus === 'completed' ? 'STUDENT_ID_MIGRATION_ROLLED_BACK' : 'STUDENT_ID_MIGRATION_RECOVERY_REQUIRED';
    wrapped.status = 409;
    wrapped.migrationId = migrationId;
    wrapped.rollbackStatus = rollback.rollbackStatus;
    wrapped.cause = error;
    throw wrapped;
  } finally {
    await releaseMongoMigrationLock(lock).catch(() => {});
  }
}

async function migrateMongo(oldId, newId, orgId, actor) {
  const capability = await getMongoTransactionCapability();
  if (capability.supported) {
    try {
      return await migrateMongoNative(oldId, newId, orgId, actor, capability.topology);
    } catch (error) {
      const unsupportedTransaction = /Transaction numbers are only allowed on a replica set member or mongos|transactions are not supported/i.test(String(error?.message || ''));
      if (!unsupportedTransaction) throw error;
      return migrateMongoStandalone(oldId, newId, orgId, actor);
    }
  }
  return migrateMongoStandalone(oldId, newId, orgId, actor);
}

async function getStudentSystemIdMigrationCapability(options = {}) {
  return runByRepositoryBackend(options, {
    json: async () => ({ topology: 'json', transactionMode: 'file-rollback' }),
    mongo: async () => {
      const capability = await getMongoTransactionCapability();
      return { topology: capability.topology, transactionMode: capability.supported ? 'native' : 'compensating' };
    }
  }, 'school.studentSystemId.capability');
}

async function recoverStudentSystemIdMigration(migrationIdInput, actor = '', options = {}) {
  const migrationId = String(migrationIdInput || '').trim();
  if (!migrationId) throw new Error('Migration ID is required.');
  return runByRepositoryBackend(options, {
    json: async () => { throw new Error('JSON migrations recover automatically from file backups.'); },
    mongo: async () => {
      const journal = await getMongoCollection(MONGO_JOURNAL_COLLECTION).findOne({ id: migrationId });
      if (!journal) throw new Error('Migration recovery journal not found.');
      let lock = null;
      try {
        lock = await acquireMongoMigrationLock({ ...journal, migrationId, actor: actor || journal.actor });
        const result = await rollbackStandaloneMigration(journal);
        if (result.rollbackStatus !== 'completed') {
          const error = new Error(`Migration ${migrationId} still requires administrator recovery.`);
          error.status = 409;
          throw error;
        }
        return { status: 'recovered', migrationId, rollbackStatus: result.rollbackStatus, restoredCount: result.restored };
      } finally {
        await releaseMongoMigrationLock(lock).catch(() => {});
      }
    }
  }, 'school.studentSystemId.recover');
}

async function recordFailureAudit({ oldId, newId, orgId, actor, message }, options = {}) {
  const audit = { id: 'SSID-' + Date.now() + '-' + crypto.randomBytes(6).toString('hex'), oldId, newId, orgId, actor, status: 'failed', message: String(message || 'Migration failed.'), createdAt: new Date().toISOString() };
  try {
    await runByRepositoryBackend(options, {
      json: () => queueWrite(async () => {
        const auditRows = (await readJsonRows(AUDIT_FILE)).rows;
        auditRows.push({ ...audit, backend: 'json' });
        await fs.writeFile(path.join(DATA_DIR, AUDIT_FILE), JSON.stringify(auditRows, null, 2));
      }),
      mongo: () => getMongoCollection('schoolStudentSystemIdMigrations').insertOne({ ...audit, backend: 'mongo' })
    }, 'school.studentSystemId.auditFailure');
  } catch (auditError) {
    console.error('[STUDENT_SYSTEM_ID_AUDIT_FAILURE]', auditError);
  }
}

async function migrateStudentSystemId({ oldId: oldInput, newId: newInput, orgId: orgInput, actor = '' }, options = {}) {
  const oldId = cleanId(oldInput);
  const newId = cleanId(newInput);
  const orgId = String(orgInput || '').trim();
  if (idsEqual(oldId, newId)) throw new Error('The replacement System Record ID must be different.');
  try {
    return await runByRepositoryBackend(options, {
      json: () => migrateJson(oldId, newId, orgId, actor),
      mongo: () => migrateMongo(oldId, newId, orgId, actor)
    }, 'school.studentSystemId.migrate');
  } catch (error) {
    await recordFailureAudit({ oldId, newId, orgId, actor, message: error.message }, options);
    throw error;
  }
}

module.exports = {
  REFERENCE_REGISTRY,
  cleanId,
  transformRows,
  buildImpact,
  generateCandidate,
  previewStudentSystemId,
  generateStudentSystemId,
  migrateStudentSystemId,
  getStudentSystemIdMigrationCapability,
  recoverStudentSystemIdMigration,
  migrateMongoStandalone,
  migrateMongoNative,
  rollbackStandaloneMigration
};
