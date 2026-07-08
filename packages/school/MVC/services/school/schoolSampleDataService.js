const path = require('path');
const fs = require('fs').promises;
const dataService = require('../../services/school/schoolDataService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { resolveCoreRoot } = require('./schoolCoreModuleResolver');
const dataServiceGlobal = requireCoreModule('MVC/services/dataService');
const { FEE_CATEGORIES } = require('../../models/school/feeCategoryCatalog');
const withdrawalRepository = require('../../repositories/school/withdrawalRepository');
const schoolRepositories = require('../../repositories/school');
const attendanceMatrixPolicyModel = require('../../models/school/attendanceMatrixPolicyModel');
const indexService = require('./schoolIndexService');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const { resolveCanonicalOrganizationName } = requireCoreModule('MVC/utils/organizationDisplay');

const MIGRATION_LOG_FILES = Object.freeze([
  'classRegistrationModeMigration.report.json',
  'backfillClassEnrollmentPeriods.report.json'
]);

async function removeOptionalMigrationLogFiles() {
  const base = path.join(resolveCoreRoot(), 'data/school');
  let removed = 0;
  const errors = [];
  for (const name of MIGRATION_LOG_FILES) {
    const fp = path.join(base, name);
    try {
      await fs.unlink(fp);
      removed += 1;
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        errors.push(`${name}: ${String(err?.message || err)}`);
      }
    }
  }
  return { removed, errors };
}

const FIRST_NAMES = Object.freeze([
  'Ava', 'Liam', 'Noah', 'Emma', 'Mia', 'Olivia', 'Lucas', 'Amelia', 'Ethan', 'Sofia',
  'Mason', 'Isla', 'Aiden', 'Nora', 'Aria', 'Leo', 'Zoe', 'Mila', 'Elijah', 'Layla'
]);
const LAST_NAMES = Object.freeze([
  'Brown', 'Smith', 'Johnson', 'Williams', 'Taylor', 'Miller', 'Wilson', 'Moore', 'Clark', 'Hall',
  'Allen', 'Young', 'King', 'Wright', 'Scott', 'Green', 'Baker', 'Adams', 'Nelson', 'Carter'
]);
const COUNTRIES = Object.freeze([
  'Canada', 'India', 'Philippines', 'Mexico', 'Brazil', 'Nigeria', 'Iran', 'China', 'Ukraine', 'Colombia'
]);
const TEACHER_SPECIALIZATIONS = Object.freeze([
  'Academic English', 'IELTS Preparation', 'Business English', 'Adult Literacy', 'Settlement Language', 'Workplace Communication'
]);
const STAFF_JOB_TITLES = Object.freeze([
  'Admissions Coordinator', 'Student Services Officer', 'Registrar Assistant', 'Operations Assistant', 'Finance Clerk', 'Program Support Officer'
]);

function pick(list, index, seedOffset = 0) {
  if (!Array.isArray(list) || !list.length) return '';
  const idx = Math.abs(Number(index || 0) + Number(seedOffset || 0)) % list.length;
  return list[idx];
}

function normalizeToken(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeNameKey(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function sanitizeNamePart(value, fallback = '') {
  const cleaned = String(value || '')
    .replace(/[^A-Za-z\s\-']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

function buildUniqueAccountCode(existingAccounts, baseCode) {
  const usedCodes = new Set(
    (existingAccounts || []).map((a) => String(a?.code || '').trim().toUpperCase()).filter(Boolean)
  );
  const base = (normalizeToken(baseCode) || `ACC_${Date.now()}`).slice(0, 40);
  if (!usedCodes.has(base)) return base;
  for (let i = 2; i <= 9999; i++) {
    const suffix = `_${i}`;
    const candidate = `${base.slice(0, Math.max(1, 40 - suffix.length))}${suffix}`;
    if (!usedCodes.has(candidate)) return candidate;
  }
  throw new Error('Unable to generate a unique sample account code.');
}

function buildUniqueAccountName(existingAccounts, baseName) {
  const usedNames = new Set(
    (existingAccounts || []).map((a) => normalizeNameKey(a?.name)).filter(Boolean)
  );
  const compactBase = String(baseName || '').trim().replace(/\s+/g, ' ').slice(0, 160) || 'Sample Account';
  if (!usedNames.has(normalizeNameKey(compactBase))) return compactBase;
  for (let i = 2; i <= 9999; i++) {
    const suffix = ` (${i})`;
    const candidate = `${compactBase.slice(0, Math.max(1, 160 - suffix.length))}${suffix}`;
    if (!usedNames.has(normalizeNameKey(candidate))) return candidate;
  }
  throw new Error('Unable to generate a unique sample account name.');
}

async function resolveOrgMeta(reqUser, orgId) {
  const allowed = Array.isArray(reqUser?.allowedOrgs) ? reqUser.allowedOrgs : [];
  const found = allowed.find((o) => idsEqual(o?.orgId, orgId));
  let canonicalName = '';
  try {
    const orgRecord = await dataServiceGlobal.getDataById('organizations', orgId, reqUser);
    canonicalName = resolveCanonicalOrganizationName(orgRecord || {});
  } catch (_) {}
  return {
    id: orgId,
    name: canonicalName || String(found?.name || found?.orgName || '').trim()
  };
}

const SCHOOL_ENTITY_ROLE_TO_MEMBERSHIP_TOKEN = Object.freeze({
  student: 'school_student',
  teacher: 'school_teacher',
  staff: 'school_staff'
});

function resolveSchoolMembershipRoleToken(role) {
  const token = String(role || '').trim().toLowerCase();
  return SCHOOL_ENTITY_ROLE_TO_MEMBERSHIP_TOKEN[token] || token;
}

function buildRoleMembership(orgMeta, role) {
  const membershipRole = resolveSchoolMembershipRoleToken(role);
  return [{
    orgId: Number.isFinite(Number(orgMeta?.id)) ? Number(orgMeta.id) : orgMeta.id,
    name: String(orgMeta?.name || '').trim(),
    roles: ['member', membershipRole].filter((v, i, arr) => v && arr.indexOf(v) === i),
    role: 'member',
    memberStatus: 'active',
    joinedAt: new Date().toISOString()
  }];
}

function buildSamplePersonPayload({ orgMeta, role, prefix, sequence }) {
  const safePrefix = sanitizeNamePart(prefix, 'Sample');
  const firstName = sanitizeNamePart(`${safePrefix} ${pick(FIRST_NAMES, sequence)}`, pick(FIRST_NAMES, sequence));
  const lastName = sanitizeNamePart(
    `${pick(LAST_NAMES, sequence, 3)} ${pick(LAST_NAMES, sequence, 11)}`,
    pick(LAST_NAMES, sequence, 3)
  );
  const unique = `${String(orgMeta?.id || '').replace(/[^A-Za-z0-9]/g, '')}_${role}_${Date.now()}_${sequence + 1}`.toLowerCase();
  const email = `${unique}@sample.school.local`;
  const gender = sequence % 3 === 0 ? 'female' : (sequence % 3 === 1 ? 'male' : 'other');
  const birthYear = 1980 + (sequence % 20);
  const birthMonth = String((sequence % 12) + 1).padStart(2, '0');
  const birthDay = String((sequence % 28) + 1).padStart(2, '0');

  return {
    active: true,
    name: {
      first: firstName,
      middle: null,
      last: lastName,
      preferred: null
    },
    demographics: {
      gender,
      dateOfBirth: `${birthYear}-${birthMonth}-${birthDay}`
    },
    contact: {
      emails: [{ type: 'primary', email, isPrimary: true }],
      phones: [{ type: 'mobile', number: `780555${String(1000 + sequence).slice(-4)}` }],
      email
    },
    addresses: [{
      type: 'home',
      line1: `${100 + sequence} Sample Avenue`,
      city: 'Edmonton',
      province: 'AB',
      postalCode: `T${(sequence % 9) + 1}A${(sequence % 9) + 1}A${(sequence % 9) + 1}`
    }],
    address: {
      type: 'home',
      line1: `${100 + sequence} Sample Avenue`,
      city: 'Edmonton',
      province: 'AB',
      postalCode: `T${(sequence % 9) + 1}A${(sequence % 9) + 1}A${(sequence % 9) + 1}`
    },
    tags: ['sample-data', `sample-${role}`],
    notes: `Generated sample ${role} record.`,
    avatarUrl: null,
    organizations: buildRoleMembership(orgMeta, role),
    audit: {
      createUser: 'SYSTEM_SAMPLE',
      createDateTime: new Date().toISOString(),
      lastUpdateUser: 'SYSTEM_SAMPLE',
      lastUpdateDateTime: new Date().toISOString()
    }
  };
}

function findHeadAccount(accounts, orgId, headCategory, aliases = []) {
  const allowed = new Set([headCategory].concat(aliases).map((x) => String(x || '').trim().toLowerCase()).filter(Boolean));
  return (accounts || []).find((a) => {
    if (!idsEqual(a?.orgId, orgId)) return false;
    if (String(a?.status || '').toLowerCase() !== 'active') return false;
    return allowed.has(String(a?.headCategory || 'none').toLowerCase());
  }) || null;
}

function resolveStudentCategoryParent(accounts, studentsHeadAccount, feeCategory) {
  if (!studentsHeadAccount) return null;
  const normalized = String(feeCategory || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  const codeMap = {
    domestic: '1221',
    international: '1222',
    corporate: '1223',
    scholarship: '1224',
    government_funded: '1225',
    others: '1226',
    other: '1226',
    linc_alberta: '1227',
    wcb_alberta: '1228'
  };
  const expectedCode = codeMap[normalized];
  if (!expectedCode) return null;
  return (accounts || []).find((a) =>
    idsEqual(a?.parentId, studentsHeadAccount.id) &&
    String(a?.status || '').toLowerCase() === 'active' &&
    String(a?.code || '') === expectedCode
  ) || null;
}

async function loadAccessibleAccountsWithSystem(reqUser, activeOrgId) {
  const scopedOrgId = String(activeOrgId || '').trim();
  if (!scopedOrgId) return [];

  const scopedUser = { ...(reqUser || {}), activeOrgId: scopedOrgId };
  const scopedAccounts = await dataService.getAccessibleSchoolAccounts(scopedUser);
  if (scopedOrgId.toUpperCase() === 'SYSTEM') return scopedAccounts;

  const systemUser = { ...(reqUser || {}), activeOrgId: 'SYSTEM' };
  const systemAccounts = await dataService.getAccessibleSchoolAccounts(systemUser);
  const merged = new Map();
  [...scopedAccounts, ...systemAccounts].forEach((acc) => {
    if (acc?.id !== undefined && acc?.id !== null) merged.set(String(acc.id), acc);
  });
  return Array.from(merged.values());
}

async function createLinkedAccountIfPossible({
  entityType,
  record,
  person,
  accessibleAccounts,
  reqUser,
  warnings
}) {
  const orgId = String(record?.orgId || '').trim();
  const accounts = Array.isArray(accessibleAccounts) ? accessibleAccounts : [];
  const orgAccounts = accounts.filter((a) => idsEqual(a?.orgId, orgId));
  const systemAccounts = accounts.filter((a) => String(a?.orgId || '').toUpperCase() === 'SYSTEM');

  let head = null;
  let parent = null;
  let partyRole = 'none';
  let codeBase = '';
  let nameBase = '';

  if (entityType === 'student') {
    head =
      findHeadAccount(orgAccounts, orgId, 'students', ['student_all']) ||
      findHeadAccount(systemAccounts, 'SYSTEM', 'students', ['student_all']);
    if (!head) {
      warnings.push(`Student ${record.id}: no active students head account found. Account creation skipped.`);
      return null;
    }
    const pool = String(head?.orgId || '').toUpperCase() === 'SYSTEM' ? systemAccounts : orgAccounts;
    parent = resolveStudentCategoryParent(pool, head, record.feeCategory) || head;
    partyRole = 'student';
    codeBase = `STU_${record.id}`;
    nameBase = `${person.name?.first || ''} ${person.name?.last || ''} (Student)`;
  } else if (entityType === 'teacher') {
    head =
      findHeadAccount(orgAccounts, orgId, 'teachers') ||
      findHeadAccount(systemAccounts, 'SYSTEM', 'teachers');
    if (!head) {
      warnings.push(`Teacher ${record.id}: no active teachers head account found. Account creation skipped.`);
      return null;
    }
    parent = head;
    partyRole = 'teacher';
    codeBase = `TCH_${record.id}`;
    nameBase = `${person.name?.first || ''} ${person.name?.last || ''} (Teacher)`;
  } else if (entityType === 'staff') {
    head =
      findHeadAccount(orgAccounts, orgId, 'staff') ||
      findHeadAccount(systemAccounts, 'SYSTEM', 'staff');
    if (!head) {
      warnings.push(`Staff ${record.id}: no active staff head account found. Account creation skipped.`);
      return null;
    }
    parent = head;
    partyRole = 'staff';
    codeBase = `STF_${record.id}`;
    nameBase = `${person.name?.first || ''} ${person.name?.last || ''} (Staff)`;
  }

  if (!parent) return null;
  const targetOrgId = String(parent?.orgId || orgId).trim();
  const targetAccounts = String(targetOrgId).toUpperCase() === 'SYSTEM' ? systemAccounts : orgAccounts;
  const parentLevel = Number(parent?.level || 1);
  const childLevel = parentLevel + 1;
  if (childLevel > 6) {
    warnings.push(`${entityType} ${record.id}: account level would exceed 6. Account creation skipped.`);
    return null;
  }

  const accountPayload = {
    orgId: targetOrgId,
    code: buildUniqueAccountCode(targetAccounts, codeBase),
    name: buildUniqueAccountName(targetAccounts, nameBase),
    type: String(parent?.type || 'asset').toLowerCase(),
    level: childLevel,
    parentId: String(parent?.id || ''),
    isControl: false,
    allowPost: true,
    partyRole,
    headCategory: 'none',
    normalBalance: String(parent?.normalBalance || 'debit').toLowerCase() === 'credit' ? 'credit' : 'debit',
    status: 'active',
    description: `Auto-created for generated sample ${entityType} ${record.id}.`
  };

  const account = await dataService.addData('schoolAccounts', accountPayload, reqUser);
  targetAccounts.push(account);
  accounts.push(account);
  return account;
}

function buildStudentPayload({ orgId, personId, sequence }) {
  const feeCategories = Array.isArray(FEE_CATEGORIES) ? FEE_CATEGORIES : [];
  return {
    orgId: String(orgId),
    personId: String(personId),
    localId: `SMP-STU-${sequence + 1}`,
    countryOfOrigin: pick(COUNTRIES, sequence),
    feeCategory: pick(feeCategories, sequence) || 'Domestic',
    sendingOrganization: '',
    funderOrganization: '',
    funderAccountId: '',
    studentAccountId: '',
    studentIdAtFunder: '',
    selfFund: true,
    funderNote: '',
    enrollmentDate: new Date().toISOString().slice(0, 10),
    academicStatus: 'Active',
    notes: 'Generated sample student.',
    attachments: []
  };
}

function buildTeacherPayload({ orgId, personId, sequence, departments }) {
  const department = Array.isArray(departments) && departments.length ? departments[sequence % departments.length] : null;
  return {
    orgId: String(orgId),
    personId: String(personId),
    teacherAccountId: '',
    employeeNumber: `SMP-TCH-${sequence + 1}`,
    departmentId: department ? String(department.id || '') : '',
    defaultPayRateId: '',
    compensationProfiles: [],
    specialization: pick(TEACHER_SPECIALIZATIONS, sequence),
    certification: 'TESL Alberta',
    employmentType: 'Full-Time',
    hireDate: new Date().toISOString().slice(0, 10),
    contractEndDate: '',
    status: 'Active',
    instructionalMode: sequence % 3 === 0 ? 'Online' : 'In-person',
    teachingFocus: 'Generated sample teacher profile',
    maxWeeklyHours: 35,
    notes: 'Generated sample teacher.'
  };
}

function buildStaffPayload({ orgId, personId, sequence, departments }) {
  const department = Array.isArray(departments) && departments.length ? departments[sequence % departments.length] : null;
  return {
    orgId: String(orgId),
    personId: String(personId),
    staffAccountId: '',
    employeeNumber: `SMP-STF-${sequence + 1}`,
    jobTitle: pick(STAFF_JOB_TITLES, sequence),
    departmentId: department ? String(department.id || '') : '',
    defaultPayRateId: '',
    compensationProfiles: [],
    employmentType: 'Full-Time',
    hireDate: new Date().toISOString().slice(0, 10),
    contractEndDate: '',
    status: 'Active',
    workLocation: 'Main Campus',
    responsibilities: 'Generated sample staff responsibilities.',
    notes: 'Generated sample staff.'
  };
}

async function generateRoleSamples({
  role,
  count,
  orgId,
  orgMeta,
  reqUser,
  prefix,
  createLinkedAccounts,
  accessibleAccounts,
  departments,
  warnings,
  errors
}) {
  const results = [];

  for (let i = 0; i < count; i++) {
    try {
      const personPayload = buildSamplePersonPayload({
        orgMeta,
        role,
        prefix,
        sequence: i
      });
      const person = await dataServiceGlobal.addData('persons', personPayload, reqUser);

      let record = null;
      if (role === 'student') {
        record = await dataService.addData('students', buildStudentPayload({ orgId, personId: person.id, sequence: i }), reqUser);
      } else if (role === 'teacher') {
        record = await dataService.addData('teachers', buildTeacherPayload({ orgId, personId: person.id, sequence: i, departments }), reqUser);
      } else if (role === 'staff') {
        record = await dataService.addData('staff', buildStaffPayload({ orgId, personId: person.id, sequence: i, departments }), reqUser);
      }

      if (record && createLinkedAccounts) {
        const account = await createLinkedAccountIfPossible({
          entityType: role,
          record,
          person,
          accessibleAccounts,
          reqUser,
          warnings
        });

        if (account) {
          if (role === 'student') {
            record = await dataService.updateData('students', record.id, { ...record, studentAccountId: String(account.id) }, reqUser);
          } else if (role === 'teacher') {
            record = await dataService.updateData('teachers', record.id, { ...record, teacherAccountId: String(account.id) }, reqUser);
          } else if (role === 'staff') {
            record = await dataService.updateData('staff', record.id, { ...record, staffAccountId: String(account.id) }, reqUser);
          }
        }
      }

      results.push({
        personId: toPublicId(person.id),
        recordId: toPublicId(record?.id)
      });
    } catch (error) {
      errors.push(`${role} #${i + 1}: ${error.message}`);
    }
  }

  return results;
}

async function generateSampleSchoolPeople({
  orgId,
  reqUser,
  studentCount = 0,
  teacherCount = 0,
  staffCount = 0,
  prefix = 'Sample',
  createLinkedAccounts = true
}) {
  const safeStudentCount = Math.max(0, Math.min(200, Number(studentCount || 0)));
  const safeTeacherCount = Math.max(0, Math.min(200, Number(teacherCount || 0)));
  const safeStaffCount = Math.max(0, Math.min(200, Number(staffCount || 0)));
  if ((safeStudentCount + safeTeacherCount + safeStaffCount) <= 0) {
    throw new Error('Please request at least one sample record.');
  }

  const orgMeta = await resolveOrgMeta(reqUser, orgId);
  const accessibleAccounts = createLinkedAccounts ? await loadAccessibleAccountsWithSystem(reqUser, orgId) : [];
  const departments = await dataService.fetchData('departments', {}, reqUser);
  const warnings = [];
  const errors = [];

  const students = await generateRoleSamples({
    role: 'student',
    count: safeStudentCount,
    orgId,
    orgMeta,
    reqUser,
    prefix,
    createLinkedAccounts,
    accessibleAccounts,
    departments,
    warnings,
    errors
  });
  const teachers = await generateRoleSamples({
    role: 'teacher',
    count: safeTeacherCount,
    orgId,
    orgMeta,
    reqUser,
    prefix,
    createLinkedAccounts,
    accessibleAccounts,
    departments,
    warnings,
    errors
  });
  const staff = await generateRoleSamples({
    role: 'staff',
    count: safeStaffCount,
    orgId,
    orgMeta,
    reqUser,
    prefix,
    createLinkedAccounts,
    accessibleAccounts,
    departments,
    warnings,
    errors
  });

  return {
    summary: {
      requested: {
        students: safeStudentCount,
        teachers: safeTeacherCount,
        staff: safeStaffCount
      },
      created: {
        students: students.length,
        teachers: teachers.length,
        staff: staff.length
      },
      failed: errors.length
    },
    warnings,
    errors,
    resultIds: {
      students,
      teachers,
      staff
    }
  };
}

function normalizeIdList(values = []) {
  const rows = Array.isArray(values) ? values : [values];
  const out = [];
  const seen = new Set();
  rows.forEach((value) => {
    const id = toPublicId(value);
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  });
  return out;
}

function normalizeStatusKey(value, fallback = 'unknown') {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || fallback;
}

const SCHOOL_SAFE_ROLE_TOKENS = new Set([
  'member',
  'school_student',
  'school_teacher',
  'school_staff'
]);

const SCHOOL_ROLE_ALIAS_TO_CANONICAL = Object.freeze({
  schoolstudent: 'school_student',
  schoolstudents: 'school_student',
  school_students: 'school_student',
  schoolteacher: 'school_teacher',
  schoolteachers: 'school_teacher',
  school_teachers: 'school_teacher',
  schoolstaff: 'school_staff',
  schoolstaffs: 'school_staff',
  school_staffs: 'school_staff'
});

function normalizeRoleToken(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_')
    .replace(/[^a-z0-9_]/g, '');
  if (!normalized) return '';
  return SCHOOL_ROLE_ALIAS_TO_CANONICAL[normalized] || normalized;
}

function collectPersonRoleTokens(person = {}) {
  const tokens = new Set();
  const organizations = Array.isArray(person?.organizations) ? person.organizations : [];
  organizations.forEach((orgRow) => {
    const rawRoles = Array.isArray(orgRow?.roles)
      ? orgRow.roles
      : [orgRow?.role || ''];
    const normalizedRoles = rawRoles
      .map((roleToken) => normalizeRoleToken(roleToken))
      .filter(Boolean);
    if (!normalizedRoles.length) normalizedRoles.push('member');
    normalizedRoles.forEach((roleToken) => tokens.add(roleToken));
  });
  if (!tokens.size) tokens.add('member');
  return Array.from(tokens);
}

function splitPersonRoleTokens(person = {}) {
  const allRoles = collectPersonRoleTokens(person);
  const schoolRoles = allRoles.filter((roleToken) => SCHOOL_SAFE_ROLE_TOKENS.has(roleToken));
  const otherRoles = allRoles.filter((roleToken) => !SCHOOL_SAFE_ROLE_TOKENS.has(roleToken));
  return {
    schoolRoles,
    otherRoles,
    hasOtherRoles: otherRoles.length > 0
  };
}

function looksLikeSampleNote(value = '', roleToken = '') {
  const note = String(value || '').trim().toLowerCase();
  if (!note) return false;
  return note.includes('sample') && note.includes(roleToken);
}

function personHasSampleDataTag(person = {}) {
  const tags = Array.isArray(person?.tags) ? person.tags : [];
  return tags.some((tag) => String(tag || '').trim().toLowerCase() === 'sample-data');
}

function isPersonLinkedToOrg(person = {}, orgId = '') {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) return false;
  return (Array.isArray(person?.organizations) ? person.organizations : [])
    .some((row) => idsEqual(row?.orgId, targetOrgId));
}

function isSampleStudentRow(row) {
  const marker = String(row?.localId || '').trim().toUpperCase();
  return /^SMP-STU-/.test(marker) || looksLikeSampleNote(row?.notes, 'student');
}

function isSampleTeacherRow(row) {
  const marker = String(row?.employeeNumber || '').trim().toUpperCase();
  return /^SMP-TCH-/.test(marker) || looksLikeSampleNote(row?.notes, 'teacher');
}

function isSampleStaffRow(row) {
  const marker = String(row?.employeeNumber || '').trim().toUpperCase();
  return /^SMP-STF-/.test(marker) || looksLikeSampleNote(row?.notes, 'staff');
}

function isSampleRoleRowForPreview(group, row, person, orgId) {
  if (group === 'students' && isSampleStudentRow(row)) return true;
  if (group === 'teachers' && isSampleTeacherRow(row)) return true;
  if (group === 'staff' && isSampleStaffRow(row)) return true;
  return personHasSampleDataTag(person) && isPersonLinkedToOrg(person, orgId);
}

const DEFAULT_MASTER_DEFINITIONS = Object.freeze({
  classes: false,
  programs: false,
  terms: false,
  subjects: false,
  departments: false,
  reportTemplates: false,
  timesheetPeriods: false,
  activityCategories: false,
  examDefinitions: false,
  schoolAccounts: false
});

function normalizeMasterDefinitions(input = {}) {
  const out = { ...DEFAULT_MASTER_DEFINITIONS };
  Object.keys(DEFAULT_MASTER_DEFINITIONS).forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      out[key] = input[key] === true || input[key] === 'true' || input[key] === 'on';
    }
  });
  return out;
}

function normalizeClearCount(result) {
  return Number(result?.removed ?? result?.deletedCount ?? 0);
}

function normalizeRemainingCount(result) {
  return Number(result?.remaining ?? 0);
}

function mergePurgeWarnings(warnings, label, result) {
  if (!Array.isArray(result?.errors) || !result.errors.length) return;
  warnings.push(`${label}: ${result.errors.join('; ')}`);
}

async function listOrgScopedRows(repository, orgId) {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId || !repository || typeof repository.list !== 'function') return [];
  const rows = await repository.list({
    query: { orgId__eq: targetOrgId },
    scope: { canViewAll: true }
  });
  return Array.isArray(rows) ? rows : [];
}

function toPreviewRow(row = {}) {
  const id = toPublicId(row?.id) || String(row?.id || '').trim();
  const presetLabel = String(row?.label || '').trim();
  if (presetLabel) return { id, label: presetLabel };
  const labelFields = ['name', 'title', 'code', 'localId', 'employeeNumber', 'summary', 'classTitle'];
  let label = '';
  for (const field of labelFields) {
    const value = String(row?.[field] || '').trim();
    if (value) {
      label = value;
      break;
    }
  }
  return { id, label: label || id || '(Unnamed)' };
}

function buildPreviewGroup(key, label, rows = [], options = {}) {
  const sampleLimit = Number(options?.sampleLimit) > 0 ? Number(options.sampleLimit) : 25;
  const normalizedRows = (Array.isArray(rows) ? rows : []).map(toPreviewRow).filter((row) => row.id);
  const count = normalizedRows.length;
  const truncated = count > sampleLimit;
  return {
    key,
    label,
    count,
    rows: truncated ? normalizedRows.slice(0, sampleLimit) : normalizedRows,
    truncated,
    hiddenCount: truncated ? count - sampleLimit : 0,
    skipped: options?.skipped === true,
    note: String(options?.note || '').trim()
  };
}

async function countExistingMigrationLogFiles() {
  const base = path.join(resolveCoreRoot(), 'data/school');
  let count = 0;
  for (const name of MIGRATION_LOG_FILES) {
    const fp = path.join(base, name);
    try {
      await fs.access(fp);
      count += 1;
    } catch (_) {
      // file absent
    }
  }
  return count;
}

function countClassEnrollments(classRows = []) {
  return (Array.isArray(classRows) ? classRows : []).reduce((sum, row) => {
    const students = Array.isArray(row?.enrollment?.students) ? row.enrollment.students : [];
    return sum + students.length;
  }, 0);
}

function countClassesWithEmbeddedSessions(classRows = []) {
  return (Array.isArray(classRows) ? classRows : []).filter((row) => {
    const sessions = Array.isArray(row?.sessions) ? row.sessions : [];
    return sessions.length > 0;
  }).length;
}

function countClassesWithOfficialFinalGrades(classRows = []) {
  return (Array.isArray(classRows) ? classRows : []).filter((row) => {
    const raw = row?.officialFinalGrades;
    return raw
      && typeof raw === 'object'
      && !Array.isArray(raw)
      && Object.keys(raw).length > 0;
  }).length;
}

function isPurgeEligibleSchoolAccount(row = {}) {
  const headCategory = String(row?.headCategory || 'none').trim().toLowerCase();
  return headCategory === 'none';
}

function sumPreviewGroupCounts(groups = []) {
  return (Array.isArray(groups) ? groups : []).reduce((sum, group) => {
    if (group?.skipped === true) return sum;
    return sum + Number(group?.count || 0);
  }, 0);
}

async function buildOrgWorkspaceResetPreview({
  orgId,
  includeAcademicSnapshots = true,
  masterDefinitions = {}
}) {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('Active organization is required.');
  const flags = normalizeMasterDefinitions(masterDefinitions);

  const [
    ledgerRows,
    transactionRows,
    journalRows,
    programRegistrationRows,
    priorSubjectCreditRows,
    termRegistrationRows,
    classEnrollmentPeriodRows,
    withdrawalRows,
    reportInstanceRows,
    reportAssignmentRows,
    timesheetRows,
    activityRows,
    activityCategoryRows,
    leaveRequestRows,
    taskRows,
    taskRoutingRuleRows,
    sessionStudentCaseRows,
    examAnswerRows,
    examAttemptRows,
    examAssignmentRows,
    examAllocationRows,
    classRows,
    subjectRows,
    migrationLogFiles,
    attendancePolicy,
    snapshotRows
  ] = await Promise.all([
    listOrgScopedRows(schoolRepositories.academicLedger, targetOrgId),
    listOrgScopedRows(schoolRepositories.globalTransactions, targetOrgId),
    listOrgScopedRows(schoolRepositories.transactionJournals, targetOrgId),
    listOrgScopedRows(schoolRepositories.studentProgramRegistrations, targetOrgId),
    listOrgScopedRows(schoolRepositories.studentProgramPriorSubjects, targetOrgId),
    listOrgScopedRows(schoolRepositories.studentTermRegistrations, targetOrgId),
    listOrgScopedRows(schoolRepositories.classEnrollmentPeriods, targetOrgId),
    withdrawalRepository.list({
      query: { orgId__eq: targetOrgId },
      scope: { canViewAll: true }
    }),
    listOrgScopedRows(schoolRepositories.reportInstances, targetOrgId),
    listOrgScopedRows(schoolRepositories.reportAssignments, targetOrgId),
    listOrgScopedRows(schoolRepositories.timesheets, targetOrgId),
    listOrgScopedRows(schoolRepositories.activities, targetOrgId),
    listOrgScopedRows(schoolRepositories.activityCategories, targetOrgId),
    listOrgScopedRows(schoolRepositories.leaveRequests, targetOrgId),
    listOrgScopedRows(schoolRepositories.tasks, targetOrgId),
    listOrgScopedRows(schoolRepositories.taskRoutingRules, targetOrgId),
    listOrgScopedRows(schoolRepositories.sessionStudentCases, targetOrgId),
    listOrgScopedRows(schoolRepositories.examAnswers, targetOrgId),
    listOrgScopedRows(schoolRepositories.examAttempts, targetOrgId),
    listOrgScopedRows(schoolRepositories.examAssignments, targetOrgId),
    listOrgScopedRows(schoolRepositories.examAllocations, targetOrgId),
    listOrgScopedRows(schoolRepositories.classes, targetOrgId),
    listOrgScopedRows(schoolRepositories.subjects, targetOrgId),
    countExistingMigrationLogFiles(),
    attendanceMatrixPolicyModel.getPolicyForOrg(targetOrgId),
    schoolRepositories.academicSnapshots.list({
      scope: { canViewAll: false, activeOrgId: targetOrgId }
    })
  ]);

  const normalizedClassRows = Array.isArray(classRows) ? classRows : [];
  const normalizedSnapshotRows = Array.isArray(snapshotRows) ? snapshotRows : [];
  const classEnrollmentCount = countClassEnrollments(normalizedClassRows);
  const embeddedSessionsClassCount = countClassesWithEmbeddedSessions(normalizedClassRows);
  const officialFinalGradesClassCount = countClassesWithOfficialFinalGrades(normalizedClassRows);
  const attendancePolicyCount = attendancePolicy ? 1 : 0;

  const transactionalGroups = [
    buildPreviewGroup('academicLedger', 'Academic ledger entries', ledgerRows),
    buildPreviewGroup('globalTransactions', 'Global transactions', transactionRows),
    buildPreviewGroup('transactionJournals', 'Transaction journals', journalRows),
    buildPreviewGroup('programRegistrations', 'Program registrations', programRegistrationRows),
    buildPreviewGroup('priorSubjectCredits', 'Prior subject credits', priorSubjectCreditRows),
    buildPreviewGroup('termRegistrations', 'Term registrations', termRegistrationRows),
    buildPreviewGroup('classEnrollmentPeriods', 'Class enrollment periods', classEnrollmentPeriodRows),
    buildPreviewGroup('withdrawals', 'Withdrawals', withdrawalRows),
    buildPreviewGroup('classEnrollments', 'Legacy class roster enrollments', [], { note: `${classEnrollmentCount} enrollment row(s) across org classes` }),
    buildPreviewGroup('reportInstances', 'Report instances', reportInstanceRows),
    buildPreviewGroup('reportAssignments', 'Report assignments', reportAssignmentRows),
    buildPreviewGroup('timesheets', 'Timesheet entries', timesheetRows),
    buildPreviewGroup('activities', 'Activities', activityRows),
    buildPreviewGroup('activityCategories', 'Activity categories', activityCategoryRows),
    buildPreviewGroup('leaveRequests', 'Leave requests', leaveRequestRows),
    buildPreviewGroup('tasks', 'Tasks', taskRows),
    buildPreviewGroup('taskRoutingRules', 'Task routing rules', taskRoutingRuleRows),
    buildPreviewGroup('sessionStudentCases', 'Session issues / cases', sessionStudentCaseRows),
    buildPreviewGroup('examAnswers', 'Exam answers', examAnswerRows),
    buildPreviewGroup('examAttempts', 'Exam attempts', examAttemptRows),
    buildPreviewGroup('examAssignments', 'Exam assignments', examAssignmentRows),
    buildPreviewGroup('examAllocations', 'Exam allocations', examAllocationRows),
    includeAcademicSnapshots
      ? buildPreviewGroup('academicSnapshots', 'Academic snapshots', normalizedSnapshotRows)
      : buildPreviewGroup('academicSnapshots', 'Academic snapshots', normalizedSnapshotRows, {
        skipped: true,
        note: 'Snapshots will be preserved for this reset.'
      }),
    buildPreviewGroup('classRuntimeDirs', 'Class workspace folders', normalizedClassRows, {
      note: `${normalizedClassRows.length} class workspace folder(s)`
    }),
    buildPreviewGroup('embeddedSessions', 'Embedded sessions on class rows', [], {
      note: `${embeddedSessionsClassCount} class row(s) with embedded sessions`
    }),
    buildPreviewGroup('subjectStorageDirs', 'Subject storage folders', subjectRows, {
      note: `${(Array.isArray(subjectRows) ? subjectRows : []).length} subject storage folder(s)`
    }),
    buildPreviewGroup('migrationLogFiles', 'Migration log files', [], {
      note: `${migrationLogFiles} optional migration log file(s) present`
    }),
    buildPreviewGroup('attendanceMatrixPolicy', 'Attendance matrix policy override', [], {
      note: attendancePolicyCount ? 'Org attendance matrix policy override is set' : 'No org attendance matrix policy override'
    }),
    buildPreviewGroup('officialFinalGradesClasses', 'Official final grades workflow state', [], {
      note: `${officialFinalGradesClassCount} class(es) with official final grade workflow state`
    }),
    buildPreviewGroup('classIndexesRebuilt', 'Class schedule indexes rebuilt', normalizedClassRows, {
      note: `${normalizedClassRows.length} class index rebuild(s)`
    })
  ];

  transactionalGroups.find((g) => g.key === 'classEnrollments').count = classEnrollmentCount;
  transactionalGroups.find((g) => g.key === 'embeddedSessions').count = embeddedSessionsClassCount;
  transactionalGroups.find((g) => g.key === 'migrationLogFiles').count = migrationLogFiles;
  transactionalGroups.find((g) => g.key === 'attendanceMatrixPolicy').count = attendancePolicyCount;
  transactionalGroups.find((g) => g.key === 'officialFinalGradesClasses').count = officialFinalGradesClassCount;

  const masterGroups = [];
  const protectedGroups = [];

  if (flags.examDefinitions) {
    const [examQuestionRows, examRevisionRows, examTemplateRows] = await Promise.all([
      listOrgScopedRows(schoolRepositories.examQuestions, targetOrgId),
      listOrgScopedRows(schoolRepositories.examRevisions, targetOrgId),
      listOrgScopedRows(schoolRepositories.examTemplates, targetOrgId)
    ]);
    masterGroups.push(
      buildPreviewGroup('examQuestions', 'Exam questions', examQuestionRows),
      buildPreviewGroup('examRevisions', 'Exam revisions', examRevisionRows),
      buildPreviewGroup('examTemplates', 'Exam templates', examTemplateRows)
    );
  }

  if (flags.reportTemplates) {
    masterGroups.push(buildPreviewGroup(
      'reportTemplates',
      'Report templates',
      await listOrgScopedRows(schoolRepositories.reportTemplates, targetOrgId)
    ));
  }

  if (flags.timesheetPeriods) {
    masterGroups.push(buildPreviewGroup(
      'timesheetPeriods',
      'Timesheet periods',
      await listOrgScopedRows(schoolRepositories.timesheetPeriods, targetOrgId)
    ));
  }

  if (flags.activityCategories) {
    masterGroups.push(buildPreviewGroup(
      'activityCategories',
      'Activity categories (remaining after transactional clear)',
      activityCategoryRows,
      { note: 'Transactional reset already clears activity categories; this shows any rows that would be targeted again.' }
    ));
  }

  if (flags.classes) {
    masterGroups.push(buildPreviewGroup('classes', 'Classes (master rows)', normalizedClassRows));
  }

  if (flags.subjects) {
    masterGroups.push(buildPreviewGroup(
      'subjects',
      'Subjects',
      await listOrgScopedRows(schoolRepositories.subjects, targetOrgId)
    ));
  }

  if (flags.programs) {
    masterGroups.push(buildPreviewGroup(
      'programs',
      'Programs',
      await listOrgScopedRows(schoolRepositories.programs, targetOrgId)
    ));
  }

  if (flags.terms) {
    masterGroups.push(buildPreviewGroup(
      'terms',
      'Terms',
      await listOrgScopedRows(schoolRepositories.terms, targetOrgId)
    ));
  }

  if (flags.departments) {
    masterGroups.push(buildPreviewGroup(
      'departments',
      'Departments',
      await listOrgScopedRows(schoolRepositories.departments, targetOrgId)
    ));
  }

  if (flags.schoolAccounts) {
    const accountRows = await listOrgScopedRows(schoolRepositories.schoolAccounts, targetOrgId);
    const eligibleAccounts = accountRows.filter(isPurgeEligibleSchoolAccount);
    const protectedAccounts = accountRows.filter((row) => !isPurgeEligibleSchoolAccount(row));
    masterGroups.push(buildPreviewGroup('schoolAccounts', 'School accounts (purge eligible)', eligibleAccounts));
    protectedGroups.push(buildPreviewGroup(
      'schoolAccountsHead',
      'Protected head school accounts',
      protectedAccounts.map((row) => ({
        ...toPreviewRow(row),
        label: `${toPreviewRow(row).label} [${String(row?.headCategory || 'none')}]`
      }))
    ));
  }

  const selectedKeys = Object.keys(flags).filter((key) => flags[key] === true);
  const transactionalRecords = sumPreviewGroupCounts(transactionalGroups.filter((g) => g.key !== 'classIndexesRebuilt'))
    + classEnrollmentCount
    + embeddedSessionsClassCount
    + migrationLogFiles
    + attendancePolicyCount
    + officialFinalGradesClassCount
    + normalizedClassRows.length;
  const masterRecords = sumPreviewGroupCounts(masterGroups);
  const protectedRecords = sumPreviewGroupCounts(protectedGroups);

  return {
    orgId: targetOrgId,
    generatedAt: new Date().toISOString(),
    includeAcademicSnapshots: includeAcademicSnapshots === true,
    masterDefinitions: flags,
    transactional: {
      groups: transactionalGroups,
      summary: { totalRecords: transactionalRecords }
    },
    masters: {
      selectedKeys,
      groups: masterGroups,
      protected: protectedGroups
    },
    summary: {
      transactionalRecords,
      masterRecords,
      protectedRecords
    }
  };
}

async function clearOptionalMasterDefinitions({
  orgId,
  masterDefinitions = {},
  activityCategoriesAlreadyCleared = false
}) {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('Active organization is required.');

  const flags = normalizeMasterDefinitions(masterDefinitions);
  const cleared = {};
  const remaining = {};
  const warnings = [];
  const anySelected = Object.values(flags).some(Boolean);
  if (!anySelected) {
    return { cleared, remaining, warnings };
  }

  if (flags.examDefinitions) {
    const examQuestionsResult = await schoolRepositories.examQuestions.clearByOrg(targetOrgId);
    const examRevisionsResult = await schoolRepositories.examRevisions.clearByOrg(targetOrgId);
    const examTemplatesResult = await schoolRepositories.examTemplates.clearByOrg(targetOrgId);
    cleared.examQuestions = normalizeClearCount(examQuestionsResult);
    cleared.examRevisions = normalizeClearCount(examRevisionsResult);
    cleared.examTemplates = normalizeClearCount(examTemplatesResult);
    remaining.examQuestions = normalizeRemainingCount(examQuestionsResult);
    remaining.examRevisions = normalizeRemainingCount(examRevisionsResult);
    remaining.examTemplates = normalizeRemainingCount(examTemplatesResult);
  }

  if (flags.reportTemplates) {
    const result = await schoolRepositories.purgeOrgScopedRepositoryRows(
      schoolRepositories.reportTemplates,
      targetOrgId
    );
    cleared.reportTemplates = Number(result?.removed || 0);
    remaining.reportTemplates = Number(result?.remaining || 0);
    mergePurgeWarnings(warnings, 'Report templates', result);
  }

  if (flags.timesheetPeriods) {
    const result = await schoolRepositories.purgeOrgScopedRepositoryRows(
      schoolRepositories.timesheetPeriods,
      targetOrgId
    );
    cleared.timesheetPeriods = Number(result?.removed || 0);
    remaining.timesheetPeriods = Number(result?.remaining || 0);
    mergePurgeWarnings(warnings, 'Timesheet periods', result);
  }

  if (flags.activityCategories && !activityCategoriesAlreadyCleared) {
    const result = await schoolRepositories.activityCategories.clearByOrg(targetOrgId);
    cleared.activityCategories = normalizeClearCount(result);
    remaining.activityCategories = normalizeRemainingCount(result);
  } else if (flags.activityCategories) {
    const scopedRows = await schoolRepositories.activityCategories.list({
      query: { orgId__eq: targetOrgId },
      scope: { canViewAll: true }
    });
    cleared.activityCategories = 0;
    remaining.activityCategories = Array.isArray(scopedRows) ? scopedRows.length : 0;
  }

  if (flags.classes) {
    const result = await schoolRepositories.purgeOrgScopedRepositoryRows(
      schoolRepositories.classes,
      targetOrgId
    );
    cleared.classes = Number(result?.removed || 0);
    remaining.classes = Number(result?.remaining || 0);
    mergePurgeWarnings(warnings, 'Classes', result);
  }

  if (flags.subjects) {
    const result = await schoolRepositories.purgeOrgScopedRepositoryRows(
      schoolRepositories.subjects,
      targetOrgId
    );
    cleared.subjects = Number(result?.removed || 0);
    remaining.subjects = Number(result?.remaining || 0);
    mergePurgeWarnings(warnings, 'Subjects', result);
  }

  if (flags.programs) {
    const result = await schoolRepositories.purgeOrgScopedRepositoryRows(
      schoolRepositories.programs,
      targetOrgId
    );
    cleared.programs = Number(result?.removed || 0);
    remaining.programs = Number(result?.remaining || 0);
    mergePurgeWarnings(warnings, 'Programs', result);
  }

  if (flags.terms) {
    const result = await schoolRepositories.purgeOrgScopedRepositoryRows(
      schoolRepositories.terms,
      targetOrgId
    );
    cleared.terms = Number(result?.removed || 0);
    remaining.terms = Number(result?.remaining || 0);
    mergePurgeWarnings(warnings, 'Terms', result);
  }

  if (flags.departments) {
    const result = await schoolRepositories.purgeOrgScopedRepositoryRows(
      schoolRepositories.departments,
      targetOrgId
    );
    cleared.departments = Number(result?.removed || 0);
    remaining.departments = Number(result?.remaining || 0);
    mergePurgeWarnings(warnings, 'Departments', result);
  }

  if (flags.schoolAccounts) {
    const result = await schoolRepositories.purgeOrgScopedSchoolAccounts(targetOrgId);
    cleared.schoolAccounts = Number(result?.removed || 0);
    cleared.schoolAccountsSkippedHead = Number(result?.skippedHeadAccounts || 0);
    remaining.schoolAccounts = Number(result?.remaining || 0);
    mergePurgeWarnings(warnings, 'School accounts', result);
  }

  return { cleared, remaining, warnings };
}

function resolvePersonDisplayName(person = {}) {
  const preferred = String(person?.name?.preferred || '').trim();
  if (preferred) return preferred;
  const first = String(person?.name?.first || '').trim();
  const last = String(person?.name?.last || '').trim();
  const combined = `${first} ${last}`.trim();
  return combined || '(Unnamed Person)';
}

function resolvePersonPrimaryEmail(person = {}) {
  const direct = String(person?.contact?.email || '').trim();
  if (direct) return direct;
  const emails = Array.isArray(person?.contact?.emails) ? person.contact.emails : [];
  const primary = emails.find((row) => row?.isPrimary && String(row?.email || '').trim());
  if (primary?.email) return String(primary.email).trim();
  const first = emails.find((row) => String(row?.email || '').trim());
  return first?.email ? String(first.email).trim() : '';
}

function buildRolePreviewRow({
  group,
  roleToken,
  row,
  person,
  account
}) {
  const id = toPublicId(row?.id);
  const personId = toPublicId(row?.personId);
  const accountId = toPublicId(
    group === 'students'
      ? row?.studentAccountId
      : (group === 'teachers' ? row?.teacherAccountId : row?.staffAccountId)
  );
  const statusRaw = group === 'students'
    ? String(row?.academicStatus || '').trim()
    : String(row?.status || '').trim();
  const statusLabel = statusRaw || 'Unknown';
  const statusKey = normalizeStatusKey(statusRaw, 'unknown');
  const isArchived = statusKey === 'archived';
  const sampleCode = String(
    group === 'students'
      ? row?.localId
      : row?.employeeNumber
  ).trim();

  return {
    id,
    group,
    role: roleToken,
    personId,
    personName: resolvePersonDisplayName(person || {}),
    personEmail: resolvePersonPrimaryEmail(person || {}),
    status: statusLabel,
    statusKey,
    isArchived,
    sampleCode,
    notes: String(row?.notes || '').trim(),
    linkedAccountId: accountId || '',
    linkedAccountName: accountId ? String(account?.name || '').trim() : '',
    linkedAccountStatus: accountId ? String(account?.status || '').trim().toLowerCase() : ''
  };
}

function removeRoleMembershipForOrg(personOrganizations = [], orgId, rolesToRemove = new Set()) {
  const targetOrgId = toPublicId(orgId);
  const roleSet = new Set(
    Array.from(rolesToRemove || [])
      .map((token) => normalizeRoleToken(token))
      .filter(Boolean)
  );
  if (!targetOrgId || !roleSet.size) {
    return { changed: false, organizations: Array.isArray(personOrganizations) ? personOrganizations : [] };
  }

  let changed = false;
  const updated = (Array.isArray(personOrganizations) ? personOrganizations : []).map((orgRow) => {
    const orgIdValue = toPublicId(orgRow?.orgId);
    if (!idsEqual(orgIdValue, targetOrgId)) return orgRow;

    const originalRoles = Array.isArray(orgRow?.roles)
      ? orgRow.roles.map((role) => normalizeRoleToken(role)).filter(Boolean)
      : [normalizeRoleToken(orgRow?.role || 'member')].filter(Boolean);
    const dedupedRoles = Array.from(new Set(originalRoles.length ? originalRoles : ['member']));
    const filteredRoles = dedupedRoles.filter((role) => !roleSet.has(role));
    const finalRoles = filteredRoles.length ? filteredRoles : ['member'];
    const roleChanged = finalRoles.length !== dedupedRoles.length
      || finalRoles.some((role, idx) => role !== dedupedRoles[idx]);
    if (!roleChanged) return orgRow;

    changed = true;
    return {
      ...orgRow,
      roles: finalRoles,
      role: finalRoles[0]
    };
  });

  return { changed, organizations: updated };
}

async function buildSamplePeopleDeletePreview({
  orgId,
  reqUser
}) {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) throw new Error('Active organization is required.');

  const [studentsAll, teachersAll, staffAll, accountsAll] = await Promise.all([
    schoolRepositories.students.list({
      query: { orgId__eq: targetOrgId },
      scope: { canViewAll: true }
    }),
    schoolRepositories.teachers.list({
      query: { orgId__eq: targetOrgId },
      scope: { canViewAll: true }
    }),
    schoolRepositories.staff.list({
      query: { orgId__eq: targetOrgId },
      scope: { canViewAll: true }
    }),
    schoolRepositories.schoolAccounts.list({
      query: { orgId__eq: targetOrgId },
      scope: { canViewAll: true }
    })
  ]);

  const candidatePersonIds = normalizeIdList([
    ...(Array.isArray(studentsAll) ? studentsAll : []).map((row) => row?.personId),
    ...(Array.isArray(teachersAll) ? teachersAll : []).map((row) => row?.personId),
    ...(Array.isArray(staffAll) ? staffAll : []).map((row) => row?.personId)
  ]);

  const peopleRows = await Promise.all(
    candidatePersonIds.map(async (personId) => {
      try {
        return await dataServiceGlobal.getDataById('persons', personId, reqUser, {
          enrichment: { includeSchoolRoles: false }
        });
      } catch (_) {
        return null;
      }
    })
  );
  const personMap = new Map();
  peopleRows.forEach((person) => {
    const personId = toPublicId(person?.id);
    if (!personId) return;
    personMap.set(personId, person);
  });

  const sampleStudents = (Array.isArray(studentsAll) ? studentsAll : []).filter((row) => {
    const person = personMap.get(toPublicId(row?.personId));
    return isSampleRoleRowForPreview('students', row, person, targetOrgId);
  });
  const sampleTeachers = (Array.isArray(teachersAll) ? teachersAll : []).filter((row) => {
    const person = personMap.get(toPublicId(row?.personId));
    return isSampleRoleRowForPreview('teachers', row, person, targetOrgId);
  });
  const sampleStaff = (Array.isArray(staffAll) ? staffAll : []).filter((row) => {
    const person = personMap.get(toPublicId(row?.personId));
    return isSampleRoleRowForPreview('staff', row, person, targetOrgId);
  });

  const associatedPersonIds = normalizeIdList([
    ...sampleStudents.map((row) => row?.personId),
    ...sampleTeachers.map((row) => row?.personId),
    ...sampleStaff.map((row) => row?.personId)
  ]);

  const accountMap = new Map();
  (Array.isArray(accountsAll) ? accountsAll : []).forEach((account) => {
    const accountId = toPublicId(account?.id);
    if (!accountId) return;
    accountMap.set(accountId, account);
  });

  const students = sampleStudents
    .map((row) => buildRolePreviewRow({
      group: 'students',
      roleToken: 'school_student',
      row,
      person: personMap.get(toPublicId(row?.personId)),
      account: accountMap.get(toPublicId(row?.studentAccountId))
    }))
    .filter((row) => row.id);
  const teachers = sampleTeachers
    .map((row) => buildRolePreviewRow({
      group: 'teachers',
      roleToken: 'school_teacher',
      row,
      person: personMap.get(toPublicId(row?.personId)),
      account: accountMap.get(toPublicId(row?.teacherAccountId))
    }))
    .filter((row) => row.id);
  const staff = sampleStaff
    .map((row) => buildRolePreviewRow({
      group: 'staff',
      roleToken: 'school_staff',
      row,
      person: personMap.get(toPublicId(row?.personId)),
      account: accountMap.get(toPublicId(row?.staffAccountId))
    }))
    .filter((row) => row.id);

  const associationsByPersonId = new Map();
  const addAssociation = (group, row) => {
    const personId = toPublicId(row?.personId);
    if (!personId) return;
    if (!associationsByPersonId.has(personId)) {
      associationsByPersonId.set(personId, []);
    }
    associationsByPersonId.get(personId).push({
      group,
      role: row.role,
      roleId: row.id,
      status: row.status,
      sampleCode: row.sampleCode
    });
  };
  students.forEach((row) => addAssociation('students', row));
  teachers.forEach((row) => addAssociation('teachers', row));
  staff.forEach((row) => addAssociation('staff', row));

  const persons = associatedPersonIds.map((personId) => {
    const person = personMap.get(personId);
    const roleDiagnostics = splitPersonRoleTokens(person || {});
    const links = Array.isArray(associationsByPersonId.get(personId))
      ? associationsByPersonId.get(personId)
      : [];
    const activeMembership = (Array.isArray(person?.organizations) ? person.organizations : [])
      .find((orgRow) => idsEqual(orgRow?.orgId, targetOrgId));
    return {
      id: personId,
      personName: resolvePersonDisplayName(person || {}),
      personEmail: resolvePersonPrimaryEmail(person || {}),
      status: person ? (person.active === false ? 'inactive' : 'active') : 'missing',
      membershipStatus: String(activeMembership?.memberStatus || '').trim().toLowerCase() || '',
      schoolRoles: roleDiagnostics.schoolRoles,
      otherRoles: roleDiagnostics.otherRoles,
      hasOtherRoles: roleDiagnostics.hasOtherRoles,
      associations: links,
      associationCount: links.length
    };
  });

  const linkedAccountMap = new Map();
  [...students, ...teachers, ...staff].forEach((row) => {
    const accountId = toPublicId(row?.linkedAccountId);
    if (!accountId) return;
    if (!linkedAccountMap.has(accountId)) {
      const account = accountMap.get(accountId);
      linkedAccountMap.set(accountId, {
        id: accountId,
        name: String(account?.name || '').trim(),
        status: String(account?.status || '').trim().toLowerCase() || 'unknown',
        owners: []
      });
    }
    linkedAccountMap.get(accountId).owners.push({
      group: row.group,
      role: row.role,
      roleId: row.id,
      personId: row.personId
    });
  });

  return {
    orgId: targetOrgId,
    generatedAt: new Date().toISOString(),
    groups: {
      students,
      teachers,
      staff,
      persons
    },
    linkedAccounts: Array.from(linkedAccountMap.values()),
    summary: {
      students: students.length,
      teachers: teachers.length,
      staff: staff.length,
      persons: persons.length,
      linkedAccounts: linkedAccountMap.size
    }
  };
}

function mapById(rows = []) {
  const out = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const id = toPublicId(row?.id);
    if (!id) return;
    out.set(id, row);
  });
  return out;
}

function buildRoleAssociationIndex(preview = {}) {
  const out = new Map();
  const addRows = (groupName, rows = []) => {
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const personId = toPublicId(row?.personId);
      const roleId = toPublicId(row?.id);
      if (!personId || !roleId) return;
      if (!out.has(personId)) out.set(personId, []);
      out.get(personId).push({
        group: groupName,
        roleId,
        role: normalizeRoleToken(row?.role)
      });
    });
  };
  addRows('students', preview?.groups?.students);
  addRows('teachers', preview?.groups?.teachers);
  addRows('staff', preview?.groups?.staff);
  return out;
}

async function buildCurrentRoleAccountReferenceIndex(orgId = '') {
  const targetOrgId = toPublicId(orgId);
  const query = targetOrgId ? { orgId__eq: targetOrgId } : {};
  const [students, teachers, staff] = await Promise.all([
    schoolRepositories.students.list({
      query,
      scope: { canViewAll: true }
    }),
    schoolRepositories.teachers.list({
      query,
      scope: { canViewAll: true }
    }),
    schoolRepositories.staff.list({
      query,
      scope: { canViewAll: true }
    })
  ]);

  const out = new Map();
  const pushRef = (accountIdRaw, ref) => {
    const accountId = toPublicId(accountIdRaw);
    if (!accountId) return;
    if (!out.has(accountId)) out.set(accountId, []);
    out.get(accountId).push(ref);
  };

  (Array.isArray(students) ? students : []).forEach((row) => {
    pushRef(row?.studentAccountId, { group: 'students', roleId: toPublicId(row?.id) });
  });
  (Array.isArray(teachers) ? teachers : []).forEach((row) => {
    pushRef(row?.teacherAccountId, { group: 'teachers', roleId: toPublicId(row?.id) });
  });
  (Array.isArray(staff) ? staff : []).forEach((row) => {
    pushRef(row?.staffAccountId, { group: 'staff', roleId: toPublicId(row?.id) });
  });

  return out;
}

async function buildCurrentRolePersonReferenceIndex(orgId = '') {
  const targetOrgId = toPublicId(orgId);
  const query = targetOrgId ? { orgId__eq: targetOrgId } : {};
  const [students, teachers, staff] = await Promise.all([
    schoolRepositories.students.list({
      query,
      scope: { canViewAll: true }
    }),
    schoolRepositories.teachers.list({
      query,
      scope: { canViewAll: true }
    }),
    schoolRepositories.staff.list({
      query,
      scope: { canViewAll: true }
    })
  ]);

  const out = new Map();
  const pushRef = (personIdRaw, ref) => {
    const personId = toPublicId(personIdRaw);
    if (!personId) return;
    if (!out.has(personId)) out.set(personId, []);
    out.get(personId).push(ref);
  };

  (Array.isArray(students) ? students : []).forEach((row) => {
    pushRef(row?.personId, { group: 'students', roleId: toPublicId(row?.id) });
  });
  (Array.isArray(teachers) ? teachers : []).forEach((row) => {
    pushRef(row?.personId, { group: 'teachers', roleId: toPublicId(row?.id) });
  });
  (Array.isArray(staff) ? staff : []).forEach((row) => {
    pushRef(row?.personId, { group: 'staff', roleId: toPublicId(row?.id) });
  });

  return out;
}

function validateSelectedIds({
  selectedIds = [],
  allowedById = new Map(),
  label = 'records'
}) {
  const invalid = normalizeIdList(selectedIds).filter((id) => !allowedById.has(id));
  if (invalid.length) {
    throw new Error(`One or more selected ${label} are no longer valid in the sample preview scope.`);
  }
}

function computeBatchStatus(summary = {}) {
  const requested = Number(summary?.requested?.total || 0);
  const succeeded = Number(summary?.succeeded?.total || 0);
  const failed = Number(summary?.failed?.total || 0);
  const skipped = Number(summary?.skipped?.total || 0);
  if (requested <= 0) return 'error';
  if (failed <= 0 && skipped <= 0) return 'success';
  if (succeeded > 0 || skipped > 0) return 'partial';
  return 'error';
}

function computeSummaryTotals(summary = {}) {
  ['requested', 'succeeded', 'failed', 'skipped'].forEach((bucket) => {
    const row = summary[bucket] || {};
    summary[bucket] = {
      students: Number(row.students || 0),
      teachers: Number(row.teachers || 0),
      staff: Number(row.staff || 0),
      persons: Number(row.persons || 0),
      accounts: Number(row.accounts || 0)
    };
    summary[bucket].total =
      summary[bucket].students
      + summary[bucket].teachers
      + summary[bucket].staff
      + summary[bucket].persons
      + summary[bucket].accounts;
  });
  return summary;
}

async function deleteSelectedSamplePeople({
  orgId,
  reqUser,
  studentIds = [],
  teacherIds = [],
  staffIds = [],
  personIds = []
}) {
  const preview = await buildSamplePeopleDeletePreview({ orgId, reqUser });
  const targetOrgId = toPublicId(preview?.orgId);
  if (!targetOrgId) throw new Error('Active organization is required.');

  const selected = {
    students: normalizeIdList(studentIds),
    teachers: normalizeIdList(teacherIds),
    staff: normalizeIdList(staffIds),
    persons: normalizeIdList(personIds)
  };

  const byId = {
    students: mapById(preview?.groups?.students),
    teachers: mapById(preview?.groups?.teachers),
    staff: mapById(preview?.groups?.staff),
    persons: mapById(preview?.groups?.persons)
  };

  validateSelectedIds({ selectedIds: selected.students, allowedById: byId.students, label: 'student records' });
  validateSelectedIds({ selectedIds: selected.teachers, allowedById: byId.teachers, label: 'teacher records' });
  validateSelectedIds({ selectedIds: selected.staff, allowedById: byId.staff, label: 'staff records' });
  validateSelectedIds({ selectedIds: selected.persons, allowedById: byId.persons, label: 'person records' });

  const summary = computeSummaryTotals({
    requested: {
      students: selected.students.length,
      teachers: selected.teachers.length,
      staff: selected.staff.length,
      persons: selected.persons.length,
      accounts: 0
    },
    succeeded: {
      students: 0,
      teachers: 0,
      staff: 0,
      persons: 0,
      accounts: 0
    },
    skipped: {
      students: 0,
      teachers: 0,
      staff: 0,
      persons: 0,
      accounts: 0
    },
    failed: {
      students: 0,
      teachers: 0,
      staff: 0,
      persons: 0,
      accounts: 0
    }
  });
  const results = [];

  const successfulRoleDeletes = {
    students: new Set(),
    teachers: new Set(),
    staff: new Set()
  };
  const roleMembershipRemovalsByPerson = new Map();
  const accountCandidates = new Set();

  const appendResult = (group, id, status, message, extra = {}) => {
    results.push({
      group,
      id: toPublicId(id) || '',
      status,
      message: String(message || '').trim() || (status === 'success' ? 'Completed.' : 'Failed.'),
      ...extra
    });
  };

  const runRoleDeletes = async (groupKey, ids, deleteFn, roleToken) => {
    for (const id of ids) {
      const item = byId[groupKey].get(id);
      if (!item) {
        summary.failed[groupKey] += 1;
        appendResult(groupKey, id, 'error', 'Record was not found in current preview.');
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        const removed = await deleteFn(id);
        if (!removed) throw new Error('Record not found or already removed.');
        summary.succeeded[groupKey] += 1;
        successfulRoleDeletes[groupKey].add(id);
        appendResult(groupKey, id, 'success', 'Deleted permanently.');

        const personId = toPublicId(item.personId);
        if (personId) {
          if (!roleMembershipRemovalsByPerson.has(personId)) roleMembershipRemovalsByPerson.set(personId, new Set());
          roleMembershipRemovalsByPerson.get(personId).add(roleToken);
        }
        const accountId = toPublicId(item.linkedAccountId);
        if (accountId) accountCandidates.add(accountId);
      } catch (error) {
        summary.failed[groupKey] += 1;
        appendResult(groupKey, id, 'error', String(error?.message || error));
      }
    }
  };

  await runRoleDeletes('students', selected.students, (id) => schoolRepositories.students.purgeById(id), 'school_student');
  await runRoleDeletes('teachers', selected.teachers, (id) => schoolRepositories.teachers.purgeById(id), 'school_teacher');
  await runRoleDeletes('staff', selected.staff, (id) => schoolRepositories.staff.purgeById(id), 'school_staff');

  for (const [personId, rolesToRemove] of roleMembershipRemovalsByPerson.entries()) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const person = await dataServiceGlobal.getDataById('persons', personId, reqUser, {
        enrichment: { includeSchoolRoles: false }
      });
      if (!person) continue;
      const membershipUpdate = removeRoleMembershipForOrg(person.organizations, targetOrgId, rolesToRemove);
      if (!membershipUpdate.changed) continue;
      // eslint-disable-next-line no-await-in-loop
      await dataServiceGlobal.updateData('persons', personId, {
        organizations: membershipUpdate.organizations,
        audit: {
          ...(person.audit || {}),
          lastUpdateUser: 'SYSTEM_SAMPLE_CLEANUP',
          lastUpdateDateTime: new Date().toISOString()
        }
      }, reqUser);
    } catch (error) {
      appendResult('persons', personId, 'error', `Role membership cleanup failed: ${String(error?.message || error)}`, {
        operation: 'membership_cleanup'
      });
    }
  }

  const roleAssociationsByPerson = buildRoleAssociationIndex(preview);
  const selectedRoleSets = {
    students: new Set(selected.students),
    teachers: new Set(selected.teachers),
    staff: new Set(selected.staff)
  };
  const currentPersonReferences = await buildCurrentRolePersonReferenceIndex();

  for (const personId of selected.persons) {
    const links = Array.isArray(roleAssociationsByPerson.get(personId)) ? roleAssociationsByPerson.get(personId) : [];
    const hasUnselectedLinkedRole = links.some((link) => !selectedRoleSets[link.group]?.has(link.roleId));
    if (hasUnselectedLinkedRole) {
      summary.skipped.persons += 1;
      appendResult('persons', personId, 'skipped', 'Skipped: linked role rows were not selected.');
      continue;
    }
    const hasUndeletedLinkedRole = links.some((link) => !successfulRoleDeletes[link.group]?.has(link.roleId));
    if (hasUndeletedLinkedRole) {
      summary.skipped.persons += 1;
      appendResult('persons', personId, 'skipped', 'Skipped: one or more linked role rows could not be deleted.');
      continue;
    }
    const liveRefs = Array.isArray(currentPersonReferences.get(personId))
      ? currentPersonReferences.get(personId)
      : [];
    if (liveRefs.length) {
      summary.skipped.persons += 1;
      appendResult('persons', personId, 'skipped', `Skipped: person is still referenced by ${liveRefs.length} school role record(s).`, {
        references: liveRefs
      });
      continue;
    }

    let personLatest = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      personLatest = await dataServiceGlobal.getDataById('persons', personId, reqUser, {
        enrichment: { includeSchoolRoles: false }
      });
    } catch (error) {
      summary.failed.persons += 1;
      appendResult('persons', personId, 'error', `Person fetch failed: ${String(error?.message || error)}`);
      continue;
    }
    if (!personLatest) {
      summary.skipped.persons += 1;
      appendResult('persons', personId, 'skipped', 'Skipped: person record is already absent; linked school rows were cleaned.');
      continue;
    }
    const roleDiagnostics = splitPersonRoleTokens(personLatest);
    if (roleDiagnostics.hasOtherRoles) {
      summary.skipped.persons += 1;
      appendResult('persons', personId, 'skipped', 'Skipped: non-school roles detected; person was retained.', {
        otherRoles: roleDiagnostics.otherRoles
      });
      continue;
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      const removed = await dataServiceGlobal.deleteData('persons', personId, reqUser);
      if (!removed) throw new Error('Person not found or already removed.');
      summary.succeeded.persons += 1;
      appendResult('persons', personId, 'success', 'Deleted permanently.');
    } catch (error) {
      summary.failed.persons += 1;
      appendResult('persons', personId, 'error', String(error?.message || error));
    }
  }

  const accountOwnerMap = new Map();
  (Array.isArray(preview?.linkedAccounts) ? preview.linkedAccounts : []).forEach((account) => {
    const accountId = toPublicId(account?.id);
    if (!accountId) return;
    accountOwnerMap.set(accountId, Array.isArray(account?.owners) ? account.owners : []);
  });
  const currentAccountReferences = await buildCurrentRoleAccountReferenceIndex();

  summary.requested.accounts = accountCandidates.size;
  for (const accountId of accountCandidates) {
    const owners = accountOwnerMap.get(accountId) || [];
    const hasUnselectedOwner = owners.some((owner) => !selectedRoleSets[owner.group]?.has(toPublicId(owner?.roleId)));
    if (hasUnselectedOwner) {
      summary.failed.accounts += 1;
      appendResult('accounts', accountId, 'error', 'Skipped: account is still owned by unselected role rows.');
      continue;
    }
    const hasOwnerDeleteFailure = owners.some((owner) => !successfulRoleDeletes[owner.group]?.has(toPublicId(owner?.roleId)));
    if (hasOwnerDeleteFailure) {
      summary.failed.accounts += 1;
      appendResult('accounts', accountId, 'error', 'Skipped: account owner deletion did not fully succeed.');
      continue;
    }
    const liveRefs = Array.isArray(currentAccountReferences.get(accountId))
      ? currentAccountReferences.get(accountId)
      : [];
    if (liveRefs.length) {
      summary.failed.accounts += 1;
      appendResult('accounts', accountId, 'error', `Skipped: account still referenced by ${liveRefs.length} role record(s).`, {
        references: liveRefs
      });
      continue;
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      const removed = await schoolRepositories.schoolAccounts.purgeById(accountId);
      if (!removed) throw new Error('School account not found or already removed.');
      summary.succeeded.accounts += 1;
      appendResult('accounts', accountId, 'success', 'Deleted permanently.');
    } catch (error) {
      summary.failed.accounts += 1;
      appendResult('accounts', accountId, 'error', String(error?.message || error));
    }
  }

  computeSummaryTotals(summary);
  const status = computeBatchStatus(summary);
  return {
    status,
    message: status === 'success'
      ? 'Selected sample people and linked records were deleted.'
      : (status === 'partial'
        ? 'Deletion completed with partial success. Review item results.'
        : 'No selected records were deleted. Review item results.'),
    summary,
    results
  };
}

/**
 * Clears term-based official final grade workflow state on all classes in the org (schoolClasses / classes.json).
 */
async function clearOfficialFinalGradesForOrg(orgId) {
  const targetOrgId = toPublicId(orgId);
  if (!targetOrgId) return { classesUpdated: 0 };
  const rows = await schoolRepositories.classes.list({
    query: { orgId__eq: targetOrgId },
    scope: { canViewAll: true }
  });
  let classesUpdated = 0;
  for (const row of rows || []) {
    const id = toPublicId(row?.id);
    if (!id) continue;
    const raw = row.officialFinalGrades;
    const has = raw
      && typeof raw === 'object'
      && !Array.isArray(raw)
      && Object.keys(raw).length > 0;
    if (!has) continue;
    await schoolRepositories.classes.update(id, { officialFinalGrades: null }, { scope: { canViewAll: true } });
    classesUpdated += 1;
  }
  return { classesUpdated };
}

async function clearSampleTransactionalData({
  orgId,
  includeAcademicSnapshots = true,
  masterDefinitions = {}
}) {
  const targetOrgId = String(orgId || '').trim();
  if (!targetOrgId) throw new Error('Active organization is required.');
  const normalizedMasterDefinitions = normalizeMasterDefinitions(masterDefinitions);

  const [
    ledgerResult,
    transactionResult,
    journalResult,
    programRegistrationResult,
    priorSubjectCreditsResult,
    termRegistrationResult,
    classEnrollmentPeriodResult,
    withdrawalResult,
    classEnrollmentResult,
    reportInstancesResult,
    reportAssignmentsResult,
    timesheetsResult,
    classRuntimeResult,
    subjectStorageResult,
    activitiesResult,
    activityCategoriesResult,
    leaveRequestsResult,
    tasksResult,
    taskRoutingRulesResult,
    sessionStudentCasesResult
  ] = await Promise.all([
    schoolRepositories.academicLedger.clearByOrg(targetOrgId),
    schoolRepositories.globalTransactions.clearByOrg(targetOrgId),
    schoolRepositories.transactionJournals.clearByOrg(targetOrgId),
    schoolRepositories.studentProgramRegistrations.clearByOrg(targetOrgId),
    schoolRepositories.studentProgramPriorSubjects.clearByOrg(targetOrgId),
    schoolRepositories.studentTermRegistrations.clearByOrg(targetOrgId),
    schoolRepositories.classEnrollmentPeriods.clearByOrg(targetOrgId),
    withdrawalRepository.clearWithdrawalsByOrg(targetOrgId),
    schoolRepositories.classes.clearEnrollmentsByOrg(targetOrgId),
    schoolRepositories.reportInstances.clearByOrg(targetOrgId),
    schoolRepositories.reportAssignments.clearByOrg(targetOrgId),
    schoolRepositories.timesheets.clearByOrg(targetOrgId),
    schoolRepositories.classes.clearRuntimeStorageByOrg(targetOrgId),
    schoolRepositories.subjects.clearStorageByOrg(targetOrgId),
    schoolRepositories.activities.clearByOrg(targetOrgId),
    schoolRepositories.activityCategories.clearByOrg(targetOrgId),
    schoolRepositories.leaveRequests.clearByOrg(targetOrgId),
    schoolRepositories.tasks.clearByOrg(targetOrgId),
    schoolRepositories.taskRoutingRules.clearByOrg(targetOrgId),
    schoolRepositories.sessionStudentCases.clearByOrg(targetOrgId)
  ]);

  const examAnswersResult = await schoolRepositories.examAnswers.clearByOrg(targetOrgId);
  const examAttemptsResult = await schoolRepositories.examAttempts.clearByOrg(targetOrgId);
  const examAssignmentsResult = await schoolRepositories.examAssignments.clearByOrg(targetOrgId);
  const examAllocationsResult = await schoolRepositories.examAllocations.clearByOrg(targetOrgId);

  let snapshotResult = { removed: 0, remaining: 0 };
  if (includeAcademicSnapshots) {
    snapshotResult = await schoolRepositories.academicSnapshots.clearByOrg(targetOrgId);
  } else {
    const scopedSnapshots = await schoolRepositories.academicSnapshots.list({
      scope: { canViewAll: false, activeOrgId: targetOrgId }
    });
    snapshotResult = { removed: 0, remaining: Number(scopedSnapshots.length || 0) };
  }

  const migrationLogResult = await removeOptionalMigrationLogFiles();

  const [attendancePolicyResult, officialGradesResult] = await Promise.all([
    attendanceMatrixPolicyModel.removePolicyForOrg(targetOrgId),
    clearOfficialFinalGradesForOrg(targetOrgId)
  ]);

  const classRows = await schoolRepositories.classes.list({
    query: { orgId__eq: targetOrgId },
    scope: { canViewAll: true }
  });
  const orgClassIds = (Array.isArray(classRows) ? classRows : [])
    .map((c) => String(c?.id || '').trim())
    .filter(Boolean);

  const indexRebuildErrors = [];
  let classIndexesRebuilt = 0;
  for (const classId of orgClassIds) {
    try {
      await indexService.rebuildIndexesForClass(classId);
      classIndexesRebuilt += 1;
    } catch (err) {
      indexRebuildErrors.push(`${classId}: ${String(err?.message || err)}`);
    }
  }

  const masterPurgeResult = await clearOptionalMasterDefinitions({
    orgId: targetOrgId,
    masterDefinitions: normalizedMasterDefinitions,
    activityCategoriesAlreadyCleared: true
  });

  const warnings = [];
  if (Array.isArray(classRuntimeResult?.errors) && classRuntimeResult.errors.length) {
    warnings.push(`Class workspace cleanup: ${classRuntimeResult.errors.join('; ')}`);
  }
  if (Array.isArray(subjectStorageResult?.errors) && subjectStorageResult.errors.length) {
    warnings.push(`Subject storage cleanup: ${subjectStorageResult.errors.join('; ')}`);
  }
  if (Array.isArray(migrationLogResult?.errors) && migrationLogResult.errors.length) {
    warnings.push(`Migration log files: ${migrationLogResult.errors.join('; ')}`);
  }
  if (indexRebuildErrors.length) {
    const slice = indexRebuildErrors.slice(0, 5).join('; ');
    warnings.push(
      `Class index rebuild: ${slice}${indexRebuildErrors.length > 5 ? '…' : ''}`
    );
  }
  if (Array.isArray(masterPurgeResult?.warnings) && masterPurgeResult.warnings.length) {
    warnings.push(...masterPurgeResult.warnings);
  }

  const transactionalCleared = {
    academicLedgerEntries: Number(ledgerResult?.removed || 0),
    globalTransactions: Number(transactionResult?.removed || 0),
    transactionJournals: Number(journalResult?.removed || 0),
    programRegistrations: Number(programRegistrationResult?.removed || 0),
    priorSubjectCredits: Number(priorSubjectCreditsResult?.removed || 0),
    termRegistrations: Number(termRegistrationResult?.removed || 0),
    classEnrollmentPeriods: Number(classEnrollmentPeriodResult?.removed || 0),
    withdrawals: Number(withdrawalResult?.removed || 0),
    classEnrollments: Number(classEnrollmentResult?.removedEnrollments || 0),
    academicSnapshots: Number(snapshotResult?.removed || 0),
    reportInstances: Number(reportInstancesResult?.removed || 0),
    reportAssignments: Number(reportAssignmentsResult?.removed || 0),
    timesheets: Number(timesheetsResult?.removed || 0),
    activities: normalizeClearCount(activitiesResult),
    activityCategories: normalizeClearCount(activityCategoriesResult),
    leaveRequests: normalizeClearCount(leaveRequestsResult),
    tasks: normalizeClearCount(tasksResult),
    taskRoutingRules: normalizeClearCount(taskRoutingRulesResult),
    sessionStudentCases: normalizeClearCount(sessionStudentCasesResult),
    examAnswers: normalizeClearCount(examAnswersResult),
    examAttempts: normalizeClearCount(examAttemptsResult),
    examAssignments: normalizeClearCount(examAssignmentsResult),
    examAllocations: normalizeClearCount(examAllocationsResult),
    classRuntimeDirs: Number(classRuntimeResult?.removedDirs || 0),
    embeddedSessionsClearedClasses:
      Number(classRuntimeResult?.mongoSessionsClearedClasses || 0)
      + Number(classRuntimeResult?.jsonSessionsClearedClasses || 0),
    subjectStorageDirs: Number(subjectStorageResult?.removedDirs || 0),
    migrationLogFiles: Number(migrationLogResult?.removed || 0),
    attendanceMatrixPolicyOrgs: Number(attendancePolicyResult?.removed || 0),
    officialFinalGradesClasses: Number(officialGradesResult?.classesUpdated || 0),
    classIndexesRebuilt
  };

  const transactionalRemaining = {
    academicLedgerEntries: Number(ledgerResult?.remaining || 0),
    globalTransactions: Number(transactionResult?.remaining || 0),
    transactionJournals: Number(journalResult?.remaining || 0),
    programRegistrations: Number(programRegistrationResult?.remaining || 0),
    priorSubjectCredits: Number(priorSubjectCreditsResult?.remaining || 0),
    termRegistrations: Number(termRegistrationResult?.remaining || 0),
    classEnrollmentPeriods: Number(classEnrollmentPeriodResult?.remaining || 0),
    withdrawals: Number(withdrawalResult?.remaining || 0),
    classEnrollments: Number(classEnrollmentResult?.remainingEnrollmentsInOrg || 0),
    academicSnapshots: Number(snapshotResult?.remaining || 0),
    reportInstances: Number(reportInstancesResult?.remaining || 0),
    reportAssignments: Number(reportAssignmentsResult?.remaining || 0),
    timesheets: Number(timesheetsResult?.remaining || 0),
    activities: normalizeRemainingCount(activitiesResult),
    activityCategories: normalizeRemainingCount(activityCategoriesResult),
    leaveRequests: normalizeRemainingCount(leaveRequestsResult),
    tasks: normalizeRemainingCount(tasksResult),
    taskRoutingRules: normalizeRemainingCount(taskRoutingRulesResult),
    sessionStudentCases: normalizeRemainingCount(sessionStudentCasesResult),
    examAnswers: normalizeRemainingCount(examAnswersResult),
    examAttempts: normalizeRemainingCount(examAttemptsResult),
    examAssignments: normalizeRemainingCount(examAssignmentsResult),
    examAllocations: normalizeRemainingCount(examAllocationsResult)
  };

  return {
    orgId: targetOrgId,
    warnings,
    masterDefinitions: normalizedMasterDefinitions,
    summary: {
      cleared: {
        ...transactionalCleared,
        ...(masterPurgeResult?.cleared || {})
      },
      remaining: {
        ...transactionalRemaining,
        ...(masterPurgeResult?.remaining || {})
      }
    }
  };
}

module.exports = {
  generateSampleSchoolPeople,
  clearSampleTransactionalData,
  clearOptionalMasterDefinitions,
  buildOrgWorkspaceResetPreview,
  buildSamplePeopleDeletePreview,
  deleteSelectedSamplePeople,
  normalizeMasterDefinitions,
  DEFAULT_MASTER_DEFINITIONS
};
