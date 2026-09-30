'use strict';

const schoolDataService = require('./schoolDataService');
const classEnrollmentReadService = require('./classEnrollmentReadService');
const classSessionCapacityService = require('./classSessionCapacityService');
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
    sessionCapacityType,
    maxCapacity,
    multiselectStudents: sessionCapacityType !== 'one_on_one' && maxCapacity !== 1,
    funderOptions,
    cycleStartDate: cycleStart,
    cycleEndDate: cycleEnd,
    sessions
  };
}

async function checkOneOnOneSessionOccupancy({ classData, sessions, reqUser }) {
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
  return raw.map((row) => ({ ...(row || {}) })).filter((row) => toPublicId(row?.studentId));
}

module.exports = {
  parseSessionsFromBody,
  prepareEnrollStudents,
  checkOneOnOneSessionOccupancy,
  listStudentPickerExclusions,
  buildProgramRegistrationRows,
  finalizeProgramRegistration,
  parsePendingEnrollmentsFromBody,
  buildRollingProgramChoices,
  summarizeSessionWindow,
  normalizeDateOnly
};
