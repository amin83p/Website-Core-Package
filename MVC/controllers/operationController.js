// MVC/controllers/operationController.js
const dataService = require('../services/dataService');
const { buildDataServiceQuery } = require('../utils/generalTools');
const OPERATION_LIST_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'name', 'active', 'system', 'trackState', 'keepActive'],
  allowedSearchFields: ['id', 'name', 'active', 'system', 'trackState', 'keepActive'],
  defaultSearchFields: ['id', 'name', 'active', 'system', 'trackState', 'keepActive'],
  allowMetaKeys: true
});

/* ---------------- HELPERS ---------------- */

function parseBool(v) {
  if (typeof v === 'boolean') return v;
  return String(v || '').toLowerCase().trim() === 'true';
}

function buildOperationFromBody(body, reqUserId, existing = null) {
  const now = new Date().toISOString();

  const operation = {
    name: (body.name || '').trim(),
    active: parseBool(body.active),
    trackState: parseBool(body.trackState),
    keepActive: parseBool(body.keepActive),

    system: existing ? existing.system : false, 
    audit: {
      createUser: existing?.audit?.createUser ?? reqUserId,
      createDateTime: existing?.audit?.createDateTime ?? now,
      lastUpdateUser: reqUserId,
      lastUpdateDateTime: now,
    }
  };

  return operation;
}

/* ---------------- CONTROLLERS ---------------- */

async function listOperations(req, res) {
  try{
    const query = await buildDataServiceQuery(req.query, OPERATION_LIST_QUERY_OPTIONS);
    const page = Number.parseInt(req.query?.page, 10) || Number.parseInt(query?.page, 10) || 1;
    const limit = Number.parseInt(req.query?.limit, 10) || Number.parseInt(query?.limit, 10) || undefined;

    const paged = await dataService.fetchDataPaged('operations', {
      ...query,
      page,
      limit
    }, req.user);
    const data = Array.isArray(paged?.rows) ? paged.rows : [];
    const pagination = paged?.pagination || null;
    
    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', results: data, pagination });
    }

    res.render('operation/operations', {
      title: 'Operation Management',
      tableName: 'Operations_Management',
      newLabel: 'Add Settings',
      newUrl: 'operations',
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: true,
      print: true,
      operations: data, 
      pagination,
      searchableFields: OPERATION_LIST_QUERY_OPTIONS.defaultSearchFields,
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

async function showAddOperationForm(req, res) {
  try {
    res.render('operation/operationForm', {
      title: 'Add Operation',
      pageCss: 'pages/operation/operations.css',
      pageScript: 'pages/operation/operationForm.js',
      includeModal: true,
      operation: null,
      user: req.user || null,
      // ✅ PASS TRACKING ID
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function addOperation(req, res) {
  try {
    const reqUserId = req.user ? req.user.id : "1";
    const operation = buildOperationFromBody(req.body, reqUserId);

    const result = await dataService.addData('operations', operation, req.user);
    
    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', result, message: 'Operation saved successfully.' });
    }
    res.redirect('/operations');
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      // ✅ FIX: Use 400 for logic error (e.g. duplicate name)
      return res.status(400).json({ status: 'error', error, message: error.message });
    }
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function showEditOperationForm(req, res) {
  try {
    const operation = await dataService.getDataById('operations', req.params.id, req.user);  
    if(!operation) throw new Error('Operation not found!');
    if (operation.system) throw new Error("System operations cannot be modified.");

    res.render('operation/operationForm', {
      title: 'Edit Operation',
      pageScript: 'pages/operation/operationForm.js',
      includeModal: true,
      operation,
      user: req.user || null,
      // ✅ PASS TRACKING ID
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function editOperation(req, res) {
  try {
    const existing = await dataService.getDataById('operations', req.params.id, req.user);
    if (!existing) throw new Error('Operation not found!');

    const reqUserId = req.user ? req.user.id : "1";
    const updates = buildOperationFromBody(req.body, reqUserId, existing);

    const result = await dataService.updateData('operations', req.params.id, updates, req.user);
    
    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', result, message: 'Operation saved successfully.' });
    }
    res.redirect('/operations');
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      // ✅ FIX: Use 400 for logic error
      return res.status(400).json({ status: 'error', error, message: error.message });
    }
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

async function deleteOperation(req, res) {
  try {
    const result = await dataService.deleteData('operations',req.params.id);
    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', result, message: 'Operation deleted successfully.' });
    }
    res.redirect('/operations');
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(500).json({ status: 'error', error, message: error.message });
    }
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user || null });
  }
}

module.exports = { 
  listOperations, 
  showAddOperationForm, 
  addOperation, 
  showEditOperationForm, 
  editOperation, 
  deleteOperation 
};
