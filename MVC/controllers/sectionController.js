// MVC/controllers/sectionController.js
const dataService = require('../services/dataService');
const { buildDataServiceQuery, inferSearchableFields, isAjax } = require('../utils/generalTools');
const settingService = require('../services/settingService');
const dashboardController = require('./dashboardController');

/* ---------------- HELPERS ---------------- */

function parseBool(v) {
  if (typeof v === 'boolean') return v;
  return String(v || '').toLowerCase().trim() === 'true';
}

function parseJsonSafe(jsonString) {
  if (!jsonString) return [];
  try {
    const data = JSON.parse(jsonString);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// Check if operations exist in the master operation list
async function validateOperationsExistence(operations, user) {
  const operationsList = await dataService.getAccessibleOperations(user.id);
  for (const opt of operations) {
    if (!operationsList.find(thisObj => thisObj.id === opt.id)) {
      throw new Error(`Operation ID '${opt.id}' is invalid or does not exist in system operations.`);
    }
  }
}

function buildSectionFromBody(body, reqUserId, existing = null) {
  const now = new Date().toISOString();

  const navigatorSection = parseBool(body.navigatorSection);
  const operations = navigatorSection ? [] : parseJsonSafe(body.selectedOperations);
  const subsections = parseJsonSafe(body.subsections);
  const related = parseJsonSafe(body.related);

  const section = {
    name: (body.name || '').trim(),
    category: (body.category || 'GENERAL').trim(),
    description: (body.description || '').trim(),
    homeURL: (body.homeURL || '').trim(),
    message: (body.message || '').trim(),
    inactiveMessage: (body.inactiveMessage || '').trim(),
    
    active: parseBool(body.active),
    mainDashboardDisplay: parseBool(body.mainDashboardDisplay),
    dashboardDisplay: parseBool(body.dashboardDisplay),
    trackState: navigatorSection ? false : (body.trackState !== undefined ? parseBool(body.trackState) : (existing ? existing.trackState : true)),
    minimumAccessRequirement: parseInt(body.minimumAccessRequirement, 10),
    navigatorSection,

    subsections,
    related,
    operations,

    audit: {
      createUser: existing?.audit?.createUser ?? reqUserId,
      createDateTime: existing?.audit?.createDateTime ?? now,
      lastUpdateUser: reqUserId,
      lastUpdateDateTime: now,
    },
  };

  return section;
}
/* ---------------- CONTROLLERS ---------------- */

async function listSections(req, res) {
  try {
    let query = await buildDataServiceQuery(req.query, {
      defaultSearchFields: ['name', 'id', 'description', 'category'],
      allowedExactKeys: ['id', 'category', 'active', 'dashboardDisplay', 'mainDashboardDisplay', 'navigatorSection']
    });
    const searchDefaultKeyword = settingService.getValue('app', 'searchDefaultKeyword') || 'aaa';
    if (query.q === searchDefaultKeyword) query.q = '';
    if (String(query.q || '').toLowerCase() === '---') query.q = '';

    const pagedSections = await dataService.fetchDataPaged('sections', query, req.user);
    const sections = Array.isArray(pagedSections?.rows) ? pagedSections.rows : [];
    const operations = await dataService.getAccessibleOperations();
    const searchableFields = await inferSearchableFields(sections, {
      exclude: ['audit', 'operations', 'subsections', 'related']
    });
    
    // Enrich sections with operation names
    sections.forEach(section => {
      section.operations = (section.operations || []).map(op => ({
        ...op,
        name: operations.find(o => o.id === op.id)?.name || 'Unknown'
      }));
    });
    const data = sections;
    const pagination = pagedSections?.pagination || null;

    // Handle AJAX Request (picker)
    if (isAjax(req)) {
      return res.json({ status: 'success', results: data, pagination, searchableFields });
    }

    res.render('section/sections', {
      title: 'Section Management',
      tableName: 'Section_Management',
      data,
      searchableFields,
      newUrl: 'sections',
      newLabel: 'Add Settings',
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: true,
      print: true,
      pagination,
      filters: req.query, 
      user: req.user || null,
      actionStateId: req.actionStateId
    });

  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(500).json({ status: 'error', error, message: error.message }); 
    }
    res.status(500).render('error', { 
      title: 'Error', 
      error,
      message: error.message, 
      user: req.user || null 
    });
  }
}

async function getQuickMenu(req, res) {
  return dashboardController.getQuickMenu(req, res);
}

async function getStartMenu(req, res) {
  return dashboardController.getStartMenu(req, res);
}

async function showAddSectionForm(req, res) {
  try {
    const [sections, operations, sectionCategories] = await Promise.all([
      dataService.getAccessibleSections(req.user),
      dataService.getAccessibleOperations(req.user),
      dataService.getSectionCategories()
    ]);
    res.render('section/sectionForm', {
      title: 'Add Section',
      includeModal: true,
      section: null,
      operations,
      sections,
      sectionCategories,
      user: req.user || null,
      // ✅ Pass Tracking ID to View
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

async function addSection(req, res) {
  try {
    const section = buildSectionFromBody(req.body, req.user.id);

    await validateOperationsExistence(section.operations, req.user);

    const results = await dataService.addData('sections',section, req.user);

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success',results, message: 'Section saved successfully.' });
    }
    res.redirect('/sections');
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      // ✅ FIX: Use 400 (Bad Request)
      return res.status(400).json({ status: 'error', error, message: error.message }); 
    }
    res.status(500).render('error', { 
      title: 'Error', 
      error,
      message: error.message, 
      user: req.user || null 
    });
  }
}

async function showEditSectionForm(req, res) {
  try {
    const section = await dataService.getDataById('sections', req.params.id, req.user);
    if (!section) {
      return res.status(404).render('404', {
        title: 'Not Found',
        user: req.user || null
      });
    }

    const [operations, sections, sectionCategories] = await Promise.all([
      dataService.getAccessibleOperations(req.user),
      dataService.getAccessibleSections(req.user),
      dataService.getSectionCategories()
    ]);

    res.render('section/sectionForm', {
      title: 'Edit Section',
      includeModal: true,
      section,
      operations,
      sections,
      sectionCategories,
      user: req.user || null,
      // ✅ Pass Tracking ID to View (Even for Edit)
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

async function editSection(req, res) {
  try {
    const existing = await dataService.getDataById('sections', req.params.id, req.user);
    if (!existing) throw new Error('Section not found');

    const reqUserId = req.user?.id || null;
    const updates = buildSectionFromBody(req.body, reqUserId, existing);

    await validateOperationsExistence(updates.operations, req.user);

    const results = await dataService.updateData('sections',req.params.id, updates, req.user);

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', message: 'Section saved successfully.', results });
    }
    res.redirect('/sections');
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      // ✅ FIX: Use 400 (Bad Request)
      return res.status(400).json({ status: 'error', error, message: error.message }); 
    }
    res.status(500).render('error', { 
      title: 'Error', 
      error,
      message: error.message, 
      user: req.user || null 
    });
  }
}

async function getSectionTemplate(req, res) {
  try {
    const [section, operations, allSections] = await Promise.all([
      dataService.getDataById('sections', req.params.id, req.user),
      dataService.getAccessibleOperations(req.user),
      dataService.getAccessibleSections(req.user)
    ]);
    if (!section) {
      return res.status(404).json({ status: 'error', message: 'Section not found.' });
    }
    const sectionMap = new Map((allSections || []).map(s => [String(s.id || ''), s]));
    const enrichRef = (ref) => {
      const id = ref?.id || ref;
      const full = sectionMap.get(String(id));
      return full ? { id: full.id, name: full.name } : { id };
    };
    const template = {
      ...section,
      operations: (section.operations || []).map(op => ({
        ...op,
        name: operations.find(o => o.id === op.id)?.name || op.name || op.id
      })),
      subsections: (section.subsections || []).map(enrichRef),
      related: (section.related || []).map(enrichRef)
    };
    res.json({ status: 'success', template });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message || 'Failed to load section template.' });
  }
}

async function deleteSection(req, res) {
  try {
    const results = await dataService.deleteData('sections',req.params.id, req.user);
    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', message: 'Section deleted successfully.', results });
    } 
    res.redirect('/sections');
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(500).json({ status: 'error', error, message: error.message }); 
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
    listSections, 
    showAddSectionForm, 
    addSection, 
    showEditSectionForm, 
    editSection, 
    deleteSection,
    getQuickMenu,
    getStartMenu,
    getSectionTemplate
};
