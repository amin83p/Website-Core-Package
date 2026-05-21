const dataService = require('../services/dataService');
const { buildDataServiceQuery } = require('../utils/generalTools');

const ROLE_LIST_QUERY_OPTIONS = Object.freeze({
  allowedExactKeys: ['id', 'key', 'label', 'domain', 'packageName', 'active', 'system'],
  allowedSearchFields: ['id', 'key', 'label', 'description', 'domain', 'packageName', 'aliases'],
  defaultSearchFields: ['id', 'key', 'label', 'description', 'domain', 'packageName', 'aliases'],
  allowMetaKeys: true
});

function parseBool(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return Boolean(defaultValue);
  if (typeof value === 'boolean') return value;
  return String(value || '').toLowerCase().trim() === 'true';
}

function parseAliases(raw) {
  if (Array.isArray(raw)) return raw;
  return String(raw || '')
    .split(/[\n,]/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function buildRoleFromBody(body = {}, reqUserId = 'SYSTEM', existing = null) {
  const now = new Date().toISOString();
  const role = {
    key: String(body.key || '').trim().toLowerCase(),
    label: String(body.label || '').trim(),
    description: String(body.description || '').trim(),
    domain: String(body.domain || '').trim().toLowerCase(),
    packageName: String(body.packageName || '').trim().toUpperCase(),
    aliases: parseAliases(body.aliases),
    active: parseBool(body.active, existing ? existing.active !== false : true),
    system: existing ? Boolean(existing.system) : parseBool(body.system, false),
    audit: {
      createUser: existing?.audit?.createUser ?? reqUserId,
      createDateTime: existing?.audit?.createDateTime ?? now,
      lastUpdateUser: reqUserId,
      lastUpdateDateTime: now
    }
  };
  return role;
}

async function listRoles(req, res) {
  try {
    const query = await buildDataServiceQuery(req.query, ROLE_LIST_QUERY_OPTIONS);
    const page = Number.parseInt(req.query?.page, 10) || Number.parseInt(query?.page, 10) || 1;
    const limit = Number.parseInt(req.query?.limit, 10) || Number.parseInt(query?.limit, 10) || undefined;

    const paged = await dataService.fetchDataPaged('roles', {
      ...query,
      page,
      limit
    }, req.user);
    const data = Array.isArray(paged?.rows) ? paged.rows : [];
    const pagination = paged?.pagination || null;

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', results: data, pagination });
    }

    return res.render('role/roles', {
      title: 'Role Management',
      tableName: 'Roles_Management',
      newLabel: 'Add Role',
      newUrl: 'roles',
      includeModal: true,
      includeModal_Table: true,
      includeModal_FileImport: true,
      print: true,
      roles: data,
      pagination,
      searchableFields: ROLE_LIST_QUERY_OPTIONS.defaultSearchFields,
      filters: req.query,
      user: req.user || null,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(500).json({ status: 'error', message: error.message, error });
    }
    return res.status(500).render('error', {
      title: 'Error',
      message: error.message,
      error,
      user: req.user || null
    });
  }
}

async function showAddRoleForm(req, res) {
  try {
    return res.render('role/roleForm', {
      title: 'Add Role',
      includeModal: true,
      role: null,
      user: req.user || null,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', {
      title: 'Error',
      message: error.message,
      user: req.user || null
    });
  }
}

async function addRole(req, res) {
  try {
    const reqUserId = req.user ? String(req.user.id) : 'SYSTEM';
    const role = buildRoleFromBody(req.body, reqUserId);
    const result = await dataService.addData('roles', role, req.user);

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', result, message: 'Role saved successfully.' });
    }
    return res.redirect('/roles');
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(400).json({ status: 'error', message: error.message, error });
    }
    return res.status(500).render('error', {
      title: 'Error',
      message: error.message,
      error,
      user: req.user || null
    });
  }
}

async function showEditRoleForm(req, res) {
  try {
    const role = await dataService.getDataById('roles', req.params.id, req.user);
    if (!role) throw new Error('Role not found.');

    return res.render('role/roleForm', {
      title: 'Edit Role',
      includeModal: true,
      role,
      user: req.user || null,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', {
      title: 'Error',
      message: error.message,
      user: req.user || null
    });
  }
}

async function editRole(req, res) {
  try {
    const existing = await dataService.getDataById('roles', req.params.id, req.user);
    if (!existing) throw new Error('Role not found.');
    if (existing.system === true) throw new Error('System roles are read-only and cannot be modified.');

    const reqUserId = req.user ? String(req.user.id) : 'SYSTEM';
    const updates = buildRoleFromBody(req.body, reqUserId, existing);
    const result = await dataService.updateData('roles', req.params.id, updates, req.user);

    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', result, message: 'Role saved successfully.' });
    }
    return res.redirect('/roles');
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(400).json({ status: 'error', message: error.message, error });
    }
    return res.status(500).render('error', {
      title: 'Error',
      message: error.message,
      error,
      user: req.user || null
    });
  }
}

async function deleteRole(req, res) {
  try {
    const result = await dataService.deleteData('roles', req.params.id, req.user);
    if (req.headers['x-ajax-request']) {
      return res.json({ status: 'success', result, message: 'Role deleted successfully.' });
    }
    return res.redirect('/roles');
  } catch (error) {
    if (req.headers['x-ajax-request']) {
      return res.status(400).json({ status: 'error', message: error.message, error });
    }
    return res.status(500).render('error', {
      title: 'Error',
      message: error.message,
      error,
      user: req.user || null
    });
  }
}

module.exports = {
  listRoles,
  showAddRoleForm,
  addRole,
  showEditRoleForm,
  editRole,
  deleteRole
};
