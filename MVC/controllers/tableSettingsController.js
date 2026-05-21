// MVC/controllers/tableSettingsController.js
const dataService = require('../services/dataService');
const { buildDataServiceQuery } = require('../utils/generalTools');
const TABLE_SETTINGS_LIST_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['userId', 'tableId', 'id'],
  allowedSearchFields: ['userId', 'tableId', 'id'],
  defaultSearchFields: ['userId', 'tableId', 'id'],
  allowMetaKeys: true
});

/* ============================================================
   VIEW: List all table settings
============================================================ */
async function listAll(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, TABLE_SETTINGS_LIST_QUERY_OPTIONS);
    const page = Number.parseInt(req.query?.page, 10) || Number.parseInt(query?.page, 10) || 1;
    const limit = Number.parseInt(req.query?.limit, 10) || Number.parseInt(query?.limit, 10) || undefined;
    
    const paged = await dataService.fetchDataPaged('tableSettings', {
      ...query,
      page,
      limit
    }, req.user);
    const data = Array.isArray(paged?.rows) ? paged.rows : [];
    const pagination = paged?.pagination || null;

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', data, pagination });
    }

    res.render('tableSettings/tableSettings', { 
      title: 'Table Settings Management',
      tableName: 'Table_Settings_Management',
      newUrl: 'tablesettings',
      newLabel: 'Add Settings',
      data,
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: true,
      print: true,
      pagination,
      searchableFields: TABLE_SETTINGS_LIST_QUERY_OPTIONS.defaultSearchFields,
      filters: req.query, 
      user: req.user || null
    });
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(500).json({ status: 'error', message: error.message });
    }
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

/* ============================================================
   VIEW: List settings belonging to a specific user
============================================================ */
async function listUserAll(req, res) {
  try {
    const { userId } = req.params;
    
    const records = await dataService.fetchData('tableSettings', { 
        q: userId, 
        type: 'exact_match', 
        searchFields: 'userId' 
    }, req.user);
    
    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', userId, records });
    }
    res.render('tablesettings/tableSettings', { 
      title: 'Table Settings Management',
      tableName: 'Table_Settings_Management',
      pageScript: 'pages/tableSettings/tableSettings.js',
      newUrl: '/tablesettings/new',
      newLabel: 'Add Settings',
      includeModal: true,
      includeModal_Table: true,
      print: true,
      records,
      userId,
      user: req.user || null
    });
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(500).json({ status: 'error', message: error.message });
    }
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

/* ============================================================
   VIEW: Get a specific item
============================================================ */
async function getItem(req, res) {
  try {
    const { userId, tableId } = req.params;
    const record = await dataService.getDataById('tableSettings', { userId, tableId }, req.user);
    
    if (req.headers['x-ajax-request']) {
      if (!record) return res.status(404).json({ status: 'error', message: 'Settings not found.' });
      return res.status(200).json({ status: 'success', data: record });
    }
    res.render('tableSettings/tableSettingsForm', { userId, tableId, record, user: req.user || null });
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(500).json({ status: 'error', message: error.message });
    }
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

/* ============================================================
   CREATE: Show add form
============================================================ */
async function showAddForm(req, res) {
  try{
    const { userId, tableId } = req.params;
    res.render('tableSettings/form', { 
      title: 'Add Section',
      mode: 'new', 
      record: null,
      tableId, 
      userId,
      pageCss: 'pages/tableSettings/form.css',
      pageScript: 'pages/tableSettings/form.js',
      includeModal: true,
      user: req.user || null,
      // ✅ PASS TRACKING ID
      actionStateId: req.actionStateId
    });
  } catch (error){
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

/* ============================================================
   CREATE: Save new settings
============================================================ */
async function addItem(req, res) {
  try {
    const { userId, tableId } = req.params;
    
    const payload = { 
      userId, 
      tableId, 
      settings: req.body 
    };

    await dataService.addData('tableSettings', payload, req.user);
    
    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', message: 'Settings saved successfully.' });
    }
    res.redirect(`/tableSettings/`);
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      // ✅ FIX: Use 400
      return res.status(400).json({ status: 'error', message: error.message });
    }
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

/* ============================================================
   UPDATE: Show edit form
============================================================ */
async function showEditForm(req, res) {
  try {
    const { userId, tableId } = req.params;
    const record = await dataService.getDataById('tableSettings', { userId, tableId }, req.user);

    if (!record) {
      return res.status(404).render('404', { title: 'Not Found', user: req.user || null });
    }

    res.render('tableSettings/form', { 
      title: 'Edit User\'s Table Settings',
      mode: 'edit', 
      record,
      tableId, 
      userId,
      pageCss: 'pages/tableSettings/form.css',
      pageScript: 'pages/tableSettings/form.js',
      includeModal: true,
      user: req.user || null,
      // ✅ PASS TRACKING ID
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

/* ============================================================
   UPDATE: Save edited record
============================================================ */
async function editItem(req, res) {
  try {
    const { userId, tableId } = req.params;

    const payload = {
      userId, 
      tableId, 
      settings: req.body
    };

    await dataService.updateData('tableSettings', null, payload, req.user);
    
    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', message: 'Settings updated successfully.' });
    }
    res.redirect(`/tableSettings/`);
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      // ✅ FIX: Use 400
      return res.status(400).json({ status: 'error', message: error.message });
    }
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

/* ============================================================
   DELETE
============================================================ */
async function deleteItem(req, res) {
  try {
    const { userId, tableId } = req.params;
    await dataService.deleteData('tableSettings', { userId, tableId }, req.user);
    
    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', message: 'Selected Settings deleted successfully.' });
    }
    res.redirect(req.headers.referer || `/tableSettings/`);
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(500).json({ status: 'error', message: error.message });
    }
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function deleteUser(req, res) {
  try {
    const { userId } = req.params;
    const userRecords = await dataService.fetchData('tableSettings', { q: userId, type: 'exact_match', searchFields: 'userId' }, req.user);
    
    for (const rec of userRecords) {
        await dataService.deleteData('tableSettings', { userId: rec.userId, tableId: rec.tableId }, req.user);
    }

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', message: 'Users\' Settings deleted successfully.' });
    }
    res.redirect(`/tableSettings/`);
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(500).json({ status: 'error', message: error.message });
    }
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function deleteAll(req, res) {
  try {
    const allRecords = await dataService.fetchData('tableSettings', {}, req.user);
    
    for (const rec of allRecords) {
        await dataService.deleteData('tableSettings', { userId: rec.userId, tableId: rec.tableId }, req.user);
    }
    
    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', message: 'All Settings deleted successfully.' });
    }
    res.redirect(`/tableSettings/`);
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(500).json({ status: 'error', message: error.message });
    }
    res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

module.exports = {
  listAll,
  listUserAll,
  getItem,
  showAddForm,
  addItem,
  showEditForm,
  editItem,
  deleteItem,
  deleteUser,
  deleteAll
};
