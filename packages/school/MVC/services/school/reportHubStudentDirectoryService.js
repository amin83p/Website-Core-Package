'use strict';

const dataService = require('./schoolDataService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const studentListSearchService = require('./studentListSearchService');
const studentModel = require('../../models/school/studentModel');
const reportService = require('./reportService');
const studentListEnrollmentFunderIndexService = require('./studentListEnrollmentFunderIndexService');
const schoolStudentProfileLinkService = require('./schoolStudentProfileLinkService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { getActiveOrgIdOrThrow } = requireCoreModule('MVC/utils/orgContextUtils');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const accessService = requireCoreModule('MVC/services/security');
const { SECTIONS, OPERATIONS } = require('../../../config/accessConstants');
const { CANONICAL_STUDENT_PICKER_SEARCH_FIELDS } = require('../../../config/studentPickerSearchFields');
const programRegistrationViewService = require('./programRegistrationViewService');
const termRegistrationViewService = require('./termRegistrationViewService');
const { buildClassEnrollmentRows } = require('./studentAcademicOverviewService');

const MIN_SEARCH_LENGTH = 3;
const DEFAULT_SEARCH_LIMIT = 12;
const MAX_SEARCH_LIMIT = 20;

function normalizeText(value) {
  return String(value || '').trim();
}

function clampSearchLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_SEARCH_LIMIT;
  return Math.min(Math.floor(n), MAX_SEARCH_LIMIT);
}

function listAddressObjects(person) {
  const out = [];
  const push = (addr) => {
    if (!addr || typeof addr !== 'object') return;
    out.push(addr);
  };
  push(person?.address);
  (Array.isArray(person?.addresses) ? person.addresses : []).forEach(push);
  (Array.isArray(person?.contact?.addresses) ? person.contact.addresses : []).forEach(push);
  push(person?.contact?.address);
  return out;
}

function readPrimaryAddress(person) {
  const addresses = listAddressObjects(person);
  if (!addresses.length) return null;
  return addresses.find((row) => row && row.isPrimary === true) || addresses[0];
}

function formatAddressFromObject(addr) {
  if (!addr || typeof addr !== 'object') return '';
  const preformatted = normalizeText(
    addr.formatted
    || addr.formattedAddress
    || addr.fullAddress
    || addr.display
    || addr.label
  );
  if (preformatted) return preformatted;
  const parts = [
    normalizeText(addr.line1 || addr.street || addr.addressLine1),
    normalizeText(addr.line2 || addr.addressLine2),
    normalizeText(addr.city),
    normalizeText(addr.province || addr.state),
    normalizeText(addr.postalCode || addr.zipCode),
    normalizeText(addr.country)
  ].filter(Boolean);
  return parts.join(', ');
}

function formatAddressOneLine(person) {
  const addr = readPrimaryAddress(person);
  if (!addr) return '';
  return formatAddressFromObject(addr);
}

function collectUniqueStrings(values) {
  const out = [];
  const seen = new Set();
  (Array.isArray(values) ? values : []).forEach((value) => {
    const text = normalizeText(value);
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(text);
  });
  return out;
}

function collectPersonEmails(person) {
  const candidates = [];
  const primary = schoolPersonAccessService.readPersonEmail(person);
  if (primary) candidates.push(primary);
  const list = Array.isArray(person?.contact?.emails) ? person.contact.emails : [];
  list.forEach((row) => {
    candidates.push(row?.email || row?.address || row?.value);
  });
  candidates.push(person?.contact?.email, person?.email);
  return collectUniqueStrings(candidates);
}

function collectPersonPhones(person) {
  const candidates = [];
  candidates.push(readPersonPhone(person));
  const list = Array.isArray(person?.contact?.phones) ? person.contact.phones : [];
  list.forEach((row) => {
    candidates.push(row?.number || row?.phone);
  });
  candidates.push(person?.contact?.phone, person?.contact?.primaryPhone);
  return collectUniqueStrings(candidates);
}

function collectPersonAddresses(person) {
  const lines = [];
  listAddressObjects(person).forEach((addr) => {
    const line = formatAddressFromObject(addr);
    if (line) lines.push(line);
  });
  return collectUniqueStrings(lines);
}

function readPersonPhone(person) {
  const phones = Array.isArray(person?.contact?.phones) ? person.contact.phones : [];
  return normalizeText(
    person?.contact?.phone
    || person?.contact?.primaryPhone
    || phones[0]?.number
    || phones[0]?.phone
  );
}

function enrichStudentRow(student, person) {
  const firstName = person?.name?.first || person?.firstName || 'Unknown';
  const lastName = person?.name?.last || person?.lastName || 'Person';
  const fullName = schoolPersonAccessService.formatPersonName(person, `${firstName} ${lastName}`.trim());
  return {
    ...student,
    firstName,
    lastName,
    name: fullName,
    email: schoolPersonAccessService.readPersonEmail(person) || '',
    phone: readPersonPhone(person) || '',
    primaryClaimNumber: studentListSearchService.resolvePrimaryClaimNumber(student)
  };
}

async function assertStudentsReadAccess(req) {
  const evalResult = await accessService.evaluateAccess({
    user: req.user,
    sectionId: SECTIONS.SCHOOL_STUDENTS,
    operationId: OPERATIONS.READ_ALL,
    ipAddress: req.ip
  });
  if (!evalResult?.allowed) {
    const error = new Error('You do not have access to the student directory.');
    error.statusCode = 403;
    throw error;
  }
}

async function searchStudents(queryInput, req) {
  await assertStudentsReadAccess(req);

  const q = normalizeText(queryInput?.q).toLowerCase();
  if (q.length < MIN_SEARCH_LENGTH) {
    return { results: [], q, minLength: MIN_SEARCH_LENGTH };
  }

  const limit = clampSearchLimit(queryInput?.limit);
  const searchFields = normalizeText(queryInput?.searchFields) || CANONICAL_STUDENT_PICKER_SEARCH_FIELDS;

  const allStudents = await dataService.fetchAllData('students', {}, req.user, dataService.buildRouteAccessContext(req));
  const personById = await schoolPersonAccessService.buildPersonByIdMap({
    reqUser: req.user,
    personIds: (Array.isArray(allStudents) ? allStudents : []).map((student) => student.personId)
  });

  const activeOrgId = getActiveOrgIdOrThrow(req.user);
  const enrollmentFunderLabelsByStudentId = await studentListEnrollmentFunderIndexService.loadEnrollmentFunderLabelsByStudentId(
    req.user,
    activeOrgId
  );

  const enrichedStudents = (Array.isArray(allStudents) ? allStudents : []).map((student) => {
    const person = personById.get(toPublicId(student.personId));
    const row = enrichStudentRow(student, person);
    return {
      ...row,
      enrollmentFunderSearchLabels: studentListEnrollmentFunderIndexService.readEnrollmentFunderLabelsForStudent(
        student,
        enrollmentFunderLabelsByStudentId
      )
    };
  });

  const visibleStudents = enrichedStudents.filter((s) => {
    const st = normalizeText(s?.academicStatus).toLowerCase();
    return st !== 'archived';
  });

  const matched = visibleStudents.filter((student) => studentListSearchService.studentMatchesListSearch(student, {
    q,
    type: queryInput?.type,
    searchFields
  }));

  const results = matched.slice(0, limit).map((student) => {
    const subtitleParts = [
      normalizeText(student.customStudentId),
      normalizeText(student.email),
      normalizeText(student.primaryClaimNumber)
    ].filter(Boolean);
    return {
      id: normalizeText(student.id),
      name: normalizeText(student.name) || normalizeText(student.id),
      customStudentId: normalizeText(student.customStudentId),
      email: normalizeText(student.email),
      academicStatus: normalizeText(student.academicStatus),
      primaryClaimNumber: normalizeText(student.primaryClaimNumber),
      subtitle: subtitleParts.join(' · ')
    };
  });

  return {
    results,
    q,
    total: matched.length,
    limit,
    minLength: MIN_SEARCH_LENGTH
  };
}

function resolveClaimNumbersForProfile(student) {
  let claimNumbers = studentModel.cleanClaimNumbers(student?.claimNumbers);
  const legacyId = normalizeText(student?.studentIdAtFunder);
  if (!claimNumbers.length && legacyId) {
    claimNumbers = studentModel.cleanClaimNumbers([{
      id: `claim_legacy_${String(student?.id || 'student')}`,
      number: legacyId,
      label: 'Legacy',
      isPrimary: true
    }]);
  }
  return (Array.isArray(claimNumbers) ? claimNumbers : []).map((row) => ({
    id: normalizeText(row?.id),
    number: normalizeText(row?.number),
    label: normalizeText(row?.label),
    notes: normalizeText(row?.notes),
    isPrimary: row?.isPrimary === true
  })).filter((row) => row.number || row.label);
}

async function evaluateCanOpenStudentEdit(req) {
  const evalResult = await accessService.evaluateAccess({
    user: req.user,
    sectionId: SECTIONS.SCHOOL_STUDENTS,
    operationId: OPERATIONS.UPDATE,
    ipAddress: req.ip
  });
  return Boolean(evalResult?.allowed);
}

async function evaluateCanOpenAcademicOverview(req) {
  const evalResult = await accessService.evaluateAccess({
    user: req.user,
    sectionId: SECTIONS.SCHOOL_ACADEMIC_LEDGER,
    operationId: OPERATIONS.READ_ALL,
    ipAddress: req.ip
  });
  return Boolean(evalResult?.allowed);
}

async function buildPersonalProfile(studentId, req) {
  await assertStudentsReadAccess(req);

  const normalizedStudentId = toPublicId(studentId);
  if (!normalizedStudentId) {
    throw new Error('Student is required.');
  }

  const student = await dataService.getDataById('students', normalizedStudentId, req.user, dataService.buildRouteAccessContext(req));
  if (!student) {
    throw new Error('Student not found or inaccessible.');
  }

  const person = student.personId
    ? await schoolPersonAccessService.getPersonById({ reqUser: req.user, personId: student.personId })
    : null;

  const name = schoolPersonAccessService.formatPersonName(person, normalizedStudentId);
  const canOpenStudentEdit = await evaluateCanOpenStudentEdit(req);
  const canOpenAcademicOverview = await evaluateCanOpenAcademicOverview(req);
  const editUrl = schoolStudentProfileLinkService.buildStudentEditUrl(student.id);
  const academicOverviewUrl = canOpenAcademicOverview
    ? `/school/academic-ledger/student-overview/${encodeURIComponent(normalizedStudentId)}`
    : '';

  const demographics = person?.demographics && typeof person.demographics === 'object' ? person.demographics : {};
  const emails = collectPersonEmails(person);
  const phones = collectPersonPhones(person);
  const addresses = collectPersonAddresses(person);
  const dateOfBirth = normalizeText(demographics.dateOfBirth || person?.dateOfBirth);
  const gender = normalizeText(demographics.gender);
  const feeCategory = normalizeText(student.feeCategory);
  const claimNumbers = resolveClaimNumbersForProfile(student);
  const clbLevelHistory = reportService.getSortedClbLevelHistory(student);

  let programRegistrations = [];
  let classEnrollments = [];
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const [registrationRows, termRows, programs, terms, classes, subjects] = await Promise.all([
      programRegistrationViewService.buildRegistrationSummaries(req.user, activeOrgId, {
        filters: { studentId: student.id }
      }),
      termRegistrationViewService.buildRegistrationSummaries(req.user, activeOrgId, {
        filters: { studentId: student.id }
      }),
      dataService.fetchAllData('programs', {}, req.user),
      dataService.fetchAllData('terms', {}, req.user),
      dataService.fetchAllData('classes', {}, req.user),
      dataService.fetchAllData('subjects', {}, req.user)
    ]);
    programRegistrations = (Array.isArray(registrationRows) ? registrationRows : []).map((row) => ({
      id: normalizeText(row.id),
      programId: normalizeText(row.programId),
      programLabel: normalizeText(row.programLabel) || normalizeText(row.programId),
      status: normalizeText(row.status),
      verificationStatus: normalizeText(row.verificationStatus),
      registrationDate: normalizeText(row.registrationDate)
    }));
    const enrollmentRows = await buildClassEnrollmentRows({
      reqUser: req.user,
      activeOrgId,
      studentId: student.id,
      programs,
      terms,
      classes,
      subjects,
      termRows
    });
    classEnrollments = (Array.isArray(enrollmentRows) ? enrollmentRows : []).map((row) => ({
      id: normalizeText(row.id),
      classId: normalizeText(row.classId),
      classTitle: normalizeText(row.classTitle),
      programLabel: normalizeText(row.programLabel),
      termLabel: normalizeText(row.termLabel),
      subjectLabel: normalizeText(row.subjectLabel),
      teacherName: normalizeText(row.teacherName),
      sessionStartTime: normalizeText(row.sessionStartTime),
      sessionEndTime: normalizeText(row.sessionEndTime),
      sessionTimeLabel: normalizeText(row.sessionTimeLabel),
      startDate: normalizeText(row.startDate),
      endDate: normalizeText(row.endDate),
      status: normalizeText(row.status),
      editUrl: normalizeText(row.editUrl)
    }));
  } catch (_) {
    programRegistrations = [];
    classEnrollments = [];
  }

  const profile = {
    id: normalizeText(student.id),
    personId: normalizeText(student.personId),
    name,
    customStudentId: normalizeText(student.customStudentId),
    studentNumber: normalizeText(student.studentNumber),
    email: emails[0] || '',
    emails,
    phone: phones[0] || '',
    phones,
    dateOfBirth,
    gender,
    addressOneLine: addresses[0] || '',
    addresses,
    feeCategory,
    academicStatus: normalizeText(student.academicStatus),
    primaryClaimNumber: studentListSearchService.resolvePrimaryClaimNumber(student),
    claimNumbers,
    clbLevelHistory,
    programRegistrations,
    classEnrollments,
    enrollmentDate: normalizeText(student.enrollmentDate),
    editUrl,
    canOpenStudentEdit,
    academicOverviewUrl,
    canOpenAcademicOverview
  };

  return profile;
}

function classifyHubStudentGender(raw) {
  const g = normalizeText(raw).toLowerCase();
  if (!g || g === 'u' || g === 'unknown' || g === 'unspecified' || g === 'prefer not to say') {
    return 'other';
  }
  if (g === 'f' || g === 'female' || g.startsWith('female')) return 'female';
  if (g === 'm' || g === 'male' || g.startsWith('male')) return 'male';
  return 'other';
}

async function getStudentPopulationSummary(req) {
  await assertStudentsReadAccess(req);

  const allStudents = await dataService.fetchAllData('students', {}, req.user, dataService.buildRouteAccessContext(req));
  const students = Array.isArray(allStudents) ? allStudents : [];
  const personById = await schoolPersonAccessService.buildPersonByIdMap({
    reqUser: req.user,
    personIds: students.map((student) => student.personId)
  });

  const counts = { total: students.length, female: 0, male: 0, other: 0 };
  students.forEach((student) => {
    const person = personById.get(toPublicId(student.personId));
    const demographics = person?.demographics && typeof person.demographics === 'object' ? person.demographics : {};
    const bucket = classifyHubStudentGender(demographics.gender || person?.gender);
    counts[bucket] += 1;
  });

  return counts;
}

module.exports = {
  MIN_SEARCH_LENGTH,
  searchStudents,
  buildPersonalProfile,
  getStudentPopulationSummary,
  classifyHubStudentGender
};