'use strict';

const schoolDataService = require('./schoolDataService');
const classEnrollmentReadService = require('./classEnrollmentReadService');
const classSessionCapacityService = require('./classSessionCapacityService');
const classEnrollmentSessionApplicabilityService = require('./classEnrollmentSessionApplicabilityService');
const scheduleSessionContextService = require('./scheduleSessionContextService');
const rollingEnrollmentSessionAlignmentService = require('./rollingEnrollmentSessionAlignmentService');
const rollingEnrollmentFunderService = require('./rollingEnrollmentFunderService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const programRegistrationApplyService = require('./programRegistrationApplyService');
const registrationIntegrityService = require('./registrationIntegrityService');
const programRegistrationController = require('../../controllers/school/programRegistrationController');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const { resolveOrgTodayFromContext } = requireCoreModule('MVC/utils/timezoneUtils');

function normalizeDateOnly(value) {
  const token = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) return '';
  return token;
}

function buildRollingProgramChoices(classData = {}) {
  const rows = Array.isArray(classData?.allowedProgramTerms) ? classData.allowedProgramTerms : [];
  const out = [];
  rows.forEach((row, index) => {
    const programId = toPublicId(row?.programId);
    if (!programId) return;
    const termId = toPublicId(row?.termId);
    const programName = String(row?.programName || '').trim();
    const programCode = String(row?.programCode || '').trim();
    const termName = String(row?.termName || '').trim();
    const termCode = String(row?.termCode || '').trim();
    let label = programName || programId;
    if (programCode) label += ` (${programCode})`;
    label += termId ? ` — ${termName || termCode || termId}` : ' — Any term';
    out.push({ programId, termId: termId || '', label, order: Number(row?.order) || index + 1 });
  });
  out.sort((a, b) => a.order - b.order);
  return out;
}

function parseSessionsFromBody(body = {}) {
  const mode = String(body?.sessionMode || body?.mode || '').trim().toLowerCase();
  const normalizedMode = mode === 'staged' ? 'staged' : (mode === 'saved' ? 'saved' : '');
  const raw = Array.isArray(body?.sessions) ? body.sessions : [];
  const sessions = raw.map((row) => ({
    classId: toPublicId(row?.classId),
    sessionId: toPublicId(row?.sessionId || row?.id),
    date: normalizeDateOnly(row?.date),
    start: String(row?.start || '').trim(),
    end: String(row?.end || '').trim()
  })).filter((row) => row.classId && row.sessionId && row.date);
  return { sessionMode: normalizedMode, sessions };
}

function assertRollingClass(classData) {
  if (!classEnrollmentReadService.isRollingClassItem(classData)) {
    throw new Error('Enroll Students is only available for rolling enrollment classes.');
  }
}

async function loadClassOrThrow(classId, reqUser, accessContext) {
  const id = toPublicId(classId);
  if (!id) throw new Error('classId is required.');
  const classData = await schoolDataService.getDataById('classes', id, reqUser, accessContext);
  if (!classData) throw new Error('Class not found.');
  assertRollingClass(classData);
  return classData;
}

async function loadActiveFunderOptions(reqUser, orgId) {
  const orgToken = toPublicId(orgId);
  if (!orgToken) return [];
  const rows = await schoolDataService.fetchAllData('funders', {}, reqUser);
  const scoped = (Array.isArray(rows) ? rows : []).filter((row) => {
    if (!idsEqual(row?.orgId, orgToken)) return false;
    return String(row?.status || '').trim().toLowerCase() === 'active';
  });
  const personById = await schoolPersonAccessService.buildPersonByIdMap({
    reqUser,
    personIds: scoped.map((row) => row.personId)
  });
  return scoped
    .map((row) => {
      const id = toPublicId(row?.id);
      if (!id) return null;
      const personId = toPublicId(row?.personId);
      const label = schoolPersonAccessService.formatPersonName(personById.get(personId), id)
        || String(personById.get(personId)?.organizationProfile?.legalName || '').trim()
        || id;
      return { id, label, personId };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));
}

function summarizeSessionWindow(sessions = []) {
  const dates = sessions.map((row) => row.date).filter(Boolean).sort();
  return {
    startDate: dates[0] || '',
    endDate: dates[dates.length - 1] || '',
    sessionCount: sessions.length
  };
}

function sumSelectedSessionDurationHours(sessions = []) {
  const total = (Array.isArray(sessions) ? sessions : []).reduce(
    (sum, row) => sum + classEnrollmentSessionApplicabilityService.resolveSessionDurationHours({
      durationHours: row?.durationHours,
      start: row?.start,
      end: row?.end,
      startTime: row?.startTime || row?.start,
      endTime: row?.endTime || row?.end
    }),
    0
  );
  return classEnrollmentSessionApplicabilityService.normalizeTargetHours(total);
}

async function prepareEnrollStudents({ classId, sessionMode, sessions, reqUser, accessContext }) {
  if (!sessionMode) throw new Error('sessionMode must be saved or staged.');
  if (!Array.isArray(sessions) || sessions.length < 2) {
    throw new Error('Select at least two sessions in the same rolling class.');
  }
  const classIds = new Set(sessions.map((row) => row.classId).filter(Boolean));
  if (classIds.size !== 1) throw new Error('Selected sessions must belong to one class.');
  const resolvedClassId = [...classIds][0];
  if (classId && !idsEqual(classId, resolvedClassId)) {
    throw new Error('Selected sessions do not match the requested class.');
  }
  const classData = await loadClassOrThrow(resolvedClassId, reqUser, accessContext);
  const window = summarizeSessionWindow(sessions);
  const minTargetHours = sumSelectedSessionDurationHours(sessions);
  const sessionCapacityType = classSessionCapacityService.resolveEffectiveSessionCapacityType(classData, null);
  const maxCapacity = classSessionCapacityService.resolveClassMaxCapacity(classData);
  const funderOptions = await loadActiveFunderOptions(reqUser, classData.orgId);
  const cycleStart = normalizeDateOnly(classData?.enrollment?.cycleStartDate || classData?.cycleStartDate);
  const cycleEnd = normalizeDateOnly(classData?.enrollment?.cycleEndDate || classData?.cycleEndDate);
  return {
    sessionMode,
    classId: toPublicId(classData.id),
    className: String(classData?.name || classData?.className || classData.id || '').trim(),
    ...window,
    minTargetHours,
    sessionCapacityType,
    maxCapacity,
    multiselectStudents: sessionCapacityType !== 'one_on_one' && maxCapacity !== 1,
    funderOptions,
    cycleStartDate: cycleStart,
    cycleEndDate: cycleEnd,
    sessions
  };
}

async function checkOneOnOneSessionOccupancy({ classData, sessions, reqUser, sessionMode = '' }) {
  if (String(sessionMode || '').trim().toLowerCase() === 'staged') {
    return { blocked: false, conflicts: [] };
  }
  if (!classSessionCapacityService.isRollingCapacityOneClass(classData)) {
    return { blocked: false, conflicts: [] };
  }
  const conflicts = [];
  for (const row of sessions) {
    const payload = await scheduleSessionContextService.buildSessionEnrollmentList({
      classId: classData.id,
      sessionId: row.sessionId,
      reqUser,
      asOfDate: row.date
    });
    const students = Array.isArray(payload?.students) ? payload.students : [];
    if (!students.length) continue;
    conflicts.push({
      sessionId: row.sessionId,
      date: row.date,
      start: String(payload?.session?.start || row.start || '').trim(),
      end: String(payload?.session?.end || row.end || '').trim(),
      students: students.map((s) => ({
        personId: toPublicId(s?.personId),
        name: String(s?.name || '').trim()
      })).filter((s) => s.name || s.personId)
    });
  }
  return { blocked: conflicts.length > 0, conflicts };
}

async function listStudentPickerExclusions({ classData, startDate, endDate, reqUser, activeOrgId }) {
  const { studentIds } = await classEnrollmentReadService.listActiveStudentIdsForClass({
    classId: classData.id,
    classItem: classData,
    reqUser,
    activeOrgId,
    startDate,
    endDate,
    sessionDates: [],
    canonicalStatuses: ['active', 'planned', 'to_be_confirmed']
  });
  return Array.from(studentIds instanceof Set ? studentIds : []).map((id) => toPublicId(id)).filter(Boolean);
}

async function findApprovedProgramRegistration(classData, student, reqUser) {
  const choices = buildRollingProgramChoices(classData);
  if (!choices.length) return null;
  const studentId = toPublicId(student?.id);
  const classOrgId = toPublicId(classData?.orgId);
  const progRegRows = await schoolDataService.fetchData('studentProgramRegistrations', {
    studentId__eq: studentId,
    page: 1,
    limit: 200
  }, reqUser);
  const allowed = new Set(choices.map((c) => c.programId));
  const match = (Array.isArray(progRegRows) ? progRegRows : []).find((row) => (
    idsEqual(row?.orgId, classOrgId)
    && registrationIntegrityService.isApprovedProgramRegistrationStatus(row?.status)
    && allowed.has(toPublicId(row?.programId))
  ));
  if (!match) return null;
  const choice = choices.find((c) => idsEqual(c.programId, match.programId));
  return {
    registrationId: toPublicId(match.id),
    programId: toPublicId(match.programId),
    registrationDate: normalizeDateOnly(match.registrationDate),
    label: choice?.label || match.programId,
    status: 'registered'
  };
}

async function resolveStudentDisplayLabel(student, reqUser) {
  if (!student) return '';
  const studentId = toPublicId(student.id);
  const person = await schoolPersonAccessService.getPersonById({
    reqUser,
    personId: student.personId
  });
  const personName = person ? schoolPersonAccessService.formatPersonName(person, '') : '';
  if (personName) return personName;
  const legacy = String(
    student.displayName || student.fullName || student.name || student.customStudentId || ''
  ).trim();
  if (legacy && studentId && legacy !== studentId) return legacy;
  if (legacy && !studentId) return legacy;
  return studentId || legacy;
}

async function buildProgramRegistrationRows({ classId, studentIds, firstSessionDate, reqUser, accessContext }) {
  const classData = await loadClassOrThrow(classId, reqUser, accessContext);
  const choices = buildRollingProgramChoices(classData);
  const defaultProgramId = choices[0]?.programId || '';
  const maxDate = normalizeDateOnly(firstSessionDate);
  const rows = [];
  for (const rawId of studentIds) {
    const studentId = toPublicId(rawId);
    if (!studentId) continue;
    const student = await schoolDataService.getDataById('students', studentId, reqUser, accessContext);
    if (!student) {
      rows.push({ studentId, status: 'error', message: 'Student not found.' });
      continue;
    }
    const studentLabel = await resolveStudentDisplayLabel(student, reqUser);
    const existing = await findApprovedProgramRegistration(classData, student, reqUser);
    if (existing) {
      rows.push({
        studentId,
        studentLabel,
        status: 'registered',
        programId: existing.programId,
        programLabel: existing.label,
        registrationDate: existing.registrationDate,
        registrationId: existing.registrationId
      });
      continue;
    }
    rows.push({
      studentId,
      studentLabel,
      status: 'missing',
      programId: defaultProgramId,
      programLabel: choices[0]?.label || '',
      registrationDate: maxDate,
      suggestedRegistrationDate: maxDate
    });
  }
  return { classId: toPublicId(classData.id), firstSessionDate: maxDate, rows };
}

async function finalizeProgramRegistration({
  classId,
  studentId,
  programId,
  registrationDate,
  note,
  reqUser,
  req
}) {
  const accessContext = schoolDataService.buildRouteAccessContext(req);
  const classData = await loadClassOrThrow(classId, reqUser, accessContext);
  const effectiveDate = normalizeDateOnly(registrationDate);
  const firstSessionDate = normalizeDateOnly(req.body?.firstSessionDate || registrationDate);
  if (!effectiveDate) throw new Error('Registration date is required.');
  if (firstSessionDate && effectiveDate > firstSessionDate) {
    throw new Error('Registration date cannot be after the first selected session date.');
  }
  const student = await schoolDataService.getDataById('students', studentId, reqUser, accessContext);
  if (!student) throw new Error('Student not found.');
  const activeOrgId = toPublicId(reqUser?.activeOrgId || classData?.orgId);
  const result = await programRegistrationApplyService.processSingleStudentProgramRegistration({
    student,
    programId,
    registrationDate: effectiveDate,
    note: String(note || 'Registered from Master Schedule Enroll Students').trim(),
    externalReference: '',
    activeOrgId,
    reqUser,
    autoApproveZeroFee: true
  });
  if (result.status === 'error') {
    return { status: 'error', message: result.message || 'Program registration failed.', issues: result.issues || [] };
  }
  if (result.status === 'finalized' || result.status === 'registered') {
    return {
      status: 'registered',
      registrationId: result.registrationId,
      message: result.message || 'Program registration finalized.',
      programId: result.programId,
      studentId: result.studentId
    };
  }
  if (result.registrationId && result.status === 'draft') {
    let approvePayload = null;
    const mockRes = {
      status() { return this; },
      json(payload) { approvePayload = payload; return payload; }
    };
    await programRegistrationController.approveRegistration({
      ...req,
      user: reqUser,
      params: { id: result.registrationId },
      body: { note: String(note || 'Approved from Master Schedule Enroll Students').trim(), registrationDate: effectiveDate }
    }, mockRes);
    if (String(approvePayload?.status || '').toLowerCase() !== 'success') {
      return {
        status: 'error',
        message: approvePayload?.message || 'Program registration was saved as draft but could not be finalized.',
        registrationId: result.registrationId
      };
    }
    return {
      status: 'registered',
      registrationId: result.registrationId,
      message: approvePayload?.message || 'Program registration finalized.',
      programId: result.programId,
      studentId: result.studentId
    };
  }
  return { status: 'error', message: 'Unexpected program registration result.' };
}

function parsePendingEnrollmentsFromBody(body = {}) {
  const raw = body?.pendingEnrollments ?? body?.pendingEnrollmentDrafts;
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => ({ ...(row || {}) })).filter((row) => pendingEntryStudentId(row));
}

function pendingEntryStudentId(entry = {}) {
  return toPublicId(entry?.studentId || entry?.students?.[0]?.studentId);
}

function pendingEntryStudentLabel(entry = {}) {
  const label = String(entry?.studentLabel || '').trim();
  if (label) return label;
  return pendingEntryStudentId(entry);
}

function sessionScheduleMatchKey(session = {}) {
  return [
    normalizeDateOnly(session?.date || session?.sessionDate),
    String(session?.start || session?.startTime || '').trim(),
    String(session?.end || session?.endTime || '').trim()
  ].join('|');
}

function pendingEntrySelectedSessions(entry = {}) {
  if (Array.isArray(entry?.selectedSessions) && entry.selectedSessions.length) {
    return entry.selectedSessions
      .map((row) => ({
        sessionId: toPublicId(row?.sessionId || row?.id),
        date: normalizeDateOnly(row?.date),
        start: String(row?.start || row?.startTime || '').trim(),
        end: String(row?.end || row?.endTime || '').trim()
      }))
      .filter((row) => row.date);
  }
  return [];
}

function resolveFirstSessionDateFromEntryFallback(entry = {}) {
  const fromSelected = pendingEntrySelectedSessions(entry)
    .map((row) => row.date)
    .filter(Boolean)
    .sort();
  if (fromSelected.length) return fromSelected[0];
  return normalizeDateOnly(entry?.startDate || entry?.firstSessionDate || entry?.minSessionDate || '');
}

async function resolvePersistedSessionsForPendingEntry(classData, entry, reqUser) {
  const sessions = await schoolDataService.getClassSessions(classData.id, reqUser);
  const rows = Array.isArray(sessions) ? sessions : [];
  const byId = new Map(
    rows
      .map((row) => [toPublicId(row?.sessionId || row?.id), row])
      .filter(([id]) => Boolean(id))
  );
  const bySchedule = new Map();
  rows.forEach((row) => {
    const key = sessionScheduleMatchKey(row);
    if (key && key !== '||' && !bySchedule.has(key)) bySchedule.set(key, row);
  });

  const selectedSessionIds = (Array.isArray(entry?.selectedSessionIds) ? entry.selectedSessionIds : [])
    .map((id) => toPublicId(id))
    .filter(Boolean);
  const selectedSessions = pendingEntrySelectedSessions(entry);
  const resolved = [];
  const used = new Set();

  selectedSessionIds.forEach((id) => {
    const match = byId.get(id);
    if (!match) return;
    const sid = toPublicId(match?.sessionId || match?.id);
    if (!sid || used.has(sid)) return;
    used.add(sid);
    resolved.push(match);
  });

  if (resolved.length < Math.max(selectedSessionIds.length, selectedSessions.length)) {
    selectedSessions.forEach((hint) => {
      const byHintId = hint.sessionId ? byId.get(hint.sessionId) : null;
      const byHintSchedule = bySchedule.get(sessionScheduleMatchKey(hint));
      const match = byHintId || byHintSchedule;
      if (!match) return;
      const sid = toPublicId(match?.sessionId || match?.id);
      if (!sid || used.has(sid)) return;
      used.add(sid);
      resolved.push(match);
    });
  }

  return {
    sessions: rows,
    resolvedSessions: resolved,
    remappedSessionIds: resolved
      .map((row) => toPublicId(row?.sessionId || row?.id))
      .filter(Boolean)
  };
}

async function resolveFirstSessionDateForSelectedIds(classData, selectedSessionIds, reqUser) {
  const idSet = new Set(
    (Array.isArray(selectedSessionIds) ? selectedSessionIds : [])
      .map((id) => toPublicId(id))
      .filter(Boolean)
  );
  if (!idSet.size) return '';
  const sessions = await schoolDataService.getClassSessions(classData.id, reqUser);
  const dates = (Array.isArray(sessions) ? sessions : [])
    .filter((row) => idSet.has(toPublicId(row?.sessionId || row?.id)))
    .map((row) => normalizeDateOnly(row?.date))
    .filter(Boolean)
    .sort();
  return dates[0] || '';
}

async function resolveFirstSessionDateForPendingEntry(classData, entry, reqUser) {
  const resolved = await resolvePersistedSessionsForPendingEntry(classData, entry, reqUser);
  const fromPersisted = resolved.resolvedSessions
    .map((row) => normalizeDateOnly(row?.date))
    .filter(Boolean)
    .sort();
  if (fromPersisted.length) return fromPersisted[0];
  return resolveFirstSessionDateFromEntryFallback(entry);
}

function remapPendingEnrollmentSessionIds(entry, remappedSessionIds = []) {
  const ids = (Array.isArray(remappedSessionIds) ? remappedSessionIds : [])
    .map((id) => toPublicId(id))
    .filter(Boolean);
  if (!ids.length) return entry;
  return {
    ...entry,
    selectedSessionIds: ids
  };
}

async function validatePendingEnrollmentsProgramRegistration({
  classData,
  pendingEnrollments,
  reqUser,
  accessContext
}) {
  const issues = [];
  const choices = buildRollingProgramChoices(classData);
  const allowedProgramIds = new Set(choices.map((c) => c.programId));

  for (const entry of Array.isArray(pendingEnrollments) ? pendingEnrollments : []) {
    const studentId = pendingEntryStudentId(entry);
    if (!studentId) continue;
    const studentLabel = pendingEntryStudentLabel(entry);
    const firstSessionDate = await resolveFirstSessionDateForPendingEntry(classData, entry, reqUser);
    if (!firstSessionDate) {
      issues.push({
        studentId,
        studentLabel,
        code: 'missing_sessions',
        message: `Could not determine the first session date for ${studentLabel}.`,
        remediation: 'Save the linked staged sessions with this enrollment, or re-open Enroll Students and queue the enrollment against the correct sessions.'
      });
      continue;
    }
    const student = await schoolDataService.getDataById('students', studentId, reqUser, accessContext);
    if (!student) {
      issues.push({
        studentId,
        studentLabel,
        code: 'student_not_found',
        message: `Student ${studentLabel} was not found.`,
        remediation: 'Remove this enrollment from your selection or choose a valid student using Enroll Students.'
      });
      continue;
    }
    const registration = await findApprovedProgramRegistration(classData, student, reqUser);
    if (!registration) {
      issues.push({
        studentId,
        studentLabel,
        code: 'program_registration_missing',
        message: `No approved program registration is on file for ${studentLabel}.`,
        remediation: 'Open Enroll Students, complete program registration for this student, queue the draft again, then retry saving.'
      });
      continue;
    }
    if (!allowedProgramIds.has(registration.programId)) {
      issues.push({
        studentId,
        studentLabel,
        code: 'program_not_allowed',
        message: `Program registration for ${studentLabel} (${registration.label || registration.programId}) is no longer allowed for this class.`,
        remediation: 'Update the student\'s program registration to an allowed program for this class, then retry.'
      });
      continue;
    }
    if (registration.registrationDate && firstSessionDate && registration.registrationDate > firstSessionDate) {
      issues.push({
        studentId,
        studentLabel,
        code: 'registration_date_after_session',
        message: `Program registration date (${registration.registrationDate}) is after the first selected session (${firstSessionDate}) for ${studentLabel}.`,
        remediation: 'Correct the program registration date so it is on or before the first session date, then retry.'
      });
    }
  }

  return issues.length ? { ok: false, issues } : { ok: true, issues: [] };
}

async function validatePendingEnrollmentsClassEnrollment({
  classData,
  pendingEnrollments,
  reqUser,
  accessContext
}) {
  const rollingEnrollmentEngineService = require('./rollingEnrollmentEngineService');
  const issues = [];
  const classId = toPublicId(classData?.id);

  for (const entry of Array.isArray(pendingEnrollments) ? pendingEnrollments : []) {
    const studentId = pendingEntryStudentId(entry);
    if (!studentId) continue;
    const studentLabel = pendingEntryStudentLabel(entry);
    try {
      const resolved = await resolvePersistedSessionsForPendingEntry(classData, entry, reqUser);
      const remappedEntry = remapPendingEnrollmentSessionIds(entry, resolved.remappedSessionIds);
      if (!resolved.remappedSessionIds.length) {
        issues.push({
          studentId,
          studentLabel,
          code: 'missing_sessions',
          message: `Could not match saved class sessions for ${studentLabel}'s drafted enrollment.`,
          remediation: 'Save the linked staged sessions first (they must remain selected with this enrollment), then retry. If sessions were already saved, re-draft the enrollment against those saved sessions.'
        });
        continue;
      }
      const rawRequest = {
        classId,
        ...remappedEntry,
        studentId,
        pendingStagedSessions: []
      };
      const normalized = rollingEnrollmentEngineService.normalizeEnrollmentEngineRequest(rawRequest, classData);
      await rollingEnrollmentEngineService.assertEnrollmentAlignmentForCreate(classData, normalized, reqUser);

      const capSessions = resolved.resolvedSessions
        .map((row) => ({
          classId,
          sessionId: toPublicId(row?.sessionId || row?.id),
          date: normalizeDateOnly(row?.date),
          start: String(row?.startTime || row?.start || '').trim(),
          end: String(row?.endTime || row?.end || '').trim()
        }))
        .filter((row) => row.sessionId && row.date);
      if (capSessions.length) {
        const capResult = await checkOneOnOneSessionOccupancy({
          classData,
          sessions: capSessions,
          reqUser
        });
        if (capResult?.blocked) {
          const conflict = (capResult.conflicts || [])[0];
          issues.push({
            studentId,
            studentLabel,
            code: 'session_capacity',
            message: conflict
              ? `Session capacity conflict for ${studentLabel} on ${conflict.date || 'a selected session'}.`
              : `Session capacity conflict for ${studentLabel}.`,
            remediation: 'Remove occupied sessions from the enrollment selection, choose different sessions, or adjust enrollments on those sessions before retrying.'
          });
        }
      }
    } catch (error) {
      issues.push({
        studentId,
        studentLabel,
        code: 'enrollment_validation',
        message: error.message || `Class enrollment check failed for ${studentLabel}.`,
        remediation: 'Review enrollment dates, session targets, and class rules in Enroll Students, update the draft, then retry saving.'
      });
    }
  }

  return issues.length ? { ok: false, issues } : { ok: true, issues: [] };
}

async function validatePendingEnrollmentsForCommit({
  classData,
  pendingEnrollments,
  reqUser,
  accessContext
}) {
  const programResult = await validatePendingEnrollmentsProgramRegistration({
    classData,
    pendingEnrollments,
    reqUser,
    accessContext
  });
  if (!programResult.ok) {
    return { ok: false, step: 'programRegistration', issues: programResult.issues };
  }
  const enrollmentResult = await validatePendingEnrollmentsClassEnrollment({
    classData,
    pendingEnrollments,
    reqUser,
    accessContext
  });
  if (!enrollmentResult.ok) {
    return { ok: false, step: 'classEnrollment', issues: enrollmentResult.issues };
  }
  return { ok: true, issues: [] };
}

async function executePendingEnrollmentsForCommit({
  classData,
  pendingEnrollments,
  reqUser,
  req,
  buildEngineHooks
}) {
  const rollingEnrollmentEngineService = require('./rollingEnrollmentEngineService');
  const classId = toPublicId(classData?.id);
  const hooks = typeof buildEngineHooks === 'function' ? buildEngineHooks(req, classData) : {};
  let refreshedClass = classData;

  for (const entry of Array.isArray(pendingEnrollments) ? pendingEnrollments : []) {
    const studentId = pendingEntryStudentId(entry);
    if (!studentId) continue;
    refreshedClass = await schoolDataService.getDataById('classes', classId, reqUser, schoolDataService.buildRouteAccessContext(req))
      || refreshedClass;
    const resolved = await resolvePersistedSessionsForPendingEntry(refreshedClass, entry, reqUser);
    const remappedEntry = remapPendingEnrollmentSessionIds(entry, resolved.remappedSessionIds);
    if (!resolved.remappedSessionIds.length) {
      const error = new Error(`Could not match saved class sessions for student ${studentId}.`);
      error.step = 'applyEnrollment';
      error.studentId = studentId;
      error.remediation = 'Save linked staged sessions with this enrollment, or re-draft enrollment against the saved sessions, then retry.';
      error.issues = [{
        studentId,
        studentLabel: pendingEntryStudentLabel(entry),
        code: 'missing_sessions',
        message: error.message,
        remediation: error.remediation
      }];
      throw error;
    }
    const engineResult = await rollingEnrollmentEngineService.execute({
      classData: refreshedClass,
      reqUser,
      rawRequest: {
        classId,
        ...remappedEntry,
        studentId,
        pendingStagedSessions: []
      },
      hooks
    });
    if (engineResult?.summary?.failed > 0) {
      const failRow = (engineResult.results || []).find((row) => row?.ok === false);
      const detail = String(failRow?.error || failRow?.message || '').trim();
      const error = new Error(detail || `Enrollment failed for student ${studentId}.`);
      error.step = 'applyEnrollment';
      error.studentId = studentId;
      error.remediation = 'Fix the enrollment issue shown, update the draft if needed, and retry from Save staged work.';
      error.issues = [{
        studentId,
        studentLabel: pendingEntryStudentLabel(entry),
        code: 'enrollment_apply_failed',
        message: detail || error.message,
        remediation: error.remediation
      }];
      throw error;
    }
  }

  return { ok: true, classData: refreshedClass };
}

module.exports = {
  loadActiveFunderOptions,
  parseSessionsFromBody,
  prepareEnrollStudents,
  checkOneOnOneSessionOccupancy,
  listStudentPickerExclusions,
  buildProgramRegistrationRows,
  finalizeProgramRegistration,
  parsePendingEnrollmentsFromBody,
  pendingEntryStudentId,
  buildRollingProgramChoices,
  summarizeSessionWindow,
  sumSelectedSessionDurationHours,
  normalizeDateOnly,
  resolveFirstSessionDateForSelectedIds,
  resolveFirstSessionDateForPendingEntry,
  resolvePersistedSessionsForPendingEntry,
  validatePendingEnrollmentsProgramRegistration,
  validatePendingEnrollmentsClassEnrollment,
  validatePendingEnrollmentsForCommit,
  executePendingEnrollmentsForCommit
};
