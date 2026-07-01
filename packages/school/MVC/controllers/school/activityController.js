const activityService = require('../../services/school/activityService');
const schoolDataService = require('../../services/school/schoolDataService');
const { requireCoreModule } = require('../../services/school/schoolCoreContracts');
const paginate = requireCoreModule('MVC/utils/paginationHelper');
const { isAjax, buildDataServiceQuery } = requireCoreModule('MVC/utils/generalTools');
const { idsEqual } = requireCoreModule('MVC/utils/idAdapter');

function getActiveOrgIdOrThrow(reqUser = {}) {
  const orgId = String(reqUser.activeOrgId || reqUser.orgId || '').trim();
  if (!orgId) throw new Error('<b>Security Violation</b><br>No active organization context found.');
  return orgId;
}

function assertOrgAccess(row, orgId) {
  if (row?.orgId && !idsEqual(row.orgId, orgId)) {
    throw new Error('<b>Security Violation</b><br>Unauthorized organization access.');
  }
}

async function loadFormLookups(req) {
  const orgId = getActiveOrgIdOrThrow(req.user);
  const [categories, departments] = await Promise.all([
    activityService.listActivityCategories({ orgId, reqUser: req.user, includeInactive: false }),
    schoolDataService.fetchData('departments', {}, req.user)
  ]);
  return {
    categories,
    departments: (Array.isArray(departments) ? departments : []).filter((row) => !row.orgId || idsEqual(row.orgId, orgId))
  };
}

exports.listActivities = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const query = await buildDataServiceQuery(req.query, { allowedExactKeys: null });
    const allRows = await activityService.listActivities({ orgId, reqUser: req.user, query });
    const status = String(req.query.status || '').trim().toLowerCase();
    const categoryId = String(req.query.categoryId || '').trim();
    const rawVisibilityScope = String(req.query.visibilityScope || req.query.scope || '').trim();
    const visibilityScope = rawVisibilityScope ? activityService.normalizeActivityVisibilityScope(rawVisibilityScope) : '';
    const filtered = allRows.filter((row) => {
      if (status && String(row.status || '').toLowerCase() !== status) return false;
      if (categoryId && String(row.categoryId || '') !== categoryId) return false;
      if (visibilityScope && activityService.normalizeActivityVisibilityScope(row.visibilityScope) !== visibilityScope) return false;
      return true;
    });
    const { data, pagination } = paginate(filtered, query.page, query.limit);
    const categories = await activityService.listActivityCategories({ orgId, reqUser: req.user, includeInactive: true });
    if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });
    res.render('school/activity/activityList', {
      title: 'School Activities',
      data,
      categories,
      tableName: 'School_Activities',
      newUrl: 'school/activities',
      newLabel: 'New Activity',
      pagination,
      filters: req.query,
      print: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(500).json({ status: 'error', message: error.message });
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.showCreateForm = async (req, res) => {
  try {
    const lookups = await loadFormLookups(req);
    res.render('school/activity/activityForm', {
      title: 'New School Activity',
      activity: { status: 'draft', paid: false, visibilityScope: 'school', attendees: [] },
      isEdit: false,
      ...lookups,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.showEditForm = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const activity = await activityService.getActivity(req.params.id, req.user);
    if (!activity) throw new Error('School activity not found.');
    assertOrgAccess(activity, orgId);
    const lookups = await loadFormLookups(req);
    res.render('school/activity/activityForm', {
      title: 'Edit School Activity',
      activity,
      isEdit: true,
      ...lookups,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.saveActivity = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const id = String(req.params.id || req.body.id || '').trim();
    if (id) {
      const existing = await activityService.getActivity(id, req.user);
      if (!existing) throw new Error('School activity not found.');
      assertOrgAccess(existing, orgId);
    }
    await activityService.saveActivity({ ...req.body, id, orgId }, req.user);
    const payload = { status: 'success', message: 'School activity saved successfully.' };
    if (isAjax(req)) return res.json(payload);
    res.redirect('/school/activities');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.deleteActivity = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const existing = await activityService.getActivity(req.params.id, req.user);
    if (!existing) throw new Error('School activity not found.');
    assertOrgAccess(existing, orgId);
    await schoolDataService.deleteData('activities', req.params.id, req.user);
    const payload = { status: 'success', message: 'School activity deleted successfully.' };
    if (isAjax(req)) return res.json(payload);
    res.redirect('/school/activities');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.listCategories = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const query = await buildDataServiceQuery(req.query, { allowedExactKeys: null });
    const q = String(req.query.q || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim().toLowerCase();
    const defaultPaid = String(req.query.defaultPaid || '').trim().toLowerCase();
    const categories = await activityService.listActivityCategories({ orgId, reqUser: req.user, includeInactive: true });
    const filtered = categories.filter((row) => {
      if (status === 'active' && row.active === false) return false;
      if (status === 'inactive' && row.active !== false) return false;
      if (defaultPaid === 'true' && row.defaultPaid !== true) return false;
      if (defaultPaid === 'false' && row.defaultPaid === true) return false;
      if (!q) return true;
      return [
        row.id,
        row.code,
        row.name,
        row.description,
        row.active === false ? 'inactive' : 'active',
        row.defaultPaid ? 'payable' : 'unpaid'
      ].join(' ').toLowerCase().includes(q);
    });
    const { data, pagination } = paginate(filtered, query.page, query.limit);
    res.render('school/activity/categoryList', {
      title: 'School Activity Categories',
      data,
      tableName: 'School_Activity_Categories',
      newUrl: 'school/activities/categories',
      newLabel: 'New Category',
      pagination,
      filters: req.query,
      print: true,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};
exports.showCategoryForm = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    let category = { active: true, defaultPaid: false };
    if (req.params.id) {
      category = await schoolDataService.getDataById('activityCategories', req.params.id, req.user);
      if (!category) throw new Error('Activity category not found.');
      assertOrgAccess(category, orgId);
    }
    res.render('school/activity/categoryForm', {
      title: req.params.id ? 'Edit Activity Category' : 'New Activity Category',
      category,
      isEdit: Boolean(req.params.id),
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    res.status(500).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.saveCategory = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const id = String(req.params.id || req.body.id || '').trim();
    if (id) {
      const existing = await schoolDataService.getDataById('activityCategories', id, req.user);
      if (!existing) throw new Error('Activity category not found.');
      assertOrgAccess(existing, orgId);
    }
    await activityService.saveActivityCategory({ ...req.body, id, orgId }, req.user);
    const payload = { status: 'success', message: 'Activity category saved successfully.' };
    if (isAjax(req)) return res.json(payload);
    res.redirect('/school/activities/categories');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.deleteCategory = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const existing = await schoolDataService.getDataById('activityCategories', req.params.id, req.user);
    if (!existing) throw new Error('Activity category not found.');
    assertOrgAccess(existing, orgId);
    await schoolDataService.deleteData('activityCategories', req.params.id, req.user);
    const payload = { status: 'success', message: 'Activity category deleted successfully.' };
    if (isAjax(req)) return res.json(payload);
    res.redirect('/school/activities/categories');
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.eligiblePersons = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const results = await activityService.getEligiblePersons({ orgId, reqUser: req.user, q: req.query.q || '' });
    res.json({
      status: 'success',
      data: results,
      results,
      items: results,
      pagination: {
        page: 1,
        currentPage: 1,
        totalPages: 1,
        limit: results.length,
        totalItems: results.length
      }
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

