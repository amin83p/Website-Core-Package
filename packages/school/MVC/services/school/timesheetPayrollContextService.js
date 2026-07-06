const schoolDataService = require('./schoolDataService');
const schoolPersonAccessService = require('./schoolPersonAccessService');
const { requireCoreModule } = require('./schoolCoreContracts');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

const PAYROLL_ROLES = Object.freeze(['teacher', 'staff']);

function normalizeId(value) {
  return String(value || '').trim();
}

function normalizeOrgRoles(orgMembership) {
  const raw = Array.isArray(orgMembership?.roles)
    ? orgMembership.roles
    : (orgMembership?.role ? [orgMembership.role] : []);
  return raw
    .map((r) => String(r || '').trim().toLowerCase())
    .filter(Boolean)
    .filter((r, i, arr) => arr.indexOf(r) === i);
}

function isInactiveSchoolRecord(row) {
  const status = String(row?.status || '').trim().toLowerCase();
  return ['archived', 'deleted', 'inactive', 'terminated'].includes(status);
}

function buildPersonName(person) {
  return String(person?.displayName || person?.name || '').trim()
    || `${person?.name?.first || ''} ${person?.name?.last || ''}`.trim()
    || String(person?.id || person?.personId || '');
}

function normalizePayrollRole(value) {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'teacher' || token === 'staff') return token;
  if (token.includes('teacher')) return 'teacher';
  if (token.includes('staff')) return 'staff';
  return '';
}

function getEligiblePayrollRoles(person, orgId) {
  const targetOrgId = normalizeId(orgId);
  if (!targetOrgId || !person) return [];

  const rolesOut = new Set();
  const directRoles = Array.isArray(person.schoolRoles || person.roles) ? (person.schoolRoles || person.roles) : [];
  if (directRoles.includes('school_teacher')) rolesOut.add('teacher');
  if (directRoles.includes('school_staff')) rolesOut.add('staff');

  const memberships = Array.isArray(person.organizations) ? person.organizations : [];
  memberships.forEach((org) => {
    if (!idsEqual(org?.orgId, targetOrgId)) return;
    const memberStatus = String(org?.memberStatus || 'active').trim().toLowerCase();
    if (memberStatus && memberStatus !== 'active') return;
    const roles = normalizeOrgRoles(org);
    if (roles.includes('school_teacher')) rolesOut.add('teacher');
    if (roles.includes('school_staff')) rolesOut.add('staff');
  });
  return [...rolesOut];
}

function personHasTeacherOrStaffRoleInOrg(person, orgId) {
  return getEligiblePayrollRoles(person, orgId).length > 0;
}

function shapeRoleRecord(role, row) {
  if (!row || isInactiveSchoolRecord(row)) return null;
  const accountId = normalizeId(
    role === 'teacher' ? row.teacherAccountId : row.staffAccountId
  );
  return {
    roleRecordId: normalizeId(row.id),
    accountId,
    compensationProfiles: Array.isArray(row.compensationProfiles) ? row.compensationProfiles : [],
    missingAccount: !accountId
  };
}

async function resolvePayrollPersonContext({ orgId, personId, reqUser } = {}) {
  const activeOrgId = normalizeId(orgId);
  const targetPersonId = normalizeId(personId);
  if (!activeOrgId || !targetPersonId) {
    throw new Error('Organization and person are required for payroll context.');
  }

  const person = await schoolPersonAccessService.getPersonById({
    reqUser,
    personId: targetPersonId,
    requireSchoolRole: false
  });
  if (!person) throw new Error('Person not found.');

  const roles = getEligiblePayrollRoles(person, activeOrgId);
  if (!roles.length) {
    throw new Error('Person does not have an active teacher or staff payroll role in this organization.');
  }

  const [teachers, staff, accounts] = await Promise.all([
    schoolDataService.fetchData('teachers', { orgId__eq: activeOrgId, personId__eq: targetPersonId }, reqUser),
    schoolDataService.fetchData('staff', { orgId__eq: activeOrgId, personId__eq: targetPersonId }, reqUser),
    schoolDataService.fetchData('schoolAccounts', {}, reqUser)
  ]);

  const teacherRow = (Array.isArray(teachers) ? teachers : []).find((row) => !isInactiveSchoolRecord(row)) || null;
  const staffRow = (Array.isArray(staff) ? staff : []).find((row) => !isInactiveSchoolRecord(row)) || null;
  const accountById = new Map((Array.isArray(accounts) ? accounts : [])
    .map((row) => [normalizeId(row?.id), row])
    .filter(([id]) => Boolean(id)));

  const roleRecords = {};
  const warnings = [];

  if (roles.includes('teacher')) {
    const shaped = shapeRoleRecord('teacher', teacherRow);
    if (!shaped) {
      warnings.push('Teacher role is assigned but no active teacher profile was found.');
    } else {
      if (shaped.missingAccount) warnings.push('Teacher profile is missing a linked payroll account.');
      roleRecords.teacher = {
        ...shaped,
        accountLabel: shaped.accountId
          ? String(accountById.get(shaped.accountId)?.name || accountById.get(shaped.accountId)?.code || shaped.accountId)
          : ''
      };
    }
  }

  if (roles.includes('staff')) {
    const shaped = shapeRoleRecord('staff', staffRow);
    if (!shaped) {
      warnings.push('Staff role is assigned but no active staff profile was found.');
    } else {
      if (shaped.missingAccount) warnings.push('Staff profile is missing a linked payroll account.');
      roleRecords.staff = {
        ...shaped,
        accountLabel: shaped.accountId
          ? String(accountById.get(shaped.accountId)?.name || accountById.get(shaped.accountId)?.code || shaped.accountId)
          : ''
      };
    }
  }

  const defaultRole = roles.length === 1 ? roles[0] : (roles.includes('teacher') ? 'teacher' : roles[0]);

  return {
    personId: targetPersonId,
    personName: buildPersonName(person),
    orgId: activeOrgId,
    roles,
    roleRecords,
    defaultRole,
    warnings
  };
}

function resolveRoleForEntry({ payrollContext, requestedRole, source = 'auto' } = {}) {
  const roles = Array.isArray(payrollContext?.roles) ? payrollContext.roles : [];
  const requested = normalizePayrollRole(requestedRole);
  if (requested && roles.includes(requested)) return requested;
  if (roles.length === 1) return roles[0];
  if (source === 'class' || source === 'report') {
    if (roles.includes('teacher')) return 'teacher';
    if (roles.includes('staff')) return 'staff';
  }
  if (source === 'activity') {
    if (roles.includes('staff') && !roles.includes('teacher')) return 'staff';
    if (roles.includes('teacher')) return 'teacher';
  }
  return payrollContext?.defaultRole || 'teacher';
}

function stampEntryPayrollFields({
  entry = {},
  payrollContext,
  period,
  payRateService,
  hours
} = {}) {
  const payableHours = Number(hours);
  const safeHours = Number.isFinite(payableHours) ? payableHours : 0;
  const source = entry?.isManual ? 'manual'
    : (entry?.isReportReflection ? 'report'
      : (entry?.isSchoolActivity ? 'activity' : 'class'));
  const personRole = resolveRoleForEntry({
    payrollContext,
    requestedRole: entry?.personRole,
    source
  });
  const roleMeta = payrollContext?.roleRecords?.[personRole] || null;
  const departmentId = normalizeId(
    entry?.deliveryDepartmentId || entry?.departmentId || ''
  );
  const resolvedRate = payRateService.resolveHourlyRate({
    compensationProfiles: roleMeta?.compensationProfiles || [],
    departmentId,
    period
  });
  const grossPay = resolvedRate && safeHours > 0
    ? payRateService.computeGrossPay(safeHours, resolvedRate.hourlyRate)
    : null;

  return {
    personRole,
    roleRecordId: roleMeta?.roleRecordId || '',
    payrollAccountId: roleMeta?.accountId || '',
    grossPay
  };
}

module.exports = {
  PAYROLL_ROLES,
  normalizePayrollRole,
  getEligiblePayrollRoles,
  personHasTeacherOrStaffRoleInOrg,
  resolvePayrollPersonContext,
  resolveRoleForEntry,
  stampEntryPayrollFields
};
