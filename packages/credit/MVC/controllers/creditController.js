const {
  paginate,
  dashboardController,
  dataService: dataServiceGlobal,
  idsEqual,
  toPublicId,
  getActiveOrgIdOrThrow: getActiveOrgIdOrThrowShared,
  assertCreateOrgContextOrThrow: assertCreateOrgContextOrThrowShared,
  assertOrgAccess,
  normalizeOrgRoles,
  getPrimaryOrgRole
} = require('../services/credit/creditCoreContracts');

const creditDataService = require('../services/credit/creditDataService');

const { getDashboardSection } = dashboardController;

const PERSON_QUERY_OPTIONS = Object.freeze({ enrichment: { includeSchoolRoles: false } });

function toDisplayName(person) {
  if (!person || typeof person !== 'object') return '';
  const identityName = person?.identity?.displayName;
  if (identityName) return String(identityName).trim();
  const first = String(person?.name?.first || '').trim();
  const last = String(person?.name?.last || '').trim();
  const joined = `${first} ${last}`.trim();
  return joined || String(person?.fullName || person?.id || '').trim();
}

function extractContact(person) {
  const primaryEmail = person?.contact?.emails?.find?.((item) => item?.isPrimary)?.email
    || person?.contact?.emails?.[0]?.email
    || person?.contact?.email
    || '';
  const primaryPhone = person?.contact?.phones?.find?.((item) => item?.isPrimary)?.number
    || person?.contact?.phones?.[0]?.number
    || '';
  return {
    personEmail: String(primaryEmail || '').trim(),
    personPhone: String(primaryPhone || '').trim()
  };
}

function getActiveOrgIdOrThrow(reqUser) {
  return getActiveOrgIdOrThrowShared(reqUser);
}

async function assertCreateOrgContextOrThrow(reqUser) {
  return assertCreateOrgContextOrThrowShared(reqUser, { scopeLabel: 'credit customers' });
}

function assertCustomerOrgAccess(customer, activeOrgId, reqUser) {
  assertOrgAccess(customer, activeOrgId, reqUser, { orgField: 'orgId', allowSystemBypass: true });
}

function parseJsonSafe(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function toBoolean(value) {
  return value === true || value === 'true' || value === 'on' || value === 1 || value === '1';
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
    ? emailsRaw.map((e) => ({
      type: String(e?.type || 'work').trim().toLowerCase(),
      email: String(e?.email || '').trim(),
      isPrimary: Boolean(e?.isPrimary)
    })).filter((e) => !!e.email)
    : [];

  if (!emails.length) throw new Error('At least one email is required for new person registration.');
  if (!emails.some((e) => e.isPrimary)) emails[0].isPrimary = true;

  const phones = Array.isArray(phonesRaw)
    ? phonesRaw.map((p) => ({
      type: String(p?.type || 'mobile').trim().toLowerCase(),
      number: String(p?.number || '').trim()
    })).filter((p) => !!p.number)
    : [];

  const addresses = Array.isArray(addressesRaw)
    ? addressesRaw.map((a) => ({
      type: String(a?.type || 'home').trim().toLowerCase(),
      line1: String(a?.line1 || '').trim(),
      city: String(a?.city || '').trim(),
      province: String(a?.province || '').trim(),
      postalCode: String(a?.postalCode || '').trim()
    })).filter((a) => !!(a.line1 || a.city || a.province || a.postalCode))
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

async function ensurePersonHasOrgRole(personId, orgId, role, reqUser) {
  const person = await dataServiceGlobal.getDataById('persons', personId, reqUser, PERSON_QUERY_OPTIONS);
  if (!person) throw new Error('Linked person record was not found.');

  const targetRole = String(role || '').trim().toLowerCase();
  if (!targetRole) return;

  const list = Array.isArray(person.organizations) ? person.organizations.slice() : [];
  const now = new Date().toISOString();
  const idx = list.findIndex((org) => idsEqual(org?.orgId || '', orgId || ''));

  if (idx >= 0) {
    const org = { ...list[idx] };
    const roles = normalizeOrgRoles(org);
    if (!roles.includes(targetRole)) roles.push(targetRole);
    org.roles = roles;
    org.role = getPrimaryOrgRole(org);
    if (!org.memberStatus) org.memberStatus = 'active';
    if (!org.joinedAt) org.joinedAt = now;
    list[idx] = org;
  } else {
    let orgName = '';
    try {
      const orgObj = await dataServiceGlobal.getDataById('organizations', orgId, reqUser);
      orgName = String(orgObj?.name || '').trim();
    } catch (_) {}
    const roles = ['member', targetRole].filter((v, i, arr) => arr.indexOf(v) === i);
    const newMembership = {
      orgId: Number.isFinite(Number(orgId)) ? Number(orgId) : orgId,
      name: orgName,
      roles,
      role: getPrimaryOrgRole({ roles }),
      memberStatus: 'active',
      joinedAt: now
    };
    list.push({
      ...newMembership
    });
  }

  await dataServiceGlobal.updateData('persons', person.id, { ...person, organizations: list }, reqUser);
}

exports.showDashboard = async (req, res) => {
  try {
    const activeOrgName = (() => {
      const activeOrgId = String(req.user?.activeOrgId || '').trim();
      const org = Array.isArray(req.user?.allowedOrgs)
        ? req.user.allowedOrgs.find((x) => String(x?.orgId || '') === activeOrgId)
        : null;
      return org?.name || org?.orgName || activeOrgId || 'N/A';
    })();

    const modules = [
      {
        title: 'Customer Registration / Directory',
        description: 'Register persons as credit customers and manage financial profile status.',
        href: '/credit/customers',
        buttonLabel: 'Open Customer Directory',
        icon: 'bi-people-fill',
        subtleClass: 'bg-primary-subtle text-primary',
        buttonClass: 'btn btn-primary'
      },
      {
        title: 'Loan & Credit Requests',
        description: 'Track loan and credit applications (placeholder for next step).',
        href: '/credit/customers',
        buttonLabel: 'Go to Customers',
        icon: 'bi-cash-coin',
        subtleClass: 'bg-success-subtle text-success',
        buttonClass: 'btn btn-success'
      },
      {
        title: 'Installment Payments',
        description: 'Capture installment payment submissions from customers (coming next).',
        href: '/credit/customers',
        buttonLabel: 'Manage Customers',
        icon: 'bi-receipt',
        subtleClass: 'bg-warning-subtle text-warning',
        buttonClass: 'btn btn-warning text-dark'
      }
    ];

    const dashboardSection = await getDashboardSection('/credit', req.user);
    res.render('credit/dashboard', {
      title: 'Credit & Loans Dashboard',
      user: req.user || null,
      activeOrgName,
      dashboardSections: modules,
      dashboardSection,
      includeModal: true
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
};

exports.listCustomers = async (req, res) => {
  try {
    const rows = await creditDataService.listCustomers(req.query, req.user);
    const { data, pagination } = paginate(rows, req.query.page, req.query.limit);

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', data, pagination });
    }

    res.render('credit/customerList', {
      title: 'Credit Customers Directory',
      tableName: 'Credit_Customers',
      data,
      pagination,
      filters: req.query,
      newUrl: 'credit/customers',
      newLabel: 'Register Customer',
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: true,
      print: true,
      user: req.user || null,
      actionStateId: req?.actionStateId || ''
    });
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(500).json({ status: 'error', message: error.message });
    }
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
};

exports.showForm = async (req, res) => {
  try {
    const isEdit = Boolean(req.params.id);
    const activeOrgId = isEdit
      ? getActiveOrgIdOrThrow(req.user)
      : await assertCreateOrgContextOrThrow(req.user);

    let customer = {};
    let personName = '';
    let personOrganizations = [];

    if (isEdit) {
      customer = await creditDataService.getCustomerById(req.params.id, req.user);
      if (!customer) {
        return res.status(404).render('404', { title: 'Not Found', user: req.user || null });
      }
      assertCustomerOrgAccess(customer, activeOrgId, req.user);
      const person = await dataServiceGlobal.getDataById('persons', customer.personId, req.user, PERSON_QUERY_OPTIONS);
      if (person) {
        personName = toDisplayName(person);
        personOrganizations = Array.isArray(person.organizations) ? person.organizations : [];
      }
    }

    return res.render('credit/customerForm', {
      title: isEdit ? 'Edit Credit Customer' : 'Register Credit Customer',
      customer,
      personName,
      personOrganizations,
      user: req.user || null,
      includeModal: true,
      actionStateId: req?.actionStateId || ''
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
};

exports.saveCustomer = async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const activeOrgId = id
      ? getActiveOrgIdOrThrow(req.user)
      : await assertCreateOrgContextOrThrow(req.user);

    let existingCustomer = null;
    if (id) {
      existingCustomer = await creditDataService.getCustomerById(id, req.user);
      if (!existingCustomer) throw new Error('Customer not found.');
      assertCustomerOrgAccess(existingCustomer, activeOrgId, req.user);
    }

    const personMode = existingCustomer
      ? 'existing'
      : String(req.body.personMode || 'existing').trim().toLowerCase();
    // Security: for updates, keep the original person linkage and ignore request body personId.
    let personId = existingCustomer
      ? toPublicId(existingCustomer.personId)
      : toPublicId(req.body.personId);

    if (!existingCustomer && personMode === 'new') {
      const personPayload = buildInlinePersonPayload(req.body, req.user);
      const createdPerson = await dataServiceGlobal.addData('persons', personPayload, req.user);
      personId = toPublicId(createdPerson?.id);
      if (!personId) throw new Error('Failed to create person profile before customer registration.');
    }

    if (!personId) throw new Error('A valid Person must be selected.');

    const person = await dataServiceGlobal.getDataById('persons', personId, req.user, PERSON_QUERY_OPTIONS);
    if (!person) throw new Error('Linked person not found.');

    const payload = {
      personId,
      personName: toDisplayName(person),
      personEmail: extractContact(person).personEmail,
      personPhone: extractContact(person).personPhone,
      customerCode: String(req.body.customerCode || '').trim().toUpperCase(),
      status: String(req.body.status || 'active').trim(),
      notes: String(req.body.notes || '').trim(),
      createdBy: String(req.user?.id || '')
    };

    if (id) await creditDataService.updateCustomer(id, payload, req.user);
    else await creditDataService.createCustomer(payload, req.user);

    await ensurePersonHasOrgRole(personId, activeOrgId, 'credit_customer', req.user);

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', message: 'Customer saved successfully.' });
    }
    return res.redirect('/credit/customers');
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(400).json({ status: 'error', message: error.message });
    }
    return res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
};

exports.deleteCustomer = async (req, res) => {
  try {
    await creditDataService.deleteCustomer(req.params.id, req.user);
    return res.json({ status: 'success', message: 'Customer deleted successfully.' });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};
