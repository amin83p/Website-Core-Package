'use strict';

/**
 * Admit a new Person + Student from a flat CSV-like record.
 * Always creates a new person (never links an existing personId).
 *
 * Expected columns (minimum): firstName, lastName, gender
 * Optional: middleName, preferredName, dateOfBirth, email, phone, phoneAlt,
 * addressLine1/2, city, provinceState, postalCode, country,
 * enrollmentDate, countryOfOrigin, feeCategory, localId, customStudentId,
 * academicStatus, notes, active
 */

const schoolDataService = require('./schoolDataService');
const { requireCoreModule } = require('./schoolCoreContracts');
const dataServiceGlobal = requireCoreModule('MVC/services/dataService');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const {
  getActiveOrgIdOrThrow,
  normalizeOrgRoles,
  getPrimaryOrgRole
} = requireCoreModule('MVC/utils/orgContextUtils');
const {
  assertNoDuplicatePersonAccount
} = require('./schoolPeopleDuplicateGuardService');
const schoolPersonAccessService = require('./schoolPersonAccessService');

function parseBool(v) {
  return String(v || '').toLowerCase().trim() === 'true' || v === '1' || v === true;
}

function createRandomEquilibriumEmail() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let local = '';
  for (let i = 0; i < 14; i += 1) {
    local += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return `${local}@equilibrium.ab.ca`;
}

function resolveDefaultAdmissionDate(orgToday) {
  const token = String(orgToday || '').trim();
  const year = /^\d{4}/.test(token) ? token.slice(0, 4) : String(new Date().getFullYear());
  return `${year}-01-01`;
}

function resolvePersonDisplayName(person, fallback) {
  const first = String(person?.name?.first || '').trim();
  const last = String(person?.name?.last || '').trim();
  const label = `${first} ${last}`.trim();
  return label || toPublicId(fallback || '') || 'Student';
}

function findActiveOrgHeadAccount(accounts, orgId, headCategory, aliases = []) {
  const orgKey = String(orgId || '').trim();
  const wanted = new Set(
    [headCategory, ...aliases].map((x) => String(x || '').trim().toLowerCase()).filter(Boolean)
  );
  return (accounts || []).find((a) => {
    if (String(a?.orgId || '').trim() !== orgKey) return false;
    if (String(a?.status || '').toLowerCase() !== 'active') return false;
    return wanted.has(String(a?.headCategory || '').trim().toLowerCase());
  }) || null;
}

function buildUniqueAccountCode(orgAccounts, baseCode) {
  const used = new Set((orgAccounts || []).map((a) => String(a?.code || '').trim().toUpperCase()).filter(Boolean));
  let code = String(baseCode || '').trim();
  if (!used.has(code.toUpperCase())) return code;
  let i = 2;
  while (used.has(`${code}_${i}`.toUpperCase())) i += 1;
  return `${code}_${i}`;
}

function buildUniqueAccountName(orgAccounts, baseName) {
  const used = new Set((orgAccounts || []).map((a) => String(a?.name || '').trim().toLowerCase()).filter(Boolean));
  let name = String(baseName || '').trim();
  if (!used.has(name.toLowerCase())) return name;
  let i = 2;
  while (used.has(`${name} (${i})`.toLowerCase())) i += 1;
  return `${name} (${i})`;
}

function normalizeFeeCategoryKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function resolveStudentCategoryParentAccount(orgAccounts, studentsHeadAccount, feeCategory) {
  if (!studentsHeadAccount) return null;
  const key = normalizeFeeCategoryKey(feeCategory);
  const codeMap = {
    domestic: '1221',
    international: '1222',
    corporate: '1223',
    scholarship: '1224',
    government_funded: '1225',
    others: '1226',
    other: '1226',
    linc: '1227',
    linc_alberta: '1227',
    wcb: '1228',
    wcb_alberta: '1228'
  };
  const targetCode = codeMap[key];
  if (!targetCode) return null;
  return (orgAccounts || []).find((a) => {
    if (String(a?.status || '').toLowerCase() !== 'active') return false;
    if (!idsEqual(a?.parentId || '', studentsHeadAccount.id || '')) return false;
    return String(a?.code || '') === String(targetCode);
  }) || null;
}

function buildInitialOrganizations(reqUser) {
  const now = new Date().toISOString();
  const activeOrgId = String(reqUser?.activeOrgId || '').trim();
  if (!activeOrgId) return [];
  const allowedOrgs = Array.isArray(reqUser?.allowedOrgs) ? reqUser.allowedOrgs : [];
  const orgMeta = allowedOrgs.find((o) => String(o?.orgId || '') === activeOrgId) || null;
  const roles = normalizeOrgRoles(orgMeta);
  return [{
    orgId: Number.isFinite(Number(activeOrgId)) ? Number(activeOrgId) : activeOrgId,
    name: String(orgMeta?.name || orgMeta?.orgName || '').trim(),
    roles: roles.length ? roles : ['member'],
    role: getPrimaryOrgRole(orgMeta) || (roles[0] || 'member'),
    memberStatus: 'active',
    joinedAt: now
  }];
}

function applyImportDefaults(record, context = {}) {
  const row = { ...(record || {}) };
  if (String(row.personId || '').trim()) {
    throw new Error('Import creates a new person per row. Remove personId from the CSV.');
  }

  row.firstName = String(row.firstName || '').trim();
  row.lastName = String(row.lastName || '').trim();
  row.middleName = String(row.middleName || '').trim();
  row.preferredName = String(row.preferredName || '').trim();
  row.gender = String(row.gender || '').trim().toLowerCase();
  row.dateOfBirth = String(row.dateOfBirth || '').trim() || '2000-01-01';
  row.email = String(row.email || '').trim() || createRandomEquilibriumEmail();
  row.countryOfOrigin = String(row.countryOfOrigin || '').trim() || 'Canada';
  row.feeCategory = String(row.feeCategory || '').trim() || 'Domestic';
  row.enrollmentDate = String(row.enrollmentDate || '').trim()
    || resolveDefaultAdmissionDate(context.orgToday);
  row.academicStatus = String(row.academicStatus || '').trim() || 'Active';
  row.notes = String(row.notes || '').trim();
  row.localId = String(row.localId || '').trim();
  row.customStudentId = String(row.customStudentId || '').trim();
  return row;
}

function validateImportRecord(record, context = {}) {
  const row = applyImportDefaults(record, context);
  if (!row.firstName || !row.lastName || !row.gender) {
    throw new Error('firstName, lastName, and gender are required.');
  }
  return row;
}

function buildPersonPayloadFromImportRow(row, reqUser) {
  const now = new Date().toISOString();
  const emails = [{ type: 'primary', email: row.email, isPrimary: true }];
  const phones = [];
  const phoneVal = String(row.phone || '').trim();
  const phoneAltVal = String(row.phoneAlt || '').trim();
  if (phoneVal) phones.push({ type: 'mobile', number: phoneVal, isPrimary: true });
  if (phoneAltVal) phones.push({ type: 'home', number: phoneAltVal, isPrimary: false });

  const addresses = [];
  const addressLine1 = String(row.addressLine1 || '').trim();
  if (addressLine1) {
    addresses.push({
      type: 'home',
      line1: addressLine1,
      line2: String(row.addressLine2 || '').trim(),
      city: String(row.city || '').trim(),
      province: String(row.provinceState || row.province || '').trim(),
      postalCode: String(row.postalCode || '').trim()
    });
  }

  return {
    active: row.active === undefined || row.active === '' ? true : parseBool(row.active),
    name: {
      first: row.firstName,
      middle: row.middleName || null,
      last: row.lastName,
      preferred: row.preferredName || null
    },
    demographics: {
      gender: row.gender,
      dateOfBirth: row.dateOfBirth
    },
    contact: {
      emails,
      phones,
      email: row.email
    },
    addresses,
    address: addresses[0] || {},
    tags: [],
    notes: row.notes || null,
    avatarUrl: null,
    organizations: buildInitialOrganizations(reqUser),
    audit: {
      createUser: reqUser?.id || reqUser?.username || 'SYSTEM',
      createDateTime: now,
      lastUpdateUser: reqUser?.id || reqUser?.username || 'SYSTEM',
      lastUpdateDateTime: now
    }
  };
}

async function createStudentSubAccount({ student, person, accessibleAccounts, reqUser, options = {} }) {
  const orgId = String(student?.orgId || '').trim();
  if (!orgId) throw new Error('Student organization is missing while creating account linkage.');

  const allAccessibleAccounts = Array.isArray(accessibleAccounts) ? accessibleAccounts : [];
  const orgAccounts = allAccessibleAccounts.filter((a) => String(a?.orgId || '') === orgId);
  const systemAccounts = allAccessibleAccounts.filter((a) => String(a?.orgId || '').toUpperCase() === 'SYSTEM');

  const studentsHead =
    findActiveOrgHeadAccount(orgAccounts, orgId, 'students', ['student_all']) ||
    findActiveOrgHeadAccount(systemAccounts, 'SYSTEM', 'students', ['student_all']);
  if (!studentsHead) {
    throw new Error('No active "students" head account is configured. Please set one in School Accounts before admitting students.');
  }
  const candidatePool = String(studentsHead?.orgId || '').toUpperCase() === 'SYSTEM'
    ? systemAccounts
    : orgAccounts;
  const parentAccount = resolveStudentCategoryParentAccount(candidatePool, studentsHead, student?.feeCategory) || studentsHead;

  const parentLevel = Number(parentAccount?.level || 1);
  const childLevel = parentLevel + 1;
  if (childLevel > 6) {
    throw new Error('Cannot create student account under the selected parent because account level would exceed 6.');
  }

  const displayName = resolvePersonDisplayName(person, student?.id);
  const baseCode = `STU_${student?.id}`;
  const code = buildUniqueAccountCode(orgAccounts, baseCode);
  const name = buildUniqueAccountName(orgAccounts, `${displayName} (Student Account)`);

  return schoolDataService.addData('schoolAccounts', {
    orgId,
    code,
    name,
    type: String(parentAccount?.type || 'asset').toLowerCase(),
    level: childLevel,
    parentId: String(parentAccount?.id || ''),
    isControl: false,
    allowPost: true,
    partyRole: 'student',
    headCategory: 'none',
    normalBalance: String(parentAccount?.normalBalance || 'debit').toLowerCase() === 'credit' ? 'credit' : 'debit',
    status: 'active',
    description: `Auto-created for student ${student?.id || ''}.`
  }, reqUser, options);
}

function parseClbString(str) {
  if (!str || typeof str !== 'string') return {};
  const result = {};
  const parts = str.trim().split(/\s+/);
  for (const part of parts) {
    const match = part.match(/^([LSRW])(.*)$/i);
    if (match) {
      const type = match[1].toUpperCase();
      const val = match[2];
      if (type === 'L') result.listening = val;
      if (type === 'S') result.speaking = val;
      if (type === 'R') result.reading = val;
      if (type === 'W') result.writing = val;
    }
  }
  return result;
}

function parseClbData(data) {
  if (!data) return {};
  if (typeof data === 'object') return data;
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch (e) {
      return parseClbString(data);
    }
  }
  return {};
}

/**
 * @param {object} record CSV row
 * @param {object} context { reqUser, orgToday, userId }
 */
async function admitNewPersonAndStudentFromRecord(record, context = {}) {
  const reqUser = context.reqUser;
  if (!reqUser) throw new Error('Import requires an authenticated user.');

  const row = validateImportRecord(record, context);
  const activeOrgId = String(context.orgId || getActiveOrgIdOrThrow(reqUser) || '').trim();
  if (!activeOrgId) throw new Error('Active organization is required to import students.');

  const personPayload = buildPersonPayloadFromImportRow(row, reqUser);
  const createdPerson = await dataServiceGlobal.addData('persons', personPayload, reqUser);
  const personId = toPublicId(createdPerson?.id);
  if (!personId) throw new Error('Failed to create person profile.');

  await assertNoDuplicatePersonAccount({
    entityType: 'students',
    orgId: activeOrgId,
    personId,
    excludeId: null,
    requestingUser: reqUser
  });

  await schoolPersonAccessService.ensurePersonHasSchoolRole({
    personId,
    orgId: activeOrgId,
    role: 'school_student',
    reqUser
  });

  const studentPayload = {
    personId,
    customStudentId: row.customStudentId,
    localId: row.localId,
    orgId: activeOrgId,
    countryOfOrigin: row.countryOfOrigin,
    feeCategory: row.feeCategory,
    sendingOrganization: '',
    studentAccountId: '',
    enrollmentDate: row.enrollmentDate,
    academicStatus: row.academicStatus,
    notes: row.notes,
    attachments: [],
    clbLevelHistory: []
  };

  const clbCurrent = parseClbData(row.clbCurrent);
  const clbGoal = parseClbData(row.clbGoal);
  const clbResult = parseClbData(row.clbResult);

  if (Object.keys(clbCurrent).length > 0 || Object.keys(clbGoal).length > 0 || Object.keys(clbResult).length > 0) {
    const todayStr = new Date().toISOString().split('T')[0];
    studentPayload.clbLevelHistory.push({
      id: `clb_${Date.now()}_0`,
      recordedAt: todayStr,
      current: clbCurrent,
      goal: clbGoal,
      result: clbResult
    });
  }

  const savedStudent = await schoolDataService.addData('students', studentPayload, reqUser);
  const createdStudentId = toPublicId(savedStudent?.id);
  if (!createdStudentId) throw new Error('Student was saved but no student id was returned.');

  const accessibleAccounts = await schoolDataService.fetchData('schoolAccounts', {}, reqUser);
  const person = await schoolPersonAccessService.getPersonById({ reqUser, personId });
  const studentAccount = await createStudentSubAccount({
    student: savedStudent,
    person,
    accessibleAccounts,
    reqUser
  });
  const createdStudentAccountId = toPublicId(studentAccount?.id);
  if (!createdStudentAccountId) throw new Error('Student account creation did not return an id.');

  await schoolDataService.updateData(
    'students',
    createdStudentId,
    { ...savedStudent, studentAccountId: createdStudentAccountId },
    reqUser
  );

  return {
    personId,
    studentId: createdStudentId,
    studentAccountId: createdStudentAccountId,
    email: row.email,
    name: `${row.firstName} ${row.lastName}`.trim()
  };
}

module.exports = {
  applyImportDefaults,
  validateImportRecord,
  admitNewPersonAndStudentFromRecord,
  createRandomEquilibriumEmail,
  resolveDefaultAdmissionDate
};
