const schoolDataService = require('../../services/school/schoolDataService');
const schoolPersonAccessService = require('../../services/school/schoolPersonAccessService');
const schoolLinkedPersonProfileService = require('../../services/school/schoolLinkedPersonProfileService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const dataServiceGlobal = requireCoreModule('MVC/services/dataService');
const { idsEqual, toPublicId } = requireCoreModule('MVC/utils/idAdapter');
const { isAjax } = requireCoreModule('MVC/utils/generalTools');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const { getActiveOrgIdOrThrow, assertCreateOrgContextOrThrow, assertOrgAccess } = requireCoreModule('MVC/utils/orgContextUtils');

const PARTY_LEAF_ROLES = new Set(['student', 'teacher', 'staff', 'parent', 'funder', 'vendor', 'organization', 'other']);

function routeAccess(req) { return schoolDataService.buildRouteAccessContext(req); }
function displayName(person = {}, fallback = '') {
  return schoolPersonAccessService.formatPersonName(person, fallback)
    || String(person?.organizationProfile?.legalName || '').trim()
    || fallback;
}
function isTruthyFlag(value) {
  return value === true || String(value || '').trim().toLowerCase() === 'true';
}
/**
 * Parent accounts for new Funder Accounts must be able to own many children
 * (control/head buckets), not single-party leaf accounts such as one student.
 */
function accountAllowsChildren(account) {
  const level = Number(account?.level || 0);
  if (!Number.isInteger(level) || level < 1 || level >= 6) return false;

  if (isTruthyFlag(account?.isControl)) return true;
  if (String(account?.headCategory || 'none').trim().toLowerCase() !== 'none') return true;

  const partyRole = String(account?.partyRole || 'none').trim().toLowerCase() || 'none';
  if (PARTY_LEAF_ROLES.has(partyRole) && isTruthyFlag(account?.allowPost)) return false;
  return partyRole === 'none';
}
function isActiveParentAccount(account, orgId) {
  return Boolean(account)
    && idsEqual(account.orgId, orgId)
    && String(account.status || '').toLowerCase() === 'active'
    && accountAllowsChildren(account);
}
function isActivePostableAccount(account, orgId) {
  return Boolean(account)
    && idsEqual(account.orgId, orgId)
    && String(account.status || '').toLowerCase() === 'active'
    && isTruthyFlag(account.allowPost);
}
function findSuggestedFunderParent(accounts, orgId) {
  const parentAccounts = (accounts || []).filter((account) => isActiveParentAccount(account, orgId));
  const byHead = (category) => parentAccounts.find(
    (account) => String(account.headCategory || '').toLowerCase() === String(category).toLowerCase()
  );
  // Prefer a dedicated Funders head, then Sponsored Organizations (ACC_1240 in the chart),
  // which is the AR control bucket meant for multi-student sponsor/funder accounts.
  return byHead('funders')
    || byHead('organizations')
    || parentAccounts.find((account) => /sponsored\s+organizations?|funder|sponsor/i.test(String(account.name || '')))
    || parentAccounts.find((account) => String(account.code || '') === '1240')
    || parentAccounts.find((account) => /receivable/i.test(String(account.name || '')) && isTruthyFlag(account.isControl))
    || null;
}
function getFunderAccountParentOrThrow(accounts, orgId, requestedParentId = '') {
  const parentAccounts = (accounts || []).filter((account) => isActiveParentAccount(account, orgId));
  const configuredHead = findSuggestedFunderParent(accounts, orgId);
  const requestedId = String(requestedParentId || '').trim();
  const parent = requestedId
    ? parentAccounts.find((account) => idsEqual(account.id, requestedId))
    : configuredHead;
  if (!parent) {
    if (requestedId) {
      throw new Error('Selected Funder Account parent must be an active account that allows child accounts (control/head accounts below level 6). Individual student or party leaf accounts cannot be used.');
    }
    throw new Error('Choose an active parent account that allows children for the new Funder Account. Configure a Funders or Sponsored Organizations receivable control head to have one suggested automatically.');
  }
  return parent;
}
function decorateParentAccountForPicker(account, suggestedParentId = '') {
  const code = String(account?.code || account?.id || '').trim();
  const name = String(account?.name || '').trim();
  const level = Number(account?.level || 0);
  const headCategory = String(account?.headCategory || 'none').trim().toLowerCase();
  const bits = [`L${level || '?'}`];
  if (headCategory && headCategory !== 'none') bits.push(`head:${headCategory}`);
  if (isTruthyFlag(account?.isControl)) bits.push('control');
  return {
    ...account,
    displayName: [code, name].filter(Boolean).join(' — '),
    subtitle: bits.join(' · '),
    isSuggestedParent: idsEqual(account?.id, suggestedParentId)
  };
}
function buildFunderAccountPayload({ accounts, parent, funderId, funderPerson }) {
  const level = Number(parent.level || 1) + 1;
  if (level > 6) throw new Error('Cannot create the Funder Account because the account hierarchy would exceed level 6.');
  return {
    orgId: String(parent.orgId),
    code: uniqueCode(accounts, `FUN_${funderId}`),
    name: uniqueName(accounts, `${displayName(funderPerson, funderId)} (Funder)`),
    type: String(parent.type || 'asset').toLowerCase(),
    level,
    parentId: String(parent.id),
    isControl: false,
    allowPost: true,
    partyRole: 'funder',
    headCategory: 'none',
    normalBalance: String(parent.normalBalance || 'debit').toLowerCase() === 'credit' ? 'credit' : 'debit',
    status: 'active',
    description: `Created for Funder ${funderId}.`
  };
}
function uniqueCode(accounts, baseCode) {
  const used = new Set((accounts || []).map((row) => String(row?.code || '').trim().toUpperCase()));
  const base = String(baseCode || 'FUNDER').toUpperCase().replace(/[^A-Z0-9_-]+/g, '_').slice(0, 40);
  if (!used.has(base)) return base;
  for (let number = 2; number < 10000; number += 1) {
    const suffix = `_${number}`;
    const candidate = `${base.slice(0, 40 - suffix.length)}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error('Unable to generate a unique Funder Account code.');
}
function uniqueName(accounts, baseName) {
  const normalized = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const used = new Set((accounts || []).map((row) => normalized(row?.name)));
  const base = String(baseName || 'Funder Account').trim().replace(/\s+/g, ' ').slice(0, 160);
  if (!used.has(normalized(base))) return base;
  for (let number = 2; number < 10000; number += 1) {
    const suffix = ` (${number})`;
    const candidate = `${base.slice(0, 160 - suffix.length)}${suffix}`;
    if (!used.has(normalized(candidate))) return candidate;
  }
  throw new Error('Unable to generate a unique Funder Account name.');
}

function buildNewPerson(body, reqUser, orgId) {
  const now = new Date().toISOString();
  const profileType = String(body.newPersonProfileType || 'organization').trim().toLowerCase() === 'organization'
    ? 'organization'
    : 'individual';
  const legalName = String(body.newOrganizationLegalName || '').trim();
  const first = String(body.newPersonFirstName || '').trim();
  const last = String(body.newPersonLastName || '').trim();
  const email = String(body.newPersonEmail || '').trim();
  if (!email) throw new Error('A business email is required for a new Funder Person.');
  if (profileType === 'organization' && !legalName) throw new Error('Organization legal name is required for a company Funder.');
  if (profileType === 'individual' && (!first || !last)) throw new Error('First and last name are required for an individual Funder.');
  if (profileType === 'individual' && (!String(body.newPersonGender || '').trim() || !String(body.newPersonDateOfBirth || '').trim())) {
    throw new Error('Gender and date of birth are required for an individual Funder Person.');
  }
  const activeOrg = (Array.isArray(reqUser?.allowedOrgs) ? reqUser.allowedOrgs : [])
    .find((org) => idsEqual(org?.orgId || org?.id, orgId)) || {};
  const displayLabel = profileType === 'organization' ? legalName : [first, last].filter(Boolean).join(' ');
  return {
    active: true,
    personProfileType: profileType,
    organizationProfile: { legalName: profileType === 'organization' ? legalName : '' },
    // Keep a readable fallback on name/displayName so list/picker formatters never see a blank org person.
    displayName: displayLabel,
    name: {
      first: profileType === 'organization' ? '' : first,
      middle: '',
      last: profileType === 'organization' ? '' : last,
      preferred: profileType === 'organization' ? legalName : ''
    },
    demographics: profileType === 'individual'
      ? { gender: String(body.newPersonGender || '').trim().toLowerCase(), dateOfBirth: String(body.newPersonDateOfBirth || '').trim() }
      : { gender: null, dateOfBirth: null },
    contact: { emails: [{ type: 'work', email, isPrimary: true }], phones: [], email },
    addresses: [],
    address: {},
    tags: [],
    manualTags: [],
    notes: String(body.newPersonNotes || '').trim() || null,
    organizations: [{
      orgId: Number.isFinite(Number(orgId)) ? Number(orgId) : orgId,
      name: String(activeOrg?.name || activeOrg?.orgName || '').trim(),
      roles: ['school_funder'],
      role: 'school_funder',
      memberStatus: 'active',
      joinedAt: now
    }],
    audit: { createUser: reqUser?.id || reqUser?.username || 'SYSTEM', createDateTime: now, lastUpdateUser: reqUser?.id || reqUser?.username || 'SYSTEM', lastUpdateDateTime: now }
  };
}

async function getFunderOrThrow(req, id) {
  const funder = await schoolDataService.getDataById('funders', id, req.user, routeAccess(req));
  if (!funder) throw new Error('Funder not found.');
  assertOrgAccess(funder, getActiveOrgIdOrThrow(req.user), req.user, { orgField: 'orgId', allowSystemBypass: true });
  return funder;
}

async function getActiveOrgAccounts(req, orgId) {
  const accounts = await schoolDataService.fetchData('schoolAccounts', {}, req.user, routeAccess(req));
  return (accounts || []).filter((account) => idsEqual(account?.orgId, orgId));
}

exports.listFunders = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const rows = await schoolDataService.fetchData('funders', {}, req.user, routeAccess(req));
    const scoped = (rows || []).filter((row) => idsEqual(row?.orgId, orgId));
    const people = await schoolPersonAccessService.buildPersonByIdMap({ reqUser: req.user, personIds: scoped.map((row) => row.personId) });
    const accounts = await getActiveOrgAccounts(req, orgId);
    const accountById = new Map(accounts.map((account) => [String(account.id), account]));
    const mapped = scoped.map((row) => ({
      ...row,
      personName: displayName(people.get(String(row.personId)), row.personId),
      personEmail: schoolPersonAccessService.readPersonEmail(people.get(String(row.personId)) || {}),
      account: accountById.get(String(row.funderAccountId || '')) || null
    }));
    const query = String(req.query?.q || '').trim().toLowerCase();
    const filtered = query ? mapped.filter((row) => [row.id, row.personName, row.personEmail, row.externalReference, row.status, row.account?.code, row.account?.name].join(' ').toLowerCase().includes(query)) : mapped;
    const { data, pagination } = paginate(filtered, req.query || {});
    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });
    return res.render('school/funder/funderList', { title: 'School Funders', data, pagination, filters: req.query || {}, user: req.user, includeModal: true, includeModal_Table: true, tableName: 'School_Funders', newUrl: 'school/funders', newLabel: 'Add Funder', print: true, actionStateId: req.actionStateId });
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.listEligiblePersons = async (req, res) => {
  try {
    const payload = await schoolPersonAccessService.listPickerPersons({
      reqUser: req.user,
      q: String(req.query?.q || ''),
      query: req.query || {},
      requireSchoolRole: false
    });
    const people = await schoolPersonAccessService.listActiveOrgPersons({
      reqUser: req.user,
      q: String(req.query?.q || ''),
      query: { ...(req.query || {}), limit: 5000 },
      requireSchoolRole: false
    });
    const byId = new Map(
      (people || []).map((person) => [String(person?.id || person?.personId || '').trim(), person])
    );
    const results = (payload.rows || []).map((row) => {
      const id = String(row?.personId || row?.id || '').trim();
      const full = byId.get(id) || {};
      return {
        ...row,
        displayName: schoolPersonAccessService.formatPersonName(full, row.displayName || id),
        name: schoolPersonAccessService.formatPersonName(full, row.name || id),
        organizations: Array.isArray(full.organizations) ? full.organizations : []
      };
    });
    return res.json({ status: 'success', results, pagination: payload.pagination || {} });
  } catch (error) { return res.status(400).json({ status: 'error', message: error.message }); }
};

exports.listEligibleAccounts = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const accounts = await getActiveOrgAccounts(req, orgId);
    const kind = String(req.query?.kind || 'parent').trim().toLowerCase();
    const suggestedParent = findSuggestedFunderParent(accounts, orgId);
    const candidates = kind === 'postable'
      ? accounts.filter((account) => isActivePostableAccount(account, orgId))
      : accounts
        .filter((account) => isActiveParentAccount(account, orgId))
        .map((account) => decorateParentAccountForPicker(account, suggestedParent?.id))
        .sort((a, b) => {
          if (a.isSuggestedParent && !b.isSuggestedParent) return -1;
          if (!a.isSuggestedParent && b.isSuggestedParent) return 1;
          return String(a.code || '').localeCompare(String(b.code || ''));
        });
    const term = String(req.query?.q || '').trim().toLowerCase();
    const filtered = term
      ? candidates.filter((account) => [
        account.id,
        account.code,
        account.name,
        account.displayName,
        account.subtitle,
        account.type,
        account.level,
        account.parentId,
        account.partyRole,
        account.headCategory
      ].join(' ').toLowerCase().includes(term))
      : candidates;
    const { data, pagination } = paginate(filtered, req.query || {});
    return res.json({
      status: 'success',
      results: data,
      pagination,
      suggestedParentId: String(suggestedParent?.id || '')
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.showForm = async (req, res) => {
  try {
    const isEdit = Boolean(req.params.id);
    const orgId = isEdit ? getActiveOrgIdOrThrow(req.user) : await assertCreateOrgContextOrThrow(req.user, { scopeLabel: 'funders' });
    const funder = isEdit ? await getFunderOrThrow(req, req.params.id) : {};
    let personName = '';
    let personOrganizations = [];

    if (isEdit && funder?.personId) {
      const person = await schoolPersonAccessService.getPersonById({
        reqUser: req.user,
        personId: funder.personId,
        requireSchoolRole: false
      });
      if (person) {
        personName = schoolPersonAccessService.formatPersonName(person, '');
        personOrganizations = Array.isArray(person.organizations) ? person.organizations : [];
      }
    }

    const peoplePayload = await schoolPersonAccessService.listPickerPersons({
      reqUser: req.user,
      query: { limit: 5000 },
      requireSchoolRole: false
    });
    const organizations = await dataServiceGlobal.fetchData('organizations', {}, req.user);
    const organizationLookup = {};
    (organizations || []).forEach((org) => {
      const id = String(org?.id || '').trim();
      if (!id) return;
      organizationLookup[id] = String(org?.name || org?.orgName || id).trim();
    });

    const accounts = await getActiveOrgAccounts(req, orgId);
    const suggestedParent = findSuggestedFunderParent(accounts, orgId);
    const funderAccountParents = accounts
      .filter((account) => isActiveParentAccount(account, orgId))
      .map((account) => decorateParentAccountForPicker(account, suggestedParent?.id))
      .sort((a, b) => {
        if (a.isSuggestedParent && !b.isSuggestedParent) return -1;
        if (!a.isSuggestedParent && b.isSuggestedParent) return 1;
        return String(a.code || '').localeCompare(String(b.code || ''));
      });
    const linkedAccount = funder?.funderAccountId
      ? accounts.find((account) => idsEqual(account.id, funder.funderAccountId)) || null
      : null;
    const suggestedFunderAccountParentId = String(
      linkedAccount?.parentId
      || suggestedParent?.id
      || ''
    );
    const editFormDisplayName = String(personName || '').trim() || 'Funder';
    const editFormRecordId = String(funder.id || funder.personId || '').trim();
    const canEditLinkedPerson = await schoolLinkedPersonProfileService.evaluateCanEditLinkedPerson({
      reqUser: req.user,
      linkType: 'funder',
      isEdit
    });

    return res.render('school/funder/funderForm', {
      title: isEdit ? `Edit Funder: ${editFormDisplayName} (${editFormRecordId})` : 'Add Funder',
      funder,
      personName,
      personOrganizations,
      organizationLookup,
      people: peoplePayload.allRows || peoplePayload.rows || [],
      funderAccountParents,
      linkedAccount,
      suggestedFunderAccountParentId,
      suggestedFunderAccountParent: suggestedParent || null,
      user: req.user,
      includeModal: true,
      actionStateId: req.actionStateId,
      canEditLinkedPerson,
      linkedPersonLinkType: 'funder',
      linkedPersonLinkId: isEdit ? editFormRecordId : ''
    });
  } catch (error) { return res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user }); }
};

exports.saveFunder = async (req, res) => {
  try {
    const id = req.params.id;
    const orgId = id ? getActiveOrgIdOrThrow(req.user) : await assertCreateOrgContextOrThrow(req.user, { scopeLabel: 'funders' });
    const existing = id ? await getFunderOrThrow(req, id) : null;
    const personMode = existing ? 'existing' : String(req.body.personMode || 'existing').trim().toLowerCase();
    let personId = existing?.personId || toPublicId(req.body.personId);
    let createdPerson = null;
    if (!existing && personMode === 'new') {
      createdPerson = await dataServiceGlobal.addData('persons', buildNewPerson(req.body, req.user, orgId), req.user);
      personId = toPublicId(createdPerson?.id);
    }
    if (!personId) throw new Error('Choose an existing Person or create a new Person for this Funder.');
    const person = createdPerson
      || await schoolPersonAccessService.getPersonById({ reqUser: req.user, personId, requireSchoolRole: false });
    if (!person) throw new Error('Selected Person is not available in the active organization.');
    const accounts = await getActiveOrgAccounts(req, orgId);
    const unlinkAccount = req.body.unlinkFunderAccount === 'true' || req.body.unlinkFunderAccount === 'on';
    const requestedAccountId = unlinkAccount
      ? ''
      : String(req.body.funderAccountId || existing?.funderAccountId || '').trim();
    const linkedAccount = requestedAccountId
      ? accounts.find((account) => idsEqual(account.id, requestedAccountId)) || null
      : null;
    if (requestedAccountId && !isActivePostableAccount(linkedAccount, orgId)) {
      throw new Error('Selected Funder Account must be active, postable, and in the active organization.');
    }
    const payload = {
      orgId,
      personId,
      funderAccountId: requestedAccountId,
      status: req.body.status || 'active',
      externalReference: req.body.externalReference || '',
      notes: req.body.notes || '',
      attachments: existing?.attachments || []
    };
    let saved;
    let createdAccount = null;
    if (existing) {
      saved = await schoolDataService.updateData('funders', id, payload, req.user, routeAccess(req));
    } else if (linkedAccount) {
      saved = await schoolDataService.addData('funders', payload, req.user, routeAccess(req));
    } else {
      const parent = getFunderAccountParentOrThrow(accounts, orgId, req.body.funderAccountParentId);
      saved = await schoolDataService.addData('funders', payload, req.user, routeAccess(req));
      try {
        createdAccount = await schoolDataService.addData(
          'schoolAccounts',
          buildFunderAccountPayload({ accounts, parent, funderId: saved.id, funderPerson: person }),
          req.user,
          routeAccess(req)
        );
        saved = await schoolDataService.updateData(
          'funders',
          saved.id,
          { ...saved, funderAccountId: String(createdAccount.id) },
          req.user,
          routeAccess(req)
        );
      } catch (error) {
        await schoolDataService.deleteData('funders', saved.id, req.user, {
          ...routeAccess(req),
          skipDeletionGuard: true,
          orgId
        }).catch(() => null);
        throw error;
      }
    }
    await schoolPersonAccessService.ensurePersonHasSchoolRole({ personId: saved.personId, orgId, role: 'school_funder', reqUser: req.user });
    const response = {
      status: 'success',
      message: createdAccount
        ? 'Funder and Funder Account created successfully.'
        : (linkedAccount ? 'Funder saved and existing Funder Account linked successfully.' : 'Funder saved successfully.'),
      funderId: String(saved.id),
      funderAccountId: String(saved.funderAccountId || '')
    };
    if (isAjax(req)) return res.json(response);
    return res.redirect('/school/funders');
  } catch (error) { if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message }); return res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user }); }
};

exports.createAccount = async (req, res) => {
  try {
    const funder = await getFunderOrThrow(req, req.params.id);
    if (funder.funderAccountId) throw new Error('This Funder already has a linked financial account.');
    const accounts = await getActiveOrgAccounts(req, funder.orgId);
    const parent = getFunderAccountParentOrThrow(accounts, funder.orgId, req.body?.funderAccountParentId);
    const person = await schoolPersonAccessService.getPersonById({ reqUser: req.user, personId: funder.personId });
    const account = await schoolDataService.addData(
      'schoolAccounts',
      buildFunderAccountPayload({ accounts, parent, funderId: funder.id, funderPerson: person }),
      req.user,
      routeAccess(req)
    );
    const saved = await schoolDataService.updateData('funders', funder.id, { ...funder, funderAccountId: String(account.id) }, req.user, routeAccess(req));
    return res.json({ status: 'success', message: 'Funder Account created and linked.', account, funder: saved });
  } catch (error) { return res.status(400).json({ status: 'error', message: error.message }); }
};

exports.deleteFunder = async (req, res) => {
  try {
    const funder = await getFunderOrThrow(req, req.params.id);
    if (funder.funderAccountId) throw new Error('Unlink the Funder Account before archiving this Funder.');
    await schoolDataService.deleteData('funders', funder.id, req.user, routeAccess(req));
    if (isAjax(req)) return res.json({ status: 'success', message: 'Funder archived successfully.' });
    return res.redirect('/school/funders');
  } catch (error) { if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message }); return res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user }); }
};

exports.__testables = {
  accountAllowsChildren,
  isActiveParentAccount,
  findSuggestedFunderParent,
  decorateParentAccountForPicker
};
