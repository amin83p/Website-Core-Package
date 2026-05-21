// MVC/controllers/contractController.js
const dataService = require('../services/dataService');const { idsEqual } = require('../utils/idAdapter');

// Helpers
function parseData(input) {
  try { return JSON.parse(input); } catch { return null; }
}

function buildContractFromBody(body, reqUserId) {
  const now = new Date().toISOString();

  // Parsing complex nested objects
  const renewal = parseData(body.renewal) || { autoRenew: false };
  const financials = parseData(body.financials) || {};
  const scope = parseData(body.scope) || {};
  const contacts = parseData(body.contacts) || {};
  const attachments = parseData(body.attachments) || [];

  return {
    orgId: (body.orgId || '').trim(),
    title: (body.title || '').trim(),
    type: (body.type || 'subscription'),
    status: (body.status || 'draft'),
    
    startDate: body.startDate || null,
    endDate: body.endDate || null,

    renewal,
    financials,
    scope,
    contacts,
    attachments,

    notes: (body.notes || '').trim(),

    audit: {
      lastUpdateUser: reqUserId,
      lastUpdateDateTime: now
    }
  };
}

async function listContracts(req, res) {
  try {
    const listQuery = {
      ...(req.query || {}),
      page: req.query.page,
      limit: req.query.limit
    };
    const pagedContracts = await dataService.fetchDataPaged('contracts', listQuery, req.user);
    const contracts = Array.isArray(pagedContracts?.rows) ? pagedContracts.rows : [];
    const orgs = await dataService.fetchData('organizations', {}, req.user);

    // Join Org Name for display
    const enriched = contracts.map(c => {
        const org = orgs.find(o => idsEqual(o.id, c.orgId));
        return { ...c, orgName: org ? org.identity.displayName : `Unknown Org (#${c.orgId})` };
    });

    const data = enriched;
    const pagination = pagedContracts?.pagination || null;

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', data, pagination });
    }

    res.render('contract/contracts', {
      title: 'Contract Management',
      tableName: 'Contracts_Management',
      data,
      newUrl: 'contracts',
      newLabel: 'Add Contract',
      includeModal: true,
      print: true,
      pagination,
      filters: req.query,
      user: req.user
    });
  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(500).json({ status: 'error', message: error.message });
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function showAddForm(req, res) {
  try {
    const prefillOrgId = String(req.query.orgId || '').trim();
    const prefillOrgName = String(req.query.orgName || '').trim();
    res.render('contract/contractForm', {
      title: 'Add Contract',
      contract: prefillOrgId ? { orgId: prefillOrgId } : null,
      orgName: prefillOrgName,
      includeModal: true, // For GenericPicker
      user: req.user
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function addContract(req, res) {
  try {
    const item = buildContractFromBody(req.body, req.user?.id);
    // Explicitly set create audit on new
    item.audit.createUser = req.user?.id;
    item.audit.createDateTime = new Date().toISOString();

    await dataService.addData('contracts', item, req.user);

    if (req.headers['x-ajax-request']) return res.json({ status: 'success', message: 'Contract created.' });
    res.redirect('/contracts');
  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function showEditForm(req, res) {
  try {
    const contract = await dataService.getDataById('contracts', req.params.id, req.user);
    if (!contract) return res.status(404).render('404', { title: 'Not Found', user: req.user });

    // Fetch Org Name for the input field display
    const org = await dataService.getDataById('organizations', contract.orgId, req.user);
    const orgName = org ? org.identity.displayName : contract.orgId;

    res.render('contract/contractForm', {
      title: 'Edit Contract',
      contract,
      orgName,
      includeModal: true,
      user: req.user
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function editContract(req, res) {
  try {
    const existing = await dataService.getDataById('contracts', req.params.id, req.user);
    if (!existing) throw new Error('Contract not found');

    const updates = buildContractFromBody(req.body, req.user?.id);
    // Preserve creation audit
    updates.audit.createUser = existing.audit.createUser;
    updates.audit.createDateTime = existing.audit.createDateTime;

    await dataService.updateData('contracts', req.params.id, updates, req.user);

    if (req.headers['x-ajax-request']) return res.json({ status: 'success', message: 'Contract updated.' });
    res.redirect('/contracts');
  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function deleteContract(req, res) {
  try {
    await dataService.deleteData('contracts', req.params.id, req.user);
    if (req.headers['x-ajax-request']) return res.json({ status: 'success', message: 'Contract deleted.' });
    res.redirect('/contracts');
  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

module.exports = {
  listContracts,
  showAddForm,
  addContract,
  showEditForm,
  editContract,
  deleteContract
};
