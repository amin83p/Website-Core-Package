const paginate = require('../../utils/paginationHelper');
const consumptionDefinitionDataService = require('../../services/activityQuota/consumptionDefinitionDataService');
const activityQuotaUiService = require('../../services/activityQuota/activityQuotaUiService');
const { SECTIONS } = require('../../../packages/activityQuota/config/accessConstants');
const {
  isAjax,
  buildDataServiceQuery,
  inferSearchableFields
} = require('../../utils/generalTools');

const LIST_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: [
    'id',
    'name',
    'orgId',
    'active',
    'sectionId',
    'operationId',
    'sourceEventType',
    'consumeTiming',
    'isFallback',
    'creator.userId',
    'creator.username',
    'targetUserIds'
  ],
  defaultSearchFields: [
    'id',
    'name',
    'description',
    'orgId',
    'sectionId',
    'operationId',
    'sourceEventType',
    'consumeTiming',
    'creator.displayName',
    'creator.username',
    'targetUserIds'
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

const PICKER_EVENT_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'name'],
  defaultSearchFields: ['id', 'name'],
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
    throw new Error('Invalid consumption definition payload.');
  }
}

async function listDefinitions(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, LIST_QUERY_OPTIONS);
    const rows = await consumptionDefinitionDataService.listDefinitions(query, req.user, {
      scopeId: req.accessScope
    });
    const searchableFields = await inferSearchableFields(rows, { exclude: ['audit', 'formula'] });
    const { data, pagination } = paginate(rows, req.query.page, req.query.limit);
    const accessUi = await activityQuotaUiService.buildCrudFlags(req, SECTIONS.ACTIVITY_QUOTA_RULES);
    const manageBtns = await activityQuotaUiService.buildManageButtons(req, {
      exclude: ['rules'],
      dashboardHref: res.locals.activityQuotaSectionDashboardHref
    });

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        results: data,
        pagination
      });
    }

    return res.render('activityQuota/rules/rulesList', {
      title: 'Activity Quota - Rules',
      tableName: 'Activity_Quota_Rules',
      data,
      searchableFields,
      newUrl: 'activity-quota/rules',
      newLabel: accessUi.canCreate ? 'New Rule' : null,
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
      entry = await consumptionDefinitionDataService.getDefinitionById(req.params.id, req.user, {
        scopeId: req.accessScope
      });
      if (!entry) {
        return res.status(404).render('404', {
          title: 'Not Found',
          user: req.user || null
        });
      }
    } else {
      await consumptionDefinitionDataService.assertCreateContext(req.user);
    }

    return res.render('activityQuota/rules/rulesForm', {
      title: isEdit ? 'Edit Consumption Rule' : 'Create Activity Quota Rule',
      entry,
      formOptions: consumptionDefinitionDataService.getFormOptions(),
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

async function saveDefinition(req, res) {
  try {
    const payload = parseMaybeJson(req.body?.definitionPlan) || req.body || {};
    const id = String(req.params.id || '').trim();
    if (id) {
      const updated = await consumptionDefinitionDataService.updateDefinition(id, payload, req.user, {
        scopeId: req.accessScope
      });
      const updatedId = String(updated?.id || id || '').trim();
      const redirectUrl = updatedId ? `/activity-quota/rules/edit/${encodeURIComponent(updatedId)}` : '/activity-quota/rules';
      if (isAjax(req)) {
        return res.json({
          status: 'success',
          message: 'Rule updated successfully.',
          results: {
            id: updatedId,
            redirectUrl
          }
        });
      }
      return res.redirect(redirectUrl);
    }

    const created = await consumptionDefinitionDataService.createDefinition(payload, req.user, {
      scopeId: req.accessScope
    });
    const createdId = String(created?.id || '').trim();
    const redirectUrl = createdId ? `/activity-quota/rules/edit/${encodeURIComponent(createdId)}` : '/activity-quota/rules';
    if (isAjax(req)) {
      return res.json({
        status: 'success',
        message: 'Rule created successfully.',
        results: {
          id: createdId,
          redirectUrl
        }
      });
    }
    return res.redirect(redirectUrl);
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

async function deleteDefinition(req, res) {
  try {
    await consumptionDefinitionDataService.deleteDefinition(req.params.id, req.user, {
      scopeId: req.accessScope
    });
    if (isAjax(req)) {
      return res.json({ status: 'success', message: 'Rule deleted successfully.' });
    }
    return res.redirect('/activity-quota/rules');
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
    const rows = await consumptionDefinitionDataService.listPickerUsers(filtered, req.user, {
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
    const rows = await consumptionDefinitionDataService.listPickerSections(filtered, req.user, {
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
    const rows = await consumptionDefinitionDataService.listPickerOperationsForSection(sectionId, filtered, req.user, {
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

async function pickerEventTypes(req, res) {
  try {
    const rawQuery = await buildDataServiceQuery(req.query, PICKER_EVENT_QUERY_OPTIONS);
    const { page, limit, filtered } = splitPagination(rawQuery);
    const rows = await consumptionDefinitionDataService.listPickerEventTypes(filtered, req.user, {
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
  listDefinitions,
  showForm,
  saveDefinition,
  deleteDefinition,
  pickerUsers,
  pickerSections,
  pickerOperations,
  pickerEventTypes
};
