const dataService = require('../services/dataService');
const userSettingsService = require('../services/userSettingsService');
const { invalidateAuthContextForUser } = require('../services/cache/authContextCacheService');
const { buildDataServiceQuery } = require('../utils/generalTools');
const { SYSTEM_CONTEXT } = require('../../config/constants');
const { toPublicId } = require('../utils/idAdapter');

const USER_SETTINGS_LIST_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['userId', 'id'],
  allowedSearchFields: ['userId', 'id'],
  defaultSearchFields: ['userId', 'id'],
  allowMetaKeys: true
});

const USER_PICKER_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'username', 'email', 'displayName', 'name', 'status', 'active', 'primaryOrgId'],
  allowedSearchFields: ['id', 'username', 'email', 'displayName', 'name', 'status', 'primaryOrgId'],
  defaultSearchFields: ['id', 'username', 'email', 'displayName', 'name', 'primaryOrgId'],
  allowMetaKeys: true
});

const USER_PICKER_PROJECTION = Object.freeze({
  id: 1,
  userId: 1,
  username: 1,
  email: 1,
  displayName: 1,
  name: 1,
  status: 1,
  active: 1,
  primaryOrgId: 1
});

function isAjax(req) {
  return Boolean(req?.headers?.['x-ajax-request'] || req?.xhr);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseSettingsJson(raw) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw || '').trim() || '{}');
  } catch (error) {
    throw new Error(`Settings JSON is invalid: ${error.message}`);
  }

  if (!isPlainObject(parsed)) {
    throw new Error('Settings JSON must be an object.');
  }
  return parsed;
}

function buildViewRecord(record, userId = '') {
  const safeRecord = record && typeof record === 'object' ? record : {};
  const safeUserId = String(safeRecord.userId || safeRecord.id || userId || '').trim();
  return {
    id: safeUserId,
    userId: safeUserId,
    settings: isPlainObject(safeRecord.settings) ? safeRecord.settings : {},
    audit: safeRecord.audit || {}
  };
}

function sanitizeUserPickerRow(row, fallbackId = '') {
  const source = row && typeof row === 'object' ? row : {};
  const id = toPublicId(source.id || source.userId || fallbackId);
  const username = String(source.username || '').trim();
  const email = String(source.email || '').trim();
  const displayName = String(source.displayName || source.name || username || email || id).trim();
  const status = String(source.status || '').trim();
  const primaryOrgId = toPublicId(source.primaryOrgId || source.orgId || source.organizationId || '');

  return {
    id,
    userId: id,
    username,
    email,
    displayName,
    name: displayName,
    status,
    active: typeof source.active === 'boolean' ? source.active : undefined,
    primaryOrgId
  };
}

async function loadSelectedUserDisplay(userId) {
  const safeUserId = toPublicId(userId);
  if (!safeUserId) return sanitizeUserPickerRow(null, '');
  const row = await dataService.getDataById('users', safeUserId, SYSTEM_CONTEXT).catch(() => null);
  return sanitizeUserPickerRow(row, safeUserId);
}

function respondError(req, res, error, status = 500) {
  if (isAjax(req)) {
    return res.status(status).json({
      status: 'error',
      message: error.message || 'User settings request failed.'
    });
  }
  return res.status(status).render('error', {
    title: 'Error',
    message: error.message || 'User settings request failed.',
    user: req.user || null
  });
}

async function listAll(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, USER_SETTINGS_LIST_QUERY_OPTIONS);
    const page = Number.parseInt(req.query?.page, 10) || Number.parseInt(query?.page, 10) || 1;
    const limit = Number.parseInt(req.query?.limit, 10) || Number.parseInt(query?.limit, 10) || undefined;

    const paged = await dataService.fetchDataPaged('userSettings', {
      ...query,
      page,
      limit
    }, SYSTEM_CONTEXT);
    const data = Array.isArray(paged?.rows) ? paged.rows : [];
    const pagination = paged?.pagination || null;

    if (isAjax(req)) return res.json({ status: 'success', data, pagination });

    return res.render('userSettings/userSettings', {
      title: 'User Settings',
      tableName: 'User_Settings',
      newUrl: 'userSettings',
      newLabel: null,
      data,
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: false,
      print: true,
      pagination,
      searchableFields: USER_SETTINGS_LIST_QUERY_OPTIONS.defaultSearchFields,
      filters: req.query,
      user: req.user || null
    });
  } catch (error) {
    return respondError(req, res, error);
  }
}

async function getItem(req, res) {
  try {
    const { userId } = req.params;
    const record = await dataService.getDataById('userSettings', userId, SYSTEM_CONTEXT);
    const viewRecord = buildViewRecord(record, userId);
    const selectedUser = await loadSelectedUserDisplay(userId);

    if (isAjax(req)) return res.json({ status: 'success', data: viewRecord, exists: Boolean(record) });

    return res.render('userSettings/form', {
      title: 'User Settings',
      mode: 'view',
      readOnly: true,
      record: viewRecord,
      selectedUser,
      hasSavedSettings: Boolean(record),
      settingsJson: JSON.stringify(viewRecord.settings || {}, null, 2),
      includeModal: true,
      user: req.user || null,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return respondError(req, res, error);
  }
}

async function showEditForm(req, res) {
  try {
    const { userId } = req.params;
    const record = await dataService.getDataById('userSettings', userId, SYSTEM_CONTEXT);
    const viewRecord = buildViewRecord(record, userId);
    const selectedUser = await loadSelectedUserDisplay(userId);

    return res.render('userSettings/form', {
      title: 'Edit User Settings',
      mode: 'edit',
      readOnly: false,
      record: viewRecord,
      selectedUser,
      hasSavedSettings: Boolean(record),
      settingsJson: JSON.stringify(viewRecord.settings || {}, null, 2),
      includeModal: true,
      user: req.user || null,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return respondError(req, res, error);
  }
}

async function editItem(req, res) {
  try {
    const { userId } = req.params;
    const settings = parseSettingsJson(req.body?.settingsJson);
    await userSettingsService.setSettings(userId, settings, req.user || SYSTEM_CONTEXT);
    invalidateAuthContextForUser(userId);

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        message: 'User settings saved successfully.'
      });
    }
    return res.redirect('/userSettings/');
  } catch (error) {
    return respondError(req, res, error, 400);
  }
}

async function deleteItem(req, res) {
  try {
    const { userId } = req.params;
    await dataService.deleteData('userSettings', userId, SYSTEM_CONTEXT);
    invalidateAuthContextForUser(userId);

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        message: 'User settings deleted successfully.'
      });
    }
    return res.redirect(req.headers.referer || '/userSettings/');
  } catch (error) {
    return respondError(req, res, error, 500);
  }
}

async function pickerUsers(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, USER_PICKER_QUERY_OPTIONS);
    const paged = await dataService.fetchDataPaged('users', query, SYSTEM_CONTEXT, {
      projection: USER_PICKER_PROJECTION
    });
    const rows = Array.isArray(paged?.rows) ? paged.rows : [];
    return res.json({
      status: 'success',
      results: rows.map((row) => sanitizeUserPickerRow(row)).filter((row) => row.id),
      pagination: paged?.pagination || null
    });
  } catch (error) {
    return res.status(400).json({
      status: 'error',
      message: error.message || 'Failed to load user picker.'
    });
  }
}

module.exports = {
  listAll,
  getItem,
  showEditForm,
  editItem,
  deleteItem,
  pickerUsers,
  sanitizeUserPickerRow,
  parseSettingsJson
};
