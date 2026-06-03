const paginate = require('../../utils/paginationHelper');
const packageManagerDataService = require('../../services/activityQuota/packageManagerDataService');
const activityQuotaUiService = require('../../services/activityQuota/activityQuotaUiService');
const { SECTIONS } = require('../../../config/accessConstants');
const { toPublicId } = require('../../utils/idAdapter');
const {
  isAjax,
  buildDataServiceQuery,
  inferSearchableFields
} = require('../../utils/generalTools');

const LIST_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: [
    'id',
    'orgId',
    'targetUserId',
    'packageId',
    'status',
    'creator.userId'
  ],
  defaultSearchFields: [
    'id',
    'orgId',
    'targetUserId',
    'targetUserName',
    'packageId',
    'packageName',
    'status',
    'notes',
    'creator.displayName',
    'creator.username'
  ],
  allowMetaKeys: false
});

const PICKER_PACKAGE_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'name', 'category', 'orgId', 'visibility', 'active'],
  defaultSearchFields: ['id', 'name', 'description', 'category'],
  allowMetaKeys: true
});

const PICKER_USER_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'username', 'email', 'status'],
  defaultSearchFields: ['id', 'username', 'email', 'name', 'roles'],
  allowMetaKeys: true
});

function buildOrgLabelLookup(user = {}) {
  const map = new Map();
  const orgs = Array.isArray(user?.allowedOrgs) ? user.allowedOrgs : [];
  orgs.forEach((org) => {
    const key = toPublicId(org?.orgId || org?.id || '');
    if (!key) return;
    const name = (org?.name || org?.orgName || org?.organizationName || '').toString().trim();
    if (name) map.set(key, name);
  });
  return map;
}

function getOrgDisplayName(orgId = '', orgLabelMap = new Map()) {
  const token = toPublicId(orgId);
  if (!token) return '';
  if (token.toUpperCase() === 'SYSTEM' || token.toUpperCase() === 'GLOBAL') {
    return 'System / Global';
  }
  return orgLabelMap.get(token) || '';
}

function splitPagination(query = {}) {
  const source = query && typeof query === 'object' ? query : {};
  const page = Number.parseInt(source.page, 10) || 1;
  const limit = Number.parseInt(source.limit, 10) || undefined;
  const filtered = { ...source };
  delete filtered.page;
  delete filtered.limit;
  return { page, limit, filtered };
}

function parseMaybeJson(input) {
  if (input === undefined || input === null) return null;
  if (typeof input === 'object') return input;
  const token = String(input || '').trim();
  if (!token) return null;
  try {
    return JSON.parse(token);
  } catch (_) {
    throw new Error('Invalid package assignment payload.');
  }
}

async function listAssignments(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, LIST_QUERY_OPTIONS);
    const rows = await packageManagerDataService.listAssignments(query, req.user, {
      scopeId: req.accessScope
    });
    const orgLabelMap = buildOrgLabelLookup(req.user || {});
    const rowsWithOrgName = (Array.isArray(rows) ? rows : []).map((row) => ({
      ...row,
      orgName: getOrgDisplayName(row?.orgId, orgLabelMap)
    }));
    const searchableFields = await inferSearchableFields(rows, { exclude: ['audit', 'packageSnapshot'] });
    const { data, pagination } = paginate(rowsWithOrgName, req.query.page, req.query.limit);
    const accessUi = await activityQuotaUiService.buildCrudFlags(req, SECTIONS.ACTIVITY_QUOTA_PACKAGE_MANAGER);
    const manageBtns = await activityQuotaUiService.buildManageButtons(req, {
      exclude: ['packageManager'],
      dashboardHref: res.locals.activityQuotaSectionDashboardHref
    });

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        results: data,
        pagination
      });
    }

    return res.render('activityQuota/packageManager/packageManagerList', {
      title: 'Activity Quota - Package Manager',
      tableName: 'Activity_Quota_Package_Manager',
      data,
      searchableFields,
      newUrl: 'activity-quota/package-manager',
      newLabel: accessUi.canCreate ? 'New Assignment' : null,
      manageBtns,
      accessUi,
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: false,
      print: true,
      btn_export: true,
      pagination,
      filters: req.query,
      user: req.user,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (isAjax(req)) {
      return res.status(400).json({ status: 'error', message: error.message });
    }
    return res.status(500).render('error', {
      title: 'Error',
      message: error.message,
      user: req.user || null
    });
  }
}

async function showForm(req, res) {
  try {
    const isEdit = Boolean(req.params.id);
    let entry = null;

    if (isEdit) {
      entry = await packageManagerDataService.getAssignmentById(req.params.id, req.user, {
        scopeId: req.accessScope
      });
      if (!entry) {
        return res.status(404).render('404', {
          title: 'Not Found',
          user: req.user || null
        });
      }
    } else {
      await packageManagerDataService.assertCreateContext(req.user);
    }

    return res.render('activityQuota/packageManager/packageManagerForm', {
      title: isEdit ? 'Edit Package Assignment' : 'Create Package Assignment',
      entry,
      includeModal: true,
      user: req.user || null,
      actionStateId: req.actionStateId || ''
    });
  } catch (error) {
    return res.status(400).render('error', {
      title: 'Error',
      message: error.message,
      user: req.user || null
    });
  }
}

async function saveAssignment(req, res) {
  try {
    const payload = parseMaybeJson(req.body?.assignmentPlan) || req.body || {};
    const id = String(req.params.id || '').trim();

    if (id) {
      await packageManagerDataService.updateAssignmentMetadata(id, payload, req.user, {
        scopeId: req.accessScope
      });
      if (isAjax(req)) {
        return res.json({ status: 'success', message: 'Assignment metadata updated successfully.' });
      }
      return res.redirect('/activity-quota/package-manager');
    }

    await packageManagerDataService.createAssignment(payload, req.user, {
      scopeId: req.accessScope
    });
    if (isAjax(req)) {
      return res.json({ status: 'success', message: 'Package assignment created successfully.' });
    }
    return res.redirect('/activity-quota/package-manager');
  } catch (error) {
    if (isAjax(req)) {
      return res.status(400).json({ status: 'error', message: error.message });
    }
    return res.status(400).render('error', {
      title: 'Error',
      message: error.message,
      user: req.user || null
    });
  }
}

async function removeAssignment(req, res) {
  try {
    await packageManagerDataService.removeAssignment(req.params.id, req.user, {
      scopeId: req.accessScope
    });
    if (isAjax(req)) {
      return res.json({ status: 'success', message: 'Assignment removed and side-effects reversed successfully.' });
    }
    return res.redirect('/activity-quota/package-manager');
  } catch (error) {
    if (isAjax(req)) {
      return res.status(400).json({ status: 'error', message: error.message });
    }
    return res.status(400).render('error', {
      title: 'Error',
      message: error.message,
      user: req.user || null
    });
  }
}

async function pickerPackages(req, res) {
  try {
    const rawQuery = await buildDataServiceQuery(req.query, PICKER_PACKAGE_QUERY_OPTIONS);
    const { page, limit, filtered } = splitPagination(rawQuery);
    const rows = await packageManagerDataService.listPickerPackages(filtered, req.user, {
      scopeId: req.accessScope
    });
    const { data, pagination } = paginate(rows, page, limit);
    return res.json({
      status: 'success',
      results: data,
      pagination
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function pickerUsers(req, res) {
  try {
    const packageId = String(req.query.packageId || '').trim();
    const rawQuery = await buildDataServiceQuery(req.query, PICKER_USER_QUERY_OPTIONS);
    const { page, limit, filtered } = splitPagination(rawQuery);
    delete filtered.packageId;
    const rows = await packageManagerDataService.listPickerUsers(filtered, packageId, req.user, {
      scopeId: req.accessScope
    });
    const { data, pagination } = paginate(rows, page, limit);
    return res.json({
      status: 'success',
      results: data,
      pagination
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

module.exports = {
  listAssignments,
  showForm,
  saveAssignment,
  removeAssignment,
  pickerPackages,
  pickerUsers
};
