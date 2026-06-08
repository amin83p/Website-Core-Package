// MVC/controllers/school/staffController.js
const dataService = require('../../services/school/schoolDataService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const dataServiceGlobal = requireCoreModule('MVC/services/dataService');
const { createTransactionContext, addDeleteCompensation } = requireCoreModule('MVC/services/transactionContextService');
const idempotencyGuardService = require('../../services/school/idempotencyGuardService');
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
const { STAFF_STATUSES, EMPLOYMENT_TYPES, COMPENSATION_METHODS } = require('../../models/school/staffModel');
const PERSON_QUERY_OPTIONS = Object.freeze({ enrichment: { includeSchoolRoles: false } });
const STAFF_DELETE_FOOTPRINT_RULES = Object.freeze([
  { entityType: 'payRates', field: 'personId', label: 'Pay Rates', personRole: 'staff' },
  { entityType: 'globalTransactions', field: 'party.staffId', label: 'Global Transactions' }
]);
const STAFF_DELETE_MAX_FOOTPRINT_SAMPLE = 5;

function getActiveOrgIdOrThrow(reqUser) {
  return getActiveOrgIdOrThrowShared(reqUser);
}

async function assertCreateOrgContextOrThrow(reqUser) {
  return assertCreateOrgContextOrThrowShared(reqUser, { scopeLabel: 'staff' });
}

function assertStaffOrgAccess(staff, activeOrgId, reqUser) {
  assertOrgAccess(staff, activeOrgId, reqUser, { orgField: 'orgId', allowSystemBypass: true });
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

function buildStaffDisplayName(staff, person) {
  const personLabel = `${String(person?.name?.first || '').trim()} ${String(person?.name?.last || '').trim()}`.trim();
  return personLabel || toPublicId(staff?.id) || toPublicId(staff?.personId) || 'Staff';
}

async function collectStaffFootprint(staff, personId, activeOrgId, reqUser) {
  const targetStaffId = toPublicId(staff?.id);
  if (!targetStaffId) return [];

  const rows = [];
  const safeActiveOrgId = String(activeOrgId || '').trim();
  const targetPersonId = String(personId || '').trim();

  for (const rule of STAFF_DELETE_FOOTPRINT_RULES) {
    if (!rule?.entityType || !rule?.field) continue;

    const query = { page: 1 };
    if (rule.entityType === 'payRates' && targetPersonId) {
      query.personId__eq = targetPersonId;
      if (rule.personRole) query.personRole__eq = String(rule.personRole || '').trim();
    } else {
      query[`${rule.field}__eq`] = targetStaffId;
    }
    if (safeActiveOrgId) query.orgId__eq = safeActiveOrgId;

    const relatedRows = await dataService.fetchData(rule.entityType, query, reqUser);
    if (!Array.isArray(relatedRows) || relatedRows.length === 0) continue;
    const samples = relatedRows.slice(0, STAFF_DELETE_MAX_FOOTPRINT_SAMPLE).map(getRecordIdentity).filter(Boolean);
    rows.push({
      entityType: String(rule.entityType || '').trim(),
      label: String(rule.label || '').trim() || String(rule.entityType || '').trim(),
      count: relatedRows.length,
      samples
    });
  }

  return rows;
}

function logStaffDeleteAuditEvent(level, payload) {
  const parts = [
    '[STAFF_DELETE]',
    `level=${String(level || '').trim() || 'unknown'}`,
    `actor=${String(payload?.actor || '').trim() || 'unknown'}`,
    `staffId=${String(payload?.staffId || '').trim() || 'unknown'}`,
    `orgId=${String(payload?.orgId || '').trim() || 'unknown'}`,
    `outcome=${String(payload?.outcome || '').trim() || 'unknown'}`
  ];
  const footer = [
    `removedRole=${Boolean(payload?.removedRole) ? 'yes' : 'no'}`,
    `removedSchoolAccount=${Boolean(payload?.removedSchoolAccount) ? 'yes' : 'no'}`,
    `removedStaff=${Boolean(payload?.removedStaff) ? 'yes' : 'no'}`,
    `footprint=${Number(payload?.footprintCount || 0)}`
  ];
  console.info(`${parts.join(' ')} ${footer.join(' ')}`);
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

async function purgeLinkedStaffAccount(staff, reqUser, txContext, outcome, warnings) {
  const linkedAccountId = String(staff?.staffAccountId || '').trim();
  if (!linkedAccountId) {
    warnings.push('Staff has no linked school account id.');
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
    }, { type: 'restore_staff_school_account', entityType: 'schoolAccounts', id: toPublicId(linkedAccountId) });
  }

  outcome.removedSchoolAccount = true;
  outcome.staffAccountId = toPublicId(linkedAccountId);
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
  const base = (normalizeToken(baseCode) || `STF_${Date.now()}`).slice(0, 40);
  if (!usedCodes.has(base)) return base;
  for (let i = 2; i <= 9999; i++) {
    const suffix = `_${i}`;
    const candidate = `${base.slice(0, Math.max(1, 40 - suffix.length))}${suffix}`;
    if (!usedCodes.has(candidate)) return candidate;
  }
  throw new Error('Unable to generate a unique account code for this staff.');
}

function buildUniqueAccountName(existingOrgAccounts, baseName) {
  const usedNames = new Set(
    (existingOrgAccounts || []).map((a) => normalizeNameKey(a?.name)).filter(Boolean)
  );
  const compactBase = String(baseName || '').trim().replace(/\s+/g, ' ').slice(0, 160) || 'Staff Account';
  if (!usedNames.has(normalizeNameKey(compactBase))) return compactBase;
  for (let i = 2; i <= 9999; i++) {
    const suffix = ` (${i})`;
    const candidate = `${compactBase.slice(0, Math.max(1, 160 - suffix.length))}${suffix}`;
    if (!usedNames.has(normalizeNameKey(candidate))) return candidate;
  }
  throw new Error('Unable to generate a unique account name for this staff.');
}

function resolvePersonDisplayName(person, fallback) {
  const first = String(person?.name?.first || '').trim();
  const last = String(person?.name?.last || '').trim();
  const full = `${first} ${last}`.trim();
  return full || String(fallback || '').trim() || 'Staff';
}

function buildStaffSearchHaystack(staff) {
  const firstName = String(staff?.firstName || '').trim();
  const lastName = String(staff?.lastName || '').trim();
  const fullName = `${firstName} ${lastName}`.trim();
  const reverseName = `${lastName} ${firstName}`.trim();
  return [
    staff?.id,
    staff?.personId,
    firstName,
    lastName,
    fullName,
    reverseName,
    staff?.email,
    staff?.phone,
    staff?.departmentName,
    staff?.employeeNo,
    staff?.employmentType,
    staff?.compensationMethod,
    staff?.staffAccountId
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
      : { status: 'success', message: 'Staff save already completed.' };
    payload.idempotency = { state: 'replayed' };
    if (isAjax(req)) {
      res.json(payload);
    } else {
      const redirectTo = String(payload.redirectTo || '').trim();
      if (redirectTo) {
        res.redirect(redirectTo);
      } else {
        res.redirect('/school/staff');
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

async function createStaffSubAccount({ staff, person, accessibleAccounts, reqUser, options = {} }) {
  const orgId = String(staff?.orgId || '').trim();
  if (!orgId) throw new Error('Staff organization is missing while creating account linkage.');

  const allAccessibleAccounts = Array.isArray(accessibleAccounts) ? accessibleAccounts : [];
  const orgAccounts = allAccessibleAccounts.filter((a) => String(a?.orgId || '') === orgId);
  const systemAccounts = allAccessibleAccounts.filter((a) => String(a?.orgId || '').toUpperCase() === 'SYSTEM');
  const staffHead =
    findActiveOrgHeadAccount(orgAccounts, orgId, 'staff') ||
    findActiveOrgHeadAccount(systemAccounts, 'SYSTEM', 'staff');
  if (!staffHead) {
    throw new Error('No active "staff" head account is configured. Please set one in School Accounts before adding staff.');
  }

  const targetOrgId = String(staffHead?.orgId || orgId).trim();
  const targetOrgAccounts = targetOrgId.toUpperCase() === 'SYSTEM' ? systemAccounts : orgAccounts;
  const parentLevel = Number(staffHead?.level || 1);
  const childLevel = parentLevel + 1;
  if (childLevel > 6) throw new Error('Cannot create staff account because account level would exceed 6.');

  const displayName = resolvePersonDisplayName(person, staff?.id);
  const code = buildUniqueAccountCode(targetOrgAccounts, `STF_${staff?.id}`);
  const name = buildUniqueAccountName(targetOrgAccounts, `${displayName} (Staff)`);

  const accountPayload = {
    orgId: targetOrgId,
    code,
    name,
    type: String(staffHead?.type || 'asset').toLowerCase(),
    level: childLevel,
    parentId: String(staffHead?.id || ''),
    isControl: false,
    allowPost: true,
    partyRole: 'staff',
    headCategory: 'none',
    normalBalance: String(staffHead?.normalBalance || 'debit').toLowerCase() === 'credit' ? 'credit' : 'debit',
    status: 'active',
    description: `Auto-created for staff ${staff?.id || ''}.`
  };
  return await dataService.addData('schoolAccounts', accountPayload, reqUser, options);
}

async function archiveLinkedStaffAccount(staff, reqUser) {
  const linkedAccountId = String(staff?.staffAccountId || '').trim();
  if (!linkedAccountId) return null;
  const account = await dataService.getDataById('schoolAccounts', linkedAccountId, reqUser);
  if (!account) return null;
  if (String(account.status || '').toLowerCase() === 'archived') return account;
  return await dataService.updateData('schoolAccounts', linkedAccountId, { ...account, status: 'archived', allowPost: false }, reqUser);
}

async function recoverLinkedStaffAccount(staff, reqUser) {
  const linkedAccountId = String(staff?.staffAccountId || '').trim();
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

exports.listStaff = async (req, res) => {
  try {
    let query = await buildDataServiceQuery(req.query);
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query.q = '';
    const searchTerm = String(query.q || '').trim().toLowerCase();
    const fetchQuery = { ...query };
    delete fetchQuery.q;
    delete fetchQuery.type;
    delete fetchQuery.searchFields;
    const canCreateStaff = await canCreateOrgScopedItem(req.user, { scopeLabel: 'staff' });
    if (String(query.status || '').trim().toLowerCase() === 'archived') {
      delete query.status;
      delete fetchQuery.status;
    }

    const allStaff = await dataService.fetchData('staff', fetchQuery, req.user);
    const persons = await dataServiceGlobal.fetchData('persons', {}, req.user, PERSON_QUERY_OPTIONS);
    const departments = await dataService.fetchData('departments', {}, req.user);

    const deptById = new Map((departments || []).map((d) => [String(d.id), d.name || d.id]));
    const enriched = allStaff.map((staff) => {
      const person = persons.find((p) => idsEqual(p.id, staff.personId));
      return {
        ...staff,
        firstName: person?.name?.first || 'Unknown',
        lastName: person?.name?.last || 'Person',
        email: person?.contact?.email || 'N/A',
        phone: person?.contact?.phones?.[0]?.number || 'N/A',
        departmentName: deptById.get(String(staff.departmentId || '')) || '-'
      };
    });

    const visibleStaff = enriched.filter((s) => String(s?.status || '').trim().toLowerCase() !== 'archived');
    const searchedStaff = !searchTerm
      ? visibleStaff
      : visibleStaff.filter((staff) => buildStaffSearchHaystack(staff).includes(searchTerm));
    const searchableFields = await inferSearchableFields(searchedStaff, { exclude: ['audit'] });
    const { data, pagination } = paginate(searchedStaff, query);

    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });

    res.render('school/staff/staffList', {
      title: 'Staff Directory',
      tableName: 'Staff_Directory',
      newUrl: 'school/staff',
      newLabel: canCreateStaff ? 'Add Staff' : null,
      data,
      searchableFields,
      includeModal: true,
      includeModal_Table: true,
      print: true,
      pagination,
      filters: req.query,
      statuses: STAFF_STATUSES,
      employmentTypes: EMPLOYMENT_TYPES,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', error, message: error.message });
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.listArchivedStaff = async (req, res) => {
  try {
    let query = await buildDataServiceQuery(req.query);
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query.q = '';
    const searchTerm = String(query.q || '').trim().toLowerCase();

    const archivedQuery = { ...query, status: 'Archived' };
    delete archivedQuery.q;
    delete archivedQuery.type;
    delete archivedQuery.searchFields;
    const allStaff = await dataService.fetchData('staff', archivedQuery, req.user);
    const persons = await dataServiceGlobal.fetchData('persons', {}, req.user, PERSON_QUERY_OPTIONS);
    const departments = await dataService.fetchData('departments', {}, req.user);
    const deptById = new Map((departments || []).map((d) => [String(d.id), d.name || d.id]));

    const enriched = allStaff.map((staff) => {
      const person = persons.find((p) => idsEqual(p.id, staff.personId));
      return {
        ...staff,
        firstName: person?.name?.first || 'Unknown',
        lastName: person?.name?.last || 'Person',
        email: person?.contact?.email || 'N/A',
        phone: person?.contact?.phones?.[0]?.number || 'N/A',
        departmentName: deptById.get(String(staff.departmentId || '')) || '-'
      };
    });

    const archivedStaff = enriched.filter((s) => String(s?.status || '').trim().toLowerCase() === 'archived');
    const searchedArchivedStaff = !searchTerm
      ? archivedStaff
      : archivedStaff.filter((staff) => buildStaffSearchHaystack(staff).includes(searchTerm));
    const searchableFields = await inferSearchableFields(searchedArchivedStaff, { exclude: ['audit'] });
    const { data, pagination } = paginate(searchedArchivedStaff, query);
    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });

    res.render('school/staff/staffRecovery', {
      title: 'Recover Archived Staff',
      tableName: 'Archived_Staff',
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
    let staff = {};
    let personName = '';
    let personOrganizations = [];

    if (isEdit) {
      staff = await dataService.getDataById('staff', req.params.id, req.user);
      if (!staff) throw new Error('Staff not found.');
      assertStaffOrgAccess(staff, activeOrgId, req.user);
      const person = await dataServiceGlobal.getDataById('persons', staff.personId, req.user, PERSON_QUERY_OPTIONS);
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

    res.render('school/staff/staffForm', {
      title: isEdit ? `Edit Staff: ${staff.id || staff.personId}` : 'New Staff',
      staff,
      personName,
      personOrganizations,
      organizationLookup,
      departments,
      statuses: STAFF_STATUSES,
      employmentTypes: EMPLOYMENT_TYPES,
      compensationMethods: COMPENSATION_METHODS,
      user: req.user,
      includeModal: true,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.saveStaff = async (req, res) => {
  let txContext = null;
  let guardKey = '';
  try {
    const { id } = req.params;
    const activeOrgId = id
      ? getActiveOrgIdOrThrow(req.user)
      : await assertCreateOrgContextOrThrow(req.user);
    guardKey = idempotencyGuardService.createGuardKey([
      'staff_save',
      String(activeOrgId || '').trim(),
      String(id || '').trim(),
      req.body || {}
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 180000,
      replayTtlMs: 20000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Staff save is already in progress. Please wait.')) return;

    txContext = createTransactionContext({
      name: 'staff_save',
      metadata: {
        staffId: toPublicId(id),
        activeOrgId: toPublicId(activeOrgId),
        requestUserId: toPublicId(req.user?.id) || String(req.user?.username || 'system')
      }
    });

    let existingStaff = null;
    if (id) {
      existingStaff = await dataService.getDataById('staff', id, req.user);
      if (!existingStaff) throw new Error('Staff not found.');
      assertStaffOrgAccess(existingStaff, activeOrgId, req.user);
    }

    const personMode = existingStaff ? 'existing' : String(req.body.personMode || 'existing').trim().toLowerCase();
    let personId = toPublicId(req.body.personId);

    if (!existingStaff && personMode === 'new') {
      const personPayload = buildInlinePersonPayload(req.body, req.user);
      const createdPerson = await dataServiceGlobal.addData('persons', personPayload, req.user, { transactionContext: txContext });
      personId = toPublicId(createdPerson?.id);
      if (!personId) throw new Error('Failed to create person profile before staff registration.');
      addDeleteCompensation(txContext, {
        service: dataServiceGlobal,
        entityType: 'persons',
        id: personId,
        requestingUser: req.user,
        label: 'staff_new_person'
      });
    }

    const payload = {
      personId,
      orgId: existingStaff?.orgId ? String(existingStaff.orgId) : String(activeOrgId),
      staffAccountId: existingStaff?.staffAccountId ? String(existingStaff.staffAccountId) : '',
      employeeNumber: String(req.body.employeeNumber || '').trim(),
      jobTitle: String(req.body.jobTitle || '').trim(),
      departmentId: String(req.body.departmentId || '').trim(),
      defaultPayRateId: '',
      compensationProfiles: parseJsonSafe(req.body.compensationProfiles, []),
      employmentType: String(req.body.employmentType || '').trim(),
      hireDate: String(req.body.hireDate || '').trim(),
      contractEndDate: String(req.body.contractEndDate || '').trim(),
      status: String(req.body.status || 'Active').trim(),
      workLocation: String(req.body.workLocation || '').trim(),
      responsibilities: String(req.body.responsibilities || '').trim(),
      notes: String(req.body.notes || '').trim()
    };

    if (!payload.personId) throw new Error('A valid Person must be selected.');
    if (!id && req.body.staffId) payload.id = String(req.body.staffId).trim();

    const roleUpdateResult = await ensurePersonHasOrgRole(payload.personId, payload.orgId, 'school_staff', req.user, { transactionContext: txContext });
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

    let createdStaffAccount = null;
    let createdStaffDisplayName = 'Staff';

    if (id) {
      await dataService.updateData('staff', id, payload, req.user, { transactionContext: txContext });
    } else {
      const accessibleAccounts = await loadAccessibleAccountsWithSystem(req.user, payload.orgId);
      const savedStaff = await dataService.addData('staff', payload, req.user, { transactionContext: txContext });
      const createdStaffId = toPublicId(savedStaff?.id);
      if (!createdStaffId) throw new Error('Staff was saved but no staff id was returned.');

      addDeleteCompensation(txContext, {
        service: dataService,
        entityType: 'staff',
        id: createdStaffId,
        requestingUser: req.user,
        label: 'staff_new_record'
      });

      const person = await dataServiceGlobal.getDataById('persons', savedStaff.personId, req.user, PERSON_QUERY_OPTIONS);
      const staffAccount = await createStaffSubAccount({
        staff: savedStaff,
        person,
        accessibleAccounts,
        reqUser: req.user,
        options: { transactionContext: txContext }
      });
      createdStaffDisplayName = resolvePersonDisplayName(person, savedStaff?.id);
      createdStaffAccount = staffAccount;
      const createdStaffAccountId = toPublicId(staffAccount?.id);
      if (!createdStaffAccountId) throw new Error('Staff account creation did not return an id.');

      addDeleteCompensation(txContext, {
        service: dataService,
        entityType: 'schoolAccounts',
        id: createdStaffAccountId,
        requestingUser: req.user,
        label: 'staff_new_account'
      });

      await dataService.updateData(
        'staff',
        createdStaffId,
        { ...savedStaff, staffAccountId: createdStaffAccountId },
        req.user,
        { transactionContext: txContext }
      );
    }

    await txContext.commit({ flow: 'staff_save', staffId: toPublicId(id) });

    const payloadOut = { status: 'success', message: 'Staff saved successfully.' };
    if (isAjax(req)) {
      const result = { ...payloadOut };
      if (!id && createdStaffAccount) {
        result.autoCreatedAccount = {
          id: String(createdStaffAccount.id || ''),
          code: String(createdStaffAccount.code || ''),
          name: String(createdStaffAccount.name || ''),
          type: String(createdStaffAccount.type || ''),
          level: Number(createdStaffAccount.level || 0),
          partyRole: String(createdStaffAccount.partyRole || 'none'),
          status: String(createdStaffAccount.status || ''),
          staffName: createdStaffDisplayName,
          editUrl: `/school/accounts/edit/${encodeURIComponent(String(createdStaffAccount.id || ''))}`
        };
      }
      idempotencyGuardService.completeGuard(guardKey, result);
      return res.json(result);
    }
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    res.redirect('/school/staff');
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (txContext) {
      await txContext.rollback({ flow: 'staff_save', reason: error.message || 'Staff save failed' });
    }
    if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.deleteStaff = async (req, res) => {
  let guardKey = '';
  let txContext = null;
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    guardKey = idempotencyGuardService.createGuardKey([
      'staff_delete',
      String(activeOrgId || '').trim(),
      String(req.params.id || '').trim()
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 90000,
      replayTtlMs: 12000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Staff delete is already in progress. Please wait.')) return;

    const staff = await dataService.getDataById('staff', req.params.id, req.user);
    if (!staff) throw new Error('Staff not found.');
    assertStaffOrgAccess(staff, activeOrgId, req.user);

    const footprint = await collectStaffFootprint(staff, staff?.personId, activeOrgId, req.user);
    const person = staff?.personId
      ? await dataServiceGlobal.getDataById('persons', staff.personId, req.user, PERSON_QUERY_OPTIONS)
      : null;
    const staffDisplayName = buildStaffDisplayName(staff, person);
    if (footprint.length > 0) {
      idempotencyGuardService.failGuard(guardKey);
      const detailPayload = {
        staffId: toPublicId(staff?.id),
        personId: toPublicId(staff?.personId),
        footprint
      };
      const payloadOut = {
        status: 'error',
        code: 'STAFF_DELETE_BLOCKED',
        message: buildFootprintBlockedMessage(staffDisplayName, footprint),
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
      name: 'staff_delete',
      metadata: {
        staffId: toPublicId(staff?.id),
        personId: toPublicId(staff?.personId),
        activeOrgId: toPublicId(activeOrgId),
        requestUserId: toPublicId(req.user?.id) || String(req.user?.username || 'system')
      }
    });

    const staffSnapshot = JSON.parse(JSON.stringify(staff || {}));
    const removed = {
      removedRole: false,
      removedSchoolAccount: false,
      removedStaff: false,
      staffAccountId: '',
      personId: toPublicId(staff?.personId),
      warnings: []
    };

    const roleResult = await removePersonSchoolRole(
      staff.personId,
      activeOrgId,
      'school_staff',
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
    } else if (roleResult.reason === 'school_staff_role_not_attached') {
        removed.warnings.push('Staff role was not attached to the person membership. Legacy role token cleanup may still be needed.');
    } else if (roleResult.reason !== 'school_staff_role_not_attached' && roleResult.reason !== 'organization_link_not_found') {
        removed.warnings.push(`Role cleanup skipped: ${roleResult.reason}`);
    }
    }

    await purgeLinkedStaffAccount(staff, req.user, txContext, removed, removed.warnings);
    await dataService.purgeData('staff', staff.id, req.user, { transactionContext: txContext });
    if (txContext) {
      txContext.addCompensation(async () => {
        await dataService.addData('staff', staffSnapshot, req.user, { transactionContext: txContext });
      }, { type: 'restore_staff_record', entityType: 'staff', id: toPublicId(staff?.id) });
    }
    removed.removedStaff = true;
    await txContext.commit({ flow: 'staff_delete', staffId: toPublicId(staff?.id) });
    logStaffDeleteAuditEvent('success', {
      actor: toPublicId(req.user?.id) || String(req.user?.username || 'system'),
      staffId: toPublicId(staff?.id),
      orgId: toPublicId(activeOrgId),
      outcome: 'deleted',
      removedRole: removed.removedRole,
      removedSchoolAccount: removed.removedSchoolAccount,
      footprintCount: footprint.length
    });

    const payloadOut = {
      status: 'success',
      message: `Staff ${escapeHtml(staffDisplayName)} deleted safely.`,
      note: `${removed.warnings.length > 0 ? `${removed.warnings.join(' ')} ` : ''}Person and user accounts are retained. If needed, remove those records from People/Users manually.`,
      data: {
        deletedStaffId: toPublicId(staff?.id),
        removedRole: removed.removedRole,
        removedSchoolAccount: removed.removedSchoolAccount,
        personId: toPublicId(staff?.personId),
        warnings: removed.warnings
      },
      redirectTo: '/school/staff'
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    if (isAjax(req)) return res.json(payloadOut);
    res.redirect('/school/staff');
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (txContext) {
      await txContext.rollback({ flow: 'staff_delete', reason: error.message || 'Staff delete failed' });
      logStaffDeleteAuditEvent('error', {
        actor: toPublicId(req.user?.id) || String(req.user?.username || 'system'),
        staffId: toPublicId(req.params?.id),
        orgId: toPublicId(req?.user?.activeOrgId),
        outcome: `rollback_initiated:${error.message || 'unknown'}`,
        removedRole: false,
        removedSchoolAccount: false,
        removedStaff: false,
        footprintCount: 0
      });
    }
    if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
    }
};

exports.archiveStaff = async (req, res) => {
  let guardKey = '';
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    guardKey = idempotencyGuardService.createGuardKey([
      'staff_archive',
      String(activeOrgId || '').trim(),
      String(req.params.id || '').trim()
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 60000,
      replayTtlMs: 8000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Staff archive is already in progress. Please wait.')) return;

    const staff = await dataService.getDataById('staff', req.params.id, req.user);
    if (!staff) throw new Error('Staff not found.');
    assertStaffOrgAccess(staff, activeOrgId, req.user);

    if (String(staff.status || '').trim().toLowerCase() === 'archived') {
      const payloadOut = {
        status: 'success',
        message: 'Staff is already archived.',
        data: { staffId: toPublicId(staff.id) },
        redirectTo: '/school/staff'
      };
      idempotencyGuardService.completeGuard(guardKey, payloadOut);
      if (isAjax(req)) return res.json(payloadOut);
      return res.redirect('/school/staff');
    }

    const archivedStaff = await dataService.updateData(
      'staff',
      staff.id,
      { ...staff, status: 'Archived' },
      req.user
    );
    if (archivedStaff?.staffAccountId) {
      await archiveLinkedStaffAccount(archivedStaff, req.user);
    }

    const payloadOut = {
      status: 'success',
      message: 'Staff archived successfully.',
      data: { archivedStaffId: toPublicId(staff.id) },
      redirectTo: '/school/staff'
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    if (isAjax(req)) return res.json(payloadOut);
    res.redirect('/school/staff');
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.recoverStaff = async (req, res) => {
  let guardKey = '';
  try {
    const activeOrgId = getActiveOrgIdOrThrow(req.user);
    guardKey = idempotencyGuardService.createGuardKey([
      'staff_recover',
      String(activeOrgId || '').trim(),
      String(req.params.id || '').trim()
    ]);
    const guardResult = idempotencyGuardService.beginGuard({
      key: guardKey,
      runningTtlMs: 90000,
      replayTtlMs: 12000
    });
    if (sendGuardedResponse(req, res, guardResult, 'Staff recovery is already in progress. Please wait.')) return;

    const staff = await dataService.getDataById('staff', req.params.id, req.user);
    if (!staff) throw new Error('Staff not found.');
    assertStaffOrgAccess(staff, activeOrgId, req.user);

    if (String(staff.status || '') !== 'Archived') {
      throw new Error('Only archived staff can be recovered.');
    }

    const restoredStaff = await dataService.updateData(
      'staff',
      req.params.id,
      { ...staff, status: 'Active' },
      req.user
    );
    await recoverLinkedStaffAccount(restoredStaff, req.user);

    const payloadOut = {
      status: 'success',
      message: 'Staff and linked account recovered successfully.',
      redirectTo: '/school/staff/archived'
    };
    idempotencyGuardService.completeGuard(guardKey, payloadOut);
    if (isAjax(req)) return res.json(payloadOut);
    res.redirect('/school/staff/archived');
  } catch (error) {
    if (guardKey) idempotencyGuardService.failGuard(guardKey);
    if (isAjax(req)) return res.status(400).json({ status: 'error', error, message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

