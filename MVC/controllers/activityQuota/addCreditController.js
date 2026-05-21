const paginate = require('../../utils/paginationHelper');
const addCreditDataService = require('../../services/activityQuota/addCreditDataService');
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
    'userId',
    'orgId',
    'section',
    'operation',
    'entryType',
    'creator.userId',
    'creator.username',
    'creator.email',
    'source.eventType',
    'source.eventId'
  ],
  defaultSearchFields: [
    'id',
    'userId',
    'orgId',
    'section',
    'operation',
    'creator.displayName',
    'creator.username',
    'creator.email',
    'source.eventType',
    'source.eventId'
  ],
  allowMetaKeys: false
});

const GROUP_LIST_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: [
    'id',
    'orgId',
    'status',
    'creator.userId',
    'source.eventType',
    'source.eventId'
  ],
  defaultSearchFields: [
    'id',
    'orgId',
    'users.id',
    'users.name',
    'users.username',
    'sections.id',
    'sections.name',
    'sections.operations.id',
    'sections.operations.name',
    'source.eventType',
    'source.eventId'
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
    throw new Error('Invalid credit plan payload.');
  }
}

function buildPlanFromGroup(group = {}) {
  return {
    dateTime: group?.dateTime || new Date().toISOString(),
    users: Array.isArray(group?.users) ? group.users : [],
    sections: Array.isArray(group?.sections) ? group.sections : [],
    source: {
      module: group?.source?.module || '',
      eventType: group?.source?.eventType || '',
      eventIdMode: group?.source?.eventIdMode || 'auto',
      eventId: group?.source?.eventId || '',
      idempotencyMode: group?.source?.idempotencyMode || 'auto',
      idempotencyKey: group?.source?.idempotencyKey || ''
    }
  };
}

async function listCredits(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, LIST_QUERY_OPTIONS);
    const rows = await addCreditDataService.listCredits(query, req.user, {
      scopeId: req.accessScope
    });
    const searchableFields = await inferSearchableFields(rows, { exclude: ['audit'] });
    const { data, pagination } = paginate(rows, req.query.page, req.query.limit);
    const accessUi = await activityQuotaUiService.buildCrudFlags(req, SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT);
    const manageBtns = await activityQuotaUiService.buildManageButtons(req, {
      exclude: ['addCredit'],
      dashboardHref: res.locals.activityQuotaSectionDashboardHref
    });

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        results: data,
        pagination
      });
    }

    return res.render('activityQuota/addCredit/addCreditList', {
      title: 'Activity Quota - Add Credit',
      tableName: 'Activity_Quota_Add_Credit',
      data,
      searchableFields,
      newUrl: 'activity-quota/add-credit',
      newLabel: accessUi.canCreate ? 'Add Credit' : null,
      manageBtns,
      accessUi,
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: true,
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
      user: req.user
    });
  }
}

async function listGroups(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, GROUP_LIST_QUERY_OPTIONS);
    const rows = await addCreditDataService.listCreditGroups(query, req.user, {
      scopeId: req.accessScope
    });
    const searchableFields = await inferSearchableFields(rows, { exclude: ['audit', 'sections', 'users'] });
    const { data, pagination } = paginate(rows, req.query.page, req.query.limit);
    const accessUi = await activityQuotaUiService.buildCrudFlags(req, SECTIONS.ACTIVITY_QUOTA_ADD_CREDIT);
    const manageBtns = await activityQuotaUiService.buildManageButtons(req, {
      exclude: ['groupedCredits'],
      dashboardHref: res.locals.activityQuotaSectionDashboardHref
    });

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        results: data,
        pagination
      });
    }

    return res.render('activityQuota/addCredit/addCreditGroupList', {
      title: 'Activity Quota - Grouped Credits',
      tableName: 'Activity_Quota_Grouped_Credits',
      data,
      searchableFields,
      newUrl: 'activity-quota/add-credit',
      newLabel: accessUi.canCreate ? 'Add Credit' : null,
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
      user: req.user
    });
  }
}

async function showForm(req, res) {
  try {
    const isEdit = Boolean(req.params.id);
    let entry = null;

    if (isEdit) {
      entry = await addCreditDataService.getCreditById(req.params.id, req.user, {
        scopeId: req.accessScope
      });
      if (!entry) {
        return res.status(404).render('404', {
          title: 'Not Found',
          user: req.user || null
        });
      }

      const group = await addCreditDataService.getCreditGroupByLedgerEntryId(entry.id, req.user, {
        scopeId: req.accessScope
      });
      if (group?.id) {
        return res.redirect(`/activity-quota/add-credit/groups/edit/${encodeURIComponent(group.id)}`);
      }
    } else {
      await addCreditDataService.assertCreateContext(req.user);
    }

    return res.render('activityQuota/addCredit/addCreditForm', {
      title: isEdit ? `Edit Credit Entry: ${entry.id}` : 'Create Credit Entry',
      entry,
      groupRecord: null,
      initialCreditPlan: null,
      formOptions: addCreditDataService.getFormOptions(),
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

async function showGroupForm(req, res) {
  try {
    const group = await addCreditDataService.getCreditGroupById(req.params.id, req.user, {
      scopeId: req.accessScope
    });
    if (!group) {
      return res.status(404).render('404', {
        title: 'Not Found',
        user: req.user || null
      });
    }

    return res.render('activityQuota/addCredit/addCreditForm', {
      title: `Edit Credit Group: ${group.id}`,
      entry: null,
      groupRecord: group,
      initialCreditPlan: buildPlanFromGroup(group),
      formOptions: addCreditDataService.getFormOptions(),
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

async function saveCredit(req, res) {
  try {
    const id = String(req.params.id || '').trim();
    if (id) {
      await addCreditDataService.updateCredit(id, req.body, req.user, {
        scopeId: req.accessScope
      });

      if (isAjax(req)) {
        return res.json({ status: 'success', message: 'Credit entry updated successfully.' });
      }
      return res.redirect('/activity-quota/add-credit');
    }

    const rawPlan = req.body?.creditPlan;
    const parsedPlan = parseMaybeJson(rawPlan);
    if (parsedPlan && Array.isArray(parsedPlan.users) && Array.isArray(parsedPlan.sections)) {
      const summary = await addCreditDataService.createCreditsFromPlan(parsedPlan, req.user, {
        scopeId: req.accessScope
      });
      const message = summary?.group?.id
        ? `Created ${summary.createdCount} credit ledger entries under group ${summary.group.id}.`
        : `Created ${summary.createdCount} credit ledger entr${summary.createdCount === 1 ? 'y' : 'ies'}.`;
      if (isAjax(req)) {
        return res.json({
          status: 'success',
          message,
          summary
        });
      }
      return res.redirect('/activity-quota/add-credit');
    }

    await addCreditDataService.createCredit(req.body, req.user);

    if (isAjax(req)) {
      return res.json({ status: 'success', message: 'Credit entry saved successfully.' });
    }
    return res.redirect('/activity-quota/add-credit');
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

async function saveGroup(req, res) {
  try {
    const groupId = String(req.params.id || '').trim();
    if (!groupId) throw new Error('Credit group id is required.');

    const parsedPlan = parseMaybeJson(req.body?.creditPlan);
    if (!parsedPlan || !Array.isArray(parsedPlan.users) || !Array.isArray(parsedPlan.sections)) {
      throw new Error('Credit group plan payload is required.');
    }

    const summary = await addCreditDataService.updateCreditGroupFromPlan(groupId, parsedPlan, req.user, {
      scopeId: req.accessScope
    });

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        message: `Updated credit group ${summary.group.id} with ${summary.updatedCount} entries.`,
        summary
      });
    }
    return res.redirect('/activity-quota/add-credit/groups');
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

async function deleteCredit(req, res) {
  try {
    await addCreditDataService.deleteCredit(req.params.id, req.user, {
      scopeId: req.accessScope
    });

    if (isAjax(req)) {
      return res.json({ status: 'success', message: 'Credit entry deleted successfully.' });
    }
    return res.redirect('/activity-quota/add-credit');
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

async function deleteGroup(req, res) {
  try {
    await addCreditDataService.deleteCreditGroup(req.params.id, req.user, {
      scopeId: req.accessScope
    });

    if (isAjax(req)) {
      return res.json({ status: 'success', message: 'Credit group deleted successfully.' });
    }
    return res.redirect('/activity-quota/add-credit/groups');
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

async function getFormOptions(req, res) {
  try {
    await addCreditDataService.resolveReadVisibility(req.user, { scopeId: req.accessScope });
    return res.json({
      status: 'success',
      results: addCreditDataService.getFormOptions()
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message });
  }
}

async function pickerUsers(req, res) {
  try {
    const rawQuery = await buildDataServiceQuery(req.query, PICKER_USER_QUERY_OPTIONS);
    const { page, limit, filtered } = splitPagination(rawQuery);
    const rows = await addCreditDataService.listPickerUsers(filtered, req.user, {
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
    const rows = await addCreditDataService.listPickerSections(filtered, req.user, {
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
    const rows = await addCreditDataService.listPickerOperationsForSection(sectionId, filtered, req.user, {
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
  listCredits,
  listGroups,
  showForm,
  showGroupForm,
  saveCredit,
  saveGroup,
  deleteCredit,
  deleteGroup,
  getFormOptions,
  pickerUsers,
  pickerSections,
  pickerOperations
};
