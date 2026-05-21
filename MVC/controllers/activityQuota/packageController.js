const paginate = require('../../utils/paginationHelper');
const packageDataService = require('../../services/activityQuota/packageDataService');
const activityQuotaUiService = require('../../services/activityQuota/activityQuotaUiService');
const { SECTIONS } = require('../../../config/accessConstants');
const {
  isAjax,
  buildDataServiceQuery,
  inferSearchableFields
} = require('../../utils/generalTools');

const LIST_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: [
    'id',
    'name',
    'category',
    'orgId',
    'visibility',
    'active',
    'creator.userId',
    'creator.username',
    'price.currencyCode',
    'eligibleRoles',
    'accessProfiles.id',
    'bannedUsers.id',
    'sections.id',
    'sections.operations.id',
    'sections.operations.label'
  ],
  defaultSearchFields: [
    'id',
    'name',
    'category',
    'description',
    'orgId',
    'visibility',
    'creator.displayName',
    'creator.username',
    'eligibleRoles',
    'accessProfiles.id',
    'accessProfiles.name',
    'bannedUsers.id',
    'bannedUsers.name',
    'sections.id',
    'sections.name',
    'sections.operations.id',
    'sections.operations.name',
    'sections.operations.label'
  ],
  allowMetaKeys: false
});

const PICKER_USER_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'username', 'email', 'status'],
  defaultSearchFields: ['id', 'username', 'email', 'name'],
  allowMetaKeys: true
});

const PICKER_SECTION_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'name', 'category', 'active'],
  defaultSearchFields: ['id', 'name', 'description', 'category'],
  allowMetaKeys: true
});

const PICKER_OPERATION_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'name', 'active', 'system'],
  defaultSearchFields: ['id', 'name', 'description'],
  allowMetaKeys: true
});

const PICKER_ACCESS_PROFILE_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'name', 'orgId', 'active'],
  defaultSearchFields: ['id', 'name', 'description'],
  allowMetaKeys: true
});

const PICKER_ROLE_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'name'],
  defaultSearchFields: ['id', 'name'],
  allowMetaKeys: true
});

const PICKER_PACKAGE_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'name', 'orgId', 'visibility', 'active'],
  defaultSearchFields: ['id', 'name', 'description'],
  allowMetaKeys: true
});

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
    throw new Error('Invalid package payload.');
  }
}

async function listPackages(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, LIST_QUERY_OPTIONS);
    const rows = await packageDataService.listPackages(query, req.user, {
      scopeId: req.accessScope
    });
    const searchableFields = await inferSearchableFields(rows, { exclude: ['audit', 'sections', 'bannedUsers'] });
    const { data, pagination } = paginate(rows, req.query.page, req.query.limit);
    const accessUi = await activityQuotaUiService.buildCrudFlags(req, SECTIONS.ACTIVITY_QUOTA_PACKAGE);
    const manageBtns = await activityQuotaUiService.buildManageButtons(req, {
      exclude: ['packages'],
      dashboardHref: res.locals.activityQuotaSectionDashboardHref
    });

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        results: data,
        pagination
      });
    }

    return res.render('activityQuota/package/packageList', {
      title: 'Activity Quota - Packages',
      tableName: 'Activity_Quota_Packages',
      data,
      searchableFields,
      newUrl: 'activity-quota/packages',
      newLabel: accessUi.canCreate ? 'New Package' : null,
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
    let sectionCategories = [];
    try {
      sectionCategories = await packageDataService.listSectionCategories(req.user, {
        scopeId: req.accessScope
      });
    } catch (_) {
      sectionCategories = [];
    }

    if (isEdit) {
      entry = await packageDataService.getPackageById(req.params.id, req.user, {
        scopeId: req.accessScope
      });
      if (!entry) {
        return res.status(404).render('404', {
          title: 'Not Found',
          user: req.user || null
        });
      }
    } else {
      await packageDataService.assertCreateContext(req.user);
    }

    return res.render('activityQuota/package/packageForm', {
      title: isEdit ? 'Edit Package' : 'Create Activity Quota Package',
      entry,
      formOptions: packageDataService.getFormOptions(sectionCategories),
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

async function savePackage(req, res) {
  try {
    const payload = parseMaybeJson(req.body?.packagePlan) || req.body || {};
    const id = String(req.params.id || '').trim();
    if (id) {
      await packageDataService.updatePackage(id, payload, req.user, {
        scopeId: req.accessScope
      });
      if (isAjax(req)) {
        return res.json({ status: 'success', message: 'Package updated successfully.' });
      }
      return res.redirect('/activity-quota/packages');
    }

    await packageDataService.createPackage(payload, req.user, {
      scopeId: req.accessScope
    });

    if (isAjax(req)) {
      return res.json({ status: 'success', message: 'Package created successfully.' });
    }
    return res.redirect('/activity-quota/packages');
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

async function deletePackage(req, res) {
  try {
    await packageDataService.deletePackage(req.params.id, req.user, {
      scopeId: req.accessScope
    });

    if (isAjax(req)) {
      return res.json({ status: 'success', message: 'Package deleted successfully.' });
    }
    return res.redirect('/activity-quota/packages');
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

async function pickerUsers(req, res) {
  try {
    const rawQuery = await buildDataServiceQuery(req.query, PICKER_USER_QUERY_OPTIONS);
    const { page, limit, filtered } = splitPagination(rawQuery);
    const rows = await packageDataService.listPickerUsers(filtered, req.user, {
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

async function pickerSections(req, res) {
  try {
    const rawQuery = await buildDataServiceQuery(req.query, PICKER_SECTION_QUERY_OPTIONS);
    const { page, limit, filtered } = splitPagination(rawQuery);
    const rows = await packageDataService.listPickerSections(filtered, req.user, {
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

async function pickerOperations(req, res) {
  try {
    const sectionId = String(req.query.sectionId || '').trim();
    const rawQuery = await buildDataServiceQuery(req.query, PICKER_OPERATION_QUERY_OPTIONS);
    const { page, limit, filtered } = splitPagination(rawQuery);
    delete filtered.sectionId;
    const rows = await packageDataService.listPickerOperationsForSection(sectionId, filtered, req.user, {
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

async function pickerAccessProfiles(req, res) {
  try {
    const rawQuery = await buildDataServiceQuery(req.query, PICKER_ACCESS_PROFILE_QUERY_OPTIONS);
    const { page, limit, filtered } = splitPagination(rawQuery);
    const rows = await packageDataService.listPickerAccessProfiles(filtered, req.user, {
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

async function pickerRoles(req, res) {
  try {
    const rawQuery = await buildDataServiceQuery(req.query, PICKER_ROLE_QUERY_OPTIONS);
    const { page, limit, filtered } = splitPagination(rawQuery);
    const rows = await packageDataService.listPickerRoles(filtered, req.user, {
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

async function pickerPackages(req, res) {
  try {
    const rawQuery = await buildDataServiceQuery(req.query, PICKER_PACKAGE_QUERY_OPTIONS);
    const { page, limit, filtered } = splitPagination(rawQuery);
    const rows = await packageDataService.listPickerPackages(filtered, req.user, {
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

async function getPackageTemplate(req, res) {
  try {
    const template = await packageDataService.getPackageTemplateById(req.params.id, req.user, {
      scopeId: req.accessScope
    });
    if (!template) {
      return res.status(404).json({ status: 'error', message: 'Package not found.' });
    }
    return res.json({
      status: 'success',
      results: template
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

module.exports = {
  listPackages,
  showForm,
  savePackage,
  deletePackage,
  pickerUsers,
  pickerSections,
  pickerOperations,
  pickerAccessProfiles,
  pickerRoles,
  pickerPackages,
  getPackageTemplate
};
