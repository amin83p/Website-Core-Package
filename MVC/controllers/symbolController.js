// MVC/controllers/symbolController.js
const dataService = require('../services/dataService');const { idsEqual } = require('../utils/idAdapter');
const { buildDataServiceQuery } = require('../utils/generalTools');

const uploadMiddleware = require('../middleware/upload');
const SYMBOL_LIST_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'name', 'type', 'orgId', 'value'],
  allowedSearchFields: ['id', 'name', 'tags', 'value', 'orgId', 'type'],
  defaultSearchFields: ['id', 'name', 'tags', 'value', 'orgId', 'type'],
  allowMetaKeys: true
});

function buildSymbolFromBody(body, reqUserId, existing = null) {
    const now = new Date().toISOString();
    
    // --- 1. TAG NORMALIZATION LOGIC ---
    let tags = [];
    if (Array.isArray(body.tags)) {
        tags = body.tags;
    } else if (typeof body.tags === 'string') {
        // Split by comma if it's a raw string from a basic input
        tags = body.tags.split(',');
    }

    // Clean: Trim, Uppercase, Filter Empty
    tags = tags.map(t => t.trim().toUpperCase()).filter(Boolean);
    
    // Deduplicate: Remove 'similar' labels (e.g. 'ADMIN' and 'ADMIN')
    tags = [...new Set(tags)]; 

    return {
        name: (body.name || '').trim().toUpperCase(),
        type: body.type, 
        value: (body.value || '').trim(),
        tags: tags, // ✅ Saved as clean, unique list
        
        audit: {
            createUser: existing?.audit?.createUser ?? reqUserId,
            createDateTime: existing?.audit?.createDateTime ?? now,
            lastUpdateUser: reqUserId,
            lastUpdateDateTime: now,
        }
    };
}

/* ---------------- CONTROLLERS ---------------- */

async function listSymbols(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, SYMBOL_LIST_QUERY_OPTIONS);
    const page = Number.parseInt(req.query?.page, 10) || Number.parseInt(query?.page, 10) || 1;
    const limit = Number.parseInt(req.query?.limit, 10) || Number.parseInt(query?.limit, 10) || undefined;

    const pagedResult = await dataService.fetchDataPaged('symbols', {
      ...query,
      page,
      limit
    }, req.user);
    const data = Array.isArray(pagedResult?.rows) ? pagedResult.rows : [];
    const pagination = pagedResult?.pagination || null;

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', results: data, pagination });
    }

    res.render('symbol/list', {
      title: 'Symbol Registry',
      tableName: 'Symbol_Management',
      newLabel: 'Add Symbol',
      newUrl: 'symbols',
      data: data,
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: true,
      print: true,
      pagination,
      searchableFields: SYMBOL_LIST_QUERY_OPTIONS.defaultSearchFields,
      filters: req.query, 
      user: req.user || null,
      actionStateId: req.actionStateId
    });

  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(500).json({ status: 'error', message: error.message });
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function showAddSymbolForm(req, res) {
  try {
    res.render('symbol/form', {
      title: 'Add Symbol',
      includeModal: true,
      symbol: null,
      user: req.user || null,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function addSymbol(req, res) {
  try {
    const reqUserId = req.user ? req.user.id : "1";    
    // ✅ NEW: Get Active Org ID
    const activeOrgId = req.user.activeOrgId;
    if (!activeOrgId) {
        throw new Error("<b>Security Violation</b><br>No active organization context found.");
    }
    if(Array.isArray(req.body.value)){
      console.log(req.body.value);
      throw new Error("<b>Multiple Symbole Types</b><br>Only provide a single type for for the symbol.");
    }

    let value = req.body.value;
    if (req.file){
      value = uploadMiddleware.getStoredFileUrl(req.file) || uploadMiddleware.getStoredFilePath(req.file);
    }
    const payload = { ...req.body, value, orgId: activeOrgId };


    // Build and Clean tags
    const symbol = buildSymbolFromBody(payload, reqUserId);
    // Explicitly attach the orgId again (ensure build helper didn't drop it)
    symbol.orgId = activeOrgId; 

    const result = await dataService.addData('symbols', symbol, req.user);

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', result, message: 'Symbol created successfully.' });
    }
    res.redirect('/symbols');
  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message: error.message });
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function editSymbol(req, res) {
  try {
    const existing = await dataService.getDataById('symbols', req.params.id, req.user);
    if (!existing) throw new Error('Symbol not found.');
    
    // ✅ NEW: Security Check (Context Isolation)
    if (!idsEqual(existing.orgId, req.user.activeOrgId)) {
      throw new Error("<b>Security Violation</b><br>You cannot edit symbols from a different organization.");
    }

    if(Array.isArray(req.body.value)){
      console.log(req.body.value);
      throw new Error("<b>Multiple Symbole Types</b><br>Only provide a single type for for the symbol.");
    }
    const reqUserId = req.user ? req.user.id : "1";

    // Handle File Replacement... (Same as before)
    let value = req.body.value;
    if (req.body.type === 'image' && req.file) {
        value = uploadMiddleware.getStoredFileUrl(req.file) || uploadMiddleware.getStoredFilePath(req.file);
    } else if (req.body.type === 'image' && !req.file && existing.type === 'image') {
        value = existing.value; 
    }

    const payload = { ...req.body, value };
    const updates = buildSymbolFromBody(payload, reqUserId, existing);

    // throw new Error('We are fixing some issues.');

    const result = await dataService.updateData('symbols', req.params.id, updates, req.user);

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', result, message: 'Symbol updated successfully.' });
    }
    res.redirect('/symbols');
  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(400).json({ status: 'error', message: error.message });
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function showEditSymbolForm(req, res) {
  try {
    //We should edit this.
    const symbol = await dataService.getDataById('symbols', req.params.id, req.user);
    if (!symbol) throw new Error('Symbol not found.');

    res.render('symbol/form', {
      title: 'Edit Symbol',
      includeModal: true,
      symbol,
      user: req.user || null,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function deleteSymbol(req, res) {
  try {
    const result = await dataService.deleteData('symbols', req.params.id, req.user);
    
    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', result, message: 'Symbol deleted successfully.' });
    }
    res.redirect('/symbols');
  } catch (error) {
    if (req.headers['x-ajax-request']) return res.status(500).json({ status: 'error', message: error.message });
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

module.exports = {
  listSymbols,
  showAddSymbolForm,
  addSymbol,
  showEditSymbolForm,
  editSymbol,
  deleteSymbol
};
