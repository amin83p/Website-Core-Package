'use strict';

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const schoolDataService = require('./schoolDataService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const { resolveCoreRoot } = require('./schoolCoreModuleResolver');
const { requireCoreModule } = require('./schoolCoreContracts');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');
const { runByRepositoryBackend } = requireCoreModule('MVC/repositories/backend/repositoryBackendSelector');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const {
  getMongoCollection,
  withMongoTransaction,
  getMongoTransactionCapability
} = requireCoreModule('MVC/infrastructure/mongo/mongoConnection');
const uploadStorage = requireCoreModule('MVC/services/uploadStorageService');
const studentSystemIdMigrationLockService = require('./studentSystemIdMigrationLockService');
const { buildUploadTargetsForClass } = require('./classFolderPaths');
const classModel = require('../../models/school/classModel');
const schoolIndexService = require('./schoolIndexService');
const { buildVoidPatch } = require('../../models/school/voidRecordMetadata');
const {
  MERGE_STUDENT_ID_REGISTRY,
  MERGE_PERSON_FLAT_REGISTRY,
  isActiveRegistrationStatus,
  transformStudentIdRows,
  transformPersonIdRows,
  mergeSessionsForPersonSwap,
  patchClassRosterMaps,
  unionScalarStudentProfile,
  buildPreviewToken,
  assertStudentDeletionRegistryParity,
  countStudentIdReferences,
  countPersonIdReferences,
  readMergeStorePayload,
  remapPersonDocument
} = require('./studentAdmissionMergeRegistry');

const DATA_DIR = path.join(resolveCoreRoot(), 'data/school');
const AUDIT_FILE = 'studentAdmissionMerges.json';
const MONGO_BACKUP_COLLECTION = 'schoolStudentAdmissionMergeBackups';

function idsEqual(left, right) {
  return String(left || '') === String(right || '');
}

function cleanId(value) {
  return String(value || '').trim();
}

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  return token;
}

function isArchivedStudent(row) {
  const status = String(row?.academicStatus || '').trim().toLowerCase();
  return status === 'archived' || row?.deleted === true;
}

function listMergeStores() {
  const map = new Map();
  [
    ...MERGE_STUDENT_ID_REGISTRY,
    ...MERGE_PERSON_FLAT_REGISTRY,
    { key: 'students', file: 'students.json', collection: 'schoolStudents', label: 'Students' },
    { key: 'classes', file: 'classes.json', collection: 'schoolClasses', label: 'Classes' }
  ].forEach((entry) => {
    const prev = map.get(entry.key) || {};
    map.set(entry.key, {
      ...prev,
      ...entry,
      shape: entry.shape || prev.shape || 'array'
    });
  });
  return [...map.values()];
}

function cloneStoreValue(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function currentStoreValue(meta) {
  return meta.shape === 'document' ? (meta.doc || { byOrgId: {} }) : (meta.rows || []);
}

function storeChanged(meta) {
  return JSON.stringify(currentStoreValue(meta)) !== JSON.stringify(meta.original);
}

async function readJsonStore(entry) {
  const filePath = path.join(DATA_DIR, entry.file);
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8') || 'null');
    return { ...readMergeStorePayload(parsed, entry.shape || 'array'), existed: true };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return entry.shape === 'document'
        ? { doc: { byOrgId: {} }, existed: false }
        : { rows: [], existed: false };
    }
    throw error;
  }
}

async function loadJsonMergeDatasetMap() {
  const map = {};
  const stores = listMergeStores();
  await Promise.all(stores.map(async (entry) => {
    const loaded = await readJsonStore(entry);
    const value = entry.shape === 'document' ? loaded.doc : loaded.rows;
    map[entry.key] = {
      ...entry,
      ...loaded,
      original: cloneStoreValue(value)
    };
  }));
  return map;
}

async function loadMongoMergeDatasetMap() {
  const map = {};
  for (const entry of listMergeStores()) {
    const collection = getMongoCollection(entry.collection);
    if (entry.shape === 'document') {
      // eslint-disable-next-line no-await-in-loop
      const row = await collection.findOne({ id: entry.mongoId || 'schedule-person-notes' });
      const doc = row && typeof row === 'object' ? { ...row } : { byOrgId: {} };
      delete doc._id;
      map[entry.key] = { ...entry, doc, existed: Boolean(row), original: cloneStoreValue(doc) };
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const rows = await collection.find({}).toArray();
    map[entry.key] = { ...entry, rows, existed: true, original: cloneStoreValue(rows) };
  }
  return map;
}

async function loadMergeDatasetMap() {
  return runByRepositoryBackend({}, {
    json: loadJsonMergeDatasetMap,
    mongo: loadMongoMergeDatasetMap
  }, 'school.admissionMerge.load');
}

async function persistJsonMergeDataset(map, options = {}) {
  const token = options.token || crypto.randomBytes(6).toString('hex');
  const staged = [];
  const backups = [];
  await queueWrite(async () => {
    for (const meta of Object.values(map)) {
      if (!meta?.file || !storeChanged(meta)) continue;
      const target = path.join(DATA_DIR, meta.file);
      const temp = `${target}.merge-${token}.tmp`;
      const backup = `${target}.merge-${token}.bak`;
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(temp, JSON.stringify(currentStoreValue(meta), null, 2));
      staged.push({ target, temp, backup, existed: meta.existed !== false });
    }
    for (const item of staged) {
      if (item.existed) {
        // eslint-disable-next-line no-await-in-loop
        await fs.rename(item.target, item.backup);
        backups.push(item);
      }
      // eslint-disable-next-line no-await-in-loop
      await fs.rename(item.temp, item.target);
    }
  });
  return {
    rollback: async () => {
      await queueWrite(async () => {
        for (const item of [...staged].reverse()) {
          // eslint-disable-next-line no-await-in-loop
          await fs.unlink(item.target).catch(() => {});
          if (item.existed) {
            // eslint-disable-next-line no-await-in-loop
            await fs.rename(item.backup, item.target).catch(() => {});
          }
          // eslint-disable-next-line no-await-in-loop
          await fs.unlink(item.temp).catch(() => {});
        }
      });
    },
    cleanupBackups: async () => {
      for (const item of backups) {
        // eslint-disable-next-line no-await-in-loop
        await fs.unlink(item.backup).catch(() => {});
      }
    }
  };
}

async function writeMongoStores(map, session) {
  for (const meta of Object.values(map)) {
    if (!meta?.collection || !storeChanged(meta)) continue;
    const collection = getMongoCollection(meta.collection);
    if (meta.shape === 'document') {
      const after = { ...currentStoreValue(meta), id: meta.mongoId || 'schedule-person-notes' };
      // eslint-disable-next-line no-await-in-loop
      await collection.replaceOne({ id: after.id }, after, { upsert: true, session });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    await collection.deleteMany({}, { session });
    const rows = (meta.rows || []).map((row) => {
      const copy = { ...row };
      delete copy._id;
      return copy;
    });
    if (rows.length) {
      // eslint-disable-next-line no-await-in-loop
      await collection.insertMany(rows, { session });
    }
  }
}

async function restoreMongoStores(snapshots) {
  for (const snap of snapshots) {
    const collection = getMongoCollection(snap.collection);
    if (snap.shape === 'document') {
      // eslint-disable-next-line no-await-in-loop
      if (!snap.before) await collection.deleteOne({ id: snap.mongoId || 'schedule-person-notes' });
      else await collection.replaceOne({ id: snap.before.id || snap.mongoId }, snap.before, { upsert: true });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    await collection.deleteMany({});
    const rows = (snap.before || []).map((row) => {
      const copy = { ...row };
      delete copy._id;
      return copy;
    });
    if (rows.length) {
      // eslint-disable-next-line no-await-in-loop
      await collection.insertMany(rows);
    }
  }
}

async function persistMongoMergeDataset(map, options = {}) {
  const journalId = options.token || crypto.randomBytes(6).toString('hex');
  const snapshots = Object.values(map).filter((meta) => meta?.collection && storeChanged(meta)).map((meta) => ({
    key: meta.key,
    collection: meta.collection,
    shape: meta.shape,
    mongoId: meta.mongoId,
    before: cloneStoreValue(meta.original)
  }));
  const capability = await getMongoTransactionCapability();
  if (capability.supported) {
    await withMongoTransaction(async (session) => {
      await getMongoCollection(MONGO_BACKUP_COLLECTION).insertOne({
        id: journalId,
        status: 'applying',
        keys: snapshots.map((row) => row.key),
        createdAt: new Date().toISOString()
      }, { session });
      await writeMongoStores(map, session);
    });
    return {
      rollback: async () => restoreMongoStores(snapshots),
      cleanupBackups: async () => {
        await getMongoCollection(MONGO_BACKUP_COLLECTION).deleteOne({ id: journalId });
      }
    };
  }
  await getMongoCollection(MONGO_BACKUP_COLLECTION).insertOne({
    id: journalId,
    status: 'applying',
    topology: 'standalone',
    snapshots,
    createdAt: new Date().toISOString()
  });
  try {
    await writeMongoStores(map);
  } catch (error) {
    await restoreMongoStores(snapshots);
    await getMongoCollection(MONGO_BACKUP_COLLECTION).updateOne({ id: journalId }, { $set: { status: 'rolled_back' } });
    throw error;
  }
  return {
    rollback: async () => {
      await restoreMongoStores(snapshots);
      await getMongoCollection(MONGO_BACKUP_COLLECTION).updateOne({ id: journalId }, { $set: { status: 'rolled_back' } });
    },
    cleanupBackups: async () => {
      await getMongoCollection(MONGO_BACKUP_COLLECTION).deleteOne({ id: journalId });
    }
  };
}

async function persistMergeDataset(map, options = {}) {
  return runByRepositoryBackend({}, {
    json: () => persistJsonMergeDataset(map, options),
    mongo: () => persistMongoMergeDataset(map, options)
  }, 'school.admissionMerge.persist');
}

function resolveSelection(students = [], mainStudentId = '', mergeStudentIds = []) {
  const mainId = toPublicId(mainStudentId);
  const mergeIds = [...new Set((Array.isArray(mergeStudentIds) ? mergeStudentIds : []).map((id) => toPublicId(id)).filter(Boolean))];
  const allIds = [...new Set([mainId, ...mergeIds].filter(Boolean))];
  if (allIds.length < 2) {
    throw new Error('Select at least two student admissions to merge.');
  }
  if (!mainId || !mergeIds.includes(mainId)) {
    throw new Error('Choose a primary admission from the selected students.');
  }
  const secondaries = mergeIds.filter((id) => !idsEqual(id, mainId));
  const byId = new Map((Array.isArray(students) ? students : []).map((row) => [toPublicId(row.id), row]));
  const selected = allIds.map((id) => {
    const row = byId.get(id);
    if (!row) throw new Error(`Student ${id} was not found.`);
    if (isArchivedStudent(row)) throw new Error(`Student ${id} is archived and cannot be merged.`);
    return row;
  });
  const orgIds = new Set(selected.map((row) => toPublicId(row.orgId)).filter(Boolean));
  if (orgIds.size !== 1) throw new Error('All selected students must belong to the same organization.');
  const main = byId.get(mainId);
  return {
    main,
    secondaries: secondaries.map((id) => byId.get(id)).filter(Boolean),
    orgId: [...orgIds][0]
  };
}

function buildTermRegistrationPlan(main, secondaries, termRows = []) {
  const plan = { moves: [], blocks: [] };
  const orgId = toPublicId(main?.orgId);
  const mainId = toPublicId(main?.id);
  const rows = (Array.isArray(termRows) ? termRows : []).filter((row) => idsEqual(row?.orgId, orgId));
  const activeByStudentProgramTerm = new Map();
  rows.forEach((row) => {
    const studentId = toPublicId(row.studentId);
    const programId = toPublicId(row.programId);
    const termId = toPublicId(row.termId);
    if (!studentId || !programId || !termId) return;
    const key = `${studentId}::${programId}::${termId}`;
    if (!isActiveRegistrationStatus(row.status)) return;
    activeByStudentProgramTerm.set(key, row);
  });
  secondaries.forEach((stu) => {
    const secId = toPublicId(stu.id);
    rows.filter((row) => idsEqual(row.studentId, secId)).forEach((row) => {
      const programId = toPublicId(row.programId);
      const termId = toPublicId(row.termId);
      const mainKey = `${mainId}::${programId}::${termId}`;
      const mainActive = activeByStudentProgramTerm.get(mainKey);
      const secActive = isActiveRegistrationStatus(row.status);
      if (secActive && mainActive) {
        plan.blocks.push(`Both admissions have an active term registration for program ${programId} and term ${termId}. Void or complete one side first.`);
        return;
      }
      plan.moves.push({
        type: 'termRegistration',
        id: row.id,
        programId,
        termId,
        fromStudentId: secId,
        registrationDate: row.registrationDate
      });
    });
  });
  const mainRegs = rows.filter((row) => idsEqual(row.studentId, mainId));
  const earliestByProgramTerm = new Map();
  [...mainRegs, ...plan.moves.map((m) => ({ programId: m.programId, termId: m.termId, registrationDate: m.registrationDate }))].forEach((row) => {
    const key = `${toPublicId(row.programId)}::${toPublicId(row.termId)}`;
    const date = normalizeDateOnly(row.registrationDate);
    if (!key || key === '::' || !date) return;
    const prev = earliestByProgramTerm.get(key);
    if (!prev || date < prev) earliestByProgramTerm.set(key, date);
  });
  plan.earliestTermDates = Object.fromEntries(earliestByProgramTerm);
  return plan;
}

function oldestDate(values = []) {
  return (Array.isArray(values) ? values : []).map((value) => normalizeDateOnly(value)).filter(Boolean).sort()[0] || '';
}

function displayLabel(title, id) {
  const name = String(title || '').trim();
  const token = String(id || '').trim();
  if (!token) return name;
  if (!name || name === token) return token;
  return `${name} (${token})`;
}

function replaceIdsWithLabels(message, labelById) {
  let next = String(message || '');
  labelById.forEach((label, id) => {
    if (!id || !label || label === id || !next.includes(id)) return;
    next = next.split(id).join(label);
  });
  return next;
}

function annotateMergePreviewLabels(previewParts, { programNameById, classTitleById }) {
  const programLabel = (id) => displayLabel(programNameById.get(toPublicId(id)), id);
  const classLabel = (id) => displayLabel(classTitleById.get(toPublicId(id)), id);
  const tagProgram = (row) => (row && typeof row === 'object' ? { ...row, programLabel: programLabel(row.programId) } : row);
  const tagClass = (row) => (row && typeof row === 'object' ? { ...row, classLabel: classLabel(row.classId) } : row);
  const programPlan = previewParts.programPlan || {};
  programPlan.dateUpdates = (programPlan.dateUpdates || []).map(tagProgram);
  programPlan.adopts = (programPlan.adopts || []).map(tagProgram);
  programPlan.moves = (programPlan.moves || []).map(tagProgram);
  programPlan.voids = (programPlan.voids || []).map(tagProgram);
  programPlan.blocks = (programPlan.blocks || []).map((message) => replaceIdsWithLabels(message, new Map(
    [...programNameById.entries()].map(([id, name]) => [id, programLabel(id)])
  )));
  const periodPlan = previewParts.periodPlan || {};
  periodPlan.moves = (periodPlan.moves || []).map(tagClass);
  periodPlan.merges = (periodPlan.merges || []).map(tagClass);
  periodPlan.conflicts = (periodPlan.conflicts || []).map((row) => ({
    ...tagClass(row),
    message: replaceIdsWithLabels(row.message, new Map([
      ...[...classTitleById.keys()].map((id) => [id, classLabel(id)]),
      ...[...programNameById.keys()].map((id) => [id, programLabel(id)])
    ]))
  }));
  return { programPlan, periodPlan };
}

function buildProgramRegistrationPlan(main, secondaries, programRows = [], periodRows = []) {
  const plan = { moves: [], adopts: [], dateUpdates: [], voids: [], blocks: [] };
  const orgId = toPublicId(main?.orgId);
  const mainId = toPublicId(main?.id);
  const mainPersonId = toPublicId(main?.personId);
  const selectedIds = new Set([mainId, ...secondaries.map((row) => toPublicId(row.id))]);
  const rows = (Array.isArray(programRows) ? programRows : []).filter((row) => idsEqual(row?.orgId, orgId));
  const neededPrograms = new Set();
  rows.forEach((row) => {
    if (selectedIds.has(toPublicId(row.studentId)) && toPublicId(row.programId)) neededPrograms.add(toPublicId(row.programId));
  });
  (Array.isArray(periodRows) ? periodRows : []).forEach((row) => {
    if (!idsEqual(row?.orgId, orgId)) return;
    if (selectedIds.has(toPublicId(row.studentId)) && toPublicId(row.programId)) neededPrograms.add(toPublicId(row.programId));
  });

  neededPrograms.forEach((programId) => {
    const related = rows.filter((row) => idsEqual(row.programId, programId) && selectedIds.has(toPublicId(row.studentId)));
    const oldest = oldestDate(related.map((row) => row.registrationDate));
    const mainActive = related.find((row) => idsEqual(row.studentId, mainId) && isActiveRegistrationStatus(row.status));
    const secondaryRelated = related.filter((row) => !idsEqual(row.studentId, mainId) && String(row.status || '').toLowerCase() !== 'void');
    if (mainActive) {
      if (oldest) {
        plan.dateUpdates.push({
          id: mainActive.id,
          programId,
          registrationDate: oldest,
          previousDate: normalizeDateOnly(mainActive.registrationDate)
        });
      }
      secondaryRelated.forEach((row) => {
        plan.voids.push({ id: row.id, programId, fromStudentId: toPublicId(row.studentId) });
      });
      return;
    }
    const source = secondaryRelated
      .slice()
      .sort((left, right) => String(left.registrationDate || '9999-99-99').localeCompare(String(right.registrationDate || '9999-99-99')))[0];
    if (!source) {
      plan.blocks.push(`A class enrollment needs program ${programId}, but none of the selected admissions has that program registration.`);
      return;
    }
    const adopt = {
      type: 'programRegistration',
      id: source.id,
      programId,
      fromStudentId: toPublicId(source.studentId),
      registrationDate: oldest || normalizeDateOnly(source.registrationDate)
    };
    plan.adopts.push(adopt);
    plan.moves.push(adopt);
    secondaryRelated.forEach((row) => {
      if (idsEqual(row.id, source.id)) return;
      plan.voids.push({ id: row.id, programId, fromStudentId: toPublicId(row.studentId) });
    });
  });
  plan.earliestProgramDates = {};
  [...plan.dateUpdates, ...plan.adopts].forEach((row) => {
    if (row.programId && row.registrationDate) plan.earliestProgramDates[row.programId] = row.registrationDate;
  });
  plan.mainPersonId = mainPersonId;
  return plan;
}

function buildEnrollmentPeriodPlan(main, secondaries, periodRows = []) {
  const orgId = toPublicId(main?.orgId);
  const mainId = toPublicId(main?.id);
  const rows = (Array.isArray(periodRows) ? periodRows : []).filter((row) => idsEqual(row?.orgId, orgId));
  const byStudentClass = new Map();
  rows.forEach((row) => {
    const key = `${toPublicId(row.studentId)}::${toPublicId(row.classId)}`;
    if (!key.includes('::') || key.startsWith('::')) return;
    if (!byStudentClass.has(key)) byStudentClass.set(key, []);
    byStudentClass.get(key).push(row);
  });
  const plan = { moves: [], merges: [], conflicts: [], classIds: new Set() };
  secondaries.forEach((stu) => {
    const secId = toPublicId(stu.id);
    rows.filter((row) => idsEqual(row.studentId, secId)).forEach((row) => {
      const classId = toPublicId(row.classId);
      const mainKey = `${mainId}::${classId}`;
      const secKey = `${secId}::${classId}`;
      const mainRows = byStudentClass.get(mainKey) || [];
      if (!mainRows.length) {
        plan.moves.push({ type: 'enrollmentPeriod', id: row.id, classId });
        plan.classIds.add(classId);
        return;
      }
      const mainPeriod = mainRows[0];
      const mainProgramId = toPublicId(mainPeriod.programId);
      const secProgramId = toPublicId(row.programId);
      if (mainProgramId && secProgramId && !idsEqual(mainProgramId, secProgramId)) {
        plan.conflicts.push({
          classId,
          message: `Class ${classId} has enrollments for different programs (${mainProgramId} and ${secProgramId}).`
        });
      }
      const mainStart = normalizeDateOnly(mainPeriod.startDate) || '9999-99-99';
      const secStart = normalizeDateOnly(row.startDate) || '9999-99-99';
      const keepMain = mainStart <= secStart;
      plan.merges.push({
        type: 'enrollmentPeriod',
        keepId: keepMain ? mainPeriod.id : row.id,
        dropId: keepMain ? row.id : mainPeriod.id,
        classId,
        startDate: keepMain ? mainPeriod.startDate : row.startDate,
        endDate: [mainPeriod.endDate, row.endDate].filter(Boolean).sort().pop() || ''
      });
      plan.classIds.add(classId);
    });
  });
  plan.classIds = [...plan.classIds];
  return plan;
}

function sessionsMentionPeople(sessions, personIds) {
  const wanted = new Set((personIds || []).map((id) => toPublicId(id)).filter(Boolean));
  return (Array.isArray(sessions) ? sessions : []).some((session) => (
    (Array.isArray(session?.roster) ? session.roster : []).some((row) => wanted.has(toPublicId(row?.personId)))
  ));
}

async function readWorkspaceSessions(classId) {
  try {
    const sessions = await classModel.getClassSessions(classId);
    return Array.isArray(sessions) ? sessions : [];
  } catch (_) {
    return [];
  }
}

async function scanSessionCollisions({ orgId, mainPersonId, secondaryPersonIds = [], studentIds = [], classIds = [], classRows = [] }) {
  const collisions = [];
  let sessionTouchCount = 0;
  const affectedClassIds = new Set((classIds || []).map((id) => toPublicId(id)).filter(Boolean));
  const selectedStudentIds = new Set((studentIds || []).map((id) => toPublicId(id)).filter(Boolean));
  const orgClasses = (Array.isArray(classRows) ? classRows : []).filter((row) => idsEqual(row?.orgId, orgId));
  const personIds = [mainPersonId, ...secondaryPersonIds].map((id) => toPublicId(id)).filter(Boolean);

  for (const classRow of orgClasses) {
    const classId = toPublicId(classRow.id);
    if (!classId) continue;
    const legacyHit = (Array.isArray(classRow?.enrollment?.students) ? classRow.enrollment.students : [])
      .some((row) => selectedStudentIds.has(toPublicId(row?.studentId)));
    const embedded = Array.isArray(classRow.sessions) ? classRow.sessions : [];
    const workspace = await readWorkspaceSessions(classId);
    const bundles = [embedded, workspace];
    let touched = legacyHit || sessionsMentionPeople(embedded, personIds) || sessionsMentionPeople(workspace, personIds);
    for (const sessions of bundles) {
      for (const secPid of secondaryPersonIds) {
        const { collisions: hits, touchCount } = mergeSessionsForPersonSwap(sessions, mainPersonId, secPid);
        if (hits.length) collisions.push(...hits.map((row) => ({ ...row, classId })));
        if (touchCount > 0) touched = true;
        sessionTouchCount += touchCount;
      }
    }
    if (touched) affectedClassIds.add(classId);
  }
  return { sessionCollisions: collisions, sessionTouchCount, affectedClassIds: [...affectedClassIds] };
}

async function countImpacts(datasets, main, secondaries, orgId) {
  const studentCounts = {};
  let studentTotal = 0;
  secondaries.forEach((stu) => {
    const secId = toPublicId(stu.id);
    MERGE_STUDENT_ID_REGISTRY.forEach((entry) => {
      const rows = datasets[entry.key]?.rows || [];
      const result = transformStudentIdRows(entry.key, rows, secId, toPublicId(main.id), orgId);
      studentCounts[entry.key] = (studentCounts[entry.key] || 0) + result.count;
      studentTotal += result.count;
    });
  });
  const personCounts = {};
  let personTotal = 0;
  const mainPersonId = toPublicId(main.personId);
  secondaries.forEach((stu) => {
    const secPersonId = toPublicId(stu.personId);
    if (!secPersonId || idsEqual(secPersonId, mainPersonId)) return;
    MERGE_PERSON_FLAT_REGISTRY.forEach((entry) => {
      const bucket = datasets[entry.key] || {};
      const source = entry.shape === 'document' ? (bucket.doc || { byOrgId: {} }) : (bucket.rows || []);
      const result = transformPersonIdRows(entry.key, source, secPersonId, mainPersonId, orgId);
      personCounts[entry.key] = (personCounts[entry.key] || 0) + result.count;
      personTotal += result.count;
    });
  });
  return {
    studentCounts,
    studentTotal,
    personCounts,
    personTotal,
    collections: [
      ...MERGE_STUDENT_ID_REGISTRY.map((entry) => ({
        key: entry.key,
        label: entry.label,
        count: studentCounts[entry.key] || 0
      })),
      ...MERGE_PERSON_FLAT_REGISTRY.map((entry) => ({
        key: entry.key,
        label: entry.label,
        count: personCounts[entry.key] || 0
      }))
    ]
  };
}

async function buildAdmissionMergePreview({ mainStudentId, mergeStudentIds = [], reqUser, onProgress } = {}) {
  const report = (progress, operation) => {
    if (typeof onProgress === 'function') onProgress({ progress, operation });
  };
  report(8, 'Loading the selected admissions');
  const students = await schoolDataService.fetchAllData('students', {}, reqUser);
  const { main, secondaries, orgId } = resolveSelection(students, mainStudentId, mergeStudentIds);
  report(22, 'Loading registrations and class records');
  const datasets = await loadMergeDatasetMap();
  const programRows = datasets.studentProgramRegistrations?.rows || [];
  const periodRows = datasets.classEnrollmentPeriods?.rows || [];
  const termRows = datasets.studentTermRegistrations?.rows || [];
  report(40, 'Reviewing program registrations');
  const programPlan = buildProgramRegistrationPlan(main, secondaries, programRows, periodRows);
  const termPlan = buildTermRegistrationPlan(main, secondaries, termRows);
  report(55, 'Reviewing class enrollments');
  const periodPlan = buildEnrollmentPeriodPlan(main, secondaries, periodRows);
  const programNameById = new Map();
  try {
    const programs = await schoolDataService.fetchAllData('programs', {}, reqUser);
    (Array.isArray(programs) ? programs : []).forEach((row) => {
      if (row?.orgId && !idsEqual(row.orgId, orgId)) return;
      programNameById.set(toPublicId(row.id), String(row.name || row.title || '').trim());
    });
  } catch (_) {
    // Names are optional. The preview still shows the ids.
  }
  const classTitleById = new Map();
  (datasets.classes?.rows || []).forEach((row) => {
    if (row?.orgId && !idsEqual(row.orgId, orgId)) return;
    classTitleById.set(toPublicId(row.id), String(row.title || row.name || '').trim());
  });
  annotateMergePreviewLabels({ programPlan, periodPlan }, { programNameById, classTitleById });

  const secondaryPersonIds = secondaries
    .map((row) => toPublicId(row.personId))
    .filter((pid) => pid && !idsEqual(pid, toPublicId(main.personId)));

  report(72, 'Reviewing class sessions and attendance');
  const { sessionCollisions, sessionTouchCount, affectedClassIds } = await scanSessionCollisions({
    orgId,
    mainPersonId: toPublicId(main.personId),
    secondaryPersonIds,
    studentIds: [main.id, ...secondaries.map((row) => row.id)],
    classIds: periodPlan.classIds,
    classRows: datasets.classes?.rows || []
  });

  report(88, 'Counting related records');
  const impacts = await countImpacts(datasets, main, secondaries, orgId);

  const blockers = [
    ...programPlan.blocks,
    ...termPlan.blocks,
    ...(periodPlan.conflicts || []).map((row) => row.message)
  ];
  if (sessionCollisions.length) {
    sessionCollisions.forEach((hit) => {
      blockers.push(`Session ${hit.sessionId || '(unknown)'} in class ${displayLabel(classTitleById.get(toPublicId(hit.classId)), hit.classId)}: ${hit.code || 'conflict'}.`);
    });
  }

  const libraryRows = datasets.libraryPatrons?.rows || [];
  const mainPatron = libraryRows.find((row) => idsEqual(row.personId, toPublicId(main.personId)) && idsEqual(row.orgId, orgId));
  secondaryPersonIds.forEach((pid) => {
    const secPatron = libraryRows.find((row) => idsEqual(row.personId, pid) && idsEqual(row.orgId, orgId));
    if (mainPatron && secPatron && String(mainPatron.status || 'active').toLowerCase() === 'active' && String(secPatron.status || 'active').toLowerCase() === 'active') {
      blockers.push(`Both persons have active library patron records (${mainPatron.id} and ${secPatron.id}).`);
    }
  });

  const warnings = [];
  if (!assertStudentDeletionRegistryParity().ok) {
    warnings.push('Student deletion registry parity check reported gaps; some references may require manual review.');
  }
  const personById = await schoolPersonAccessService.buildPersonByIdMap({
    reqUser,
    personIds: [main, ...secondaries].map((row) => row.personId)
  });
  const admissionLabelFor = (student) => {
    const person = personById.get(toPublicId(student.personId));
    const name = schoolPersonAccessService.formatPersonName(person, '');
    const code = String(student.customStudentId || student.id || '').trim();
    return name ? `${name} (${code})` : code;
  };
  secondaries.forEach((stu) => {
    const secondaryLabel = admissionLabelFor(stu);
    const mainLabel = admissionLabelFor(main);
    warnings.push(`${secondaryLabel} may use a different name from the primary admission ${mainLabel}. Update People after the merge if the name should change.`);
  });

  const previewPayload = {
    mainStudentId: toPublicId(main.id),
    mergeStudentIds: secondaries.map((row) => toPublicId(row.id)),
    orgId,
    programPlan,
    termPlan,
    periodPlan
  };
  report(100, 'Preparing the summary');
  const previewToken = buildPreviewToken(previewPayload);

  return {
    ready: blockers.length === 0,
    previewToken,
    students: [main, ...secondaries].map((row) => {
      const person = personById.get(toPublicId(row.personId));
      const name = schoolPersonAccessService.formatPersonName(person, '');
      const code = String(row.customStudentId || row.id || '').trim();
      return {
        studentId: toPublicId(row.id),
        personId: toPublicId(row.personId),
        name: name || code,
        admissionLabel: name ? `${name} (${code})` : code,
        customStudentId: String(row.customStudentId || '').trim(),
        academicStatus: String(row.academicStatus || '').trim(),
        isMain: idsEqual(row.id, main.id)
      };
    }),
    impacts: { ...impacts, sessionTouchCount },
    registrationPlan: { program: programPlan, term: termPlan, periods: periodPlan },
    affectedClassIds,
    sessionCollisions,
    blockers,
    warnings,
    registryParity: assertStudentDeletionRegistryParity()
  };
}

function applyStudentIdMergesToDatasets(datasets, mainStudentId, secondaries, orgId) {
  let total = 0;
  secondaries.forEach((stu) => {
    const oldId = toPublicId(stu.id);
    MERGE_STUDENT_ID_REGISTRY.forEach((entry) => {
      const bucket = datasets[entry.key];
      if (!bucket) return;
      const transformed = transformStudentIdRows(entry.key, bucket.rows, oldId, mainStudentId, orgId);
      bucket.rows = transformed.rows;
      total += transformed.count;
    });
  });
  return total;
}

function applyPersonIdMergesToDatasets(datasets, mainPersonId, secondaries, orgId) {
  let total = 0;
  secondaries.forEach((stu) => {
    const oldPid = toPublicId(stu.personId);
    if (!oldPid || idsEqual(oldPid, mainPersonId)) return;
    MERGE_PERSON_FLAT_REGISTRY.forEach((entry) => {
      const bucket = datasets[entry.key];
      if (!bucket) return;
      const source = entry.shape === 'document' ? (bucket.doc || { byOrgId: {} }) : (bucket.rows || []);
      const transformed = transformPersonIdRows(entry.key, source, oldPid, mainPersonId, orgId);
      if (entry.shape === 'document') bucket.doc = transformed.doc || transformed.rows?.[0] || bucket.doc;
      else bucket.rows = transformed.rows;
      total += transformed.count;
    });
  });
  return total;
}

async function applyRegistrationPlanToDatasets(datasets, main, programPlan, termPlan, periodPlan) {
  const mainId = toPublicId(main.id);
  const mainPid = toPublicId(main.personId);
  const programRows = datasets.studentProgramRegistrations?.rows || [];
  (programPlan.dateUpdates || []).forEach((update) => {
    const idx = programRows.findIndex((row) => idsEqual(row.id, update.id));
    if (idx < 0 || !update.registrationDate) return;
    programRows[idx] = { ...programRows[idx], registrationDate: update.registrationDate };
  });
  (programPlan.adopts || programPlan.moves || []).forEach((move) => {
    const idx = programRows.findIndex((row) => idsEqual(row.id, move.id));
    if (idx < 0) return;
    programRows[idx] = {
      ...programRows[idx],
      studentId: mainId,
      personId: mainPid,
      ...(move.registrationDate ? { registrationDate: move.registrationDate } : {})
    };
  });
  const registrationIdForProgram = (programId) => {
    const match = programRows.find((row) => idsEqual(row.studentId, mainId) && idsEqual(row.programId, programId) && isActiveRegistrationStatus(row.status));
    return match ? match.id : '';
  };

  const termRows = datasets.studentTermRegistrations?.rows || [];
  termPlan.moves.forEach((move) => {
    const idx = termRows.findIndex((row) => idsEqual(row.id, move.id));
    if (idx < 0) return;
    const termKey = `${move.programId}::${move.termId}`;
    const nextDate = termPlan.earliestTermDates?.[termKey];
    termRows[idx] = {
      ...termRows[idx],
      studentId: mainId,
      personId: mainPid,
      ...(nextDate ? { registrationDate: nextDate } : {})
    };
  });
  Object.entries(termPlan.earliestTermDates || {}).forEach(([key, date]) => {
    const [programId, termId] = String(key).split('::');
    const idx = termRows.findIndex((row) => idsEqual(row.studentId, mainId) && idsEqual(row.programId, programId) && idsEqual(row.termId, termId) && isActiveRegistrationStatus(row.status));
    if (idx >= 0 && date) termRows[idx] = { ...termRows[idx], registrationDate: date };
  });
  datasets.studentTermRegistrations.rows = termRows;

  const periodRows = datasets.classEnrollmentPeriods?.rows || [];
  periodPlan.moves.forEach((move) => {
    const idx = periodRows.findIndex((row) => idsEqual(row.id, move.id));
    if (idx < 0) return;
    const programRegistrationId = registrationIdForProgram(periodRows[idx].programId) || periodRows[idx].programRegistrationId;
    periodRows[idx] = { ...periodRows[idx], studentId: mainId, personId: mainPid, programRegistrationId };
  });
  periodPlan.merges.forEach((merge) => {
    const keepIdx = periodRows.findIndex((row) => idsEqual(row.id, merge.keepId));
    if (keepIdx >= 0) {
      const programRegistrationId = registrationIdForProgram(periodRows[keepIdx].programId) || periodRows[keepIdx].programRegistrationId;
      periodRows[keepIdx] = {
        ...periodRows[keepIdx],
        studentId: mainId,
        personId: mainPid,
        programRegistrationId,
        startDate: merge.startDate || periodRows[keepIdx].startDate,
        endDate: merge.endDate || periodRows[keepIdx].endDate
      };
    }
    const dropIdx = periodRows.findIndex((row) => idsEqual(row.id, merge.dropId));
    if (dropIdx >= 0) periodRows.splice(dropIdx, 1);
  });
  datasets.classEnrollmentPeriods.rows = periodRows;
  (programPlan.voids || []).forEach((entry) => {
    const idx = programRows.findIndex((row) => idsEqual(row.id, entry.id));
    if (idx < 0) return;
    programRows[idx] = buildVoidPatch(
      programRows[idx],
      { id: 'admission-merge' },
      'Voided after this admission was merged into the primary student.'
    );
  });
  datasets.studentProgramRegistrations.rows = programRows;
}

function applyClassSessionMergesToDatasets({ datasets, orgId, mainPersonId, secondaries, classIds }) {
  const personMap = new Map();
  secondaries.forEach((stu) => {
    const sec = toPublicId(stu.personId);
    if (sec && !idsEqual(sec, mainPersonId)) personMap.set(sec, mainPersonId);
  });
  const targetIds = new Set((classIds || []).map((id) => toPublicId(id)).filter(Boolean));
  const rows = datasets.classes?.rows || [];
  const touched = [];
  datasets.classes.rows = rows.map((classRow) => {
    if (!idsEqual(classRow?.orgId, orgId)) return classRow;
    const classId = toPublicId(classRow.id);
    if (!classId || !targetIds.has(classId)) return classRow;
    let sessions = Array.isArray(classRow.sessions) ? classRow.sessions : [];
    let updated = false;
    for (const secPid of personMap.keys()) {
      const result = mergeSessionsForPersonSwap(sessions, mainPersonId, secPid);
      if (result.collisions.length) {
        throw new Error(`Session roster conflict in class ${classId} (session ${result.collisions[0].sessionId || ''}).`);
      }
      if (result.touchCount > 0) {
        sessions = result.sessions;
        updated = true;
      }
    }
    const patched = patchClassRosterMaps({ ...classRow, ...(updated ? { sessions } : {}) }, personMap);
    if (patched.changed || updated) touched.push(classId);
    return patched.changed ? patched.classRow : (updated ? { ...classRow, sessions } : classRow);
  });
  return { touchedClassIds: touched };
}

async function patchClassWorkspaceFiles({ classRows = [], classIds = [], mainPersonId, secondaries }) {
  const targetIds = new Set((classIds || []).map((id) => toPublicId(id)).filter(Boolean));
  const restores = [];
  for (const classRow of classRows) {
    const classId = toPublicId(classRow?.id);
    if (!classId || !targetIds.has(classId)) continue;
    // eslint-disable-next-line no-await-in-loop
    const originalSessions = await readWorkspaceSessions(classId);
    if (originalSessions.length) {
      let nextSessions = originalSessions;
      let touched = false;
      for (const stu of secondaries) {
        const secPid = toPublicId(stu.personId);
        if (!secPid || idsEqual(secPid, mainPersonId)) continue;
        const result = mergeSessionsForPersonSwap(nextSessions, mainPersonId, secPid);
        if (result.collisions.length) {
          throw new Error(`Workspace session roster conflict in class ${classId} (session ${result.collisions[0].sessionId || ''}).`);
        }
        if (result.touchCount > 0) {
          nextSessions = result.sessions;
          touched = true;
        }
      }
      if (touched) {
        restores.push(async () => classModel.saveClassSessions(classId, originalSessions));
        // eslint-disable-next-line no-await-in-loop
        await classModel.saveClassSessions(classId, nextSessions);
      }
    }
    const targets = buildUploadTargetsForClass(classRow);
    for (const target of targets) {
      const url = uploadStorage.uploadsUrlForParts(target.scopeKey, target.relativePath, 'gradebook.json');
      let parsed = null;
      try {
        // eslint-disable-next-line no-await-in-loop
        const data = await uploadStorage.readBuffer(url);
        parsed = JSON.parse(data.buffer.toString('utf8'));
      } catch (_) {
        parsed = null;
      }
      if (!parsed || typeof parsed !== 'object') continue;
      let nextDoc = parsed;
      let count = 0;
      secondaries.forEach((stu) => {
        const secPid = toPublicId(stu.personId);
        if (!secPid || idsEqual(secPid, mainPersonId)) return;
        const remapped = remapPersonDocument(nextDoc, secPid, mainPersonId);
        nextDoc = remapped.value;
        count += remapped.count;
      });
      if (!count) continue;
      const originalDoc = parsed;
      restores.push(async () => uploadStorage.saveJson({
        scopeKey: target.scopeKey,
        relativeDir: target.relativePath,
        fileName: 'gradebook.json',
        data: originalDoc
      }));
      // eslint-disable-next-line no-await-in-loop
      await uploadStorage.saveJson({
        scopeKey: target.scopeKey,
        relativeDir: target.relativePath,
        fileName: 'gradebook.json',
        data: nextDoc
      });
    }
  }
  return {
    rollback: async () => {
      for (const restore of restores.reverse()) {
        // eslint-disable-next-line no-await-in-loop
        await restore().catch(() => {});
      }
    }
  };
}

function applyProfileUnionToStudentRows(rows, main, secondaries) {
  const next = (Array.isArray(rows) ? rows : []).map((row) => ({ ...row }));
  const mainId = toPublicId(main?.id);
  const index = next.findIndex((row) => idsEqual(row.id, mainId));
  if (index < 0) throw new Error('Primary student row was not found.');
  next[index] = unionScalarStudentProfile(next[index], secondaries);
  const drop = new Set(secondaries.map((row) => toPublicId(row.id)));
  return next.filter((row) => !drop.has(toPublicId(row.id)));
}

function verifyNoSecondaryReferences(datasets, secondaries, orgId) {
  const remaining = [];
  secondaries.forEach((stu) => {
    const sid = toPublicId(stu.id);
    const pid = toPublicId(stu.personId);
    const studentHits = countStudentIdReferences(datasets, sid, orgId);
    if (studentHits.total > 0) {
      remaining.push({ type: 'studentId', studentId: sid, counts: studentHits.counts, total: studentHits.total });
    }
    if (pid) {
      const personHits = countPersonIdReferences(datasets, pid, orgId);
      if (personHits.total > 0) {
        remaining.push({ type: 'personId', personId: pid, counts: personHits.counts, total: personHits.total });
      }
    }
  });
  return remaining;
}

async function purgeSecondaryStudent(student, reqUser, warnings) {
  const dataService = requireCoreModule('MVC/services/dataService');
  const activeOrgId = toPublicId(student.orgId);
  const personId = toPublicId(student.personId);

  let roleResult = null;
  try {
    roleResult = await schoolPersonAccessService.removePersonSchoolRole({
      personId,
      orgId: activeOrgId,
      role: 'school_student',
      reqUser
    });
  } catch (error) {
    warnings.push(`Could not remove the school student role for person ${personId}: ${error.message}`);
  }

  const linkedAccountId = String(student?.studentAccountId || '').trim();
  if (linkedAccountId) {
    try {
      await dataService.purgeData('schoolAccounts', linkedAccountId, reqUser, { skipDeletionGuard: true });
    } catch (error) {
      warnings.push(`Could not purge school account ${linkedAccountId}: ${error.message}`);
    }
  }

  let personPurged = false;
  if (personId) {
    const otherStudents = await schoolDataService.fetchData('students', { personId__eq: personId, page: 1, limit: 5 }, reqUser);
    if (otherStudents.length) {
      warnings.push(`Person ${personId} still has another student admission and was kept.`);
    } else {
      try {
        await dataService.deleteData('persons', personId, reqUser);
        personPurged = true;
      } catch (error) {
        warnings.push(`Person ${personId} was not deleted: ${error.message}`);
      }
    }
  }
  return { personPurged, removedRole: Boolean(roleResult?.changed) };
}

async function writeMergeAudit(record) {
  await queueWrite(async () => {
    const filePath = path.join(DATA_DIR, AUDIT_FILE);
    let rows = [];
    try {
      rows = JSON.parse(await fs.readFile(filePath, 'utf8') || '[]');
      if (!Array.isArray(rows)) rows = [];
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    rows.push(record);
    await fs.writeFile(filePath, JSON.stringify(rows, null, 2));
  });
}

async function executeAdmissionMerge({
  mainStudentId,
  mergeStudentIds = [],
  previewToken = '',
  confirmation = '',
  reqUser,
  actor = ''
} = {}) {
  if (String(confirmation || '').trim().toUpperCase() !== 'MERGE') {
    throw new Error('Type MERGE to confirm this operation.');
  }
  const preview = await buildAdmissionMergePreview({ mainStudentId, mergeStudentIds, reqUser });
  if (!preview.ready) {
    throw new Error(preview.blockers[0] || 'Merge is blocked. Refresh the preview.');
  }
  if (previewToken && previewToken !== preview.previewToken) {
    throw new Error('Preview is stale. Run preview again before merging.');
  }

  const students = await schoolDataService.fetchAllData('students', {}, reqUser);
  const { main, secondaries, orgId } = resolveSelection(students, mainStudentId, mergeStudentIds);
  await studentSystemIdMigrationLockService.assertWriteAllowed('students', orgId);

  const datasets = await loadMergeDatasetMap();
  const journalToken = crypto.randomBytes(6).toString('hex');

  const mainId = toPublicId(main.id);
  const mainPersonId = toPublicId(main.personId);

  let persisted = null;
  let workspacePatch = null;
  let studentUpdates = 0;
  let personUpdates = 0;
  const warnings = [];
  const personsNotPurged = [];
  const affectedClassIds = preview.affectedClassIds || [];

  try {
    datasets.students.rows = applyProfileUnionToStudentRows(datasets.students.rows, main, secondaries);

    await applyRegistrationPlanToDatasets(
      datasets,
      main,
      preview.registrationPlan.program,
      preview.registrationPlan.term,
      preview.registrationPlan.periods
    );

    studentUpdates = applyStudentIdMergesToDatasets(datasets, mainId, secondaries, orgId);
    personUpdates = applyPersonIdMergesToDatasets(datasets, mainPersonId, secondaries, orgId);
    applyClassSessionMergesToDatasets({
      datasets,
      orgId,
      mainPersonId,
      secondaries,
      classIds: affectedClassIds
    });

    persisted = await persistMergeDataset(datasets, { token: journalToken });
    workspacePatch = await patchClassWorkspaceFiles({
      classRows: datasets.classes?.rows || [],
      classIds: affectedClassIds,
      mainPersonId,
      secondaries
    });

    const verifyDatasets = await loadMergeDatasetMap();
    const remaining = verifyNoSecondaryReferences(verifyDatasets, secondaries, orgId);
    if (remaining.length) {
      const error = new Error('Post-merge verification failed: references remain on secondary admissions.');
      error.remaining = remaining;
      throw error;
    }

    for (const classId of affectedClassIds) {
      // eslint-disable-next-line no-await-in-loop
      await schoolIndexService.rebuildIndexesForClass(classId);
    }

    for (const stu of secondaries) {
      try {
        const purgeResult = await purgeSecondaryStudent(stu, reqUser, warnings);
        if (!purgeResult.personPurged && toPublicId(stu.personId)) {
          personsNotPurged.push(toPublicId(stu.personId));
        }
      } catch (error) {
        warnings.push(`Secondary admission ${toPublicId(stu.id)} could not be fully purged: ${error.message}`);
        if (toPublicId(stu.personId)) personsNotPurged.push(toPublicId(stu.personId));
      }
    }

    if (persisted?.cleanupBackups) await persisted.cleanupBackups();
  } catch (error) {
    if (workspacePatch?.rollback) await workspacePatch.rollback();
    if (persisted?.rollback) await persisted.rollback();
    throw error;
  }

  const auditId = `SAM-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  await writeMergeAudit({
    id: auditId,
    orgId,
    mainStudentId: mainId,
    mergedStudentIds: secondaries.map((row) => toPublicId(row.id)),
    mainPersonId,
    mergedPersonIds: secondaries.map((row) => toPublicId(row.personId)),
    studentReferenceUpdates: studentUpdates,
    personReferenceUpdates: personUpdates,
    actor: String(actor || reqUser?.id || '').trim(),
    createdAt: new Date().toISOString(),
    warnings,
    personsNotPurged
  });

  return {
    auditId,
    mainStudentId: mainId,
    redirectTo: `/school/students/edit/${encodeURIComponent(mainId)}`,
    warnings,
    personsNotPurged,
    studentReferenceUpdates: studentUpdates,
    personReferenceUpdates: personUpdates
  };
}

module.exports = {
  buildAdmissionMergePreview,
  executeAdmissionMerge,
  assertStudentDeletionRegistryParity,
  buildProgramRegistrationPlan,
  buildTermRegistrationPlan,
  buildEnrollmentPeriodPlan,
  applyProfileUnionToStudentRows
};
