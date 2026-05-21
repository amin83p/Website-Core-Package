// MVC/controllers/organizationController.js
//const organizationModel = require('../models/organizationModel');
const dataService = require('../services/dataService'); 
const { buildDataServiceQuery, isAjax } = require('../utils/generalTools');
const { idsEqual } = require('../utils/idAdapter');

const ORGANIZATION_SEARCHABLE_FIELDS = Object.freeze([
  'id',
  'active',
  'identity.displayName',
  'identity.legalName',
  'identity.type',
  'identity.registrationNo',
  'identity.taxId',
  'contact.email',
  'contact.phone',
  'contact.address.city',
  'contact.address.country',
  'domain.primaryDomain',
  'billing.plan',
  'billing.status',
  'billing.currency',
  'notes',
  'tags',
  'audit.createDateTime',
  'audit.lastUpdateDateTime'
]);

// helpers
function normalizeTags(tagsString) {
  if (!tagsString) return [];
  return tagsString.split(',').map(t => t.trim()).filter(Boolean);
}

function normalizeDomains(domainsString) {
  if (!domainsString) return [];
  return domainsString.split(',').map(d => d.trim()).filter(Boolean);
}

function parseBool(v) {
  if (typeof v === 'boolean') return v;
  return String(v || '').toLowerCase().trim() === 'true';
}

function parseNum(v, fallback = null) {
  if (v === '' || v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function buildOrganizationFromBody(body, reqUserId) {
  const now = new Date().toISOString();

  // Parse admins if provided as JSON string
  let admins = [];
  if (body.admins) {
    try {
      admins = JSON.parse(body.admins);
      if (!Array.isArray(admins)) admins = [];
    } catch {
      admins = [];
    }
  }

  return {
    active: parseBool(body.active),

    identity: {
      legalName: (body.legalName || '').trim(),
      displayName: (body.displayName || body.legalName || '').trim(),
      type: (body.type || '').trim(),
      registrationNo: body.registrationNo?.trim() || null,
      taxId: body.taxId?.trim() || null,
      website: body.website?.trim() || null,
      logoUrl: body.logoUrl?.trim() || null,
      industry: body.industry?.trim() || null,
      size: body.size?.trim() || null
    },

    contact: {
      email: body.contactEmail?.trim() || null,
      phone: body.phone?.trim() || null,
      phoneAlt: body.phoneAlt?.trim() || null,
      fax: body.fax?.trim() || null,
      address: {
        line1: body.addressLine1?.trim() || null,
        line2: body.addressLine2?.trim() || null,
        city: body.city?.trim() || null,
        provinceState: body.provinceState?.trim() || null,
        postalCode: body.postalCode?.trim() || null,
        country: body.country?.trim() || null
      }
    },

    domain: {
      primaryDomain: body.primaryDomain?.trim() || null,
      allowedDomains: normalizeDomains(body.allowedDomains),
      autoJoinEnabled: parseBool(body.autoJoinEnabled),
      ssoEnabled: parseBool(body.ssoEnabled)
    },

    billing: {
      plan: (body.plan || 'free').trim(),
      status: (body.billingStatus || 'active').trim(),
      currency: (body.currency || 'USD').trim(),
      seatsLimit: parseNum(body.seatsLimit, null),
      seatsUsed: parseNum(body.seatsUsed, 0),
      billingEmail: body.billingEmail?.trim() || null,
      billingCycle: body.billingCycle?.trim() || null,
      nextInvoiceDate: body.nextInvoiceDate?.trim() || null
    },

    settings: {
      defaultAccessLevel: parseNum(body.defaultAccessLevel, 0),
      allowSelfRegistration: parseBool(body.allowSelfRegistration),
      requireAdminApprovalForImport: parseBool(body.requireAdminApprovalForImport),
      dataRetentionDays: parseNum(body.dataRetentionDays, null)
    },

    people: {
      ownerUserId: parseNum(body.ownerUserId, null),
      admins,
      membersCount: parseNum(body.membersCount, 0)
    },

    notes: body.notes?.trim() || null,
    tags: normalizeTags(body.tags),

    audit: {
      createUser: reqUserId,
      createDateTime: now,
      lastUpdateUser: reqUserId,
      lastUpdateDateTime: now
    }
  };
}

async function listOrganizations(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, {
      defaultSearchFields: [
        'identity.displayName',
        'identity.legalName',
        'contact.email',
        'domain.primaryDomain',
        'billing.plan',
        'billing.status',
        'notes'
      ],
      allowedSearchFields: ORGANIZATION_SEARCHABLE_FIELDS,
      allowedExactKeys: [
        'id',
        'active',
        'identity.type',
        'billing.plan',
        'billing.status',
        'contact.address.country'
      ]
    });

    const [pagedOrganizations, contracts] = await Promise.all([
      dataService.fetchDataPaged('organizations', query, req.user),
      dataService.fetchData('contracts', {}, req.user)
    ]);

    const organizations = Array.isArray(pagedOrganizations?.rows) ? pagedOrganizations.rows : [];

    const contractCountByOrgId = new Map();
    (contracts || []).forEach((item) => {
      const orgId = String(item?.orgId || '').trim();
      if (!orgId) return;
      contractCountByOrgId.set(orgId, (contractCountByOrgId.get(orgId) || 0) + 1);
    });

    const enriched = (organizations || []).map((org) => ({
      ...org,
      contractCount: contractCountByOrgId.get(String(org?.id || '').trim()) || 0
    }));

    const data = enriched;
    const pagination = pagedOrganizations?.pagination || null;

    if (isAjax(req)) {
      return res.json({ status: 'success', results: data, pagination, searchableFields: ORGANIZATION_SEARCHABLE_FIELDS });
    }

    res.render('organization/organizations', {
      title: 'Organizations Management',
      tableName: 'Organizations_Management',
      data: data,
      newUrl: 'organizations',
      newLabel: 'Add Organization',
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: true,
      print: true,
      searchableFields: ORGANIZATION_SEARCHABLE_FIELDS,
      pagination,
      filters: req.query,
      //
      user: req.user || null,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) {
      return res.status(500).json({ status: 'error', message: error.message });
    }
    res.status(500).render('error', {
        title: 'Error',
        error,
        message: error.message,
        user: req.user || null
    });
  }
}

async function showAddOrganizationForm(req, res) {
  res.render('organization/organizationForm', {
    title: 'Add Organization',
    includeModal: true,
    organization: null,
    organizationContracts: [],
    user: req.user || null,
    actionStateId: req.actionStateId
  });
}

async function addOrganization(req, res) {
  try {
    const reqUserId = req.user ? req.user.id : null;
    const org = buildOrganizationFromBody(req.body, reqUserId);

    const addResult = await dataService.addData('organizations', org, req.user);
    //await organizationModel.addOrganization(org);

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', message: 'Organization saved successfully.' });
    }
    res.redirect('/organizations');
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(500).json({ status: 'error', message: error.message });
    }
    res.status(500).render('error', {
      title: 'Error',
      error,
      message: error.message,
      user: req.user || null
    });
  }
}

async function showEditOrganizationForm(req, res) {
  try {
    const [organization, contracts] = await Promise.all([
      dataService.getDataById('organizations', req.params.id, req.user),
      dataService.fetchData('contracts', { orgId__eq: req.params.id, sort: 'startDate', order: 'desc' }, req.user)
    ]);

    if (!organization) {
      return res.status(404).render('404', {
        title: 'Not Found',
        user: req.user || null
      });
    }

    res.render('organization/organizationForm', {
      title: 'Edit Organization',
      includeModal: true,
      organization,
      organizationContracts: Array.isArray(contracts) ? contracts.filter((c) => idsEqual(c?.orgId, organization.id)) : [],
      user: req.user || null,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', {
      title: 'Error',
      error,
      message: error.message,
      user: req.user || null
    });
  }
}

async function editOrganization(req, res) {
  try {
    const existing = await dataService.getDataById('organizations', req.params.id, req.user);
    //const existing = await policyModel.getPolicyById(req.params.id);
    if (!existing) throw new Error('Organization not found');
    const reqUserId = req.user ? req.user.id : null;
    const updates = buildOrganizationFromBody(req.body, reqUserId);

    // do NOT overwrite create audit on edit
    delete updates.audit.createUser;
    delete updates.audit.createDateTime;
    const updatedObj = await dataService.updateData('organizations', req.params.id, updates, req.user);

    //await organizationModel.updateOrganization(req.params.id, updates);

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', message: 'Organization updated successfully.' });
    }
    res.redirect('/organizations');
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(500).json({ status: 'error', message: error.message });
    }
    res.status(500).render('error', {
      title: 'Error',
      error,
      message: error.message,
      user: req.user || null
    });
  }
}

async function deleteOrganization(req, res) {
  try {
    //await organizationModel.deleteOrganization(req.params.id);
    const deletedObj = await dataService.deleteData('organizations', req.params.id, req.user);

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', message: 'Organization deleted successfully.' });
    }
    res.redirect('/organizations');
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(500).json({ status: 'error', message: error.message });
    }
    res.status(500).render('error', {
      title: 'Error',
      error,
      message: error.message,
      user: req.user || null
    });
  }
}

module.exports = {
  listOrganizations,
  showAddOrganizationForm,
  addOrganization,
  showEditOrganizationForm,
  editOrganization,
  deleteOrganization
};
