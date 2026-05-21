// MVC/controllers/accessPolicyController.js
const dataService = require('../services/dataService');const { idsEqual } = require('../utils/idAdapter');
 
const securityService = require('../services/security');

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

function parseNonNegativeInt(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || Number.isNaN(n)) return fallback;
  return n >= 0 ? n : fallback;
}

function normalizeOrgScopeToken(value) {
  const token = String(value || '').trim();
  if (!token || token.toLowerCase() === 'global') return '';
  return token;
}

function getAccessPolicySaveErrorMessage(error) {
  const message = String(error?.message || '').trim();
  const lower = message.toLowerCase();
  const duplicateSignal = Number(error?.code) === 11000
    || lower.includes('e11000')
    || (lower.includes('duplicate') && lower.includes('key'))
    || lower.includes('already has a policy')
    || lower.includes('already exists for this user in the selected scope');

  if (duplicateSignal) return 'A policy already exists for this user in the selected scope.';
  if (lower.includes('user cannot be changed')) return 'User cannot be changed when editing an existing policy.';
  if (lower.includes('organization scope cannot be changed')) return 'Organization scope cannot be changed when editing an existing policy.';
  return message || 'Failed to save access policy.';
}

function buildPolicyFromBody(body, reqUserId, existing = null) {
  const now = new Date().toISOString();
  
  const network = parseData(body.network) || {};
  const security = parseData(body.security) || {};
  
  const sessionControl = {
    maxSessions: parseNonNegativeInt(body.sessionControl?.maxSessions, 5),
    maxDuration: parseNonNegativeInt(body.sessionControl?.maxDuration, 480),
    idleTimeout: parseNonNegativeInt(body.sessionControl?.idleTimeout, 30)
  };

  const globalSchedule = parseData(body.globalSchedule) || {};
  const sections = parseData(body.sections) || [];

  let orgId = (body.orgId || '').trim() || null;
  if (orgId === 'global') orgId = null;

  return {
    userId: (body.userId || '').trim(),
    orgId: orgId, 
    policyName: (body.policyName || '').trim(),
    active: parseBool(body.active),
    validityPeriod: { startDate: body.validityPeriod?.startDate || null, endDate: body.validityPeriod?.endDate || null },
    network,
    security,
    sessionControl, 
    globalSchedule, 
    sections,
    audit: {
      createUser: existing?.audit?.createUser ?? reqUserId,
      createDateTime: existing?.audit?.createDateTime ?? now,
      lastUpdateUser: reqUserId,
      lastUpdateDateTime: now
    }
  };
}

/* ============================================================
   DIAGNOSTIC TOOLS
============================================================ */
async function showAccessChecker(req, res) {
  try {
    const sections = await dataService.fetchData('sections', {}, req.user);
    const operations = await dataService.fetchData('operations', {}, req.user);
    const userPolicies = await dataService.fetchData('accessPolicies', { userId: req.user.id }, req.user); 
    const hasPolicy = userPolicies.length > 0;

    res.render('accessPolicy/accessChecker', {
      title: 'Access Control Checker',
      user: req.user,
      hasPolicy,
      sections,
      operations
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
}

async function performAccessCheck(req, res) {
  try {
    const { sectionId, operationId } = req.body;
    const result = await securityService.evaluateAccess({
        user: req.user,
        sectionId: sectionId,
        operationId: operationId,
        ipAddress: req.ip
    });

    if (result.allowed) {
        return res.json({ status: 'success', message: result.reason, limits: result.limits });
    } else {
        return res.json({ status: 'error', message: result.reason });
    }
  } catch (error) {
    res.json({ status: 'error', message: error.message });
  }
}

/* ============================================================
   AJAX CHECK
============================================================ */
async function checkUserPolicy(req, res) {
  try {
    const { userId } = req.params;
    const orgId = req.query.orgId || null; 

    if (!userId) throw new Error('User ID is required');
    
    const policies = await dataService.fetchData('accessPolicies', { userId: userId }, req.user);
    const policy = policies.find(p => idsEqual(p.orgId || '', orgId || ''));

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
    const pagedPolicies = await dataService.fetchDataPaged('accessPolicies', req.query, req.user);
    const policies = Array.isArray(pagedPolicies?.rows) ? pagedPolicies.rows : [];
    const users = await dataService.fetchData('users', {}, req.user);
    const orgs = await dataService.fetchData('organizations', {}, req.user);

    const enrichedPolicies = policies.map(p => {
      const u = users.find(user => idsEqual(user.id, p.userId));
      
      let orgName = 'Global / System';
      if (p.orgId) {
          const o = orgs.find(org => idsEqual(org.id, p.orgId));
          orgName = o ? o.name : `Org #${p.orgId}`;
      }

      return { 
          ...p, 
          userName: u ? (u.username || u.email) : 'Unknown User',
          orgName: orgName 
      };
    });

    const data = enrichedPolicies;
    const pagination = pagedPolicies?.pagination || null;
    if (req.headers['x-ajax-request']) return res.json({ status: 'success', data, pagination });

    res.render('accessPolicy/policies', {
      title: 'Access Policy Management', tableName: 'Access_Policy_Management',
      data, newUrl: 'accessPolicies', newLabel: 'Add Policy',
      includeModal: true, includeModal_Table: true, print: true,
      pagination, filters: req.query, user: req.user || null,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(500).json({ status: 'error', message: error.message });
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function showAddPolicyForm(req, res) {
  try {
    const organizations = await dataService.getAccessibleOrganizations(req.user);
    const scopes = await dataService.fetchData('scopes', {}, req.user);

    res.render('accessPolicy/policyForm', {
      title: 'Add Access Policy', includeModal: true, policy: null,
      organizations, 
      scopes,
      user: req.user || null,
      actionStateId: req.actionStateId
    });
  } catch (error) { res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null }); }
}

async function addPolicy(req, res) {
  try {
    const reqUserId = req.user?.id || "1";
    
    const existingPolicies = await dataService.fetchData('accessPolicies', { userId: req.body.userId }, req.user);
    const targetOrgId = (req.body.orgId || '').trim() || null;
    const duplicate = existingPolicies.find(p => idsEqual(p.orgId || '', targetOrgId || ''));

    if (duplicate) {
        throw new Error('A policy already exists for this user in the selected scope.');
    }

    const targetUser = await dataService.getDataById('users', req.body.userId, req.user);
    if (!targetUser) throw new Error('Selected User does not exist.');
    
    const policy = buildPolicyFromBody(req.body, reqUserId);
    await dataService.addData('accessPolicies', policy, req.user);
    
    if (req.headers['x-ajax-request']) return res.json({ status: 'success', message: 'Policy created successfully.' });
    res.redirect('/accessPolicies');

  } catch (error) {
    const message = getAccessPolicySaveErrorMessage(error);
    // ✅ FIX: Use 400 (Bad Request) so ActionState Middleware sees it as a retryable error.
    // If we send 500, the middleware assumes a fatal crash and invalidates the token.
    if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message });
    res.status(400).render('error', { title: 'Error', message, user: req.user || null });
  }
}

async function showEditPolicyForm(req, res) {
  try {
    const policy = await dataService.getDataById('accessPolicies', req.params.id, req.user);
    if (!policy) return res.status(404).render('404', { title: 'Not Found', user: req.user || null });
    
    const user = await dataService.getDataById('users', policy.userId, req.user);
    const targetUserName = user ? `${user.username || user.email} (${user.id})` : policy.userId;
    
    const organizations = await dataService.getAccessibleOrganizations(req.user);
    const scopes = await dataService.fetchData('scopes', {}, req.user);

    res.render('accessPolicy/policyForm', {
      title: 'Edit Access Policy', 
      includeModal: true, 
      policy,
      targetUserName,
      organizations,
      scopes,
      user: req.user || null,
      actionStateId: req.actionStateId
    });
  } catch (error) { res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null }); }
}

async function editPolicy(req, res) {
  try {
    const existing = await dataService.getDataById('accessPolicies', req.params.id, req.user);
    if (!existing) throw new Error('Policy not found');
    const reqUserId = req.user?.id || "1";

    const incomingUserId = String(req.body?.userId || '').trim();
    const incomingOrgId = normalizeOrgScopeToken(req.body?.orgId);
    const existingUserId = String(existing?.userId || '').trim();
    const existingOrgId = normalizeOrgScopeToken(existing?.orgId);
    if (incomingUserId && incomingUserId !== existingUserId) {
      throw new Error('User cannot be changed when editing an existing policy.');
    }
    if (incomingOrgId !== existingOrgId) {
      throw new Error('Organization scope cannot be changed when editing an existing policy.');
    }

    const updates = buildPolicyFromBody(req.body, reqUserId, existing);
    await dataService.updateData('accessPolicies', req.params.id, updates, req.user);
    
    if (req.headers['x-ajax-request']) return res.json({ status: 'success', message: 'Policy updated successfully.' });
    res.redirect('/accessPolicies');
  } catch (error) {
    const message = getAccessPolicySaveErrorMessage(error);
    // ✅ FIX: Use 400 (Bad Request) here too.
    if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message });
    res.status(400).render('error', { title: 'Error', message, user: req.user || null });
  }
}

async function deletePolicy(req, res) {
  try {
    await dataService.deleteData('accessPolicies', req.params.id, req.user);
    if (req.headers['x-ajax-request']) return res.json({ status: 'success', message: 'Policy deleted successfully.' });
    res.redirect('/accessPolicies');
  } catch (error) {
    // Delete is usually terminal, but we can stick to 400 to be safe if it's a logic error.
    if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

module.exports = {
  listPolicies,
  showAddPolicyForm,
  addPolicy,
  showEditPolicyForm,
  editPolicy,
  deletePolicy,
  checkUserPolicy,
  showAccessChecker,
  performAccessCheck
};
