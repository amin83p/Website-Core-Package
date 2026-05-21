// MVC/controllers/accessController.js
const dataService = require('../services/dataService');
const { buildDataServiceQuery } = require('../utils/generalTools');
const { SEARCH_DEFAULT_KEYWORD } = require('../../config/constants');
const { checkAdminVerificationCode } = require('../utils/encyptors');
const {isSuperAdmin, isAdmin}= require('../services/adminChekersService');
// NOTE: Categories must come from the server layer (model/service), not the view.
const ACCESS_LIST_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'name', 'description', 'orgId', 'active', 'fullAdmin'],
  allowedSearchFields: ['id', 'name', 'description', 'orgId', 'adminCategories'],
  defaultSearchFields: ['id', 'name', 'description', 'orgId', 'adminCategories'],
  allowMetaKeys: true
});

async function buildAccessFromBody(body, reqUser, existing = null, req = null) {
  const now = new Date().toISOString();
  const reqUserId = reqUser ? reqUser.id : 'system';

  let rawName = (body.name || '').trim().toUpperCase().replace(/\s+/g, '_');

  let targetOrgId = null;
  const isSuper = isSuperAdmin(reqUser);
  
  if (isSuper) {
    targetOrgId = (body.orgId && body.orgId !== '') ? Number(body.orgId) : null; 
  } else {
    targetOrgId = Number(reqUser.primaryOrgId || reqUser.activeOrgId); 
    if (!targetOrgId) throw new Error("Cannot create Access Profile: No active organization context.");
  }

  let sections = [];
  let requiresAdminVerification = false;

  try {
    sections = JSON.parse(body.sections || '[]');
    if (Array.isArray(sections)) {
      sections = sections.map(sec => {
        const isAdminAccess = sec.adminAccess === true;
        if (isAdminAccess) requiresAdminVerification = true;

        const ops = isAdminAccess ? [] : (Array.isArray(sec.operations) ? sec.operations.map(op => ({
          operationId: op.operationId,
          scopeId: op.scopeId,
          maxAttemptsPerSession: (op.maxAttemptsPerSession !== '' && op.maxAttemptsPerSession !== null) ? parseInt(op.maxAttemptsPerSession, 10) : null,
          maxSessionDurationMinutes: (op.maxSessionDurationMinutes !== '' && op.maxSessionDurationMinutes !== null) ? parseInt(op.maxSessionDurationMinutes, 10) : null,
          maxFetchUploadVolumeKB: (op.maxFetchUploadVolumeKB !== '' && op.maxFetchUploadVolumeKB !== null) ? parseInt(op.maxFetchUploadVolumeKB, 10) : null
        })) : []);

        return {
          sectionId: sec.sectionId,
          adminAccess: isAdminAccess,
          operations: ops
        };
      });
    }
  } catch (e) { sections = []; }

  const isFullAdmin = body.fullAdmin === 'true' || body.fullAdmin === true;
  
  let adminCategories = [];
  if (body.adminCategories) {
      if (Array.isArray(body.adminCategories)) {
          adminCategories = body.adminCategories;
      } else {
          adminCategories = [body.adminCategories];
      }
  }

  // ✅ Normalize + validate categories server-side.
  
  const allowedCats = Array.isArray(await dataService.getSectionCategories()) ? await dataService.getSectionCategories() : [];
  adminCategories = [...new Set(
    (adminCategories || [])
      .map(c => (c || '').toString().trim().toUpperCase())
      .filter(c => c && allowedCats.includes(c))
  )];

  if (isFullAdmin || adminCategories.length > 0) requiresAdminVerification = true;

  let isActive = body.active === 'true' || body.active === true;
  let startDate = body.startDate || null;
  let endDate = body.endDate || null;

  if (isFullAdmin) {
      isActive = true;  
      startDate = null; 
      endDate = null;   
  }

  if (requiresAdminVerification && req) {
      if (!checkAdminVerificationCode(req)) {
          throw new Error("Security Violation: High Privilege Access requested without valid Admin Verification.");
      }
  }

  return {
    name: rawName,
    orgId: targetOrgId, 
    description: (body.description || '').trim(),
    active: isActive,
    fullAdmin: isFullAdmin,
    adminCategories: adminCategories, 
    validity: { startDate, endDate },
    sections: sections, 
    audit: {
      createUser: existing?.audit?.createUser ?? reqUserId,
      createDateTime: existing?.audit?.createDateTime ?? now,
      lastUpdateUser: reqUserId,
      lastUpdateDateTime: now,
    }
  };
}

async function listAccesses(req, res) {
    try {
        const query = await buildDataServiceQuery(req.query, ACCESS_LIST_QUERY_OPTIONS);
        const page = Number.parseInt(req.query?.page, 10) || Number.parseInt(query?.page, 10) || 1;
        const limit = Number.parseInt(req.query?.limit, 10) || Number.parseInt(query?.limit, 10) || undefined;
    
        const pagedAccesses = await dataService.fetchDataPaged('accesses', {
          ...query,
          page,
          limit
        }, req.user);
        var data = Array.isArray(pagedAccesses?.rows) ? pagedAccesses.rows : [];
        const pagination = pagedAccesses?.pagination || null;
    
        if (req.headers['x-ajax-request']) {
          if(String(req.query?.q || '').trim() === SEARCH_DEFAULT_KEYWORD) data = await dataService.getAccessibleAccesses(req.user);
          return res.json({ status: 'success', results: data, pagination });
        }
    
        res.render('access/accesses', {
          title: 'Default Access Definitions',
          tableName: 'Accesses_Management',
          newLabel: 'Define Access',
          newUrl: 'accesses',
          includeModal: true,
          includeModal_Table: true,
          includeModal_FileImport: true,
          print: true,
          accesses: data,
          pagination,
          searchableFields: ACCESS_LIST_QUERY_OPTIONS.defaultSearchFields,
          filters: req.query,
          user: req.user || null,
          actionStateId: req.actionStateId
        });
      } catch (error) {
        if (req.headers['x-ajax-request']) {
          return res.status(500).json({ status: 'error', error, message: error.message });
        }
        res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
      }
}

async function showAddAccessForm(req, res) {
    try {
        const allSections = await dataService.getAccessibleSections(req.user);
        const allOps = await dataService.getAccessibleOperations(req.user);
        const allScopes = await dataService.getAccessibleScopes(req.user);
        const sectionCategories = await dataService.getSectionCategories();
        const allOrgs = (isAdmin(req.user)) 
                        ? await dataService.getAccessibleOrganizations(req.user) 
                        : [];
    
        res.render('access/accessForm', {
          title: 'Define Access Level',
          includeModal: true,
          accessItem: null,
          sections: allSections,
          operations: allOps,
          scopes: allScopes,
          organizations: allOrgs,
          validCategories: sectionCategories,
          user: req.user || null,
          actionStateId: req.actionStateId
        });
      } catch (error) {
        res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
      }
}

async function addAccess(req, res) {
    try {
        const item = await buildAccessFromBody(req.body, req.user, null, req);
        const result = await dataService.addData('accesses', item, req.user);
        
        if (req.headers['x-ajax-request']) {
          return res.json({ status: 'success', result, message: 'Access Definition saved.' });
        }
        res.redirect('/accesses');
      } catch (error) {
        // ✅ FIX: Use 400 for logic errors so ActionState retries. 403 stays for Security.
        const status = error.message.includes("Security Violation") ? 403 : 400;
        
        if (req.headers['x-ajax-request']) {
          return res.status(status).json({ 
              status: status === 403 ? 'admin_required' : 'error', 
              error, 
              message: error.message 
          });
        }
        res.status(status).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
      }
}

async function showEditAccessForm(req, res) {
    try {
        const accessItem = await dataService.getDataById('accesses', req.params.id, req.user);
        if (!accessItem) throw new Error('Access Definition not found');
    
        const allSections = await dataService.getAccessibleSections(req.user);
        const allOps = await dataService.getAccessibleOperations(req.user);
        const allScopes = await dataService.getAccessibleScopes(req.user);
        const sectionCategories = await dataService.getSectionCategories();
        const allOrgs = (isAdmin(req.user)) 
                        ? await dataService.getAccessibleOrganizations(req.user) 
                        : [];
    
        res.render('access/accessForm', {
          title: 'Edit Access Level',
          includeModal: true,
          accessItem,
          sections: allSections,
          operations: allOps,
          scopes: allScopes,
          organizations: allOrgs,
          validCategories: sectionCategories,
          user: req.user || null,
          actionStateId: req.actionStateId
        });
      } catch (error) {
        res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
      }
}

async function editAccess(req, res) {
    try {
        const existing = await dataService.getDataById('accesses', req.params.id, req.user);
        if (!existing) throw new Error('Not found');
        const updates = await buildAccessFromBody(req.body, req.user, existing, req);
    
        const result = await dataService.updateData('accesses', req.params.id, updates, req.user);
        
        if (req.headers['x-ajax-request']) {
          return res.json({ status: 'success', result, message: 'Access Definition updated.' });
        }
        res.redirect('/accesses');
      } catch (error) {
        // ✅ FIX: Use 400 for logic errors so ActionState retries.
        const status = error.message.includes("Security Violation") ? 403 : 400;
        
        if (req.headers['x-ajax-request']) {
          return res.status(status).json({ 
              status: status === 403 ? 'admin_required' : 'error',
              error, 
              message: error.message 
          });
        }
        res.status(status).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
      }
}

async function deleteAccess(req, res) {
    try {
        const existing = await dataService.getDataById('accesses', req.params.id, req.user);
        if (!existing) throw new Error('Access Definition not found');
    
        const results = await dataService.deleteData('accesses', req.params.id);
        if (req.headers['x-ajax-request']) {
          return res.json({ status: 'success', results, message: 'Access Definition Deleted successfully.' });
        }
        res.redirect('/accesses');
      } catch (error) {
        // Delete failure is usually consistent (e.g., ID not found), so 500 or 400 is fine. 
        // We'll stick to 400 to be safe.
        if (req.headers['x-ajax-request']) {
          return res.status(400).json({ status: 'error', error, message: error.message });
        }
        res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
      }
}

module.exports = {
  listAccesses, showAddAccessForm, addAccess, showEditAccessForm, editAccess, deleteAccess
};
