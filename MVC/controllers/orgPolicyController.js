// MVC/controllers/orgPolicyController.js
const dataService = require('../services/dataService');const { idsEqual } = require('../utils/idAdapter');
 
const { SYSTEM_CONTEXT } = require('../../config/constants');

/* ============================================================
   HELPERS
============================================================ */
function parseBool(v) {
  if (typeof v === 'boolean') return v;
  return String(v || '').toLowerCase().trim() === 'true' || String(v) === '1';
}

function parseData(input) {
  if (!input) return null;
  if (typeof input === 'object') return input;
  try { return JSON.parse(input); } catch { return null; }
}

function parsePositiveInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeOrgIdToken(value) {
  return String(value || '').trim();
}

function getOrgPolicySaveErrorMessage(error) {
  const message = String(error?.message || '').trim();
  const lower = message.toLowerCase();
  const duplicateSignal = Number(error?.code) === 11000
    || lower.includes('e11000')
    || (lower.includes('duplicate') && lower.includes('key'))
    || lower.includes('organization already has a policy')
    || lower.includes('this organization already has a policy');

  if (duplicateSignal) return 'This organization already has a policy.';
  if (lower.includes('organization cannot be changed')) return 'Organization cannot be changed when editing an existing policy.';
  return message || 'Failed to save organization policy.';
}

function normalizeIdList(values = []) {
  const rows = Array.isArray(values) ? values : [values];
  const out = [];
  const seen = new Set();
  rows.forEach((value) => {
    const id = String(value || '').trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  });
  return out;
}

function normalizePolicySections(rawSections = []) {
  const rows = Array.isArray(rawSections) ? rawSections : [];
  const normalized = [];
  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object') return;
    const sectionId = String(row.sectionId || row.id || '').trim();
    if (!sectionId) return;
    const targetUserIds = normalizeIdList(row.targetUserIds || []);
    const applyToAllUsers = row.applyToAllUsers !== false;
    if (!applyToAllUsers && targetUserIds.length === 0) {
      throw new Error(`Section #${index + 1} must target at least one user when "Apply to all users" is turned off.`);
    }

    const next = { ...row, sectionId };
    if (targetUserIds.length > 0) next.targetUserIds = targetUserIds;
    else delete next.targetUserIds;
    delete next.applyToAllUsers;
    normalized.push(next);
  });
  return normalized;
}

function normalizeTargetedPolicyBlock(rawBlock = {}, {
  blockName = 'Policy block',
  requireApplyToAllToggle = false
} = {}) {
  const base = (rawBlock && typeof rawBlock === 'object') ? { ...rawBlock } : {};
  const targetUserIds = normalizeIdList(base.targetUserIds || []);
  let applyToAllUsers = true;
  if (requireApplyToAllToggle) {
    if (Object.prototype.hasOwnProperty.call(base, 'applyToAllUsers')) {
      applyToAllUsers = base.applyToAllUsers !== false;
    } else {
      applyToAllUsers = targetUserIds.length === 0;
    }
    if (!applyToAllUsers && targetUserIds.length === 0) {
      throw new Error(`${blockName} must target at least one user when "Apply to all users" is turned off.`);
    }
  } else if (Object.prototype.hasOwnProperty.call(base, 'applyToAllUsers')) {
    applyToAllUsers = base.applyToAllUsers !== false;
  }

  if (applyToAllUsers || targetUserIds.length === 0) delete base.targetUserIds;
  else base.targetUserIds = targetUserIds;
  delete base.applyToAllUsers;
  return base;
}

function parseRouteOverrides(rawList) {
  const list = Array.isArray(rawList) ? rawList : [];
  const out = [];

  for (let i = 0; i < list.length; i += 1) {
    const item = list[i] && typeof list[i] === 'object' ? list[i] : {};
    const pathRaw = String(item.path || '').trim();
    const path = pathRaw ? (pathRaw.startsWith('/') ? pathRaw : `/${pathRaw}`) : '';
    if (!path) continue;

    const methodRaw = String(item.method || '*').trim().toUpperCase();
    const method = ['*', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(methodRaw) ? methodRaw : '*';

    const matchTypeRaw = String(item.matchType || 'prefix').trim().toLowerCase();
    const matchType = ['exact', 'prefix', 'contains'].includes(matchTypeRaw) ? matchTypeRaw : 'prefix';

    const keyModeRaw = String(item.keyMode || '').trim().toLowerCase();
    const keyMode = ['ip', 'user_or_ip', 'username_ip', ''].includes(keyModeRaw) ? keyModeRaw : '';

    const modeRaw = String(item.mode || 'inherit').trim().toLowerCase();
    const mode = ['inherit', 'monitor', 'enforce'].includes(modeRaw) ? modeRaw : 'inherit';

    const groupRaw = String(item.group || '').trim().toLowerCase();
    const group = ['auth', 'picker', 'write', 'heavy', 'global', ''].includes(groupRaw) ? groupRaw : '';

    const windowMs = parsePositiveInt(item.windowMs, null);
    const max = parsePositiveInt(item.max, null);
    const priorityNum = parseInt(item.priority, 10);
    const priority = Number.isFinite(priorityNum) ? priorityNum : 0;

    const startAtVal = item.startAt ? new Date(item.startAt) : null;
    const endAtVal = item.endAt ? new Date(item.endAt) : null;
    const startAt = (startAtVal && !Number.isNaN(startAtVal.getTime())) ? startAtVal.toISOString() : '';
    const endAt = (endAtVal && !Number.isNaN(endAtVal.getTime())) ? endAtVal.toISOString() : '';

    out.push({
      id: String(item.id || `ROV_${Date.now()}_${i + 1}`).trim(),
      label: String(item.label || '').trim(),
      enabled: item.enabled === true || String(item.enabled || '').toLowerCase() === 'true',
      method,
      matchType,
      path,
      startAt,
      endAt,
      windowMs,
      max,
      keyMode,
      mode,
      group,
      priority,
      notes: String(item.notes || '').trim()
    });
  }

  return out;
}

function normalizeRequestControl(rawInput) {
  const src = rawInput && typeof rawInput === 'object' ? rawInput : {};
  const customRoutesSource = Array.isArray(src.customRoutes)
    ? src.customRoutes
    : (Array.isArray(src.routeOverrides) ? src.routeOverrides : []);
  const normalized = {
    customRoutes: parseRouteOverrides(customRoutesSource)
  };
  if (Object.prototype.hasOwnProperty.call(src, 'applyToAllUsers')) {
    normalized.applyToAllUsers = src.applyToAllUsers !== false;
  }
  if (Object.prototype.hasOwnProperty.call(src, 'targetUserIds')) {
    normalized.targetUserIds = src.targetUserIds;
  }
  return normalized;
}

function buildPolicyFromBody(body, reqUserId, existing = null) {
  const now = new Date().toISOString();
  
  const network = normalizeTargetedPolicyBlock(parseData(body.network) || {}, {
    blockName: 'Network policy block',
    requireApplyToAllToggle: true
  });
  const security = parseData(body.security) || {};
  const sessionControl = normalizeTargetedPolicyBlock(parseData(body.sessionControl) || {}, {
    blockName: 'Session control block',
    requireApplyToAllToggle: true
  });
  const globalSchedule = normalizeTargetedPolicyBlock(parseData(body.globalSchedule) || {}, {
    blockName: 'Global schedule block',
    requireApplyToAllToggle: true
  });
  const sections = normalizePolicySections(parseData(body.sections) || []);
  const bannedUsers = parseData(body.bannedUsers) || [];
  const requestControl = normalizeTargetedPolicyBlock(normalizeRequestControl(parseData(body.requestControl) || {}), {
    blockName: 'Request control block',
    requireApplyToAllToggle: true
  });

  return {
    orgId: (body.orgId || '').trim(),
    policyName: (body.policyName || '').trim(),
    active: parseBool(body.active),
    validityPeriod: { startDate: body.validityPeriod?.startDate || null, endDate: body.validityPeriod?.endDate || null },
    network,
    security,
    sessionControl, 
    requestControl,
    globalSchedule, 
    sections,
    bannedUsers,
    audit: {
      createUser: existing?.audit?.createUser ?? reqUserId,
      createDateTime: existing?.audit?.createDateTime ?? now,
      lastUpdateUser: reqUserId,
      lastUpdateDateTime: now
    }
  };
}

/* ============================================================
   AJAX CHECK
============================================================ */
async function checkOrgPolicy(req, res) {
  try {
    const { orgId } = req.params;
    if (!orgId) throw new Error('Org ID is required');
    
    // We access model directly or via dataService if added there
    // For now assuming dataService.getPolicyByOrgId is implemented or we fetch all
    const policies = await dataService.fetchData('orgPolicies', { q: orgId, type: 'exact_match', searchFields: 'orgId' }, req.user);
    const policy = policies.find(p => idsEqual(p.orgId, orgId));

    return res.json({ status: 'success', exists: !!policy, policy: policy ? { id: policy.id, name: policy.policyName } : null });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
}

/* ============================================================
   CRUD ACTIONS
============================================================ */
async function listPolicies(req, res) {
  try {
    const listQuery = {
      ...(req.query || {}),
      page: req.query.page,
      limit: req.query.limit
    };
    const pagedPolicies = await dataService.fetchDataPaged('orgPolicies', listQuery, req.user);
    const policies = Array.isArray(pagedPolicies?.rows) ? pagedPolicies.rows : [];
    const orgs = await dataService.fetchData('organizations', {}, req.user);
    //console.log(policies,orgs);

    const enrichedPolicies = policies.map(p => {
      const o = orgs.find(org => idsEqual(org.id, p.orgId));
      return { ...p, orgName: o ? o.identity.displayName : 'Unknown Org' };
    });

    const data = enrichedPolicies;
    const pagination = pagedPolicies?.pagination || null;
    if (req.headers['x-ajax-request']) return res.json({ status: 'success', data, pagination });
    res.render('orgPolicy/policies', {
      title: 'Organization Policy Management', 
      tableName: 'Org_Policy_Management',
      data, 
      newUrl: 'organizationPolicies', 
      newLabel: 'Add Policy',
      includeModal: true, 
      includeModal_Table: true, 
      print: true,
      pagination, 
      filters: req.query, 
      user: req.user || null
    });
  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(500).json({ status: 'error', message: error.message });
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function showAddPolicyForm(req, res) {
  try {
    const websiteRequestControl = (req.websitePolicy && req.websitePolicy.requestControl) || {};
    res.render('orgPolicy/policyForm', {
      title: 'Add Organization Policy', 
      includeModal: true, 
      policy: null,
      websiteRequestControl,
      user: req.user || null,
      actionStateId: req.actionStateId
    });
  } catch (error) { res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null }); }
}

async function addPolicy(req, res) {
  try {
    const reqUserId = req.user?.id || "1";
    // Check duplication
    const existingList = await dataService.fetchData('orgPolicies', { q: req.body.orgId, type: 'exact_match', searchFields: 'orgId' }, req.user);
    if (existingList.find(p => idsEqual(p.orgId, req.body.orgId))) {
        throw new Error('This organization already has a policy.');
    }

    const targetOrg = await dataService.getDataById('organizations', req.body.orgId, req.user);
    if (!targetOrg) throw new Error('Selected Organization does not exist.');
    
    const policy = buildPolicyFromBody(req.body, reqUserId);
    await dataService.addData('orgPolicies', policy, req.user);
    
    if (req.headers['x-ajax-request']) return res.json({ status: 'success', message: 'Org Policy created successfully.' });
    res.redirect('/orgPolicies');
  } catch (error) {
    const message = getOrgPolicySaveErrorMessage(error);
    if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message });
    res.status(400).render('error', { title: 'Error', message, user: req.user || null });
  }
}

async function showEditPolicyForm(req, res) {
  try {
    const policy = await dataService.getDataById('orgPolicies', req.params.id, req.user);
    if (!policy) return res.status(404).render('404', { title: 'Not Found', user: req.user || null });
    
    const org = await dataService.getDataById('organizations', policy.orgId, req.user);
    const targetOrgName = org ? `${org.identity.displayName} (#${org.id})` : policy.orgId;
    const websiteRequestControl = (req.websitePolicy && req.websitePolicy.requestControl) || {};
    res.render('orgPolicy/policyForm', {
      title: 'Edit Organization Policy', 
      includeModal: true, 
      policy,
      websiteRequestControl,
      targetOrgName,
      user: req.user || null,
      actionStateId: req.actionStateId
    });
  } catch (error) { res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null }); }
}

async function editPolicy(req, res) {
  try {
    const existing = await dataService.getDataById('orgPolicies', req.params.id, req.user);
    if (!existing) throw new Error('Policy not found');

    const incomingOrgId = normalizeOrgIdToken(req.body?.orgId);
    const existingOrgId = normalizeOrgIdToken(existing?.orgId);
    if (incomingOrgId !== existingOrgId) {
      throw new Error('Organization cannot be changed when editing an existing policy.');
    }
    
    const reqUserId = req.user?.id || "1";
    const updates = buildPolicyFromBody(req.body, reqUserId, existing);
    
    await dataService.updateData('orgPolicies', req.params.id, updates, req.user);
    
    if (req.headers['x-ajax-request']) return res.json({ status: 'success', message: 'Policy updated successfully.' });
    res.redirect('/orgPolicies');
  } catch (error) {
    const message = getOrgPolicySaveErrorMessage(error);
    if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message });
    res.status(400).render('error', { title: 'Error', message, user: req.user || null });
  }
}

async function deletePolicy(req, res) {
  try {
    await dataService.deleteData('orgPolicies', req.params.id, req.user);
    if (req.headers['x-ajax-request']) return res.json({ status: 'success', message: 'Policy deleted successfully.' });
    res.redirect('/orgPolicies');
  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message: error.message });
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

module.exports = {
  listPolicies,
  showAddPolicyForm,
  addPolicy,
  showEditPolicyForm,
  editPolicy,
  deletePolicy,
  checkOrgPolicy
};
