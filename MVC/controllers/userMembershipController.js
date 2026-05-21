const dataService = require('../services/dataService');
const { buildDataServiceQuery } = require('../utils/generalTools');
const {
  normalizeMembershipPayload,
  getMembershipPeriodSourceTypeOptions,
  normalizeMembershipPeriodSourceTypeToken
} = require('../services/security/entitlementService');
const { idsEqual, toPublicId } = require('../utils/idAdapter');
const { SYSTEM_CONTEXT } = require('../../config/constants');

const MEMBERSHIP_PERIOD_SOURCE_TYPE_OPTIONS = getMembershipPeriodSourceTypeOptions();
const MEMBERSHIP_LIST_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'userId', 'orgId', 'status', 'notes'],
  allowedSearchFields: ['id', 'userId', 'orgId', 'status', 'notes'],
  defaultSearchFields: ['id', 'userId', 'orgId', 'status', 'notes'],
  allowMetaKeys: true
});
const MEMBERSHIP_PERIOD_SOURCE_TYPE_SET = new Set(
  MEMBERSHIP_PERIOD_SOURCE_TYPE_OPTIONS.map((item) => String(item.value || '').trim().toLowerCase()).filter(Boolean)
);

function parseBool(v) {
  if (typeof v === 'boolean') return v;
  const raw = String(v || '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'on' || raw === 'yes';
}

function parsePeriods(body) {
  const raw = String(body?.periodsJson || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error('Membership periods payload must be an array.');
    }
    return parsed;
  } catch (_) {
    throw new Error('Invalid membership periods payload.');
  }
}

function normalizeAndValidatePeriodSourceTypes(periods = []) {
  const rows = Array.isArray(periods) ? periods : [];
  const allowedValues = MEMBERSHIP_PERIOD_SOURCE_TYPE_OPTIONS.map((item) => `'${item.value}'`).join(', ');

  return rows.map((period, index) => {
    const row = period && typeof period === 'object' ? { ...period } : {};
    const rawSourceType = String(row.sourceType || '').trim();
    const normalizedSourceType = normalizeMembershipPeriodSourceTypeToken(rawSourceType, { fallback: '' });
    if (!normalizedSourceType || !MEMBERSHIP_PERIOD_SOURCE_TYPE_SET.has(normalizedSourceType)) {
      throw new Error(
        `Invalid period source type at row ${index + 1}. Allowed values: ${allowedValues}.`
      );
    }
    row.sourceType = normalizedSourceType;
    return row;
  });
}

async function listMemberships(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, MEMBERSHIP_LIST_QUERY_OPTIONS);
    const page = Number.parseInt(req.query?.page, 10) || Number.parseInt(query?.page, 10) || 1;
    const limit = Number.parseInt(req.query?.limit, 10) || Number.parseInt(query?.limit, 10) || undefined;
    const pagedMemberships = await dataService.fetchDataPaged('userMemberships', {
      ...query,
      page,
      limit
    }, req.user);
    const memberships = Array.isArray(pagedMemberships?.rows) ? pagedMemberships.rows : [];

    const pageUserIds = Array.from(new Set(
      memberships.map((row) => String(row?.userId || '').trim()).filter(Boolean)
    ));
    const users = await Promise.all(pageUserIds.map((userId) => dataService.getDataById('users', userId, req.user)));
    const userById = new Map((Array.isArray(users) ? users : []).filter(Boolean).map((u) => [String(u.id), u]));

    const data = (Array.isArray(memberships) ? memberships : []).map((row) => ({
      ...row,
      linkedUser: userById.get(String(row.userId)) || null
    }));
    const pagination = pagedMemberships?.pagination || null;

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', results: data, pagination });
    }

    res.render('membership/memberships', {
      title: 'User Memberships',
      tableName: 'User_Memberships',
      newUrl: 'memberships',
      newLabel: 'Add Membership',
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: false,
      print: false,
      memberships: data,
      pagination,
      searchableFields: MEMBERSHIP_LIST_QUERY_OPTIONS.defaultSearchFields,
      filters: req.query,
      user: req.user || null,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(500).json({ status: 'error', message: error.message });
    }
    return res.status(500).render('error', {
      title: 'Error',
      error,
      message: error.message,
      user: req.user || null
    });
  }
}

async function showAddForm(req, res) {
  try {
    const users = await dataService.fetchData('users', {}, req.user);
    res.render('membership/membershipForm', {
      title: 'Add Membership',
      membershipItem: null,
      users: Array.isArray(users) ? users : [],
      usersJson: JSON.stringify(Array.isArray(users) ? users : []),
      membershipPeriodSourceTypeOptions: MEMBERSHIP_PERIOD_SOURCE_TYPE_OPTIONS,
      includeModal: true,
      user: req.user || null,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function buildMembershipFromBody(body, reqUser, existing = null) {
  const now = new Date().toISOString();
  const reqUserId = reqUser?.id || 'system';
  const validatedPeriods = normalizeAndValidatePeriodSourceTypes(parsePeriods(body));
  const parsed = normalizeMembershipPayload({
    userId: body.userId,
    orgId: body.orgId,
    active: parseBool(body.active),
    notes: body.notes,
    periods: validatedPeriods,
    source: {
      paymentProvider: body.paymentProvider,
      paymentReference: body.paymentReference
    }
  });
  if (!parsed.userId) throw new Error('User is required.');

  const linkedUser = await dataService.getDataById('users', parsed.userId, SYSTEM_CONTEXT);
  if (!linkedUser) throw new Error(`User '${parsed.userId}' not found.`);
  if (parsed.orgId) {
    const userOrgs = Array.isArray(linkedUser.organizations) ? linkedUser.organizations : [];
    const hasOrg = userOrgs.some((org) => String(org?.orgId || '') === String(parsed.orgId));
    if (!hasOrg) {
      throw new Error(`Selected organization '${parsed.orgId}' is not assigned to the selected user.`);
    }
  }

  const userOrgs = Array.isArray(linkedUser.organizations) ? linkedUser.organizations : [];
  const userOrgSet = new Set(
    userOrgs
      .map((org) => toPublicId(org?.orgId))
      .filter(Boolean)
      .map((value) => String(value))
  );

  const periods = Array.isArray(parsed.periods) ? parsed.periods : [];
  periods.forEach((period) => {
    const periodOrgId = toPublicId(period?.orgId);
    if (!periodOrgId) return;
    if (!userOrgSet.has(String(periodOrgId))) {
      throw new Error(`Period organization '${periodOrgId}' is not assigned to the selected user.`);
    }
  });

  const existingRows = await dataService.fetchData('userMemberships', {
    q: parsed.userId,
    type: 'exact_match',
    searchFields: 'userId',
    page: 1,
    limit: 5000
  }, SYSTEM_CONTEXT);
  const duplicates = (Array.isArray(existingRows) ? existingRows : []).filter((row) => {
    if (!idsEqual(row?.userId, parsed.userId)) return false;
    if (existing?.id && idsEqual(row?.id, existing.id)) return false;
    return true;
  });
  const parsedOrgId = toPublicId(parsed.orgId) || null;
  const duplicateSameScope = duplicates.find((row) => idsEqual((toPublicId(row?.orgId) || null), parsedOrgId));
  const duplicateGlobal = duplicates.find((row) => !(toPublicId(row?.orgId) || null));
  if (duplicateSameScope) {
    const editUrl = `/memberships/edit/${encodeURIComponent(String(duplicateSameScope.id || '').trim())}`;
    throw new Error(
      'A membership record already exists for this user and this organization scope.' +
      `<br><a href="${editUrl}" class="fw-bold text-decoration-underline">Open existing membership record</a>`
    );
  }
  if (!parsedOrgId && duplicates.length > 0) {
    throw new Error('Cannot create a Global membership when organization-specific memberships already exist for this user.');
  }
  if (parsedOrgId && duplicateGlobal) {
    const editUrl = `/memberships/edit/${encodeURIComponent(String(duplicateGlobal.id || '').trim())}`;
    throw new Error(
      'Cannot create an organization membership while a Global membership exists for this user.' +
      `<br><a href="${editUrl}" class="fw-bold text-decoration-underline">Open Global membership record</a>`
    );
  }

  return {
    ...parsed,
    status: parsed.summary?.status || 'no_period',
    audit: {
      createUser: existing?.audit?.createUser ?? reqUserId,
      createDateTime: existing?.audit?.createDateTime ?? now,
      lastUpdateUser: reqUserId,
      lastUpdateDateTime: now
    }
  };
}

async function addMembership(req, res) {
  try {
    const payload = await buildMembershipFromBody(req.body, req.user);
    await dataService.addData('userMemberships', payload, req.user);
    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', message: 'Membership saved successfully.' });
    }
    return res.redirect('/memberships');
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(400).json({ status: 'error', message: error.message });
    }
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function showEditForm(req, res) {
  try {
    const membershipItem = await dataService.getDataById('userMemberships', req.params.id, req.user);
    if (!membershipItem) throw new Error('Membership record not found.');
    const normalizedPeriods = Array.isArray(membershipItem?.periods) && membershipItem.periods.length
      ? membershipItem.periods
      : (Array.isArray(membershipItem?.summary?.periods) ? membershipItem.summary.periods : []);
    const membershipViewModel = {
      ...membershipItem,
      periods: normalizedPeriods
    };
    const users = await dataService.fetchData('users', {}, req.user);
    res.render('membership/membershipForm', {
      title: 'Edit Membership',
      membershipItem: membershipViewModel,
      users: Array.isArray(users) ? users : [],
      usersJson: JSON.stringify(Array.isArray(users) ? users : []),
      membershipPeriodSourceTypeOptions: MEMBERSHIP_PERIOD_SOURCE_TYPE_OPTIONS,
      includeModal: true,
      user: req.user || null,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function editMembership(req, res) {
  try {
    const existing = await dataService.getDataById('userMemberships', req.params.id, req.user);
    if (!existing) throw new Error('Membership record not found.');
    const payload = await buildMembershipFromBody(req.body, req.user, existing);
    await dataService.updateData('userMemberships', req.params.id, payload, req.user);
    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', message: 'Membership updated successfully.' });
    }
    return res.redirect('/memberships');
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(400).json({ status: 'error', message: error.message });
    }
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function deleteMembership(req, res) {
  try {
    await dataService.deleteData('userMemberships', req.params.id, req.user);
    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', message: 'Membership deleted successfully.' });
    }
    return res.redirect('/memberships');
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(400).json({ status: 'error', message: error.message });
    }
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

module.exports = {
  listMemberships,
  showAddForm,
  addMembership,
  showEditForm,
  editMembership,
  deleteMembership
};
