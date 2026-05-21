const emailManagementService = require('../services/emailManagementService');
const emailLedgerService = require('../services/emailLedgerService');
const paginate = require('../utils/paginationHelper');
const { assertCreateOrgContextOrThrow, canCreateOrgScopedItem } = require('../utils/orgContextUtils');
const path = require('path');
const crypto = require('crypto');
const coreFilesService = require('../services/coreFilesService');
const uploadFolderSettingsService = require('../services/uploadFolderSettingsService');
const settingService = require('../services/settingService');

function isAjax(req) {
  return Boolean(req?.headers?.['x-ajax-request'] || req?.xhr);
}

function cleanString(value, { max = 5000, allowEmpty = true } = {}) {
  if (value === undefined || value === null) return allowEmpty ? '' : null;
  const out = String(value).replace(/\0/g, '').trim();
  if (!allowEmpty && !out) return null;
  return out.length > max ? out.slice(0, max) : out;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const token = String(value ?? '').trim().toLowerCase();
  if (!token) return fallback;
  if (['true', '1', 'yes', 'y', 'on'].includes(token)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(token)) return false;
  return fallback;
}

function buildPayloadFromBody(body = {}) {
  return {
    eventKey: cleanString(body.eventKey, { max: 120, allowEmpty: true }).toUpperCase(),
    sectionId: cleanString(body.sectionId, { max: 120, allowEmpty: true }).toUpperCase(),
    operationId: cleanString(body.operationId, { max: 120, allowEmpty: true }).toUpperCase(),
    senderTemplate: cleanString(body.senderTemplate, { max: 320, allowEmpty: true }),
    recipientTemplate: cleanString(body.recipientTemplate, { max: 600, allowEmpty: true }),
    subjectTemplate: cleanString(body.subjectTemplate, { max: 260, allowEmpty: true }),
    bodyTemplate: cleanString(body.bodyTemplate, { max: 30000, allowEmpty: true }),
    isActive: normalizeBoolean(body.isActive, true)
  };
}

function buildPlaceholderMap(registryRows = []) {
  const map = {};
  (Array.isArray(registryRows) ? registryRows : []).forEach((row) => {
    const eventKey = String(row?.eventKey || '').trim().toUpperCase();
    const key = eventKey || `${String(row?.sectionId || '').trim().toUpperCase()}::${String(row?.operationId || '').trim().toUpperCase()}`;
    if (!key || key === '::') return;
    map[key] = {
      eventKey,
      label: row?.label || key,
      sectionId: String(row?.sectionId || '').trim().toUpperCase(),
      operationId: String(row?.operationId || '').trim().toUpperCase(),
      allowed: Array.isArray(row?.allowed) ? row.allowed : [],
      required: Array.isArray(row?.required) ? row.required : []
    };
  });
  return map;
}

function buildPickerPagination(totalItems = 0, page = 1, limit = 20) {
  const safeLimit = Math.max(1, Number.parseInt(String(limit || 20), 10) || 20);
  const safePage = Math.max(1, Number.parseInt(String(page || 1), 10) || 1);
  const safeTotal = Math.max(0, Number(totalItems) || 0);
  const totalPages = Math.max(1, Math.ceil(safeTotal / safeLimit));
  const currentPage = Math.min(safePage, totalPages);
  const startItem = safeTotal > 0 ? ((currentPage - 1) * safeLimit + 1) : 0;
  const endItem = Math.min(currentPage * safeLimit, safeTotal);
  return {
    currentPage,
    totalPages,
    totalItems: safeTotal,
    limit: safeLimit,
    startItem,
    endItem
  };
}

function matchesKeyword(haystack = '', needle = '') {
  const source = String(haystack || '').toLowerCase();
  const query = String(needle || '').toLowerCase();
  if (!query) return true;
  return source.includes(query);
}

function resolveDefaultPageSize() {
  const raw = Number.parseInt(String(settingService.getValue('app', 'defaultPageSize') || ''), 10);
  if (!Number.isFinite(raw) || Number.isNaN(raw) || raw <= 0) return 30;
  return Math.max(5, Math.min(500, raw));
}

function normalizeRelativeFolderToken(value, max = 800) {
  const token = cleanString(value, { max, allowEmpty: true }).replace(/\\/g, '/');
  if (!token || token === '/' || token === '.') return '';
  const compact = token
    .split('/')
    .map((part) => cleanString(part, { max: 200, allowEmpty: true }))
    .filter(Boolean)
    .join('/');
  if (!compact || compact === '.') return '';
  return compact.replace(/^\/+/, '').replace(/\/+$/, '');
}

function isImageFilename(fileName = '') {
  const ext = String(path.extname(String(fileName || '')).toLowerCase() || '').trim();
  return ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico'].includes(ext);
}

function normalizeScopeKeyToken(value = '') {
  const token = String(value || '').trim().toUpperCase();
  if (!token || token === 'SYSTEM' || token === 'GLOBAL') return '';
  return token.replace(/^ORG_/, '');
}

function buildScopeUploadPrefix(scopeKey = '') {
  const token = String(scopeKey || '').trim().toUpperCase();
  return token ? `/uploads/ORG_${token}` : '/uploads/GLOBAL';
}

function encodeUploadUrl(uploadPath = '') {
  const normalized = String(uploadPath || '').replace(/\\/g, '/').replace(/\/+/g, '/').trim();
  if (!normalized) return '';
  return normalized
    .split('/')
    .map((part, index) => (index === 0 ? part : encodeURIComponent(part)))
    .join('/');
}

function buildMediaLibraryRow(entry = {}, scopeKey = '', currentFolder = '') {
  const fileName = cleanString(entry.name, { max: 260, allowEmpty: true });
  const folder = normalizeRelativeFolderToken(currentFolder);
  const uploadPath = `${buildScopeUploadPrefix(scopeKey)}/${[folder, fileName].filter(Boolean).join('/')}`.replace(/\/+/g, '/');
  const digest = crypto.createHash('md5').update(uploadPath).digest('hex');
  return {
    id: `LIB_${digest}`,
    name: fileName,
    originalName: fileName,
    filename: fileName,
    path: uploadPath,
    url: encodeUploadUrl(uploadPath),
    mimeType: '',
    size: Number(entry.size || 0) || 0,
    uploadDate: entry.modified ? new Date(entry.modified).toISOString() : '',
    source: 'saved_library'
  };
}

function activeOrgScopeId(user = null) {
  return normalizeScopeKeyToken(user?.activeOrgId);
}

function getEmailTemplateMediaDefaultFolder() {
  return uploadFolderSettingsService.resolveUploadFolder('core.emailTemplates');
}

async function showTemplateList(req, res) {
  try {
    const [result, eventCatalog, canCreateTemplate] = await Promise.all([
      emailManagementService.listTemplates(req.query || {}, req.user),
      Promise.resolve(emailManagementService.getSupportedEventCatalog({ includeInactive: true })),
      canCreateOrgScopedItem(req.user, { scopeLabel: 'email templates' })
    ]);
    const baseRows = Array.isArray(result?.rows) ? result.rows : (Array.isArray(result) ? result : []);
    const eventLabelByComposite = new Map();
    const eventLabelByKey = new Map();
    (Array.isArray(eventCatalog) ? eventCatalog : []).forEach((event) => {
      const eventKey = String(event?.eventKey || '').trim().toUpperCase();
      const sectionId = String(event?.sectionId || '').trim().toUpperCase();
      const operationId = String(event?.operationId || '').trim().toUpperCase();
      const label = String(event?.label || eventKey || `${sectionId}::${operationId}`);
      if (eventKey) eventLabelByKey.set(eventKey, label);
      if (sectionId && operationId) {
        eventLabelByComposite.set(`${sectionId}::${operationId}`, label);
      }
    });

    const rows = baseRows.map((row) => {
      const sectionId = String(row?.sectionId || '').trim().toUpperCase();
      const operationId = String(row?.operationId || '').trim().toUpperCase();
      const eventKey = String(row?.eventKey || '').trim().toUpperCase();
      const opKey = `${sectionId}::${operationId}`;
      return {
        ...row,
        sectionLabel: sectionId || '',
        operationLabel: operationId || '',
        eventKey,
        eventLabel: eventLabelByKey.get(eventKey) || eventLabelByComposite.get(opKey) || row?.eventLabel || ''
      };
    });
    const fallbackPagination = paginate(rows, req.query?.page, req.query?.limit).pagination;
    const pagination = result?.pagination || fallbackPagination;

    if (isAjax(req)) {
      return res.json({ status: 'success', data: rows, pagination });
    }

    return res.render('emailManagement/templateList', {
      title: 'Email Templates',
      data: rows,
      pagination,
      filters: req.query || {},
      newUrl: 'email-management/templates',
      newLabel: canCreateTemplate ? 'Add Email Template' : null,
      tableName: 'Email_Management_Templates',
      eventCatalog: Array.isArray(eventCatalog) ? eventCatalog : [],
      includeModal: true,
      includeModal_Table: true,
      print: true,
      user: req.user || null,
      actionStateId: req?.actionStateId || ''
    });
  } catch (error) {
    if (isAjax(req)) {
      return res.status(400).json({ status: 'error', message: error.message || 'Unable to load templates.' });
    }
    return res.status(500).render('error', {
      title: 'Error',
      message: error.message || 'Unable to load templates.',
      user: req.user || null
    });
  }
}

async function showAddTemplateForm(req, res) {
  try {
    await assertCreateOrgContextOrThrow(req.user, { scopeLabel: 'email templates' });
    const [eventCatalog, registryRows] = await Promise.all([
      Promise.resolve(emailManagementService.getSupportedEventCatalog({ includeInactive: true })),
      Promise.resolve(emailManagementService.getPlaceholderRegistrySnapshot())
    ]);

    return res.render('emailManagement/templateForm', {
      title: 'Create Email Template',
      template: null,
      mediaDefaultFolder: getEmailTemplateMediaDefaultFolder(),
      eventCatalog,
      placeholderRegistry: registryRows,
      placeholderRegistryMap: buildPlaceholderMap(registryRows),
      includeModal: true,
      print: true,
      user: req.user || null,
      actionStateId: req?.actionStateId || ''
    });
  } catch (error) {
    return res.status(500).render('error', {
      title: 'Error',
      message: error.message || 'Unable to open template form.',
      user: req.user || null
    });
  }
}

async function showEmailLedgerList(req, res) {
  try {
    const result = await emailLedgerService.listEntries(req.query || {}, req.user);
    const rows = Array.isArray(result?.rows) ? result.rows : [];
    const pagination = result?.pagination || paginate(rows, req.query?.page, req.query?.limit).pagination;

    if (isAjax(req)) {
      return res.json({
        status: 'success',
        data: rows,
        pagination
      });
    }

    return res.render('emailManagement/ledgerList', {
      title: 'Email Ledger',
      data: rows,
      pagination,
      filters: req.query || {},
      tableName: 'Email_Management_Ledger',
      includeModal: true,
      includeModal_Table: true,
      print: true,
      user: req.user || null,
      actionStateId: req?.actionStateId || ''
    });
  } catch (error) {
    if (isAjax(req)) {
      return res.status(400).json({ status: 'error', message: error.message || 'Unable to load email ledger.' });
    }
    return res.status(500).render('error', {
      title: 'Error',
      message: error.message || 'Unable to load email ledger.',
      user: req.user || null
    });
  }
}

async function showEmailLedgerDetail(req, res) {
  try {
    const row = await emailLedgerService.getEntryById(req.params.id, req.user);
    if (!row) {
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'Email ledger entry not found.',
        user: req.user || null
      });
    }
    return res.render('emailManagement/ledgerDetail', {
      title: 'Email Ledger Detail',
      entry: row,
      includeModal: true,
      print: true,
      user: req.user || null
    });
  } catch (error) {
    return res.status(500).render('error', {
      title: 'Error',
      message: error.message || 'Unable to load email ledger detail.',
      user: req.user || null
    });
  }
}

async function pickerEmailEvents(req, res) {
  try {
    const page = Math.max(1, Number.parseInt(String(req.query?.page || '1'), 10) || 1);
    const limit = Math.max(1, Number.parseInt(String(req.query?.limit || '20'), 10) || 20);
    const rawQuery = cleanString(req.query?.q, { max: 200, allowEmpty: true }).toLowerCase();
    const tokens = rawQuery ? rawQuery.split(/\s+/g).filter(Boolean) : [];

    const catalog = emailManagementService.getSupportedEventCatalog({ includeInactive: false });
    const filtered = (Array.isArray(catalog) ? catalog : []).filter((event) => {
      if (!tokens.length) return true;
      const searchable = [
        event?.eventKey || '',
        event?.label || '',
        event?.sectionId || '',
        event?.operationId || '',
        ...(Array.isArray(event?.allowedPlaceholders) ? event.allowedPlaceholders : []),
        ...(Array.isArray(event?.requiredPlaceholders) ? event.requiredPlaceholders : [])
      ].join(' ');
      return tokens.every((token) => matchesKeyword(searchable, token));
    }).map((event) => ({
      id: String(event?.eventKey || '').toUpperCase(),
      name: String(event?.label || event?.eventKey || '').trim() || String(event?.eventKey || '').toUpperCase(),
      eventKey: String(event?.eventKey || '').toUpperCase(),
      label: String(event?.label || event?.eventKey || '').trim() || String(event?.eventKey || '').toUpperCase(),
      sectionId: String(event?.sectionId || '').toUpperCase(),
      operationId: String(event?.operationId || '').toUpperCase(),
      allowedPlaceholders: Array.isArray(event?.allowedPlaceholders) ? event.allowedPlaceholders : [],
      requiredPlaceholders: Array.isArray(event?.requiredPlaceholders) ? event.requiredPlaceholders : [],
      description: `${String(event?.sectionId || '').toUpperCase()}::${String(event?.operationId || '').toUpperCase()}`
    }));

    const startIndex = (page - 1) * limit;
    const paged = filtered.slice(startIndex, startIndex + limit);
    const pagination = buildPickerPagination(filtered.length, page, limit);
    return res.json({
      status: 'success',
      results: paged,
      pagination
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message || 'Unable to load email events.' });
  }
}

async function listTemplateMediaLibrary(req, res) {
  try {
    const defaultPageSize = resolveDefaultPageSize();
    const scopeKey = activeOrgScopeId(req.user);
    const defaultFolder = normalizeRelativeFolderToken(getEmailTemplateMediaDefaultFolder()) || 'email-templates';
    if (!scopeKey) {
      return res.json({
        status: 'success',
        message: 'Saved media library is available for organization scope only.',
        results: [],
        folders: [],
        currentFolder: '',
        parentFolder: '',
        defaultFolder,
        defaults: { pageSize: defaultPageSize }
      });
    }

    const requestedFolder = normalizeRelativeFolderToken(req.query?.folder);
    const candidateFolders = requestedFolder
      ? [requestedFolder, defaultFolder, '']
      : [defaultFolder, ''];

    let currentFolder = '';
    let entries = [];
    for (const folderToken of candidateFolders) {
      // eslint-disable-next-line no-await-in-loop
      const listed = await coreFilesService.listDirectoryByScope({
        scopeKey,
        relativeDir: normalizeRelativeFolderToken(folderToken)
      }).catch(() => null);
      if (Array.isArray(listed)) {
        currentFolder = normalizeRelativeFolderToken(folderToken);
        entries = listed;
        break;
      }
    }
    const folders = [];
    const rows = [];

    for (const entry of entries) {
      if (!entry) continue;
      const name = cleanString(entry.name, { max: 260, allowEmpty: true });
      if (!name) continue;
      if (entry.isDir) {
        folders.push({
          name,
          path: normalizeRelativeFolderToken([currentFolder, name].filter(Boolean).join('/'))
        });
        continue;
      }
      if (!isImageFilename(name)) continue;
      rows.push(buildMediaLibraryRow(entry, scopeKey, currentFolder));
    }

    folders.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    rows.sort((a, b) => String(b.uploadDate || '').localeCompare(String(a.uploadDate || '')));
    const parentFolder = currentFolder.includes('/')
      ? currentFolder.split('/').slice(0, -1).join('/')
      : '';

    return res.json({
      status: 'success',
      message: rows.length ? `Loaded ${rows.length} image file(s).` : 'No saved image files found.',
      results: rows,
      folders,
      currentFolder,
      parentFolder,
      defaultFolder,
      defaults: { pageSize: defaultPageSize }
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message || 'Unable to load saved media library.' });
  }
}

async function showEditTemplateForm(req, res) {
  try {
    const [templateRow, eventCatalog, registryRows] = await Promise.all([
      emailManagementService.getTemplateById(req.params.id, req.user),
      Promise.resolve(emailManagementService.getSupportedEventCatalog({ includeInactive: true })),
      Promise.resolve(emailManagementService.getPlaceholderRegistrySnapshot())
    ]);
    if (!templateRow) {
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'Email template not found.',
        user: req.user || null
      });
    }

    return res.render('emailManagement/templateForm', {
      title: 'Edit Email Template',
      template: templateRow,
      mediaDefaultFolder: getEmailTemplateMediaDefaultFolder(),
      eventCatalog,
      placeholderRegistry: registryRows,
      placeholderRegistryMap: buildPlaceholderMap(registryRows),
      includeModal: true,
      print: true,
      user: req.user || null,
      actionStateId: req?.actionStateId || ''
    });
  } catch (error) {
    return res.status(500).render('error', {
      title: 'Error',
      message: error.message || 'Unable to open template form.',
      user: req.user || null
    });
  }
}

async function addTemplate(req, res) {
  try {
    await assertCreateOrgContextOrThrow(req.user, { scopeLabel: 'email templates' });
    const payload = buildPayloadFromBody(req.body || {});
    await emailManagementService.createTemplate(payload, req.user);
    if (isAjax(req)) {
      return res.json({ status: 'success', message: 'Email template saved successfully.' });
    }
    return res.redirect('/email-management/templates');
  } catch (error) {
    if (isAjax(req)) {
      return res.status(400).json({ status: 'error', message: error.message || 'Failed to save template.' });
    }
    return res.status(500).render('error', {
      title: 'Error',
      message: error.message || 'Failed to save template.',
      user: req.user || null
    });
  }
}

async function editTemplate(req, res) {
  try {
    const payload = buildPayloadFromBody(req.body || {});
    await emailManagementService.updateTemplate(req.params.id, payload, req.user);
    if (isAjax(req)) {
      return res.json({ status: 'success', message: 'Email template updated successfully.' });
    }
    return res.redirect('/email-management/templates');
  } catch (error) {
    if (isAjax(req)) {
      return res.status(400).json({ status: 'error', message: error.message || 'Failed to update template.' });
    }
    return res.status(500).render('error', {
      title: 'Error',
      message: error.message || 'Failed to update template.',
      user: req.user || null
    });
  }
}

async function deleteTemplate(req, res) {
  try {
    await emailManagementService.deleteTemplate(req.params.id, req.user);
    if (isAjax(req)) {
      return res.json({ status: 'success', message: 'Email template deleted successfully.' });
    }
    return res.redirect('/email-management/templates');
  } catch (error) {
    if (isAjax(req)) {
      return res.status(400).json({ status: 'error', message: error.message || 'Failed to delete template.' });
    }
    return res.status(500).render('error', {
      title: 'Error',
      message: error.message || 'Failed to delete template.',
      user: req.user || null
    });
  }
}

module.exports = {
  showTemplateList,
  showEmailLedgerList,
  showEmailLedgerDetail,
  showAddTemplateForm,
  showEditTemplateForm,
  pickerEmailEvents,
  listTemplateMediaLibrary,
  addTemplate,
  editTemplate,
  deleteTemplate
};
