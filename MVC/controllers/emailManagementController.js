const emailManagementService = require('../services/emailManagementService');
const emailProviderProfileService = require('../services/emailProviderProfileService');
const emailEventDefinitionService = require('../services/emailEventDefinitionService');
const emailLedgerService = require('../services/emailLedgerService');
const paginate = require('../utils/paginationHelper');
const {
  canManageEmailTemplates,
  isSystemTemplateOrg,
  resolveEmailTemplateOrgContext,
  resolveActiveOrgEmailContext
} = require('../utils/emailTemplateOrgContext');
const path = require('path');
const crypto = require('crypto');
const coreFilesService = require('../services/coreFilesService');
const uploadFolderSettingsService = require('../services/uploadFolderSettingsService');
const { getRegisteredPackageNames } = require('../services/emailEventRegistry');

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
    templateKind: cleanString(body.templateKind, { max: 20, allowEmpty: true }).toLowerCase(),
    templateName: cleanString(body.templateName, { max: 180, allowEmpty: true }),
    eventKey: cleanString(body.eventKey, { max: 120, allowEmpty: true }).toUpperCase(),
    providerProfileId: cleanString(body.providerProfileId, { max: 120, allowEmpty: true }),
    packageName: cleanString(body.packageName, { max: 64, allowEmpty: true }).toUpperCase(),
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
      packageName: String(row?.packageName || 'CORE').trim().toUpperCase(),
      sectionId: String(row?.sectionId || '').trim().toUpperCase(),
      operationId: String(row?.operationId || '').trim().toUpperCase(),
      allowed: Array.isArray(row?.allowed) ? row.allowed : [],
      required: Array.isArray(row?.required) ? row.required : [],
      runtime: Array.isArray(row?.runtime) ? row.runtime : [],
      placeholders: Array.isArray(row?.placeholders) ? row.placeholders : []
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
    const [result, eventCatalog, canCreateTemplate, activeOrgContext] = await Promise.all([
      emailManagementService.listTemplates(req.query || {}, req.user),
      emailManagementService.getAccessibleEventDefinitions(req.user, { includeInactive: true }),
      canManageEmailTemplates(req.user, { scopeLabel: 'email templates' }),
      resolveActiveOrgEmailContext(req.user)
    ]);
    const packageFilterOptions = ['CORE', ...getRegisteredPackageNames().filter((pkg) => pkg !== 'CORE')];
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
        eventLabel: eventLabelByKey.get(eventKey) || eventLabelByComposite.get(opKey) || row?.eventLabel || '',
        routeRole: isSystemTemplateOrg(row?.orgId) ? 'platform_default' : 'org_override'
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
      packageFilterOptions,
      includeModal: true,
      includeModal_Table: true,
      print: true,
      user: req.user || null,
      actionStateId: req?.actionStateId || '',
      activeOrgContext
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

async function loadTemplateFormAssignments(reqUser) {
  const result = await emailManagementService.getEventAssignmentsForOrg(reqUser);
  return result?.assignments && typeof result.assignments === 'object' ? result.assignments : {};
}

async function showAddTemplateForm(req, res) {
  try {
    await resolveEmailTemplateOrgContext(req.user, { scopeLabel: 'email templates' });
    const forceEventKeys = [];
    const [eventCatalog, registryRows, eventAssignments, providerOptionsResult] = await Promise.all([
      emailManagementService.getAccessibleEventDefinitions(req.user, { includeInactive: true, forceEventKeys }),
      emailManagementService.getAccessiblePlaceholderRegistry(req.user, { includeInactive: true, forceEventKeys }),
      loadTemplateFormAssignments(req.user),
      emailProviderProfileService.listProviderOptionsForTemplate(req.user)
    ]);
    const isSystemMode = isSystemTemplateOrg(req.user?.activeOrgId);

    return res.render('emailManagement/templateForm', {
      title: 'Create Email Template',
      template: null,
      mediaDefaultFolder: getEmailTemplateMediaDefaultFolder(),
      eventCatalog,
      placeholderRegistry: registryRows,
      placeholderRegistryMap: buildPlaceholderMap(registryRows),
      eventAssignments,
      currentTemplateId: '',
      providerOptions: providerOptionsResult?.profiles || [],
      providerOptionsSource: providerOptionsResult?.source || 'org',
      isSystemMode,
      queryEventKey: cleanString(req.query?.eventKey, { max: 120, allowEmpty: true }).toUpperCase(),
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
    const [result, activeOrgContext] = await Promise.all([
      emailLedgerService.listEntries(req.query || {}, req.user),
      resolveActiveOrgEmailContext(req.user)
    ]);
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
      actionStateId: req?.actionStateId || '',
      activeOrgContext
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
    const excludeTemplateId = cleanString(req.query?.excludeTemplateId, { max: 120, allowEmpty: true });

    const [catalog, assignmentResult] = await Promise.all([
      emailManagementService.getAccessibleEventDefinitions(req.user, { includeInactive: false }),
      emailManagementService.getEventAssignmentsForOrg(req.user).catch(() => ({ assignments: {} }))
    ]);
    const assignments = assignmentResult?.assignments && typeof assignmentResult.assignments === 'object'
      ? assignmentResult.assignments
      : {};

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
    }).map((event) => {
      const eventKey = String(event?.eventKey || '').toUpperCase();
      const assignment = assignments[eventKey] || null;
      const assigned = Boolean(assignment?.id && assignment.id !== excludeTemplateId);
      const assignedSuffix = assigned ? ' [Assigned]' : '';
      const baseLabel = String(event?.label || eventKey || '').trim() || eventKey;
      return {
      id: eventKey,
      name: [
        String(event?.packageName || 'CORE').toUpperCase(),
        baseLabel + assignedSuffix
      ].filter(Boolean).join(' — '),
      eventKey,
      packageName: String(event?.packageName || 'CORE').toUpperCase(),
      label: baseLabel,
      sectionId: String(event?.sectionId || '').toUpperCase(),
      operationId: String(event?.operationId || '').toUpperCase(),
      allowedPlaceholders: Array.isArray(event?.allowedPlaceholders) ? event.allowedPlaceholders : [],
      requiredPlaceholders: Array.isArray(event?.requiredPlaceholders) ? event.requiredPlaceholders : [],
      description: `${String(event?.sectionId || '').toUpperCase()}::${String(event?.operationId || '').toUpperCase()}`,
      assigned,
      assignedTemplateId: assigned ? assignment.id : ''
    };
    });

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

async function pickerEmailTemplates(req, res) {
  try {
    const page = Math.max(1, Number.parseInt(String(req.query?.page || '1'), 10) || 1);
    const limit = Math.max(1, Number.parseInt(String(req.query?.limit || '20'), 10) || 20);
    const rawQuery = cleanString(req.query?.q, { max: 200, allowEmpty: true }).toLowerCase();
    const tokens = rawQuery ? rawQuery.split(/\s+/g).filter(Boolean) : [];

    const rows = await emailManagementService.listTemplatesForPicker(req.query || {}, req.user);
    const filtered = (Array.isArray(rows) ? rows : []).filter((row) => {
      if (!tokens.length) return true;
      const searchable = [
        row?.id || '',
        row?.label || '',
        row?.name || '',
        row?.packageName || '',
        row?.eventKey || '',
        row?.subjectTemplate || ''
      ].join(' ');
      return tokens.every((token) => matchesKeyword(searchable, token));
    });

    const startIndex = (page - 1) * limit;
    const paged = filtered.slice(startIndex, startIndex + limit);
    const pagination = buildPickerPagination(filtered.length, page, limit);
    return res.json({
      status: 'success',
      results: paged,
      pagination
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message || 'Unable to load email templates.' });
  }
}

async function pickerEmailPlaceholders(req, res) {
  try {
    const page = Math.max(1, Number.parseInt(String(req.query?.page || '1'), 10) || 1);
    const limit = Math.max(1, Number.parseInt(String(req.query?.limit || '20'), 10) || 20);
    const rawQuery = cleanString(req.query?.q, { max: 200, allowEmpty: true }).toLowerCase();
    const tokens = rawQuery ? rawQuery.split(/\s+/g).filter(Boolean) : [];

    const registryRows = await emailManagementService.getAccessiblePlaceholderRegistry(req.user, {
      includeInactive: true
    });
    const placeholders = emailEventDefinitionService.buildGlobalPlaceholderPickerRows(registryRows);
    const filtered = placeholders.filter((row) => {
      if (!tokens.length) return true;
      const searchable = [
        row?.key,
        row?.name,
        row?.description,
        ...(Array.isArray(row?.eventKeys) ? row.eventKeys : []),
        ...(Array.isArray(row?.eventLabels) ? row.eventLabels : [])
      ].join(' ');
      return tokens.every((token) => matchesKeyword(searchable, token));
    });

    const startIndex = (page - 1) * limit;
    const paged = filtered.slice(startIndex, startIndex + limit);
    const pagination = buildPickerPagination(filtered.length, page, limit);
    return res.json({ status: 'success', results: paged, pagination });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message || 'Unable to load placeholders.' });
  }
}

async function showEventRoutingList(req, res) {
  try {
    const [result, eventCatalog] = await Promise.all([
      emailManagementService.listEventRoutingCoverage(req.query || {}, req.user),
      emailManagementService.getAccessibleEventDefinitions(req.user, { includeInactive: false })
    ]);
    const rows = Array.isArray(result?.rows) ? result.rows : [];
    const pagination = result?.pagination || paginate(rows, req.query?.page, req.query?.limit).pagination;
    const isSystemMode = isSystemTemplateOrg(req.user?.activeOrgId);

    if (isAjax(req)) {
      return res.json({ status: 'success', data: rows, pagination });
    }

    return res.render('emailManagement/eventRoutingList', {
      title: 'Email Event Routing',
      data: rows,
      pagination,
      filters: req.query || {},
      eventCatalog: Array.isArray(eventCatalog) ? eventCatalog : [],
      isSystemMode,
      tableName: 'Email_Event_Routing',
      searchableFields: [
        'eventKey',
        'eventLabel',
        'packageName',
        'sectionId',
        'operationId',
        'orgTemplateId',
        'orgTemplateSubject',
        'systemTemplateId',
        'systemTemplateSubject',
        'effectiveRoute'
      ],
      includeModal: true,
      includeModal_Table: true,
      print: true,
      user: req.user || null,
      actionStateId: req?.actionStateId || ''
    });
  } catch (error) {
    if (isAjax(req)) {
      return res.status(400).json({ status: 'error', message: error.message || 'Unable to load event routing.' });
    }
    return res.status(500).render('error', {
      title: 'Error',
      message: error.message || 'Unable to load event routing.',
      user: req.user || null
    });
  }
}

async function listEventAssignments(req, res) {
  try {
    const result = await emailManagementService.getEventAssignmentsForOrg(req.user);
    return res.json({
      status: 'success',
      orgId: result?.orgId || '',
      assignments: result?.assignments || {}
    });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error.message || 'Unable to load event assignments.' });
  }
}

async function showEditTemplateForm(req, res) {
  try {
    const templateRow = await emailManagementService.getTemplateById(req.params.id, req.user);
    if (!templateRow) {
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'Email template not found.',
        user: req.user || null
      });
    }

    const forceEventKeys = [String(templateRow?.eventKey || '').trim().toUpperCase()].filter(Boolean);
    const [eventCatalog, registryRows, eventAssignments, providerOptionsResult] = await Promise.all([
      emailManagementService.getAccessibleEventDefinitions(req.user, {
        includeInactive: true,
        forceEventKeys
      }),
      emailManagementService.getAccessiblePlaceholderRegistry(req.user, {
        includeInactive: true,
        forceEventKeys
      }),
      loadTemplateFormAssignments(req.user),
      emailProviderProfileService.listProviderOptionsForTemplate(req.user)
    ]);
    const isSystemMode = isSystemTemplateOrg(templateRow?.orgId);

    return res.render('emailManagement/templateForm', {
      title: 'Edit Email Template',
      template: templateRow,
      mediaDefaultFolder: getEmailTemplateMediaDefaultFolder(),
      eventCatalog,
      placeholderRegistry: registryRows,
      placeholderRegistryMap: buildPlaceholderMap(registryRows),
      eventAssignments,
      currentTemplateId: String(templateRow?.id || '').trim(),
      providerOptions: providerOptionsResult?.profiles || [],
      providerOptionsSource: providerOptionsResult?.source || 'org',
      isSystemMode,
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
    await resolveEmailTemplateOrgContext(req.user, { scopeLabel: 'email templates' });
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
  showEventRoutingList,
  showEmailLedgerList,
  showEmailLedgerDetail,
  showAddTemplateForm,
  showEditTemplateForm,
  pickerEmailEvents,
  pickerEmailPlaceholders,
  listEventAssignments,
  pickerEmailTemplates,
  listTemplateMediaLibrary,
  addTemplate,
  editTemplate,
  deleteTemplate
};
