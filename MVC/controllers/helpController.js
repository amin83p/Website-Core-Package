const helpCenterService = require('../services/helpCenterService');
const dataService = require('../services/dataService');
const helpArticleRepository = require('../repositories/helpArticleRepository');
const personRepository = require('../repositories/personRepository');
const adminAuthorityService = require('../services/adminAuthorityService');

function isAjaxRequest(req) {
  return Boolean(req.headers['x-ajax-request'] || req.xhr || req.headers.accept?.includes('json'));
}

function safeQuery(value) {
  return String(value || '').trim();
}

function parseBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const v = String(value || '').trim().toLowerCase();
  if (!v) return fallback;
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

function normalizeToken(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeArray(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [values])
    .map((x) => String(x || '').trim())
    .filter(Boolean)));
}

function parseCsvList(value) {
  return normalizeArray(String(value || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean));
}

function slugify(value) {
  const raw = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return raw || `help-${Date.now()}`;
}

function generateHelpId() {
  return `HELP_${Date.now().toString(36).toUpperCase()}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function normalizeContentPagePath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^javascript:/i.test(raw)) return '';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function canManageHelp(user) {
  return Boolean(user && user.id);
}

async function fetchAllSections(reqUser) {
  return await dataService.fetchData('sections', { limit: 10000 }, reqUser || null);
}

async function fetchAllOperations(reqUser) {
  return await dataService.fetchData('operations', { limit: 10000 }, reqUser || null);
}

async function resolveViewerAudienceTags(req) {
  const viewer = req?.user || null;
  const base = ['all', 'user'];
  if (!viewer) return base;

  const tags = [];
  const personId = String(viewer.personId || '').trim();
  if (personId) {
    try {
      const personTags = await personRepository.getAudienceTags(personId, {
        enrichment: { includeSchoolRoles: false }
      });
      if (Array.isArray(personTags)) tags.push(...personTags);
    } catch (_) {
      // Ignore audience enrichment failure and continue with base.
    }
  }

  if (adminAuthorityService.isAdmin(viewer)) {
    tags.push('admin', 'admins', 'developer', 'developers', 'system');
  }

  return normalizeArray([...base, ...tags].map((x) => String(x || '').toLowerCase()));
}

function normalizeHelpRecord(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const updatedAt = new Date(src.updatedAt || new Date().toISOString());
  return {
    id: String(src.id || '').trim(),
    slug: String(src.slug || '').trim().toLowerCase(),
    title: String(src.title || '').trim(),
    category: String(src.category || 'Uncategorized').trim() || 'Uncategorized',
    sectionId: normalizeToken(src.sectionId),
    operationId: normalizeToken(src.operationId),
    priority: Number.parseInt(src.priority, 10) || 0,
    active: src.active !== false,
    tags: normalizeArray(src.tags || []),
    summary: String(src.summary || '').trim(),
    contentMode: String(src.contentMode || 'richtext').trim().toLowerCase() === 'html_page' ? 'html_page' : 'richtext',
    contentPagePath: normalizeContentPagePath(src.contentPagePath || ''),
    contentHtml: String(src.contentHtml || '').trim(),
    audience: normalizeArray(src.audience || ['all']),
    updatedAt: Number.isNaN(updatedAt.getTime()) ? new Date().toISOString() : updatedAt.toISOString()
  };
}

function buildHelpPayload(body, existing = null) {
  const title = String(body.title || '').trim();
  const explicitSlug = String(body.slug || '').trim().toLowerCase();
  const slug = slugify(explicitSlug || title);
  const contentMode = String(body.contentMode || 'richtext').trim().toLowerCase() === 'html_page' ? 'html_page' : 'richtext';
  const audienceBase = normalizeArray(body.audience || []);
  const audienceCustom = parseCsvList(body.customAudiences || '');
  const mergedAudience = normalizeArray([...audienceBase, ...audienceCustom].map((x) => x.toLowerCase()));
  const audience = mergedAudience.includes('all') || mergedAudience.length === 0 ? ['all'] : mergedAudience;

  const payload = {
    id: existing?.id || generateHelpId(),
    slug,
    title,
    category: String(body.category || 'Uncategorized').trim() || 'Uncategorized',
    sectionId: normalizeToken(body.sectionId),
    operationId: normalizeToken(body.operationId),
    priority: Number.parseInt(body.priority, 10) || 0,
    active: parseBool(body.active, false),
    tags: parseCsvList(body.tags || ''),
    summary: String(body.summary || '').trim(),
    contentMode,
    contentPagePath: contentMode === 'html_page' ? normalizeContentPagePath(body.contentPagePath || '') : '',
    contentHtml: contentMode === 'richtext' ? String(body.contentHtml || '').trim() : String(existing?.contentHtml || ''),
    audience,
    updatedAt: new Date().toISOString()
  };

  if (!payload.title) throw new Error('Help title is required.');
  if (!payload.slug) throw new Error('Help slug is required.');
  if (!payload.summary) throw new Error('Help summary is required.');
  if (payload.contentMode === 'richtext' && !payload.contentHtml) throw new Error('Rich text content is required.');
  if (payload.contentMode === 'html_page' && !payload.contentPagePath) throw new Error('HTML page path is required when content mode is html_page.');
  return payload;
}

function sortHelpRecords(items) {
  return [...items].sort((a, b) => {
    const priorityDiff = (Number.parseInt(b.priority, 10) || 0) - (Number.parseInt(a.priority, 10) || 0);
    if (priorityDiff !== 0) return priorityDiff;
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });
}

async function validateSectionOperationPair(sectionId, operationId, reqUser) {
  const sid = normalizeToken(sectionId);
  const oid = normalizeToken(operationId);
  if (!sid && !oid) return;
  if (oid && !sid) {
    throw new Error('Section is required when operation is selected.');
  }

  const sections = await fetchAllSections(reqUser);
  const section = (sections || []).find((s) => normalizeToken(s?.name) === sid || normalizeToken(s?.id) === sid);
  if (!section) {
    throw new Error('Selected section is not valid.');
  }
  if (!oid) return;

  const operationRefs = Array.isArray(section.operations) ? section.operations : [];
  if (operationRefs.length === 0) {
    throw new Error('Selected section has no registered operations.');
  }

  const operations = await fetchAllOperations(reqUser);
  const opById = new Map((operations || []).map((op) => [String(op.id || '').trim().toUpperCase(), op]));
  const validOperationNames = new Set(
    operationRefs.map((opRef) => {
      const opId = String(opRef?.id || '').trim().toUpperCase();
      const op = opById.get(opId);
      return normalizeToken(op?.name || '');
    }).filter(Boolean)
  );

  if (!validOperationNames.has(oid)) {
    throw new Error('Selected operation is not registered for the selected section.');
  }
}

async function helpHome(req, res) {
  const hasCenterQuery = ['q', 'category', 'sectionId', 'operationId']
    .some((k) => Object.prototype.hasOwnProperty.call(req.query || {}, k));
  if (hasCenterQuery || String(req.query.view || '').toLowerCase() === 'center') {
    return viewHelpCenter(req, res);
  }
  if (canManageHelp(req.user)) return res.redirect('/help/manage');
  return viewHelpCenter(req, res);
}

async function listHelpItems(req, res) {
  try {
    const q = safeQuery(req.query.q).toLowerCase();
    const category = safeQuery(req.query.category);
    const contentMode = safeQuery(req.query.contentMode).toLowerCase();
    const activeFilter = safeQuery(req.query.active).toLowerCase();

    const query = {
      ...(q ? { q } : {}),
      ...(category ? { category__eq: category } : {}),
      ...((contentMode === 'richtext' || contentMode === 'html_page') ? { contentMode__eq: contentMode } : {}),
      ...(activeFilter === 'active' ? { active__eq: true } : {}),
      ...(activeFilter === 'inactive' ? { active__eq: false } : {}),
      page: req.query.page,
      limit: req.query.limit,
      sort: req.query.sort || 'priority',
      order: req.query.order || 'desc'
    };

    const pageResult = await helpArticleRepository.listPaged({
      query,
      scope: {
        canViewAll: true,
        isAuthenticated: Boolean(req.user)
      }
    });
    const records = (Array.isArray(pageResult?.rows) ? pageResult.rows : []).map(normalizeHelpRecord);
    const data = sortHelpRecords(records);
    const pagination = pageResult?.pagination || null;
    const categories = await helpArticleRepository.listCategories({
      scope: {
        canViewAll: true,
        isAuthenticated: Boolean(req.user)
      }
    });

    if (isAjaxRequest(req)) {
      return res.json({ status: 'success', results: data, pagination, categories });
    }

    return res.render('help/manageList', {
      title: 'Help Items',
      tableName: 'Help_Articles_Management',
      data,
      categories,
      newUrl: 'help/manage',
      newLabel: 'Add Help Item',
      includeModal: true,
      includeModal_Table: true,
      print: true,
      pagination,
      filters: req.query || {},
      user: req.user || null,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjaxRequest(req)) return res.status(500).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function showAddHelpForm(req, res) {
  try {
    return res.render('help/manageForm', {
      title: 'New Help Item',
      item: null,
      includeModal: true,
      user: req.user || null,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function showEditHelpForm(req, res) {
  try {
    const existing = await helpArticleRepository.getById(req.params.id);
    if (!existing) return res.status(404).render('404', { title: 'Not Found', user: req.user || null });
    return res.render('help/manageForm', {
      title: 'Edit Help Item',
      item: normalizeHelpRecord(existing),
      includeModal: true,
      user: req.user || null,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function addHelpItem(req, res) {
  try {
    const payload = buildHelpPayload(req.body);
    await validateSectionOperationPair(payload.sectionId, payload.operationId, req.user);
    await helpArticleRepository.create(payload);
    await helpCenterService.rebuildCache();
    if (isAjaxRequest(req)) return res.json({ status: 'success', message: 'Help item created.', item: payload });
    return res.redirect('/help/manage');
  } catch (error) {
    if (isAjaxRequest(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function editHelpItem(req, res) {
  try {
    const existing = await helpArticleRepository.getById(req.params.id);
    if (!existing) throw new Error('Help item not found.');
    const payload = buildHelpPayload(req.body, normalizeHelpRecord(existing));
    await validateSectionOperationPair(payload.sectionId, payload.operationId, req.user);
    await helpArticleRepository.update(req.params.id, payload);
    await helpCenterService.rebuildCache();
    if (isAjaxRequest(req)) return res.json({ status: 'success', message: 'Help item updated.', item: payload });
    return res.redirect('/help/manage');
  } catch (error) {
    if (isAjaxRequest(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function deleteHelpItem(req, res) {
  try {
    await helpArticleRepository.remove(req.params.id);
    await helpCenterService.rebuildCache();
    if (isAjaxRequest(req)) return res.json({ status: 'success', message: 'Help item deleted.' });
    return res.redirect('/help/manage');
  } catch (error) {
    if (isAjaxRequest(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function listHelpPages(req, res) {
  try {
    const q = safeQuery(req.query.q).toLowerCase();
    const sections = await fetchAllSections(req.user);

    const staticPages = [
      { path: '/help/center', name: 'Help Center', category: 'HELP', sectionName: 'HELP', description: 'Help landing and search page' },
      { path: '/help/manage', name: 'Help Management', category: 'HELP', sectionName: 'HELP', description: 'Help list and administration page' }
    ];

    const fromSections = (Array.isArray(sections) ? sections : [])
      .filter((s) => s && s.active !== false && String(s.homeURL || '').trim())
      .map((s) => {
        const path = normalizeContentPagePath(s.homeURL || '');
        return {
          path,
          name: String(s.name || path).trim(),
          category: String(s.category || '').trim(),
          sectionName: String(s.name || '').trim(),
          description: String(s.description || '').trim()
        };
      })
      .filter((row) => !!row.path);

    const dedupMap = new Map();
    [...staticPages, ...fromSections].forEach((row) => {
      const key = String(row.path || '').toLowerCase();
      if (!key) return;
      if (!dedupMap.has(key)) dedupMap.set(key, row);
    });

    let pages = Array.from(dedupMap.values())
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    if (q) {
      pages = pages.filter((row) => [
        row.path,
        row.name,
        row.category,
        row.sectionName,
        row.description
      ].join(' ').toLowerCase().includes(q));
    }

    const results = pages.slice(0, 200).map((row) => ({
      id: row.path,
      path: row.path,
      name: row.name,
      category: row.category || 'GENERAL',
      sectionName: row.sectionName || row.name,
      description: row.description || '',
      label: `${row.name} (${row.path})`
    }));

    return res.json({ status: 'success', results });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
}

async function listHelpSections(req, res) {
  try {
    const q = safeQuery(req.query.q).toLowerCase();
    let sections = (await fetchAllSections(req.user))
      .filter((s) => s && s.active !== false)
      .map((s) => ({
        id: String(s.name || '').trim(),
        name: String(s.name || '').trim(),
        sectionNumericId: String(s.id || '').trim(),
        category: String(s.category || '').trim(),
        description: String(s.description || '').trim(),
        homeURL: String(s.homeURL || '').trim()
      }))
      .filter((s) => !!s.id);

    if (q) {
      sections = sections.filter((s) => [
        s.id,
        s.sectionNumericId,
        s.category,
        s.description,
        s.homeURL
      ].join(' ').toLowerCase().includes(q));
    }

    sections.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    return res.json({ status: 'success', results: sections.slice(0, 200) });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
}

async function listHelpOperations(req, res) {
  try {
    const sectionRef = normalizeToken(req.query.sectionId || req.query.sectionRef);
    const q = safeQuery(req.query.q).toLowerCase();
    if (!sectionRef) return res.json({ status: 'success', results: [] });

    const [sections, operations] = await Promise.all([
      fetchAllSections(req.user),
      fetchAllOperations(req.user)
    ]);

    const section = (sections || []).find((s) => normalizeToken(s?.name) === sectionRef || normalizeToken(s?.id) === sectionRef);
    if (!section || !Array.isArray(section.operations)) {
      return res.json({ status: 'success', results: [] });
    }

    const opById = new Map((operations || []).map((op) => [String(op.id || '').trim().toUpperCase(), op]));
    let results = section.operations.map((opRef) => {
      const opId = String(opRef?.id || '').trim().toUpperCase();
      const op = opById.get(opId);
      const opName = String(op?.name || opId).trim().toUpperCase();
      return {
        id: opName,
        name: opName,
        code: opId,
        label: `${opName} (${opId})`,
        active: op?.active !== false
      };
    }).filter((x) => !!x.id);

    if (q) {
      results = results.filter((x) => [
        x.id,
        x.name,
        x.code,
        x.label
      ].join(' ').toLowerCase().includes(q));
    }

    return res.json({ status: 'success', results: results.slice(0, 200) });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
}

async function viewHelpCenter(req, res) {
  try {
    const q = safeQuery(req.query.q);
    const category = safeQuery(req.query.category);
    const sectionId = safeQuery(req.query.sectionId).toUpperCase();
    const operationId = safeQuery(req.query.operationId).toUpperCase();
    const viewerAudienceTags = await resolveViewerAudienceTags(req);

    const [categories, articles, resolvedContextArticle] = await Promise.all([
      helpCenterService.getCategories(viewerAudienceTags),
      helpCenterService.searchArticles(q, { category, sectionId, operationId }, viewerAudienceTags),
      (sectionId || operationId) ? helpCenterService.resolveArticle(sectionId, operationId, viewerAudienceTags) : Promise.resolve(null)
    ]);

    if (isAjaxRequest(req)) {
      return res.json({
        status: 'success',
        categories,
        articles,
        resolvedContextArticle
      });
    }

    return res.render('help/index', {
      title: 'Help Center',
      categories,
      articles,
      resolvedContextArticle,
      canManage: canManageHelp(req.user),
      filters: {
        q,
        category,
        sectionId,
        operationId
      },
      viewerAudienceTags,
      user: req.user || null
    });
  } catch (error) {
    if (isAjaxRequest(req)) return res.status(500).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function viewHelpArticle(req, res) {
  try {
    const slug = safeQuery(req.params.slug);
    const viewerAudienceTags = await resolveViewerAudienceTags(req);
    const article = await helpCenterService.getArticleBySlug(slug, viewerAudienceTags);
    if (!article) {
      return res.status(404).render('404', { title: 'Help Not Found', user: req.user || null });
    }

    const related = await helpCenterService.getRelatedArticles(article, 6, viewerAudienceTags);
    if (isAjaxRequest(req)) {
      return res.json({ status: 'success', article, related });
    }

    return res.render('help/article', {
      title: article.title,
      article,
      related,
      canManage: canManageHelp(req.user),
      user: req.user || null
    });
  } catch (error) {
    if (isAjaxRequest(req)) return res.status(500).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

async function resolveHelp(req, res) {
  try {
    const sectionId = safeQuery(req.query.sectionId || req.params.sectionId).toUpperCase();
    const operationId = safeQuery(req.query.operationId || req.params.operationId).toUpperCase();
    const viewerAudienceTags = await resolveViewerAudienceTags(req);
    const article = await helpCenterService.resolveArticle(sectionId, operationId, viewerAudienceTags);

    if (!article) {
      const payload = { status: 'error', message: 'No help article found for this context.' };
      if (isAjaxRequest(req)) return res.status(404).json(payload);
      return res.redirect('/help/center');
    }

    const url = `/help/article/${encodeURIComponent(article.slug)}`;
    if (isAjaxRequest(req)) {
      return res.json({
        status: 'success',
        sectionId,
        operationId,
        article,
        url
      });
    }

    return res.redirect(url);
  } catch (error) {
    if (isAjaxRequest(req)) return res.status(500).json({ status: 'error', message: error.message });
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user || null });
  }
}

module.exports = {
  helpHome,
  listHelpItems,
  showAddHelpForm,
  addHelpItem,
  showEditHelpForm,
  editHelpItem,
  deleteHelpItem,
  listHelpPages,
  listHelpSections,
  listHelpOperations,
  viewHelpCenter,
  viewHelpArticle,
  resolveHelp
};

