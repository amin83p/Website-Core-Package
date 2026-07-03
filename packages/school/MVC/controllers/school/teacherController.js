// MVC/controllers/school/teacherController.js
const dataService = require('../../services/school/schoolDataService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const dataServiceGlobal = requireCoreModule('MVC/services/dataService');
const { createTransactionContext, addDeleteCompensation } = requireCoreModule('MVC/services/transactionContextService');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');
const {
  assertNoDuplicatePersonAccount,
  enrichPersonPickerRowsWithAccountState
} = require('../../services/school/schoolPeopleDuplicateGuardService');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const settingService = requireCoreModule('MVC/services/settingService');
const { isAjax, buildDataServiceQuery, inferSearchableFields } = requireCoreModule('MVC/utils/generalTools');
const {
  getActiveOrgIdOrThrow: getActiveOrgIdOrThrowShared,
  assertCreateOrgContextOrThrow: assertCreateOrgContextOrThrowShared,
  canCreateOrgScopedItem,
  assertOrgAccess,
  normalizeOrgRoles,
  getPrimaryOrgRole
} = requireCoreModule('MVC/utils/orgContextUtils');
const { normalizeOrgRoleTokens } = require('../../utils/schoolRoleTokenUtils');
const { resolveCanonicalOrganizationName } = requireCoreModule('MVC/utils/organizationDisplay');
const { TEACHER_STATUSES, EMPLOYMENT_TYPES, INSTRUCTIONAL_MODES, COMPENSATION_METHODS } = require('../../models/school/teacherModel');
const PERSON_QUERY_OPTIONS = Object.freeze({ enrichment: { includeSchoolRoles: false } });
const TEACHER_DELETE_FOOTPRINT_RULES = Object.freeze([
  { entityType: 'reportAssignments', field: 'teacherIds', label: 'Report Assignments', mode: 'array' },
  { entityType: 'reportInstances', field: 'teacherId', label: 'Report Instances' },
  { entityType: 'timesheets', field: 'teacherId', label: 'Timesheets' },
  { entityType: 'globalTransactions', field: 'party.teacherId', label: 'Global Transactions' },
  { entityType: 'payRates', field: 'personId', label: 'Pay Rates', personRole: 'teacher' }
]);
const TEACHER_DELETE_MAX_FOOTPRINT_SAMPLE = 5;

function getActiveOrgIdOrThrow(reqUser) {
  return getActiveOrgIdOrThrowShared(reqUser);
}

async function assertCreateOrgContextOrThrow(reqUser) {
  return assertCreateOrgContextOrThrowShared(reqUser, { scopeLabel: 'teachers' });
}

function assertTeacherOrgAccess(teacher, activeOrgId, reqUser) {
  assertOrgAccess(teacher, activeOrgId, reqUser, { orgField: 'orgId', allowSystemBypass: true });
}

function toBoolean(v) {
  return v === true || v === 'true' || v === 'on' || v === 1 || v === '1';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getRecordIdentity(record) {
  return toPublicId(record?.id)
    || toPublicId(record?.code)
    || toPublicId(record?.partyId)
    || toPublicId(record?.orgId)
    || toPublicId(record?._id)
    || '';
}

function buildFootprintBlockedMessage(displayName, footprint) {
  const safeName = escapeHtml(displayName);
  if (!Array.isArray(footprint) || !footprint.length) {
    return `Cannot delete ${safeName} because it has related history.`;
  }

  const items = footprint.map((entry) => {
    const sampleText = Array.isArray(entry.samples) && entry.samples.length > 0
      ? `<span class="font-monospace">(${entry.samples.join(', ')})</span>`
      : '';
    return `<li><strong>${escapeHtml(entry.label || '')}</strong>: ${Number(entry.count || 0)} record(s) found ${sampleText}</li>`;
  });

  return `Cannot delete ${safeName} because related history exists. Please remove these references first:<ul>${items.join('')}</ul>`;
}

function buildTeacherDisplayName(teacher, person) {
  const personLabel = `${String(person?.name?.first || '').trim()} ${String(person?.name?.last || '').trim()}`.trim();
  return personLabel || toPublicId(teacher?.id) || toPublicId(teacher?.personId) || 'Teacher';
}

async function collectTeacherFootprint(teacher, personId, activeOrgId, reqUser) {
  const targetTeacherId = toPublicId(teacher?.id);
  if (!targetTeacherId) return [];

  const rows = [];
  const safeActiveOrgId = String(activeOrgId || '').trim();
  const targetPersonId = String(personId || '').trim();

  for (const rule of TEACHER_DELETE_FOOTPRINT_RULES) {
    if (!rule?.entityType || !rule?.field) continue;

    if (String(rule.mode || '').trim().toLowerCase() === 'array') {
      const query = { page: 1 };
      if (safeActiveOrgId) query.orgId__eq = safeActiveOrgId;
      const assignments = await dataService.fetchData(rule.entityType, query, reqUser);
      const relatedRows = Array.isArray(assignments)
        ? assignments.filter((item) => Array.isArray(item?.teacherIds) && item.teacherIds.some((candidateId) => idsEqual(candidateId, targetTeacherId)))
        : [];
      if (!relatedRows.length) continue;
      const samples = relatedRows.slice(0, TEACHER_DELETE_MAX_FOOTPRINT_SAMPLE).map(getRecordIdentity).filter(Boolean);
      rows.push({
        entityType: String(rule.entityType || '').trim(),
        label: String(rule.label || '').trim() || String(rule.entityType || '').trim(),
        count: relatedRows.length,
        samples
      });
      continue;
    }

    const query = { page: 1 };
    if (rule.entityType === 'payRates' && targetPersonId) {
      query.personId__eq = targetPersonId;
      if (rule.personRole) query.personRole__eq = String(rule.personRole || '').trim();
    } else {
      query[`${rule.field}__eq`] = targetTeacherId;
    }
    if (safeActiveOrgId) query.orgId__eq = safeActiveOrgId;

    const relatedRows = await dataService.fetchData(rule.entityType, query, reqUser);
    if (!Array.isArray(relatedRows) || relatedRows.length === 0) continue;
    const samples = relatedRows.slice(0, TEACHER_DELETE_MAX_FOOTPRINT_SAMPLE).map(getRecordIdentity).filter(Boolean);
    rows.push({
      entityType: String(rule.entityType || '').trim(),
      label: String(rule.label || '').trim() || String(rule.entityType || '').trim(),
      count: relatedRows.length,
      samples
    });
  }

  return rows;
}

function logTeacherDeleteAuditEvent(level, payload) {
  const parts = [
    '[TEACHER_DELETE]',
    `level=${String(level || '').trim() || 'unknown'}`,
    `actor=${String(payload?.actor || '').trim() || 'unknown'}`,
    `teacherId=${String(payload?.teacherId || '').trim() || 'unknown'}`,
    `orgId=${String(payload?.orgId || '').trim() || 'unknown'}`,
    `outcome=${String(payload?.outcome || '').trim() || 'unknown'}`
  ];
  const footer = [
    `removedRole=${Boolean(payload?.removedRole) ? 'yes' : 'no'}`,
    `removedSchoolAccount=${Boolean(payload?.removedSchoolAccount) ? 'yes' : 'no'}`,
    `removedTeacher=${Boolean(payload?.removedTeacher) ? 'yes' : 'no'}`,
    `footprint=${Number(payload?.footprintCount || 0)}`
  ];
  console.info(`${parts.join(' ')} ${footer.join(' ')}`);
}

function formatTeacherDisplayNameForLog(teacher, person) {
  return buildTeacherDisplayName(teacher, person);
}

async function removePersonSchoolRole(personId, orgId, role, reqUser, options = {}) {
  const person = await dataServiceGlobal.getDataById('persons', personId, reqUser, PERSON_QUERY_OPTIONS);
  if (!person) return { changed: false, skipped: true, reason: 'person_not_found' };

  const targetRole = String(role || '').trim().toLowerCase();
  if (!targetRole) return { changed: false, skipped: true, reason: 'role_not_defined' };

  const list = Array.isArray(person.organizations) ? person.organizations.slice() : [];
  const idx = list.findIndex((org) => idsEqual(org?.orgId || '', orgId || ''));
  if (idx < 0) return { changed: false, personId: toPublicId(person.id), reason: 'organization_link_not_found' };

  const orgEntry = { ...list[idx] };
  const roles = normalizeOrgRoleTokens(orgEntry);
  if (!roles.includes(targetRole)) return { changed: false, personId: toPublicId(person.id), reason: `${targetRole}_role_not_attached` };

  const nextRoles = roles.filter((candidate) => candidate !== targetRole);
  const nextOrg = { ...orgEntry, roles: Array.isArray(nextRoles) && nextRoles.length > 0 ? nextRoles : ['member'] };
  nextOrg.role = Array.isArray(nextOrg.roles) && nextOrg.roles.length > 0 ? nextOrg.roles[0] : 'member';
  if (!nextOrg.memberStatus) nextOrg.memberStatus = 'active';
  if (!nextOrg.joinedAt) nextOrg.joinedAt = new Date().toISOString();
  list[idx] = nextOrg;

  const beforeOrganizations = Array.isArray(person.organizations) ? JSON.parse(JSON.stringify(person.organizations)) : [];
  await dataServiceGlobal.updateData('persons', person.id, { ...person, organizations: list }, reqUser, options);

  return {
    changed: true,
    personId: toPublicId(person.id),
    beforeOrganizations
  };
}

async function purgeLinkedTeacherAccount(teacher, reqUser, txContext, outcome, warnings) {
  const linkedAccountId = String(teacher?.teacherAccountId || '').trim();
  if (!linkedAccountId) {
    warnings.push('Teacher has no linked school account id.');
    return { removed: false, accountId: '' };
  }

  const accountSnapshot = await dataService.getDataById('schoolAccounts', linkedAccountId, reqUser);
  if (!accountSnapshot) {
    warnings.push(`Linked school account ${linkedAccountId} not found.`);
    return { removed: false, accountId: linkedAccountId };
  }

  const accountSnapshotClone = JSON.parse(JSON.stringify(accountSnapshot));
  await dataService.purgeData('schoolAccounts', linkedAccountId, reqUser, { transactionContext: txContext });

  if (txContext) {
    txContext.addCompensation(async () => {
      await dataService.addData('schoolAccounts', accountSnapshotClone, reqUser, { transactionContext: txContext });
    }, { type: 'restore_teacher_school_account', entityType: 'schoolAccounts', id: toPublicId(linkedAccountId) });
  }

  outcome.removedSchoolAccount = true;
  outcome.teacherAccountId = toPublicId(linkedAccountId);
  return { removed: true, accountId: toPublicId(linkedAccountId), snapshot: accountSnapshotClone };
}

function parseJsonSafe(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
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

function buildUniqueAccountCode(existingOrgAccounts, baseCode) {
  const usedCodes = new Set(
    (existingOrgAccounts || []).map((a) => String(a?.code || '').trim().toUpperCase()).filter(Boolean)
  );
  const base = (normalizeToken(baseCode) || `TCH_${Date.now()}`).slice(0, 40);
  if (!usedCodes.has(base)) return base;
  for (let i = 2; i <= 9999; i++) {
    const suffix = `_${i}`;
    const candidate = `${base.slice(0, Math.max(1, 40 - suffix.length))}${suffix}`;
    if (!usedCodes.has(candidate)) return candidate;
  }
  throw new Error('Unable to generate a unique account code for this teacher.');
}

function buildUniqueAccountName(existingOrgAccounts, baseName) {
  const usedNames = new Set(
    (existingOrgAccounts || []).map((a) => normalizeNameKey(a?.name)).filter(Boolean)
  );
  const compactBase = String(baseName || '').trim().replace(/\s+/g, ' ').slice(0, 160) || 'Teacher Account';
  if (!usedNames.has(normalizeNameKey(compactBase))) return compactBase;
  for (let i = 2; i <= 9999; i++) {
    const suffix = ` (${i})`;
    const candidate = `${compactBase.slice(0, Math.max(1, 160 - suffix.length))}${suffix}`;
    if (!usedNames.has(normalizeNameKey(candidate))) return candidate;
  }
  throw new Error('Unable to generate a unique account name for this teacher.');
}

function resolvePersonDisplayName(person, fallback) {
  const first = String(person?.name?.first || '').trim();
  const last = String(person?.name?.last || '').trim();
  const full = `${first} ${last}`.trim();
  return full || String(fallback || '').trim() || 'Teacher';
}

function resolvePersonMembershipOrgIds(person = null) {
  const list = Array.isArray(person?.organizations) ? person.organizations : [];
  return list.map((entry) => String(entry?.orgId || '').trim()).filter(Boolean);
}

function mapPersonPickerRow(person = null) {
  const firstName = String(person?.name?.first || person?.firstName || '').trim();
  const lastName = String(person?.name?.last || person?.lastName || '').trim();
  const preferredName = String(person?.name?.preferred || person?.preferredName || '').trim();
  const personId = String(person?.id || '').trim();
  const emails = Array.isArray(person?.contact?.emails) ? person.contact.emails : [];
  const contactEmail = String(person?.contact?.email || person?.email || emails[0]?.email || '').trim();
  const displayName = preferredName
    || `${firstName} ${lastName}`.trim()
    || String(person?.displayName || person?.fullName || '').trim()
    || personId;

  return {
    id: personId,
    personId,
    firstName,
    lastName,
    preferredName,
    email: contactEmail,
    name: {
      first: firstName,
      last: lastName,
      preferred: preferredName
    },
    displayName,
    organizations: Array.isArray(person?.organizations) ? person.organizations : []
  };
}
function buildTeacherSearchHaystack(teacher) {
  const firstName = String(teacher?.firstName || '').trim();
  const lastName = String(teacher?.lastName || '').trim();
  const fullName = `${firstName} ${lastName}`.trim();
  const reverseName = `${lastName} ${firstName}`.trim();
  return [
    teacher?.id,
    teacher?.personId,
    firstName,
    lastName,
    fullName,
    reverseName,
    teacher?.email,
    teacher?.phone,
    teacher?.departmentName,
    teacher?.employeeNo,
    teacher?.employmentType,
    teacher?.instructionalMode,
    teacher?.compensationMethod,
    teacher?.teacherAccountId
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
}

function sendGuardedResponse(req, res, guardResult, duplicateMessage, duplicateStatus = 409) {
  if (!guardResult || guardResult.status === 'acquired') return false;
  if (guardResult.status === 'busy') {
    const payload = {
      status: 'warning',
      message: duplicateMessage,
      idempotency: {
        state: 'busy',
        retryAfterMs: Number(guardResult.retryAfterMs || 0)
      }
    };
    if (isAjax(req)) {
      res.status(duplicateStatus).json(payload);
    } else {
      res.status(duplicateStatus).render('error', { title: 'Error', message: payload.message, user: req.user });
    }
    return true;
  }
  if (guardResult.status === 'replay') {
    const payload = guardResult.payload && typeof guardResult.payload === 'object'
      ? { ...guardResult.payload }
      : { status: 'success', message: 'Teacher save already completed.' };
    payload.idempotency = { state: 'replayed' };
    if (isAjax(req)) {
      res.json(payload);
    } else {
      const redirectTo = String(payload.redirectTo || '').trim();
      if (redirectTo) {
        res.redirect(redirectTo);
      } else {
        res.redirect('/school/teachers');
      }
    }
    return true;
  }
  return false;
}

function findActiveOrgHeadAccount(accounts, orgId, headCategory, aliases = []) {
  const allowedCategories = new Set(
    [headCategory]
      .concat(Array.isArray(aliases) ? aliases : [])
      .map((v) => String(v || '').trim().toLowerCase())
      .filter(Boolean)
  );
  return (accounts || []).find((a) => {
    if (!idsEqual(a?.orgId || '', orgId || '')) return false;
    if (String(a?.status || '').toLowerCase() !== 'active') return false;
    return allowedCategories.has(String(a?.headCategory || 'none').toLowerCase());
  }) || null;
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

async function createTeacherSubAccount({ teacher, person, accessibleAccounts, reqUser, options = {} }) {
  const orgId = String(teacher?.orgId || '').trim();
  if (!orgId) throw new Error('Teacher organization is missing while creating account linkage.');

  const allAccessibleAccounts = Array.isArray(accessibleAccounts) ? accessibleAccounts : [];
  const orgAccounts = allAccessibleAccounts.filter((a) => String(a?.orgId || '') === orgId);
  const systemAccounts = allAccessibleAccounts.filter((a) => String(a?.orgId || '').toUpperCase() === 'SYSTEM');
  const teachersHead =
    findActiveOrgHeadAccount(orgAccounts, orgId, 'teachers') ||
    findActiveOrgHeadAccount(systemAccounts, 'SYSTEM', 'teachers');
  if (!teachersHead) {
    throw new Error('No active "teachers" head account is configured. Please set one in School Accounts before adding teachers.');
  }

  const targetOrgId = String(teachersHead?.orgId || orgId).trim();
  const targetOrgAccounts = targetOrgId.toUpperCase() === 'SYSTEM' ? systemAccounts : orgAccounts;
  const parentLevel = Number(teachersHead?.level || 1);
  const childLevel = parentLevel + 1;
  if (childLevel > 6) throw new Error('Cannot create teacher account because account level would exceed 6.');

  const displayName = resolvePersonDisplayName(person, teacher?.id);
  const code = buildUniqueAccountCode(targetOrgAccounts, `TCH_${teacher?.id}`);
  const name = buildUniqueAccountName(targetOrgAccounts, `${displayName} (Teacher)`);

  const accountPayload = {
    orgId: targetOrgId,
    code,
    name,
    type: String(teachersHead?.type || 'asset').toLowerCase(),
    level: childLevel,
    parentId: String(teachersHead?.id || ''),
    isControl: false,
    allowPost: true,
    partyRole: 'teacher',
    headCategory: 'none',
    normalBalance: String(teachersHead?.normalBalance || 'debit').toLowerCase() === 'credit' ? 'credit' : 'debit',
    status: 'active',
    description: `Auto-created for teacher ${teacher?.id || ''}.`
  };
  return await dataService.addData('schoolAccounts', accountPayload, reqUser, options);
}

async function archiveLinkedTeacherAccount(teacher, reqUser) {
  const linkedAccountId = String(teacher?.teacherAccountId || '').trim();
  if (!linkedAccountId) return null;
  const account = await dataService.getDataById('schoolAccounts', linkedAccountId, reqUser);
  if (!account) return null;
  if (String(account.status || '').toLowerCase() === 'archived') return account;
  return await dataService.updateData('schoolAccounts', linkedAccountId, { ...account, status: 'archived', allowPost: false }, reqUser);
}

async function recoverLinkedTeacherAccount(teacher, reqUser) {
  const linkedAccountId = String(teacher?.teacherAccountId || '').trim();
  if (!linkedAccountId) return null;
  const account = await dataService.getDataById('schoolAccounts', linkedAccountId, reqUser);
  if (!account) return null;
  if (String(account.status || '').toLowerCase() !== 'archived') return account;
  return await dataService.updateData('schoolAccounts', linkedAccountId, { ...account, status: 'active', allowPost: true }, reqUser);
}

function buildInlinePersonPayload(body, reqUser) {
  const now = new Date().toISOString();
  const firstName = String(body.newPersonFirstName || '').trim();
  const middleName = String(body.newPersonMiddleName || '').trim();
  const lastName = String(body.newPersonLastName || '').trim();
  const preferredName = String(body.newPersonPreferredName || '').trim();
  const notes = String(body.newPersonNotes || '').trim();
  const active = toBoolean(body.newPersonActive);
  const gender = String(body.newPersonGender || '').trim().toLowerCase();
  const dateOfBirth = String(body.newPersonDateOfBirth || '').trim();

  const emailsRaw = parseJsonSafe(body.newPersonEmails, []);
  const phonesRaw = parseJsonSafe(body.newPersonPhones, []);
  const addressesRaw = parseJsonSafe(body.newPersonAddresses, []);

  const emails = Array.isArray(emailsRaw)
    ? emailsRaw
      .map((e) => ({
        type: String(e?.type || 'work').trim().toLowerCase(),
        email: String(e?.email || '').trim(),
        isPrimary: Boolean(e?.isPrimary)
      }))
      .filter((e) => !!e.email)
    : [];

  const fallbackEmail = String(body.newPersonEmail || '').trim();
  if (!emails.length && fallbackEmail) emails.push({ type: 'primary', email: fallbackEmail, isPrimary: true });
  if (!emails.length) throw new Error('At least one email is required for new person registration.');
  if (!emails.some((e) => e.isPrimary)) emails[0].isPrimary = true;

  const phones = Array.isArray(phonesRaw)
    ? phonesRaw
      .map((p) => ({ type: String(p?.type || 'mobile').trim().toLowerCase(), number: String(p?.number || '').trim() }))
      .filter((p) => !!p.number)
    : [];

  const fallbackPhone = String(body.newPersonPhone || '').trim();
  if (!phones.length && fallbackPhone) phones.push({ type: 'mobile', number: fallbackPhone });

  const addresses = Array.isArray(addressesRaw)
    ? addressesRaw
      .map((a) => ({
        type: String(a?.type || 'home').trim().toLowerCase(),
        line1: String(a?.line1 || '').trim(),
        city: String(a?.city || '').trim(),
        province: String(a?.province || '').trim(),
        postalCode: String(a?.postalCode || '').trim()
      }))
      .filter((a) => !!(a.line1 || a.city || a.province || a.postalCode))
    : [];

  if (!firstName || !lastName || !gender || !dateOfBirth) {
    throw new Error('New Person fields are incomplete. Please provide first name, last name, gender, and date of birth.');
  }

  const activeOrgId = String(reqUser?.activeOrgId || '').trim();
  const allowedOrgs = Array.isArray(reqUser?.allowedOrgs) ? reqUser.allowedOrgs : [];
  const activeOrgMeta = allowedOrgs.find((o) => String(o?.orgId || '') === activeOrgId) || null;
  const baseOrgRoles = normalizeOrgRoles(activeOrgMeta);
  const initialOrganizations = activeOrgId
    ? [{
      orgId: Number.isFinite(Number(activeOrgId)) ? Number(activeOrgId) : activeOrgId,
      name: String(activeOrgMeta?.name || activeOrgMeta?.orgName || '').trim(),
      roles: baseOrgRoles,
      role: getPrimaryOrgRole(activeOrgMeta),
      memberStatus: 'active',
      joinedAt: now
    }]
    : [];

  return {
    active,
    name: {
      first: firstName,
      middle: middleName || null,
      last: lastName,
      preferred: preferredName || null
    },
    demographics: { gender, dateOfBirth },
    contact: {
      emails,
      phones,
      email: emails.find((e) => e.isPrimary)?.email || emails[0]?.email || null
    },
    addresses,
    address: addresses[0] || {},
    tags: [],
    notes: notes || null,
    avatarUrl: null,
    organizations: initialOrganizations,
    audit: {
      createUser: reqUser?.id || reqUser?.username || 'SYSTEM',
      createDateTime: now,
      lastUpdateUser: reqUser?.id || reqUser?.username || 'SYSTEM',
      lastUpdateDateTime: now
    }
  };
}

async function ensurePersonHasOrgRole(personId, orgId, role, reqUser, options = {}) {
  const person = await dataServiceGlobal.getDataById('persons', personId, reqUser, PERSON_QUERY_OPTIONS);
  if (!person) throw new Error('Linked person record was not found.');

  const targetRole = String(role || '').trim().toLowerCase();
  if (!targetRole) return;

  const list = Array.isArray(person.organizations) ? person.organizations.slice() : [];
  const now = new Date().toISOString();
  const idx = list.findIndex((org) => idsEqual(org?.orgId || '', orgId || ''));
  let orgName = '';
  try {
    const orgObj = await dataServiceGlobal.getDataById('organizations', orgId, reqUser);
    orgName = resolveCanonicalOrganizationName(orgObj || {});
  } catch (_) {}

  let changed = false;
  if (idx >= 0) {
    const org = { ...list[idx] };
    const roles = normalizeOrgRoles(org);
    if (!roles.includes(targetRole)) {
      roles.push(targetRole);
      changed = true;
    }
    org.roles = roles;
    org.role = getPrimaryOrgRole(org);
    if (!org.memberStatus) {
      org.memberStatus = 'active';
      changed = true;
    }
    if (!org.joinedAt) {
      org.joinedAt = now;
      changed = true;
    }
    if (orgName && String(org.name || '').trim() !== orgName) {
      org.name = orgName;
      changed = true;
    }
    list[idx] = org;
  } else {
    list.push({
      orgId: Number.isFinite(Number(orgId)) ? Number(orgId) : orgId,
      name: orgName,
      roles: ['member', targetRole].filter((v, i, arr) => arr.indexOf(v) === i),
      role: 'member',
      memberStatus: 'active',
      joinedAt: now
    });
    changed = true;
  }

  if (changed) {
    await dataServiceGlobal.updateData('persons', person.id, { ...person, organizations: list }, reqUser, options);
  }
  return {
    changed,
    personId: toPublicId(person.id),
    beforeOrganizations: Array.isArray(person.organizations) ? JSON.parse(JSON.stringify(person.organizations)) : []
  };
}

exports.listEligiblePersons = async (req, res) => {
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    const query = await buildDataServiceQuery(req.query);
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query.q = '';

    const persons = await dataServiceGlobal.fetchData('persons', {
      q: query.q || '',
      type: query.type || 'contains',
      searchFields: query.searchFields || 'id,name.first,name.last,name.preferred,preferredName,contact.email,email'
    }, req.user, PERSON_QUERY_OPTIONS);

    const mapped = (Array.isArray(persons) ? persons : [])
      .filter((person) => {
        const orgIds = resolvePersonMembershipOrgIds(person);
        return orgIds.length === 0 || orgIds.some((orgId) => idsEqual(orgId, activeOrgId));
      })
      .map(mapPersonPickerRow);
    const enriched = await enrichPersonPickerRowsWithAccountState(mapped, {
      entityType: 'teachers',
      orgId: activeOrgId,
      requestingUser: req.user
    });

    const { data, pagination } = paginate(enriched, query);
    return res.json({
      status: 'success',
      results: data,
      pagination
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};
exports.listTeachers = async (req, res) => {
  try {
    let query = await buildDataServiceQuery(req.query);
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query.q = '';
    const searchTerm = String(query.q || '').trim().toLowerCase();
    const fetchQuery = { ...query };
    delete fetchQuery.q;
    delete fetchQuery.type;
    delete fetchQuery.searchFields;
    const canCreateTeachers = await canCreateOrgScopedItem(req.user, { scopeLabel: 'teachers' });
    if (String(query.status || '').trim().toLowerCase() === 'archived') {
      delete query.status;
      delete fetchQuery.status;
    }

    const allTeachers = await dataService.fetchData('teachers', fetchQuery, req.user);
    const persons = await dataServiceGlobal.fetchData('persons', {}, req.user, PERSON_QUERY_OPTIONS);
    const departments = await dataService.fetchData('departments', {}, req.user);

    const deptById = new Map((departments || []).map((d) => [String(d.id), d.name || d.id]));
    const enriched = allTeachers.map((teacher) => {
      const person = persons.find((p) => idsEqual(p.id, teacher.personId));
      return {
        ...teacher,
        firstName: person?.name?.first || 'Unknown',
        lastName: person?.name?.last || 'Person',
        email: person?.contact?.email || 'N/A',
        phone: person?.contact?.phones?.[0]?.number || 'N/A',
        departmentName: deptById.get(String(teacher.departmentId || '')) || '-'
      };
    });

    const visibleTeachers = enriched.filter((t) => String(t?.status || '').trim().toLowerCase() !== 'archived');
    const searchedTeachers = !searchTerm
      ? visibleTeachers
      : visibleTeachers.filter((teacher) => buildTeacherSearchHaystack(teacher).includes(searchTerm));
    const searchableFields = await inferSearchableFields(searchedTeachers, { exclude: ['audit'] });
    const { data, pagination } = paginate(searchedTeachers, query);

    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });

    res.render('school/teacher/teacherList', {
      title: 'Teacher Directory',
      tableName: 'Teachers_Directory',
      newUrl: 'school/teachers',
      newLabel: canCreateTeachers ? 'Add Teacher' : null,
      data,
      searchableFields,
      includeModal: true,
      includeModal_Table: true,
      print: true,
      pagination,
      filters: req.query,
      statuses: TEACHER_STATUSES,
      employmentTypes: EMPLOYMENT_TYPES,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', error, message: error.message });
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.listArchivedTeachers = async (req, res) => {
  try {
    let query = await buildDataServiceQuery(req.query);
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query.q = '';
    const searchTerm = String(query.q || '').trim().toLowerCase();

    const archivedQuery = { ...query, status: 'Archived' };
    delete archivedQuery.q;
    delete archivedQuery.type;
    delete archivedQuery.searchFields;
    const allTeachers = await dataService.fetchData('teachers', archivedQuery, req.user);
    const persons = await dataServiceGlobal.fetchData('persons', {}, req.user, PERSON_QUERY_OPTIONS);
    const departments = await dataService.fetchData('departments', {}, req.user);
    const deptById = new Map((departments || []).map((d) => [String(d.id), d.name || d.id]));

    const enriched = allTeachers.map((teacher) => {
      const person = persons.find((p) => idsEqual(p.id, teacher.personId));
      return {
        ...teacher,
        firstName: person?.name?.first || 'Unknown',
        lastName: person?.name?.last || 'Person',
        email: person?.contact?.email || 'N/A',
        phone: person?.contact?.phones?.[0]?.number || 'N/A',
        departmentName: deptById.get(String(teacher.departmentId || '')) || '-'
      };
    });

    const archivedTeachers = enriched.filter((t) => String(t?.status || '').trim().toLowerCase() === 'archived');
    const searchedArchivedTeachers = !searchTerm
      ? archivedTeachers
      : archivedTeachers.filter((teacher) => buildTeacherSearchHaystack(teacher).includes(searchTerm));
    const searchableFields = await inferSearchableFields(searchedArchivedTeachers, { exclude: ['audit'] });
    const { data, pagination } = paginate(searchedArchivedTeachers, query);
    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });

    res.render('school/teacher/teacherRecovery', {
      title: 'Recover Archived Teachers',
      tableName: 'Archived_Teachers',
      data,
      searchableFields,
      includeModal: true,
      includeModal_Table: true,
      print: true,
      pagination,
      filters: req.query,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', error, message: error.message });
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.showForm = async (req, res) => {
  try {
    const isEdit = !!req.params.id;
    const activeOrgId = isEdit
      ? getActiveOrgIdOrThrow(req.user)
      : await assertCreateOrgContextOrThrow(req.user);
    let teacher = {};
    let personName = '';
    let personOrganizations = [];

    if (isEdit) {
      teacher = await dataService.getDataById('teachers', req.params.id, req.user);
      if (!teacher) throw new Error('Teacher not found.');
      assertTeacherOrgAccess(teacher, activeOrgId, req.user);
      const person = await dataServiceGlobal.getDataById('persons', teacher.personId, req.user, PERSON_QUERY_OPTIONS);
      if (person) {
        personName = `${person.name?.first || ''} ${person.name?.last || ''}`.trim();
        personOrganizations = Array.isArray(person.organizations) ? person.organizations : [];
      }
    }

    const [departments, organizations] = await Promise.all([
      dataService.fetchData('departments', {}, req.user),
      dataServiceGlobal.fetchData('organizations', {}, req.user)
    ]);
    const organizationLookup = {};
    (organizations || []).forEach((org) => {
      const id = String(org?.id || org?.orgId || '').trim();
      if (!id) return;
      organizationLookup[id] = String(
        org?.name ||
        org?.orgName ||
        org?.identity?.displayName ||
        org?.identity?.legalName ||
        id
      ).trim();
    });

    const editFormDisplayName = String(personName || '').trim() || 'Teacher';
    const editFormRecordId = String(teacher.id || teacher.personId || '').trim();

    res.render('school/teacher/teacherForm', {
      title: isEdit ? `Edit Teacher: ${editFormDisplayName} (${editFormRecordId})` : 'New Teacher',
      teacher,
      personName,
      personOrganizations,
      organizationLookup,
      departments,
      statuses: TEACHER_STATUSES,
      employmentTypes: EMPLOYMENT_TYPES,
      instructionalModes: INSTRUCTIONAL_MODES,
      compensationMethods: COMPENSATION_METHODS,
      user: req.user,
      includeModal: true,      
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.saveTeacher = async (req, res) => {
  let txContext = null;
  let guardKey = '';
  try {
    const { id } = req.params;
    const activeOrgId = id
      ? getActiveOrgIdOrThrow(req.user)
      : await assertCreateOrgContextOrThrow(req.user);
    guardKey = idempotencyGuardService.createGuardKey([
      'teacher_save',
      String(activeOrgId || '').trim(),
      String(id || '').trim(),
      req.body || {}
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 180000,
      replayTtlMs: 20000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Teacher save is already in progress. Please wait.')) return;

    txContext = createTransactionContext({
      name: 'teacher_save',
      metadata: {
        teacherId: toPublicId(id),
        activeOrgId: toPublicId(activeOrgId),
        requestUserId: toPublicId(req.user?.id) || String(req.user?.username || 'system')
      }
    });

    let existingTeacher = null;
    if (id) {
      existingTeacher = await dataService.getDataById('teachers', id, req.user);
      if (!existingTeacher) throw new Error('Teacher not found.');
      assertTeacherOrgAccess(existingTeacher, activeOrgId, req.user);
    }

    const personMode = existingTeacher ? 'existing' : String(req.body.personMode || 'existing').trim().toLowerCase();
    let personId = toPublicId(req.body.personId);

    if (!existingTeacher && personMode === 'new') {
      const personPayload = buildInlinePersonPayload(req.body, req.user);
      const createdPerson = await dataServiceGlobal.addData('persons', personPayload, req.user, { transactionContext: txContext });
      personId = toPublicId(createdPerson?.id);
      if (!personId) throw new Error('Failed to create person profile before teacher registration.');
      addDeleteCompensation(txContext, {
        service: dataServiceGlobal,
        entityType: 'persons',
        id: personId,
        requestingUser: req.user,
        label: 'teacher_new_person'
      });
    }

    const payload = {
      personId,
      orgId: existingTeacher?.orgId ? String(existingTeacher.orgId) : String(activeOrgId),
      teacherAccountId: existingTeacher?.teacherAccountId ? String(existingTeacher.teacherAccountId) : '',
      employeeNumber: String(req.body.employeeNumber || '').trim(),
      departmentId: String(req.body.departmentId || '').trim(),
      defaultPayRateId: '',
      compensationProfiles: parseJsonSafe(req.body.compensationProfiles, []),
      specialization: String(req.body.specialization || '').trim(),
      certification: String(req.body.certification || '').trim(),
      employmentType: String(req.body.employmentType || '').trim(),
      hireDate: String(req.body.hireDate || '').trim(),
      contractEndDate: String(req.body.contractEndDate || '').trim(),
      status: String(req.body.status || 'Active').trim(),
      instructionalMode: String(req.body.instructionalMode || '').trim(),
      teachingFocus: String(req.body.teachingFocus || '').trim(),
      maxWeeklyHours: String(req.body.maxWeeklyHours || '').trim(),
      notes: String(req.body.notes || '').trim()
    };

    if (!payload.personId) throw new Error('A valid Person must be selected.');
    if (!id && req.body.teacherId) payload.id = String(req.body.teacherId).trim();

    await assertNoDuplicatePersonAccount({
      entityType: 'teachers',
      orgId: payload.orgId,
      personId: payload.personId,
      excludeId: id,
      requestingUser: req.user
    });

    const roleUpdateResult = await ensurePersonHasOrgRole(payload.personId, payload.orgId, 'school_teacher', req.user, { transactionContext: txContext });
    if (roleUpdateResult?.changed && roleUpdateResult?.personId) {
      txContext.addCompensation(async () => {
        const person = await dataServiceGlobal.getDataById('persons', roleUpdateResult.personId, req.user, PERSON_QUERY_OPTIONS);
        if (!person) return;
        await dataServiceGlobal.updateData(
          'persons',
          roleUpdateResult.personId,
          { ...person, organizations: roleUpdateResult.beforeOrganizations || [] },
          req.user,
          { transactionContext: txContext }
        );
      }, { type: 'restore_person_org_roles', personId: roleUpdateResult.personId });
    }

    let createdTeacherAccount = null;
    let createdTeacherDisplayName = 'Teacher';

    if (id) {
      await dataService.updateData('teachers', id, payload, req.user, { transactionContext: txContext });
    } else {
      const accessibleAccounts = await loadAccessibleAccountsWithSystem(req.user, payload.orgId);
      const savedTeacher = await dataService.addData('teachers', payload, req.user, { transactionContext: txContext });
      const createdTeacherId = toPublicId(savedTeacher?.id);
      if (!createdTeacherId) throw new Error('Teacher was saved but no teacher id was returned.');

      addDeleteCompensation(txContext, {
        service: dataService,
        entityType: 'teachers',
        id: createdTeacherId,
        requestingUser: req.user,
        label: 'teacher_new_record'
      });

      const person = await dataServiceGlobal.getDataById('persons', savedTeacher.personId, req.user, PERSON_QUERY_OPTIONS);
      const teacherAccount = await createTeacherSubAccount({
        teacher: savedTeacher,
        person,
        accessibleAccounts,
        reqUser: req.user,
        options: { transactionContext: txContext }
      });
      createdTeacherDisplayName = resolvePersonDisplayName(person, savedTeacher?.id);
      createdTeacherAccount = teacherAccount;
      const createdTeacherAccountId = toPublicId(teacherAccount?.id);
      if (!createdTeacherAccountId) throw new Error('Teacher account creation did not return an id.');

      addDeleteCompensation(txContext, {
        service: dataService,
        entityType: 'schoolAccounts',
        id: createdTeacherAccountId,
        requestingUser: req.user,
        label: 'teacher_new_account'
      });

      await dataService.updateData(
        'teachers',
        createdTeacherId,
        { ...savedTeacher, teacherAccountId: createdTeacherAccountId },
        req.user,
        { transactionContext: txContext }
      );
    }

    await txContext.commit({ flow: 'teacher_save', teacherId: toPublicId(id) });

    const payloadOut = { status: 'success', message: 'Teacher saved successfully.' };
    if (isAjax(req)) {
      const result = { ...payloadOut };
      if (!id && createdTeacherAccount) {
        result.autoCreatedAccount = {
          id: String(createdTeacherAccount.id || ''),
          code: String(createdTeacherAccount.code || ''),
          name: String(createdTeacherAccount.name || ''),
          type: String(createdTeacherAccount.type || ''),
          level: Number(createdTeacherAccount.level || 0),
          partyRole: String(createdTeacherAccount.partyRole || 'none'),
          status: String(createdTeacherAccount.status || ''),
          teacherName: createdTeacherDisplayName,
          editUrl: `/school/accounts/edit/${encodeURIComponent(String(createdTeacherAccount.id || ''))}`
        };
      }
      idempotencyGuardService.completeGuard(guardKey, result);
      return res.json(result);
    }
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    res.redirect('/school/teachers');
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (txContext) {
      await txContext.rollback({ flow: 'teacher_save', reason: error.message || 'Teacher save failed' });
    }
    const statusCode = Number(error?.statusCode || 400);
    const responsePayload = {
      status: 'error',
      code: error?.code || '',
      error,
      message: error.message,
      details: error?.details || null
    };
    if (isAjax(req)) return res.status(statusCode).json(responsePayload);
    res.status(statusCode).render('error', { title: 'Error', error, message: error.message, user: req.user, statusCode });
  }
};

exports.deleteTeacher = async (req, res) => {
  let guardKey = '';
  let txContext = null;
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    guardKey = idempotencyGuardService.createGuardKey([
      'teacher_delete',
      String(activeOrgId || '').trim(),
      String(req.params.id || '').trim()
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 90000,
      replayTtlMs: 12000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Teacher delete is already in progress. Please wait.')) return;

    const teacher = await dataService.getDataById('teachers', req.params.id, req.user);
    if (!teacher) throw new Error('Teacher not found.');
    assertTeacherOrgAccess(teacher, activeOrgId, req.user);

    const footprint = await collectTeacherFootprint(teacher, teacher?.personId, activeOrgId, req.user);
    const person = teacher?.personId
      ? await dataServiceGlobal.getDataById('persons', teacher.personId, req.user, PERSON_QUERY_OPTIONS)
      : null;
    const teacherDisplayName = buildTeacherDisplayName(teacher, person);
    if (footprint.length > 0) {
      idempotencyGuardService.failGuard(guardKey);
      const detailPayload = {
        teacherId: toPublicId(teacher?.id),
        personId: toPublicId(teacher?.personId),
        footprint
      };
      const payloadOut = {
        status: 'error',
        code: 'TEACHER_DELETE_BLOCKED',
        message: buildFootprintBlockedMessage(teacherDisplayName, footprint),
        details: detailPayload,
        data: detailPayload
      };
      if (isAjax(req)) return res.status(409).json(payloadOut);
      return res.status(409).render('error', {
        title: 'Delete blocked',
        statusCode: 409,
        code: payloadOut.code,
        error: new Error(payloadOut.message),
        message: payloadOut.message,
        details: payloadOut.details,
        user: req.user
      });
    }

    txContext = createTransactionContext({
      name: 'teacher_delete',
      metadata: {
        teacherId: toPublicId(teacher?.id),
        personId: toPublicId(teacher?.personId),
        activeOrgId: toPublicId(activeOrgId),
        requestUserId: toPublicId(req.user?.id) || String(req.user?.username || 'system')
      }
    });

    const teacherSnapshot = JSON.parse(JSON.stringify(teacher || {}));
    const removed = {
      removedRole: false,
      removedSchoolAccount: false,
      removedTeacher: false,
      teacherAccountId: '',
      personId: toPublicId(teacher?.personId),
      warnings: []
    };

    const roleResult = await removePersonSchoolRole(
      teacher.personId,
      activeOrgId,
      'school_teacher',
      req.user,
      { transactionContext: txContext }
    );
    if (roleResult?.changed && roleResult?.personId) {
      removed.removedRole = true;
      txContext.addCompensation(async () => {
        const personRecord = await dataServiceGlobal.getDataById('persons', roleResult.personId, req.user, PERSON_QUERY_OPTIONS);
        if (!personRecord) return;
        await dataServiceGlobal.updateData(
          'persons',
          roleResult.personId,
          { ...personRecord, organizations: roleResult.beforeOrganizations || [] },
          req.user,
          { transactionContext: txContext }
        );
      }, { type: 'restore_person_org_roles', personId: roleResult.personId });
    } else if (roleResult?.reason) {
    if (roleResult.reason === 'person_not_found') {
        removed.warnings.push('Person record was not found for role cleanup.');
    } else if (roleResult.reason === 'school_teacher_role_not_attached') {
        removed.warnings.push('Teacher role was not attached to the person membership. Legacy role token cleanup may still be needed.');
    } else if (roleResult.reason !== 'school_teacher_role_not_attached' && roleResult.reason !== 'organization_link_not_found') {
        removed.warnings.push(`Role cleanup skipped: ${roleResult.reason}`);
    }
    }

    await purgeLinkedTeacherAccount(teacher, req.user, txContext, removed, removed.warnings);
    await dataService.purgeData('teachers', teacher.id, req.user, { transactionContext: txContext });
    if (txContext) {
      txContext.addCompensation(async () => {
        await dataService.addData('teachers', teacherSnapshot, req.user, { transactionContext: txContext });
      }, { type: 'restore_teacher_record', entityType: 'teachers', id: toPublicId(teacher?.id) });
    }
    removed.removedTeacher = true;
    await txContext.commit({ flow: 'teacher_delete', teacherId: toPublicId(teacher?.id) });
    logTeacherDeleteAuditEvent('success', {
      actor: toPublicId(req.user?.id) || String(req.user?.username || 'system'),
      teacherId: toPublicId(teacher?.id),
      orgId: toPublicId(activeOrgId),
      outcome: 'deleted',
      removedRole: removed.removedRole,
      removedSchoolAccount: removed.removedSchoolAccount,
      footprintCount: footprint.length
    });

    const payloadOut = {
      status: 'success',
      message: `Teacher ${escapeHtml(teacherDisplayName)} deleted safely.`,
      note: `${removed.warnings.length > 0 ? `${removed.warnings.join(' ')} ` : ''}Person and user accounts are retained. If needed, remove those records from People/Users manually.`,
      data: {
        deletedTeacherId: toPublicId(teacher?.id),
        removedRole: removed.removedRole,
        removedSchoolAccount: removed.removedSchoolAccount,
        personId: toPublicId(teacher?.personId),
        warnings: removed.warnings
      },
      redirectTo: '/school/teachers'
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    if (isAjax(req)) return res.json(payloadOut);
    res.redirect('/school/teachers');
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (txContext) {
      await txContext.rollback({ flow: 'teacher_delete', reason: error.message || 'Teacher delete failed' });
      logTeacherDeleteAuditEvent('error', {
        actor: toPublicId(req.user?.id) || String(req.user?.username || 'system'),
        teacherId: toPublicId(req.params?.id),
        orgId: toPublicId(req?.user?.activeOrgId),
        outcome: `rollback_initiated:${error.message || 'unknown'}`,
        removedRole: false,
        removedSchoolAccount: false,
        removedTeacher: false,
        footprintCount: 0
      });
    }
    if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
    }
};

exports.archiveTeacher = async (req, res) => {
  let guardKey = '';
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    guardKey = idempotencyGuardService.createGuardKey([
      'teacher_archive',
      String(activeOrgId || '').trim(),
      String(req.params.id || '').trim()
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 60000,
      replayTtlMs: 8000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Teacher archive is already in progress. Please wait.')) return;

    const teacher = await dataService.getDataById('teachers', req.params.id, req.user);
    if (!teacher) throw new Error('Teacher not found.');
    assertTeacherOrgAccess(teacher, activeOrgId, req.user);

    if (String(teacher.status || '').trim().toLowerCase() === 'archived') {
      const payloadOut = {
        status: 'success',
        message: 'Teacher is already archived.',
        data: { teacherId: toPublicId(teacher.id) },
        redirectTo: '/school/teachers'
      };
      idempotencyGuardService.completeGuard(guardKey, payloadOut);
      if (isAjax(req)) return res.json(payloadOut);
      return res.redirect('/school/teachers');
    }

    const archivedTeacher = await dataService.updateData(
      'teachers',
      teacher.id,
      { ...teacher, status: 'Archived' },
      req.user
    );
    if (archivedTeacher?.teacherAccountId) {
      await archiveLinkedTeacherAccount(archivedTeacher, req.user);
    }

    const payloadOut = {
      status: 'success',
      message: 'Teacher archived successfully.',
      data: { archivedTeacherId: toPublicId(teacher.id) },
      redirectTo: '/school/teachers'
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    if (isAjax(req)) return res.json(payloadOut);
    res.redirect('/school/teachers');
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.recoverTeacher = async (req, res) => {
  let guardKey = '';
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    guardKey = idempotencyGuardService.createGuardKey([
      'teacher_recover',
      String(activeOrgId || '').trim(),
      String(req.params.id || '').trim()
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 90000,
      replayTtlMs: 12000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Teacher recovery is already in progress. Please wait.')) return;

    const teacher = await dataService.getDataById('teachers', req.params.id, req.user);
    if (!teacher) throw new Error('Teacher not found.');
    assertTeacherOrgAccess(teacher, activeOrgId, req.user);

    if (String(teacher.status || '') !== 'Archived') {
      throw new Error('Only archived teachers can be recovered.');
    }

    const restoredTeacher = await dataService.updateData(
      'teachers',
      req.params.id,
      { ...teacher, status: 'Active' },
      req.user
    );
    await recoverLinkedTeacherAccount(restoredTeacher, req.user);

    const payloadOut = {
      status: 'success',
      message: 'Teacher and linked account recovered successfully.',
      redirectTo: '/school/teachers/archived'
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    if (isAjax(req)) return res.json(payloadOut);
    res.redirect('/school/teachers/archived');
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

