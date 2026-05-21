// MVC/controllers/scopeController.js
const dataService = require('../services/dataService'); 
const { buildDataServiceQuery } = require('../utils/generalTools');
const {
  normalizeScopeDefinition,
  summarizeScopeDefinition,
  getScopeDefinitionOptions
} = require('../utils/scopeDefinitionHelper');
const SCOPE_LIST_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'name', 'description', 'level', 'active'],
  allowedSearchFields: ['id', 'name', 'description', 'level', 'definition.mode'],
  defaultSearchFields: ['id', 'name', 'description', 'level', 'definition.mode'],
  allowMetaKeys: true
});

/* ---------------- HELPERS ---------------- */

function parseBool(v) {
  if (typeof v === 'boolean') return v;
  return String(v || '').toLowerCase().trim() === 'true';
}

function parseJsonObject(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function buildScopeFromBody(body, reqUserId, existing = null) {
  const now = new Date().toISOString();

  // Enforce Naming Convention (Uppercase, underscore for space)
  let rawName = (body.name || '').trim().toUpperCase();
  rawName = rawName.replace(/\s+/g, '_');

  const scope = {
    name: rawName,
    level: parseInt(body.level, 10),
    description: (body.description || '').trim(),
    active: parseBool(body.active),
    definition: normalizeScopeDefinition(parseJsonObject(body.definitionJson), rawName),
    
    audit: {
      createUser: existing?.audit?.createUser ?? reqUserId,
      createDateTime: existing?.audit?.createDateTime ?? now,
      lastUpdateUser: reqUserId,
      lastUpdateDateTime: now,
    }
  };

  // Fallback to 0 if NaN
  if (isNaN(scope.level)) scope.level = 0;

  return scope;
}

/* ---------------- CONTROLLERS ---------------- */

async function listScopes(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, SCOPE_LIST_QUERY_OPTIONS);
    const page = Number.parseInt(req.query?.page, 10) || Number.parseInt(query?.page, 10) || 1;
    const limit = Number.parseInt(req.query?.limit, 10) || Number.parseInt(query?.limit, 10) || undefined;

    const paged = await dataService.fetchDataPaged('scopes', {
      ...query,
      page,
      limit
    }, req.user);
    const pagedRows = Array.isArray(paged?.rows) ? paged.rows : [];
    const enrichedList = pagedRows.map((item) => {
      const definition = normalizeScopeDefinition(item?.definition, item?.name);
      return {
        ...item,
        definition,
        definitionSummary: summarizeScopeDefinition(definition)
      };
    });
    const data = enrichedList;
    const pagination = paged?.pagination || null;

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', result: data, pagination });
    }

    res.render('scope/scopes', {
      title: 'Scope Management',
      tableName: 'Scopes_Management',
      newLabel: 'Add Scope',
      newUrl: 'scopes',
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: true,
      print: true,
      scopes: data, 
      pagination,
      searchableFields: SCOPE_LIST_QUERY_OPTIONS.defaultSearchFields,
      filters: req.query, 
      user: req.user || null
    });
  } catch (error) {   
    if (req.headers['x-ajax-request']) {
      return res.status(500).json({ status: 'error', error, message: error.message });
    }
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }  
}

async function showAddScopeForm(req, res) {
  res.render('scope/scopeForm', {
    title: 'Add Scope',
    includeModal: true,
    scope: null,
    scopeDefinition: normalizeScopeDefinition(null, ''),
    scopeDefinitionOptions: getScopeDefinitionOptions(),
    actionStateId: req.actionStateId,
    user: req.user || null
  });
}

async function addScope(req, res) {
  try {
    const reqUserId = req.user ? req.user.id : "1";
    const scope = buildScopeFromBody(req.body, reqUserId);

    const result = await dataService.addData('scopes', scope, req.user);
    
    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', result, message: 'Scope saved successfully.' });
    }
    res.redirect('/scopes');
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      // ✅ FIX: Use 400 (Bad Request) instead of 500.
      // This tells the middleware "User Input Error" -> Keep Session Active.
      return res.status(400).json({ status: 'error', message: error.message });
    }
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function showEditScopeForm(req, res) {
  try {
    const scope = await dataService.getDataById('scopes', req.params.id, req.user);  
    if(!scope) throw new Error('Scope not found!');
    const scopeDefinition = normalizeScopeDefinition(scope.definition, scope.name);

    res.render('scope/scopeForm', {
      title: 'Edit Scope',
      includeModal: true,
      scope: { ...scope, definition: scopeDefinition },
      scopeDefinition,
      scopeDefinitionOptions: getScopeDefinitionOptions(),
      actionStateId: req.actionStateId,
      user: req.user || null
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function editScope(req, res) {
  try {
    const existing = await dataService.getDataById('scopes', req.params.id, req.user);
    if (!existing) throw new Error('Scope not found!');

    const updates = buildScopeFromBody(req.body, req.user.id, existing);

    const result = await dataService.updateData('scopes', req.params.id, updates, req.user);
    
    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', result, message: 'Scope saved successfully.' });
    }
    res.redirect('/scopes');
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      // ✅ FIX: Use 400 (Bad Request) instead of 500.
      // This keeps the session active so the user can fix the error and retry.
      return res.status(400).json({ status: 'error', error, message: error.message });
    }
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function deleteScope(req, res) {
  try {
    const result = await dataService.deleteData('scopes', req.params.id, req.user);
    
    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', result, message: 'Scope deleted successfully.' });
    }
    res.redirect('/scopes');
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(500).json({ status: 'error', error, message: error.message });
    }
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

module.exports = { 
  listScopes, 
  showAddScopeForm, 
  addScope, 
  showEditScopeForm, 
  editScope, 
  deleteScope 
};
