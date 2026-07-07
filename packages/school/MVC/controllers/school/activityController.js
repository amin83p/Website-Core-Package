const activityService = require('../../services/school/activityService');
const activityWorkSessionService = require('../../services/school/activityWorkSessionService');
const schoolDataService = require('../../services/school/schoolDataService');
const schoolDependencyService = require('../../services/school/schoolDependencyService');
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

function logWorkSessionMutationError(action, error, req = {}) {
  const activityId = req.params?.activityId || '';
  const entryId = req.params?.entryId || '';
  const personId = (req.body && req.body.personId) || '';
  console.error(`[school-activity-work-session] ${action} failed`, {
    activityId,
    entryId,
    personId,
    message: error?.message,
    stack: error?.stack
  });
}

function hasPersonControlRules(row = {}) {
  const allowedCount = Array.isArray(row.allowedPersonIds) ? row.allowedPersonIds.length : 0;
  const excludedCount = Array.isArray(row.excludedPersonIds) ? row.excludedPersonIds.length : 0;
  const entryExclusionCount = (Array.isArray(row.entries) ? row.entries : []).reduce((sum, entry) => {
    return sum + (Array.isArray(entry?.excludedPersonIds) ? entry.excludedPersonIds.length : 0);
  }, 0);
  return allowedCount > 0 || excludedCount > 0 || entryExclusionCount > 0;
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
    const allRows = await activityService.listActivities({
      orgId,
      reqUser: req.user,
      query,
      accessContext: schoolDataService.buildRouteAccessContext(req)
    });
    const status = String(req.query.status || '').trim().toLowerCase();
    const categoryId = String(req.query.categoryId || '').trim();
    const personControl = String(req.query.personControl || '').trim().toLowerCase();
    const rawVisibilityScope = String(req.query.visibilityScope || req.query.scope || '').trim();
    const visibilityScope = rawVisibilityScope ? activityService.normalizeActivityVisibilityScope(rawVisibilityScope) : '';
    const filtered = allRows.filter((row) => {
      if (status && String(row.status || '').toLowerCase() !== status) return false;
      if (categoryId && String(row.categoryId || '') !== categoryId) return false;
      if (visibilityScope && activityService.normalizeActivityVisibilityScope(row.visibilityScope) !== visibilityScope) return false;
      if (personControl === 'restricted' && !hasPersonControlRules(row)) return false;
      if (personControl === 'open' && hasPersonControlRules(row)) return false;
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
      activity: { status: 'draft', paid: false, evaluationType: 'attendance', visibilityScope: 'school', attendees: [], allowedPersonIds: [], excludedPersonIds: [] },
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
    const activity = await activityService.getActivity(req.params.id, req.user, schoolDataService.buildRouteAccessContext(req));
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
      const existing = await activityService.getActivity(id, req.user, schoolDataService.buildRouteAccessContext(req));
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
    const existing = await activityService.getActivity(req.params.id, req.user, schoolDataService.buildRouteAccessContext(req));
    if (!existing) throw new Error('School activity not found.');
    assertOrgAccess(existing, orgId);
    schoolDependencyService.assertActivityNotTimesheetLocked(existing, `Activity "${existing.title || existing.id}"`);
    await schoolDependencyService.assertSourceNotReferenced({
      orgId,
      sourceType: 'activity',
      sourceRef: { activityId: existing.id },
      label: `Activity "${existing.title || existing.id}"`,
      reqUser: req.user
    });
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

exports.manageWorkSessionsOverview = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const { activityId } = req.params;
    const accessContext = schoolDataService.buildRouteAccessContext(req);
    const context = await activityWorkSessionService.getWorkSessionsOverview(activityId, req.user, accessContext);
    assertOrgAccess(context.activity, orgId);
    if (context.sessions.length === 1) {
      const onlySession = context.sessions[0];
      return res.redirect(activityWorkSessionService.buildSessionManageUrl(activityId, onlySession.entryId));
    }
    res.render('school/activity/activityWorkSessionsOverview', {
      title: `Manage Work Sessions — ${context.activity.title || activityId}`,
      ...context,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.getWorkSessionsOverviewJson = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const { activityId } = req.params;
    const accessContext = schoolDataService.buildRouteAccessContext(req);
    const context = await activityWorkSessionService.getWorkSessionsOverview(activityId, req.user, accessContext);
    assertOrgAccess(context.activity, orgId);
    return res.json({ status: 'success', ...context });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.getWorkSessionContextJson = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const { activityId, entryId } = req.params;
    const accessContext = schoolDataService.buildRouteAccessContext(req);
    const context = await activityWorkSessionService.getWorkSessionContext(activityId, entryId, req.user, accessContext);
    assertOrgAccess(context.activity, orgId);
    return res.json({ status: 'success', context, actionStateId: req.actionStateId });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
};

exports.manageWorkSession = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const { activityId, entryId } = req.params;
    const accessContext = schoolDataService.buildRouteAccessContext(req);
    const context = await activityWorkSessionService.getWorkSessionContext(activityId, entryId, req.user, accessContext);
    assertOrgAccess(context.activity, orgId);
    res.render('school/activity/activityWorkSessionManager', {
      title: 'Manage Work Session',
      ...context,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.saveWorkSessionAssignee = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const { activityId, entryId } = req.params;
    const accessContext = schoolDataService.buildRouteAccessContext(req);
    const body = req.body || {};
    const result = await activityWorkSessionService.saveAssigneeRow({
      activityId,
      entryId,
      personId: body.personId,
      reqUser: req.user,
      input: body,
      accessContext
    });
    assertOrgAccess(result.context.activity, orgId);
    const payload = { status: 'success', message: 'Assignee row saved.', actionStateId: req.actionStateId, ...result };
    if (isAjax(req)) return res.json(payload);
    const target = await activityWorkSessionService.resolveWorkSessionManageTargetForRequest({
      activityId,
      entryId,
      reqUser: req.user,
      accessContext
    });
    res.redirect(target.url);
  } catch (error) {
    logWorkSessionMutationError('save', error, req);
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.completeWorkSessionAssignee = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const { activityId, entryId } = req.params;
    const accessContext = schoolDataService.buildRouteAccessContext(req);
    const body = req.body || {};
    const result = await activityWorkSessionService.completeAssignee({
      activityId,
      entryId,
      personId: body.personId,
      reqUser: req.user,
      input: body,
      accessContext
    });
    assertOrgAccess(result.context.activity, orgId);
    const payload = { status: 'success', message: 'Assignment marked complete.', actionStateId: req.actionStateId, ...result };
    if (isAjax(req)) return res.json(payload);
    const target = await activityWorkSessionService.resolveWorkSessionManageTargetForRequest({
      activityId,
      entryId,
      reqUser: req.user,
      accessContext
    });
    res.redirect(target.url);
  } catch (error) {
    logWorkSessionMutationError('complete', error, req);
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    res.status(400).render('error', { title: 'Error', error, message: error.message, user: req.user });
  }
};

exports.resetWorkSessionAssigneeCompletion = async (req, res) => {
  try {
    const orgId = getActiveOrgIdOrThrow(req.user);
    const { activityId, entryId } = req.params;
    const accessContext = schoolDataService.buildRouteAccessContext(req);
    const body = req.body || {};
    const result = await activityWorkSessionService.resetAssigneeCompletion({
      activityId,
      entryId,
      personId: body.personId,
      reqUser: req.user,
      input: body,
      accessContext
    });
    assertOrgAccess(result.context.activity, orgId);
    const payload = { status: 'success', message: 'Assignment moved back to pending completion.', actionStateId: req.actionStateId, ...result };
    if (isAjax(req)) return res.json(payload);
    const target = await activityWorkSessionService.resolveWorkSessionManageTargetForRequest({
      activityId,
      entryId,
      reqUser: req.user,
      accessContext
    });
    res.redirect(target.url);
  } catch (error) {
    logWorkSessionMutationError('pending', error, req);
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

