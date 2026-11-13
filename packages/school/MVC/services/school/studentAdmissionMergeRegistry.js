'use strict';

const crypto = require('crypto');
const studentSystemIdMigrationService = require('./studentSystemIdMigrationService');
const { getEntityDefinition } = require('./schoolDeletionRuleRegistry');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual: idsEqualCore, toPublicId: toPublicIdCore } = requireCoreModule('MVC/utils/idAdapter');

function idsEqual(left, right) {
  return idsEqualCore(left, right);
}

function toPublicId(value) {
  return toPublicIdCore(value);
}

function cleanId(value) {
  return String(value || '').trim();
}

const INACTIVE_PROGRAM_STATUSES = new Set([
  'withdrawn', 'cancelled', 'completed', 'rolled_back', 'void', 'archived'
]);

function isActiveRegistrationStatus(status) {
  const token = String(status || 'registered').trim().toLowerCase();
  return token && !INACTIVE_PROGRAM_STATUSES.has(token);
}

const MERGE_STUDENT_ID_REGISTRY = Object.freeze([
  ...studentSystemIdMigrationService.REFERENCE_REGISTRY.filter((entry) => entry.key !== 'students'),
  {
    key: 'overallReportInstances',
    file: 'overallReportInstances.json',
    collection: 'schoolOverallReportInstances',
    label: 'Overall report instances'
  },
  {
    key: 'overallReportManagementSessions',
    file: 'overallReportManagementSessions.json',
    collection: 'schoolOverallReportManagementSessions',
    label: 'Overall report management sessions'
  }
]);

const MERGE_PERSON_FLAT_REGISTRY = Object.freeze([
  { key: 'studentProgramRegistrations', file: 'studentProgramRegistrations.json', collection: 'schoolStudentProgramRegistrations', label: 'Program registrations (personId)' },
  { key: 'studentTermRegistrations', file: 'studentTermRegistrations.json', collection: 'schoolStudentTermRegistrations', label: 'Term registrations (personId)' },
  { key: 'classEnrollmentPeriods', file: 'classEnrollmentPeriods.json', collection: 'schoolClassEnrollmentPeriods', label: 'Enrollment periods (personId)' },
  { key: 'sessionStudentCases', file: 'sessionStudentCases.json', collection: 'schoolSessionStudentCases', label: 'Session student cases' },
  { key: 'attendanceChangeLogs', file: 'attendanceChangeLogs.json', collection: 'schoolAttendanceChangeLogs', label: 'Attendance change logs' },
  { key: 'schedulePersonNotes', file: 'schedulePersonNotes.json', collection: 'schoolSchedulePersonNotes', label: 'Schedule person notes', shape: 'document', mongoId: 'schedule-person-notes' },
  { key: 'libraryPatrons', file: 'libraryPatrons.json', collection: 'schoolLibraryPatrons', label: 'Library patrons' },
  { key: 'libraryLoans', file: 'libraryLoans.json', collection: 'schoolLibraryLoans', label: 'Library loans' },
  { key: 'activities', file: 'activities.json', collection: 'schoolActivities', label: 'Activities' },
  { key: 'tasks', file: 'tasks.json', collection: 'schoolTasks', label: 'Tasks' },
  { key: 'academicLedger', file: 'academicLedger.json', collection: 'schoolAcademicLedger', label: 'Academic ledger (personId)' },
  { key: 'academicSnapshots', file: 'academicSnapshots.json', collection: 'schoolAcademicSnapshots', label: 'Academic snapshots (personId)' },
  { key: 'withdrawals', file: 'withdrawals.json', collection: 'schoolWithdrawals', label: 'Withdrawals (personId)' },
  { key: 'globalTransactions', file: 'globalTransactionLedger.json', collection: 'schoolGlobalTransactions', label: 'Financial transactions (personId)' },
  { key: 'examAssignments', file: 'examAssignments.json', collection: 'schoolExamAssignments', label: 'Exam assignments (personId)' },
  { key: 'examAttempts', file: 'examAttempts.json', collection: 'schoolExamAttempts', label: 'Exam attempts (personId)' },
  { key: 'examAnswers', file: 'examAnswers.json', collection: 'schoolExamAnswers', label: 'Exam answers (personId)' },
  { key: 'reportInstances', file: 'reportInstances.json', collection: 'schoolReportInstances', label: 'Report instances (personId)' },
  { key: 'reportAssignments', file: 'reportAssignments.json', collection: 'schoolReportAssignments', label: 'Report assignments (personId)' },
  { key: 'overallReportInstances', file: 'overallReportInstances.json', collection: 'schoolOverallReportInstances', label: 'Overall report instances (personId)' },
  { key: 'overallReportManagementSessions', file: 'overallReportManagementSessions.json', collection: 'schoolOverallReportManagementSessions', label: 'Overall report management sessions (personId)' }
]);

const PERSON_SCALAR_KEYS = new Set([
  'personId',
  'studentPersonId',
  'assignedPersonId',
  'targetPersonId',
  'studentId'
]);

const PERSON_ARRAY_KEYS = new Set([
  'personId',
  'studentPersonId',
  'assignedPersonId',
  'targetPersonId',
  'allowedPersonIds',
  'excludedPersonIds',
  'targetStudentIds',
  'studentIds'
]);

const STUDENT_RECORD_SCALAR_KEYS = new Set(['studentId', 'student_record_id']);
const STUDENT_RECORD_ARRAY_KEYS = new Set(['studentIds', 'targetStudentIds', 'exemptStudentIds']);

function replaceArrayPersonIds(values, oldId, newId) {
  if (!Array.isArray(values)) return { value: values, count: 0 };
  let count = 0;
  const value = values.map((item) => {
    if (!idsEqual(item, oldId)) return item;
    count += 1;
    return newId;
  });
  return { value, count };
}

function replaceScalarId(raw, oldId, newId, countRef) {
  if (!idsEqual(raw, oldId)) return raw;
  countRef.count += 1;
  return newId;
}

function deepReplaceIdFields(value, oldId, newId, countRef, scalarKeys, arrayKeys) {
  if (Array.isArray(value)) {
    return value.map((item) => deepReplaceIdFields(item, oldId, newId, countRef, scalarKeys, arrayKeys));
  }
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  const output = {};
  Object.entries(value).forEach(([key, raw]) => {
    if (key === 'targetKey' && typeof raw === 'string') {
      const prefix = 'student:';
      if (raw.startsWith(prefix) && idsEqual(raw.slice(prefix.length), oldId)) {
        output[key] = `${prefix}${newId}`;
        countRef.count += 1;
        return;
      }
    }
    if (scalarKeys.has(key) && !Array.isArray(raw)) {
      output[key] = replaceScalarId(raw, oldId, newId, countRef);
      return;
    }
    if (arrayKeys.has(key) && Array.isArray(raw)) {
      const replaced = replaceArrayPersonIds(raw, oldId, newId);
      output[key] = replaced.value;
      countRef.count += replaced.count;
      return;
    }
    output[key] = deepReplaceIdFields(raw, oldId, newId, countRef, scalarKeys, arrayKeys);
  });
  return output;
}

function transformOverallReportInstances(rows, oldStudentId, newStudentId, orgId) {
  let count = 0;
  const output = (Array.isArray(rows) ? rows : []).map((source) => {
    const row = source && typeof source === 'object' ? { ...source } : source;
    if (!row || typeof row !== 'object') return row;
    const rowOrgId = String(row.orgId || '').trim();
    if (orgId && rowOrgId && !idsEqual(rowOrgId, orgId)) return row;
    const countRef = { count: 0 };
    const next = deepReplaceIdFields(row, oldStudentId, newStudentId, countRef, STUDENT_RECORD_SCALAR_KEYS, STUDENT_RECORD_ARRAY_KEYS);
    count += countRef.count;
    return next;
  });
  return { rows: output, count };
}

function transformStudentIdRows(key, inputRows, oldStudentId, newStudentId, orgId = '') {
  if (key === 'overallReportInstances' || key === 'overallReportManagementSessions') {
    return transformOverallReportInstances(inputRows, oldStudentId, newStudentId, orgId);
  }
  const base = studentSystemIdMigrationService.transformRows(key, inputRows, oldStudentId, newStudentId, orgId);
  let extra = 0;
  const rows = base.rows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const rowOrgId = String(row.orgId || '').trim();
    if (orgId && rowOrgId && !idsEqual(rowOrgId, orgId)) return row;
    const countRef = { count: 0 };
    const next = deepReplaceIdFields(row, oldStudentId, newStudentId, countRef, STUDENT_RECORD_SCALAR_KEYS, STUDENT_RECORD_ARRAY_KEYS);
    extra += countRef.count;
    return next;
  });
  return { rows, count: base.count + extra };
}

function transformPersonIdRows(key, inputRows, oldPersonId, newPersonId, orgId = '') {
  if (key === 'schedulePersonNotes') {
    return transformSchedulePersonNotesDoc(inputRows, oldPersonId, newPersonId, orgId);
  }
  let count = 0;
  const output = (Array.isArray(inputRows) ? inputRows : []).map((source) => {
    const row = source && typeof source === 'object' ? { ...source } : source;
    if (!row || typeof row !== 'object') return row;
    const rowOrgId = String(row.orgId || '').trim();
    if (orgId && rowOrgId && !idsEqual(rowOrgId, orgId)) return row;
    const countRef = { count: 0 };
    const next = deepReplaceIdFields(row, oldPersonId, newPersonId, countRef, PERSON_SCALAR_KEYS, PERSON_ARRAY_KEYS);
    count += countRef.count;
    return next;
  });
  return { rows: output, count };
}

function transformSchedulePersonNotesDoc(doc, oldPersonId, newPersonId, orgId = '') {
  const source = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : { byOrgId: {} };
  const next = JSON.parse(JSON.stringify(source));
  if (!next.byOrgId || typeof next.byOrgId !== 'object' || Array.isArray(next.byOrgId)) next.byOrgId = {};
  let count = 0;
  Object.entries(next.byOrgId).forEach(([orgKey, orgRow]) => {
    if (orgId && orgKey !== orgId && orgKey !== 'SYSTEM') return;
    if (!orgRow || typeof orgRow !== 'object') return;
    const byPersonId = orgRow.byPersonId && typeof orgRow.byPersonId === 'object' ? orgRow.byPersonId : null;
    if (!byPersonId) return;
    const matchedKey = Object.keys(byPersonId).find((key) => idsEqual(key, oldPersonId));
    if (!matchedKey) return;
    const mainKey = Object.keys(byPersonId).find((key) => idsEqual(key, newPersonId));
    if (!mainKey) byPersonId[newPersonId] = byPersonId[matchedKey];
    delete byPersonId[matchedKey];
    count += 1;
  });
  return { doc: next, rows: [next], count };
}

function readMergeStorePayload(parsed, shape = 'array') {
  if (shape === 'document') {
    if (Array.isArray(parsed)) {
      const error = new Error('Schedule person notes must stay an object. Refusing to overwrite them with an array.');
      error.code = 'MERGE_STORE_SHAPE';
      throw error;
    }
    return { doc: parsed && typeof parsed === 'object' ? parsed : { byOrgId: {} } };
  }
  if (parsed == null) return { rows: [] };
  if (!Array.isArray(parsed)) {
    const error = new Error('Merge store must contain a JSON array.');
    error.code = 'MERGE_STORE_SHAPE';
    throw error;
  }
  return { rows: parsed };
}

function remapPersonDocument(doc, oldPersonId, newPersonId) {
  const countRef = { count: 0 };
  const value = deepReplaceIdFields(doc, oldPersonId, newPersonId, countRef, PERSON_SCALAR_KEYS, PERSON_ARRAY_KEYS);
  return { value, count: countRef.count };
}

function countStudentIdReferences(datasets, studentId, orgId) {
  const counts = {};
  let total = 0;
  MERGE_STUDENT_ID_REGISTRY.forEach((entry) => {
    const rows = datasets[entry.key]?.rows || datasets[entry.key] || [];
    const c = transformStudentIdRows(entry.key, Array.isArray(rows) ? rows : [], studentId, '__NOOP__', orgId).count;
    counts[entry.key] = c;
    total += c;
  });
  return { counts, total };
}

function countPersonIdReferences(datasets, personId, orgId) {
  const counts = {};
  let total = 0;
  MERGE_PERSON_FLAT_REGISTRY.forEach((entry) => {
    const bucket = datasets[entry.key] || {};
    const source = entry.shape === 'document' ? (bucket.doc || { byOrgId: {} }) : (bucket.rows || bucket || []);
    const c = transformPersonIdRows(entry.key, source, personId, '__NOOP__', orgId).count;
    counts[entry.key] = c;
    total += c;
  });
  return { counts, total };
}

function rosterAttendanceToken(row = {}) {
  return String(row.attendance || row.status || '').trim().toLowerCase();
}

function rosterConflict(mainRow = {}, secondaryRow = {}) {
  const mainAtt = rosterAttendanceToken(mainRow);
  const secAtt = rosterAttendanceToken(secondaryRow);
  if (mainAtt && secAtt && mainAtt !== secAtt) {
    return { code: 'attendance_mismatch', main: mainAtt, secondary: secAtt };
  }
  const mainConduct = String(mainRow.conductSummary || mainRow.conduct || '').trim();
  const secConduct = String(secondaryRow.conductSummary || secondaryRow.conduct || '').trim();
  if (mainConduct && secConduct && mainConduct !== secConduct) {
    return { code: 'conduct_mismatch', main: mainConduct, secondary: secConduct };
  }
  return null;
}

function mergeRosterRows(mainRow = {}, secondaryRow = {}) {
  const next = { ...mainRow };
  Object.entries(secondaryRow).forEach(([key, value]) => {
    if (key === 'personId') return;
    if (next[key] === undefined || next[key] === null || next[key] === '') {
      next[key] = value;
    }
  });
  return next;
}

function remapGradebookPersonKeys(gradebook, mainPid, secPid) {
  if (!gradebook || typeof gradebook !== 'object') return { value: gradebook, touchCount: 0 };
  const next = { ...gradebook };
  let touchCount = 0;
  ['scores', 'students', 'rows', 'cells'].forEach((bucketKey) => {
    const bucket = next[bucketKey];
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) return;
    if (!Object.prototype.hasOwnProperty.call(bucket, secPid)) return;
    if (!Object.prototype.hasOwnProperty.call(bucket, mainPid)) {
      next[bucketKey] = { ...bucket, [mainPid]: bucket[secPid] };
    } else {
      next[bucketKey] = { ...bucket };
    }
    delete next[bucketKey][secPid];
    touchCount += 1;
  });
  return { value: next, touchCount };
}

function mergeSessionsForPersonSwap(sessions = [], mainPersonId = '', secondaryPersonId = '') {
  const mainPid = toPublicId(mainPersonId);
  const secPid = toPublicId(secondaryPersonId);
  const collisions = [];
  let touchCount = 0;
  if (!mainPid || !secPid || idsEqual(mainPid, secPid)) {
    return { sessions, collisions, touchCount };
  }
  const nextSessions = (Array.isArray(sessions) ? sessions : []).map((session) => {
    const roster = Array.isArray(session?.roster) ? session.roster.map((row) => ({ ...row })) : [];
    const mainIdx = roster.findIndex((row) => idsEqual(row?.personId, mainPid));
    const secIdx = roster.findIndex((row) => idsEqual(row?.personId, secPid));
    let nextSession = session;
    let rosterChanged = false;
    if (secIdx >= 0 && mainIdx >= 0) {
      const conflict = rosterConflict(roster[mainIdx], roster[secIdx]);
      if (conflict) {
        collisions.push({
          sessionId: String(session?.sessionId || session?.id || '').trim(),
          classId: String(session?.classId || '').trim(),
          ...conflict
        });
        return session;
      }
    }
    if (secIdx >= 0) {
      touchCount += 1;
      rosterChanged = true;
      if (mainIdx < 0) roster[secIdx].personId = mainPid;
      else {
        roster[mainIdx] = mergeRosterRows(roster[mainIdx], roster[secIdx]);
        roster.splice(secIdx, 1);
      }
    }
    const gradebookSwap = remapGradebookPersonKeys(session.gradebook, mainPid, secPid);
    touchCount += gradebookSwap.touchCount;
    let gradebooksTouched = 0;
    const gradebooks = Array.isArray(session?.gradebooks)
      ? session.gradebooks.map((gradebook) => {
        const swapped = remapGradebookPersonKeys(gradebook, mainPid, secPid);
        gradebooksTouched += swapped.touchCount;
        return swapped.touchCount ? swapped.value : gradebook;
      })
      : session?.gradebooks;
    touchCount += gradebooksTouched;
    if (!rosterChanged && !gradebookSwap.touchCount && !gradebooksTouched) return session;
    nextSession = {
      ...session,
      ...(rosterChanged ? { roster } : {}),
      ...(gradebookSwap.touchCount ? { gradebook: gradebookSwap.value } : {}),
      ...(Array.isArray(session?.gradebooks) ? { gradebooks } : {})
    };
    return nextSession;
  });
  return { sessions: nextSessions, collisions, touchCount };
}

function patchClassRosterMaps(classRow = {}, personIdMap = new Map()) {
  const next = { ...classRow };
  const order = Array.isArray(next.attendanceRosterPersonOrder)
    ? next.attendanceRosterPersonOrder.map((id) => toPublicId(id)).filter(Boolean)
    : [];
  const nicknames = next.attendanceRosterNicknames && typeof next.attendanceRosterNicknames === 'object'
    ? { ...next.attendanceRosterNicknames }
    : {};
  let changed = false;
  personIdMap.forEach((mainPid, secPid) => {
    if (!secPid || !mainPid || idsEqual(secPid, mainPid)) return;
    const orderIdx = order.findIndex((id) => idsEqual(id, secPid));
    if (orderIdx >= 0) {
      if (!order.some((id) => idsEqual(id, mainPid))) {
        order[orderIdx] = mainPid;
      } else {
        order.splice(orderIdx, 1);
      }
      changed = true;
    }
    if (nicknames[secPid]) {
      if (!nicknames[mainPid]) nicknames[mainPid] = nicknames[secPid];
      delete nicknames[secPid];
      changed = true;
    }
  });
  if (changed) {
    next.attendanceRosterPersonOrder = order;
    next.attendanceRosterNicknames = nicknames;
  }
  return { classRow: next, changed };
}

function unionScalarStudentProfile(mainStudent = {}, secondaryStudents = []) {
  const next = { ...mainStudent };
  const claimSet = new Set(
    (Array.isArray(next.claimNumbers) ? next.claimNumbers : [])
      .map((row) => JSON.stringify(row))
  );
  const claims = Array.isArray(next.claimNumbers) ? [...next.claimNumbers] : [];
  let clbHistory = Array.isArray(next.clbLevelHistory) ? [...next.clbLevelHistory] : [];
  let enrollmentDate = String(next.enrollmentDate || '').trim();
  let notes = String(next.notes || '').trim();

  (Array.isArray(secondaryStudents) ? secondaryStudents : []).forEach((stu) => {
    (Array.isArray(stu.claimNumbers) ? stu.claimNumbers : []).forEach((row) => {
      const key = JSON.stringify(row);
      if (!claimSet.has(key)) {
        claimSet.add(key);
        claims.push(row);
      }
    });
    clbHistory = clbHistory.concat(Array.isArray(stu.clbLevelHistory) ? stu.clbLevelHistory : []);
    const secEnroll = String(stu.enrollmentDate || '').trim();
    if (secEnroll && (!enrollmentDate || secEnroll < enrollmentDate)) enrollmentDate = secEnroll;
    const secNotes = String(stu.notes || '').trim();
    if (secNotes) {
      notes = notes ? `${notes}\n---\n${secNotes}` : secNotes;
    }
  });

  clbHistory.sort((a, b) => String(a?.effectiveDate || a?.date || '').localeCompare(String(b?.effectiveDate || b?.date || '')));
  next.claimNumbers = claims;
  next.clbLevelHistory = clbHistory.slice(0, 100);
  if (enrollmentDate) next.enrollmentDate = enrollmentDate;
  if (notes) next.notes = notes.slice(0, 8000);
  return next;
}

function buildPreviewToken(payload = {}) {
  const raw = JSON.stringify(payload);
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function assertStudentDeletionRegistryParity() {
  const def = getEntityDefinition('student');
  const rules = Array.isArray(def?.fieldRules) ? def.fieldRules : [];
  const entityTypes = new Set(rules.map((row) => String(row.entityType || '').trim()).filter(Boolean));
  const covered = new Set(MERGE_STUDENT_ID_REGISTRY.map((row) => {
    const map = {
      studentProgramRegistrations: 'studentProgramRegistrations',
      studentTermRegistrations: 'studentTermRegistrations',
      classEnrollmentPeriods: 'classEnrollmentPeriods',
      academicLedger: 'academicLedger',
      globalTransactions: 'globalTransactions',
      reportInstances: 'reportInstances',
      examAssignments: 'examAssignments',
      examAttempts: 'examAttempts',
      examAnswers: 'examAnswers'
    };
    return map[row.key] || row.key;
  }));
  const missing = [...entityTypes].filter((type) => !covered.has(type));
  return { ok: missing.length === 0, missing, covered: [...covered] };
}

module.exports = {
  MERGE_STUDENT_ID_REGISTRY,
  MERGE_PERSON_FLAT_REGISTRY,
  INACTIVE_PROGRAM_STATUSES,
  isActiveRegistrationStatus,
  transformStudentIdRows,
  transformPersonIdRows,
  transformSchedulePersonNotesDoc,
  readMergeStorePayload,
  remapPersonDocument,
  countStudentIdReferences,
  countPersonIdReferences,
  mergeSessionsForPersonSwap,
  patchClassRosterMaps,
  unionScalarStudentProfile,
  buildPreviewToken,
  assertStudentDeletionRegistryParity,
  rosterConflict
};
