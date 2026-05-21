// MVC/controllers/fileController.js
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const pathResolver = require('../utils/pathResolver');
const { isRailwayProxyMode } = require('../utils/uploadModeUtils');
const organizationRepository = require('../repositories/organizationRepository');
const orgFileBackupService = require('../services/orgFileBackupService');
const adminAuthorityService = require('../services/adminAuthorityService');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');
const {
  gatewayCreateFolder,
  gatewayDeleteByRelativePath,
  gatewayMoveItem,
  gatewayCopyItem,
  gatewayRenameItem,
  gatewayUploadFile,
  gatewayListDirectory,
  gatewayDownloadOrgBackup,
  gatewayRestoreOrgBackup
} = require('../services/fileGatewayClientService');

const INVALID_NAME_PATTERN = /[<>:"/\\|?*\x00-\x1F]/;
const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
]);

/* ---------------- HELPERS ---------------- */

function isAjax(req) {
  return Boolean(req.headers['x-ajax-request']);
}

function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

function getUserDrives(user) {
  const drives = [];
  if (adminAuthorityService.isAdminForRequest(user, SECTIONS.UPLOADED_FILES, OPERATIONS.READ_ALL, { section: { id: SECTIONS.UPLOADED_FILES } })) {
    drives.push({ name: 'System (Global)', id: 'GLOBAL', icon: 'bi-globe' });
  }
  if (user.activeOrgId && user.activeOrgId !== 'SYSTEM') {
    const orgToken = String(user.activeOrgId || '').trim().replace(/^ORG_/i, '');
    if (orgToken) drives.push({ name: 'Active Org', id: `ORG_${orgToken}`, icon: 'bi-building' });
  }
  return drives;
}

function canManageOrgBackups(user) {
  return adminAuthorityService.isAdminForRequest(user, SECTIONS.UPLOADED_FILES, OPERATIONS.DOWNLOAD_FILE, { section: { id: SECTIONS.UPLOADED_FILES } });
}

function getOrganizationLabel(org = {}) {
  return String(
    org?.identity?.displayName ||
    org?.identity?.legalName ||
    org?.name ||
    org?.displayName ||
    org?.id ||
    ''
  ).trim();
}

async function getOrgBackupOrganizations(user) {
  if (!canManageOrgBackups(user)) return [];
  const globalScope = {
    id: 'GLOBAL',
    scope: 'GLOBAL',
    label: 'System (Global)'
  };
  let rows = [];
  try {
    rows = await organizationRepository.list({
      query: { page: 1, limit: 1000 },
      scope: { canViewAll: true }
    });
  } catch (error) {
    console.warn('[FileManager][OrgBackup] Organization list failed; showing Global only.', error?.message || error);
    return [globalScope];
  }
  const orgRows = (Array.isArray(rows) ? rows : [])
    .map((org) => {
      const rawId = String(org?.id || '').trim();
      if (!rawId || rawId.toUpperCase() === 'SYSTEM' || rawId.toUpperCase() === 'GLOBAL') return null;
      const id = orgFileBackupService.normalizeOrgId(rawId);
      return {
        id,
        scope: orgFileBackupService.getOrgScopeFolder(id),
        label: getOrganizationLabel(org) || id
      };
    })
    .filter((org) => org && org.id)
    .sort((a, b) => a.label.localeCompare(b.label));
  return [globalScope, ...orgRows];
}

async function assertOrgBackupRequest(req) {
  if (!canManageOrgBackups(req.user)) {
    throw new Error('Only system administrators can manage upload folder backups.');
  }
  const orgId = orgFileBackupService.normalizeOrgId(req.body?.orgId || req.query?.orgId || '');
  if (orgId === 'GLOBAL') {
    return {
      orgId,
      org: {
        id: 'GLOBAL',
        identity: { displayName: 'System (Global)' }
      }
    };
  }
  const org = await organizationRepository.getById(orgId);
  if (!org) throw new Error('Selected organization or global folder was not found.');
  return { orgId, org };
}

function sanitizeDrivePath(pathValue = '') {
  return String(pathValue || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .trim();
}

function assertValidName(name, label = 'name') {
  const token = String(name || '').trim();
  if (!token) throw new Error(`Invalid ${label}.`);
  if (token === '.' || token === '..') throw new Error(`Invalid ${label}.`);
  if (INVALID_NAME_PATTERN.test(token)) throw new Error(`Invalid ${label}.`);
  if (WINDOWS_RESERVED_NAMES.has(token.toUpperCase())) throw new Error(`Invalid ${label}.`);
  return token;
}

function assertValidRelativePath(input = '', label = 'path') {
  const normalized = sanitizeDrivePath(input);
  if (!normalized) return '';
  if (path.isAbsolute(normalized)) throw new Error(`Invalid ${label}.`);

  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length) return '';

  const cleanParts = parts.map((part) => assertValidName(part, label));
  return cleanParts.join('/');
}

function resolveContextFromPath(user, requestedPath, options = {}) {
  const allowRoot = Boolean(options.allowRoot);
  const currentPath = sanitizeDrivePath(requestedPath);
  const parts = currentPath.split('/').filter(Boolean);
  const availableDrives = getUserDrives(user);

  if (!parts.length) {
    if (allowRoot) {
      return {
        isRoot: true,
        availableDrives,
        currentPath: ''
      };
    }
    throw new Error('Invalid path.');
  }

  const rootId = parts[0];
  const hasAccess = availableDrives.some((drive) => drive.id === rootId);
  if (!hasAccess && !adminAuthorityService.isSuperAdmin(user)) {
    throw new Error('Access Denied: You do not have permission to view this folder.');
  }

  const scopeKey = rootId === 'GLOBAL' ? 'GLOBAL' : rootId.replace(/^ORG_/i, '');
  const relativeSub = parts.slice(1).join('/');
  const baseDir = pathResolver.getRootPath(scopeKey);
  const targetPath = pathResolver.resolveSafePath(baseDir, relativeSub);

  return {
    isRoot: false,
    availableDrives,
    rootId,
    scopeKey,
    relativeSub,
    baseDir,
    targetPath,
    currentPath
  };
}

function getWebUrl(scopeId, subfolder, filename) {
  let url = '/uploads';
  if (scopeId === 'GLOBAL') url += '/GLOBAL';
  else url += `/ORG_${scopeId}`;

  if (subfolder && subfolder !== '.' && subfolder !== './') {
    url += `/${subfolder.replace(/^\/+|\/+$/g, '')}`;
  }
  url += `/${filename}`;
  return url;
}

function buildCurrentPathFromUploadBody(body = {}) {
  const explicitPath = assertValidRelativePath(body.path || '', 'path');
  if (explicitPath) return explicitPath;

  const scopeTokenRaw = String(body.targetOrgId || 'GLOBAL').trim();
  const scopeToken = scopeTokenRaw.toUpperCase() === 'GLOBAL'
    ? 'GLOBAL'
    : `ORG_${scopeTokenRaw.replace(/^ORG_/i, '')}`;
  const subfolder = assertValidRelativePath(body.category || '', 'path');
  if (!subfolder) return scopeToken;
  return `${scopeToken}/${subfolder}`;
}

function parseRelativePathsMap(req) {
  const raw = req.body && typeof req.body.relativePathsJson === 'string'
    ? req.body.relativePathsJson
    : '';
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function splitFilePath(relativeToken = '', fallbackName = '') {
  const clean = assertValidRelativePath(relativeToken, 'file path');
  if (!clean) return { relativeDir: '', fileName: assertValidName(fallbackName, 'file name') };

  const parts = clean.split('/').filter(Boolean);
  const fileNameFromPath = parts.pop() || '';
  const fileName = assertValidName(fileNameFromPath || fallbackName, 'file name');
  const relativeDir = parts.join('/');
  return { relativeDir, fileName };
}

function resolveAvailableFilePath(directory, desiredName) {
  const ext = path.extname(desiredName);
  const base = path.basename(desiredName, ext);
  let candidate = path.join(directory, desiredName);
  let index = 1;

  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${base}_${index}${ext}`);
    index += 1;
  }

  return candidate;
}

function getFileManagerUploadConcurrency() {
  const parsed = Number.parseInt(String(process.env.FILE_MANAGER_UPLOAD_CONCURRENCY || '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 8) : 3;
}

async function runWithConcurrency(items = [], concurrency = 3, worker) {
  const list = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Math.min(Number(concurrency) || 1, list.length || 1));
  let nextIndex = 0;

  async function runNext() {
    while (nextIndex < list.length) {
      const index = nextIndex;
      nextIndex += 1;
      // eslint-disable-next-line no-await-in-loop
      await worker(list[index], index);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runNext()));
}

function isSameOrInsidePath(basePath = '', targetPath = '') {
  const base = path.resolve(String(basePath || ''));
  const target = path.resolve(String(targetPath || ''));
  if (!base || !target) return false;
  if (base === target) return true;
  const relative = path.relative(base, target);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function copyPathRecursive(sourcePath, destinationPath) {
  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    fs.cpSync(sourcePath, destinationPath, { recursive: true, errorOnExist: true });
    return;
  }
  fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
}

function movePathSafe(sourcePath, destinationPath) {
  try {
    fs.renameSync(sourcePath, destinationPath);
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error;
    copyPathRecursive(sourcePath, destinationPath);
    fs.rmSync(sourcePath, { recursive: true, force: true });
  }
}

function sendArchiveResponse(res, archive) {
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${archive.fileName}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const stream = fs.createReadStream(archive.archivePath);
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    archive.cleanup().catch(() => null);
  };
  stream.on('close', cleanup);
  stream.on('error', (error) => {
    cleanup();
    if (!res.headersSent) res.status(500).send(error.message || 'Backup download failed.');
    else res.destroy(error);
  });
  res.on('close', cleanup);
  stream.pipe(res);
}

function pipeGatewayBackupResponse(res, gatewayResponse, fallbackFileName) {
  const contentType = gatewayResponse.headers.get('content-type') || 'application/gzip';
  const contentDisposition = gatewayResponse.headers.get('content-disposition')
    || `attachment; filename="${fallbackFileName}"`;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', contentDisposition);
  res.setHeader('Cache-Control', gatewayResponse.headers.get('cache-control') || 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (!gatewayResponse.body || typeof Readable.fromWeb !== 'function') {
    throw new Error('Gateway backup response stream is not available.');
  }
  const stream = Readable.fromWeb(gatewayResponse.body);
  stream.on('error', (error) => {
    if (!res.headersSent) res.status(500).send(error.message || 'Backup download failed.');
    else res.destroy(error);
  });
  stream.pipe(res);
}

function buildOperationDestinationPath(destinationContext = {}, finalName = '') {
  return [destinationContext.currentPath, finalName]
    .filter(Boolean)
    .join('/')
    .replace(/\\/g, '/');
}

function parseSourcePathInputs(body = {}) {
  const values = [];
  const pushValue = (value) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach(pushValue);
      return;
    }
    const token = String(value || '').trim();
    if (!token) return;
    if (token.startsWith('[') && token.endsWith(']')) {
      try {
        const parsed = JSON.parse(token);
        if (Array.isArray(parsed)) {
          parsed.forEach(pushValue);
          return;
        }
      } catch (_) {
        // Treat invalid JSON as a literal token.
      }
    }
    values.push(token);
  };

  pushValue(body.sourcePath);
  pushValue(body.sourcePaths);
  pushValue(body['sourcePaths[]']);

  if (typeof body.sourcePathsJson === 'string' && body.sourcePathsJson.trim()) {
    try {
      const parsedJson = JSON.parse(body.sourcePathsJson);
      if (Array.isArray(parsedJson)) parsedJson.forEach(pushValue);
    } catch (_) {
      pushValue(body.sourcePathsJson);
    }
  }

  const deduped = [];
  const seen = new Set();
  values.forEach((token) => {
    const key = String(token || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push(key);
  });
  return deduped;
}

function buildPathBreadcrumbs(pathValue = '') {
  const breadcrumbs = [];
  let accum = '';
  String(pathValue || '').split('/').filter(Boolean).forEach((part, idx) => {
    accum += (idx === 0 ? part : `/${part}`);
    breadcrumbs.push({ name: part, path: accum });
  });
  return breadcrumbs;
}

async function listFolderRowsForContext(context = {}) {
  let contents = [];
  if (isRailwayProxyMode()) {
    const gatewayResult = await gatewayListDirectory({
      scopeKey: context.scopeKey,
      relativeDir: context.relativeSub
    });
    contents = (Array.isArray(gatewayResult?.files) ? gatewayResult.files : []).map((item) => ({
      name: item.name,
      isDir: Boolean(item.isDir),
      modified: item.modified ? new Date(item.modified) : new Date(0),
      path: path.join(context.currentPath, item.name).replace(/\\/g, '/')
    }));
  } else {
    pathResolver.ensureDir(context.targetPath);
    const items = fs.readdirSync(context.targetPath, { withFileTypes: true });
    contents = items.map((item) => {
      const stats = fs.statSync(path.join(context.targetPath, item.name));
      return {
        name: item.name,
        isDir: item.isDirectory(),
        modified: stats.mtime,
        path: path.join(context.currentPath, item.name).replace(/\\/g, '/')
      };
    });
  }

  return contents
    .filter((item) => item && item.isDir)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

async function transferSingleItem({ req, operation = 'move', sourcePathInput = '', destinationPathInput = '' } = {}) {
  const sourceContext = resolveContextFromPath(req.user, sourcePathInput);
  const destinationContext = resolveContextFromPath(req.user, destinationPathInput);
  if (!sourceContext.relativeSub) throw new Error('Cannot move or copy root drives.');

  let finalName = '';
  let targetPath = '';
  if (isRailwayProxyMode()) {
    const payload = {
      sourceScopeKey: sourceContext.scopeKey,
      sourceRelativePath: sourceContext.relativeSub,
      destinationScopeKey: destinationContext.scopeKey,
      destinationRelativeDir: destinationContext.relativeSub
    };
    const result = operation === 'copy'
      ? await gatewayCopyItem(payload)
      : await gatewayMoveItem(payload);
    finalName = String(result?.finalName || path.basename(sourceContext.relativeSub)).trim();
    targetPath = buildOperationDestinationPath(destinationContext, finalName);
  } else {
    const sourceTarget = sourceContext.targetPath;
    const destinationDir = destinationContext.targetPath;
    if (!fs.existsSync(sourceTarget)) throw new Error('Source item not found.');
    if (!fs.existsSync(destinationDir) || !fs.statSync(destinationDir).isDirectory()) {
      throw new Error('Destination folder not found.');
    }

    const sourceStat = fs.statSync(sourceTarget);
    if (sourceStat.isDirectory() && isSameOrInsidePath(sourceTarget, destinationDir)) {
      throw new Error('A folder cannot be moved or copied into itself.');
    }

    const destinationTarget = resolveAvailableFilePath(destinationDir, path.basename(sourceTarget));
    finalName = path.basename(destinationTarget);
    if (operation === 'copy') copyPathRecursive(sourceTarget, destinationTarget);
    else movePathSafe(sourceTarget, destinationTarget);
    targetPath = buildOperationDestinationPath(destinationContext, finalName);
  }

  return {
    sourcePath: sourceContext.currentPath,
    destinationPath: targetPath,
    finalName,
    destinationContext
  };
}

async function handleFileTransfer(req, res, operation = 'move') {
  try {
    const destinationPathInput = assertValidRelativePath(req.body?.destinationPath || '', 'destination path');
    if (!destinationPathInput) throw new Error('Destination folder is required.');

    const requestedSourcePaths = parseSourcePathInputs(req.body || {});
    if (!requestedSourcePaths.length) throw new Error('Source path is required.');

    const sourcePaths = [];
    const seenSources = new Set();
    requestedSourcePaths.forEach((token) => {
      const key = String(token || '').trim();
      if (!key || seenSources.has(key)) return;
      seenSources.add(key);
      sourcePaths.push(key);
    });

    if (sourcePaths.length === 1) {
      const normalizedSourcePath = assertValidRelativePath(sourcePaths[0], 'source path');
      if (!normalizedSourcePath) throw new Error('Source path is required.');
      const transfer = await transferSingleItem({
        req,
        operation,
        sourcePathInput: normalizedSourcePath,
        destinationPathInput
      });
      const verb = operation === 'copy' ? 'copied' : 'moved';
      const payload = {
        status: 'success',
        message: `Item ${verb} successfully.`,
        sourcePath: transfer.sourcePath,
        destinationPath: transfer.destinationPath,
        finalName: transfer.finalName
      };
      if (isAjax(req)) return res.json(payload);
      return res.redirect(`/files?path=${encodeURIComponent(transfer.destinationContext.currentPath)}`);
    }

    const verb = operation === 'copy' ? 'copied' : 'moved';
    const results = [];
    let succeeded = 0;
    let failed = 0;
    let lastDestinationContext = null;

    for (const rawSourcePath of sourcePaths) {
      try {
        const normalizedSourcePath = assertValidRelativePath(rawSourcePath, 'source path');
        if (!normalizedSourcePath) throw new Error('Source path is required.');
        const transfer = await transferSingleItem({
          req,
          operation,
          sourcePathInput: normalizedSourcePath,
          destinationPathInput
        });
        succeeded += 1;
        lastDestinationContext = transfer.destinationContext;
        results.push({
          sourcePath: transfer.sourcePath,
          status: 'success',
          message: `Item ${verb} successfully.`,
          destinationPath: transfer.destinationPath,
          finalName: transfer.finalName
        });
      } catch (error) {
        failed += 1;
        results.push({
          sourcePath: String(rawSourcePath || ''),
          status: 'error',
          message: error.message || `Unable to ${operation} item.`
        });
      }
    }

    const summary = {
      requested: sourcePaths.length,
      succeeded,
      failed,
      operation
    };
    const status = succeeded > 0 && failed > 0
      ? 'partial'
      : (succeeded > 0 ? 'success' : 'error');
    const message = status === 'success'
      ? `All ${succeeded} item(s) ${verb} successfully.`
      : (status === 'partial'
        ? `${succeeded} item(s) ${verb}; ${failed} failed.`
        : `No items were ${verb}.`);

    const payload = {
      status,
      message,
      summary,
      results
    };

    if (isAjax(req)) {
      return res.status(status === 'error' ? 400 : 200).json(payload);
    }

    if (status === 'error') {
      return res.status(400).render('error', {
        title: operation === 'copy' ? 'Copy Failed' : 'Move Failed',
        message,
        user: req.user
      });
    }

    const redirectPath = lastDestinationContext?.currentPath || destinationPathInput;
    return res.redirect(`/files?path=${encodeURIComponent(redirectPath)}`);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', {
      title: operation === 'copy' ? 'Copy Failed' : 'Move Failed',
      message: error.message,
      user: req.user
    });
  }
}

/* ---------------- ACTIONS ---------------- */

exports.listFiles = async (req, res) => {
  try {
    const user = req.user;
    const currentPathStr = sanitizeDrivePath(req.query.path || '');
    const context = resolveContextFromPath(user, currentPathStr, { allowRoot: true });
    const orgBackupOrganizations = await getOrgBackupOrganizations(user).catch(() => []);
    const orgBackupEnabled = canManageOrgBackups(user);

    if (context.isRoot) {
      return res.render('files/fileList', {
        title: 'File Manager',
        includeModal: true,
        isRoot: true,
        drives: context.availableDrives,
        files: [],
        breadcrumbs: [],
        currentPath: '',
        user,
        canManageOrgBackups: orgBackupEnabled,
        orgBackupOrganizations,
        actionStateId: req.actionStateId
      });
    }

    let contents = [];
    if (isRailwayProxyMode()) {
      const gatewayResult = await gatewayListDirectory({
        scopeKey: context.scopeKey,
        relativeDir: context.relativeSub
      });
      contents = (Array.isArray(gatewayResult?.files) ? gatewayResult.files : []).map((item) => ({
        name: item.name,
        isDir: Boolean(item.isDir),
        size: item.isDir ? '-' : formatBytes(Number(item.size || 0)),
        modified: item.modified ? new Date(item.modified) : new Date(0),
        path: path.join(context.currentPath, item.name).replace(/\\/g, '/')
      }));
    } else {
      pathResolver.ensureDir(context.targetPath);
      const items = fs.readdirSync(context.targetPath, { withFileTypes: true });

      contents = items.map((item) => {
        const stats = fs.statSync(path.join(context.targetPath, item.name));
        return {
          name: item.name,
          isDir: item.isDirectory(),
          size: item.isDirectory() ? '-' : formatBytes(stats.size),
          modified: stats.mtime,
          path: path.join(context.currentPath, item.name).replace(/\\/g, '/')
        };
      });
    }

    contents.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return b.modified - a.modified;
    });

    const breadcrumbs = buildPathBreadcrumbs(context.currentPath);

    return res.render('files/fileList', {
      title: 'File Manager',
      includeModal: true,
      isRoot: false,
      files: contents,
      breadcrumbs,
      currentPath: context.currentPath,
      drives: context.availableDrives,
      user,
      currentScope: context.scopeKey,
      currentSubfolder: context.relativeSub,
      canManageOrgBackups: orgBackupEnabled,
      orgBackupOrganizations,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.listFolderLibrary = async (req, res) => {
  try {
    const user = req.user;
    const requestedPath = sanitizeDrivePath(req.query?.path || '');
    const context = resolveContextFromPath(user, requestedPath, { allowRoot: true });
    const drives = Array.isArray(context.availableDrives) ? context.availableDrives : [];

    if (context.isRoot) {
      return res.json({
        status: 'success',
        message: 'Folder library loaded.',
        currentPath: '',
        parentPath: '',
        breadcrumbs: [],
        drives,
        folders: []
      });
    }

    const folders = await listFolderRowsForContext(context);
    return res.json({
      status: 'success',
      message: 'Folder library loaded.',
      currentPath: context.currentPath,
      parentPath: context.currentPath.split('/').slice(0, -1).join('/'),
      breadcrumbs: buildPathBreadcrumbs(context.currentPath),
      drives,
      folders: folders.map((row) => ({
        name: row.name,
        path: row.path
      }))
    });
  } catch (error) {
    return res.status(400).json({
      status: 'error',
      message: error.message || 'Unable to load folder library.'
    });
  }
};

exports.downloadOrgBackup = async (req, res) => {
  try {
    const { orgId } = await assertOrgBackupRequest(req);
    if (isRailwayProxyMode()) {
      const gatewayResponse = await gatewayDownloadOrgBackup({ orgId });
      return pipeGatewayBackupResponse(res, gatewayResponse, orgFileBackupService.getBackupFileName(orgId));
    }

    const archive = await orgFileBackupService.createOrgBackupArchive(orgId);
    return sendArchiveResponse(res, archive);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Backup Failed', message: error.message, user: req.user });
  }
};

exports.restoreOrgBackup = async (req, res) => {
  try {
    const { orgId } = await assertOrgBackupRequest(req);
    if (!req.file || !req.file.buffer) throw new Error('Select an organization backup file to restore.');

    const result = isRailwayProxyMode()
      ? await gatewayRestoreOrgBackup({
        orgId,
        buffer: req.file.buffer,
        fileName: req.file.originalname || 'org-upload-backup.tar.gz',
        mimeType: req.file.mimetype || 'application/gzip'
      })
      : {
        status: 'success',
        message: 'Organization files restored.',
        report: await orgFileBackupService.restoreOrgBackupFromBuffer(orgId, req.file.buffer, {
          fileName: req.file.originalname || 'org-upload-backup.tar.gz'
        })
      };

    return res.json({
      status: 'success',
      message: result?.message || result?.report?.message || 'Organization files restored.',
      report: result?.report || result
    });
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Restore Failed', message: error.message, user: req.user });
  }
};

exports.downloadFile = (req, res) => {
  try {
    const requestedPath = sanitizeDrivePath(req.query.path || '');
    if (isRailwayProxyMode()) {
      if (!requestedPath) return res.status(400).send('Invalid path');
      return res.redirect(`/uploads/${encodeURI(requestedPath)}`);
    }
    const context = resolveContextFromPath(req.user, requestedPath);
    const targetFile = context.targetPath;

    if (!fs.existsSync(targetFile)) return res.status(404).send('File not found');
    const stat = fs.statSync(targetFile);
    if (stat.isDirectory()) return res.status(400).send('Cannot download a folder.');
    return res.download(targetFile);
  } catch (error) {
    return res.status(400).send(error.message);
  }
};

exports.deleteFile = (req, res) => {
  try {
    let requestedPath = sanitizeDrivePath(req.query.path || '');
    if (!requestedPath && req.params.filename && req.params.filename !== 'dummy') {
      requestedPath = sanitizeDrivePath(req.params.filename);
    }
    if (!requestedPath) throw new Error('No path provided.');

    const context = resolveContextFromPath(req.user, requestedPath);
    if (!context.relativeSub) throw new Error('Cannot delete root drives.');

    if (isRailwayProxyMode()) {
      gatewayDeleteByRelativePath({
        scopeKey: context.scopeKey,
        relativePath: context.relativeSub
      }).then(() => {
        if (isAjax(req)) {
          return res.json({ status: 'success', message: 'Item deleted.' });
        }
        const parentPath = context.currentPath.split('/').slice(0, -1).join('/');
        return res.redirect(`/files?path=${encodeURIComponent(parentPath)}`);
      }).catch((error) => {
        if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
        return res.redirect('back');
      });
      return;
    }

    const target = context.targetPath;
    if (!fs.existsSync(target)) {
      if (isAjax(req)) return res.status(404).json({ status: 'error', message: 'Item not found' });
      return res.redirect('back');
    }

    const stat = fs.statSync(target);
    if (stat.isDirectory()) fs.rmdirSync(target, { recursive: true });
    else fs.unlinkSync(target);

    if (isAjax(req)) {
      return res.json({ status: 'success', message: 'Item deleted.' });
    }

    const parentPath = context.currentPath.split('/').slice(0, -1).join('/');
    return res.redirect(`/files?path=${encodeURIComponent(parentPath)}`);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.redirect('back');
  }
};

exports.moveItem = (req, res) => handleFileTransfer(req, res, 'move');

exports.copyItem = (req, res) => handleFileTransfer(req, res, 'copy');

exports.renameItem = async (req, res) => {
  try {
    const sourcePathInput = assertValidRelativePath(req.body?.sourcePath || '', 'source path');
    const newName = assertValidName(req.body?.newName || '', 'new name');
    if (!sourcePathInput) throw new Error('Source path is required.');

    const sourceContext = resolveContextFromPath(req.user, sourcePathInput);
    if (!sourceContext.relativeSub) throw new Error('Cannot rename root drives.');
    if (path.basename(sourceContext.relativeSub) === newName) {
      throw new Error('New name must be different from the current name.');
    }

    const parentPath = sourceContext.currentPath.split('/').slice(0, -1).join('/');
    const parentRelative = sourceContext.relativeSub.split('/').slice(0, -1).join('/');
    let targetPath = [parentPath, newName].filter(Boolean).join('/').replace(/\\/g, '/');

    if (isRailwayProxyMode()) {
      const result = await gatewayRenameItem({
        scopeKey: sourceContext.scopeKey,
        relativePath: sourceContext.relativeSub,
        newName
      });
      const finalName = String(result?.finalName || newName).trim() || newName;
      targetPath = [parentPath, finalName].filter(Boolean).join('/').replace(/\\/g, '/');
    } else {
      const sourceTarget = sourceContext.targetPath;
      if (!fs.existsSync(sourceTarget)) throw new Error('Source item not found.');

      const destinationTarget = pathResolver.resolveSafePath(sourceContext.baseDir, [parentRelative, newName].filter(Boolean).join('/'));
      if (fs.existsSync(destinationTarget)) {
        throw new Error('A file or folder with this name already exists.');
      }
      movePathSafe(sourceTarget, destinationTarget);
    }

    const payload = {
      status: 'success',
      message: `Item renamed to "${newName}".`,
      sourcePath: sourceContext.currentPath,
      destinationPath: targetPath,
      finalName: newName
    };

    if (isAjax(req)) return res.json(payload);
    return res.redirect(`/files?path=${encodeURIComponent(parentPath)}`);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', {
      title: 'Rename Failed',
      message: error.message,
      user: req.user
    });
  }
};

exports.createFolder = (req, res) => {
  try {
    const currentPath = assertValidRelativePath(req.body.path || '', 'path');
    const folderName = assertValidName(req.body.folderName, 'folder name');
    const context = resolveContextFromPath(req.user, currentPath);

    if (isRailwayProxyMode()) {
      gatewayCreateFolder({
        scopeKey: context.scopeKey,
        relativeDir: context.relativeSub,
        folderName
      }).then(() => {
        if (isAjax(req)) {
          return res.json({ status: 'success', message: `Folder "${folderName}" created.` });
        }
        return res.redirect(`/files?path=${encodeURIComponent(context.currentPath)}`);
      }).catch((error) => {
        if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
        return res.status(400).render('error', { title: 'Create Folder Failed', message: error.message, user: req.user });
      });
      return;
    }

    const folderRelative = context.relativeSub
      ? `${context.relativeSub}/${folderName}`
      : folderName;
    const folderPath = pathResolver.resolveSafePath(context.baseDir, folderRelative);

    if (fs.existsSync(folderPath)) {
      throw new Error('A folder or file with this name already exists.');
    }

    pathResolver.ensureDir(folderPath);

    if (isAjax(req)) {
      return res.json({ status: 'success', message: `Folder "${folderName}" created.` });
    }

    return res.redirect(`/files?path=${encodeURIComponent(context.currentPath)}`);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Create Folder Failed', message: error.message, user: req.user });
  }
};

exports.uploadFile = (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      throw new Error('No files were uploaded.');
    }

    const currentPath = buildCurrentPathFromUploadBody(req.body || {});
    const context = resolveContextFromPath(req.user, currentPath);
    const baseTargetDir = context.targetPath;
    if (!isRailwayProxyMode()) {
      pathResolver.ensureDir(baseTargetDir);
    }

    const relativePaths = parseRelativePathsMap(req);
    const finalFiles = [];
    const renamedFiles = [];
    const errors = [];
    let renamedCount = 0;
    let uploadedCount = 0;
    let skippedCount = 0;

    const processFile = async (file, index) => {
      try {
        const relativeFromClient = String(relativePaths[index] || '').trim();
        const { relativeDir, fileName } = splitFilePath(relativeFromClient, file.originalname);

        const finalSubfolder = [context.relativeSub, relativeDir]
          .filter(Boolean)
          .join('/')
          .replace(/\\/g, '/');

        if (isRailwayProxyMode()) {
          const gatewayResult = await gatewayUploadFile({
            scopeKey: context.scopeKey,
            relativeDir: finalSubfolder,
            desiredName: fileName,
            localFilePath: file.path,
            mimeType: file.mimetype
          });
          const finalName = String(gatewayResult.fileName || fileName).trim() || fileName;
          if (gatewayResult.renamed) {
            renamedCount += 1;
            renamedFiles.push({ from: fileName, to: finalName });
          }

          if (file.path && fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }

          uploadedCount += 1;
          finalFiles.push({
            name: finalName,
            size: file.size,
            url: String(gatewayResult.url || getWebUrl(context.scopeKey, finalSubfolder, finalName)),
            type: file.mimetype.startsWith('image/') ? 'image' : 'file'
          });
          return;
        }

        const finalDir = relativeDir
          ? pathResolver.resolveSafePath(baseTargetDir, relativeDir)
          : baseTargetDir;
        pathResolver.ensureDir(finalDir);

        const availablePath = resolveAvailableFilePath(finalDir, fileName);
        const finalName = path.basename(availablePath);
        if (finalName !== fileName) {
          renamedCount += 1;
          renamedFiles.push({ from: fileName, to: finalName });
        }

        fs.renameSync(file.path, availablePath);
        uploadedCount += 1;

        finalFiles.push({
          name: finalName,
          size: file.size,
          url: getWebUrl(context.scopeKey, finalSubfolder, finalName),
          type: file.mimetype.startsWith('image/') ? 'image' : 'file'
        });
      } catch (fileError) {
        skippedCount += 1;
        errors.push({
          index,
          fileName: file.originalname,
          message: fileError.message || String(fileError)
        });
        try {
          if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
        } catch (_) {
          // best effort cleanup
        }
      }
    };

    runWithConcurrency(req.files, getFileManagerUploadConcurrency(), processFile).then(() => {
      const payload = {
        status: errors.length ? 'partial' : 'success',
        message: errors.length
          ? `Uploaded ${uploadedCount} file(s), skipped ${skippedCount}.`
          : 'Upload complete.',
        files: finalFiles,
        uploadedCount,
        renamedCount,
        skippedCount,
        renamedFiles,
        errors
      };

      if (isAjax(req)) return res.json(payload);
      return res.redirect(`/files?path=${encodeURIComponent(context.currentPath)}`);
    }).catch((error) => {
      if (isAjax(req)) {
        return res.status(400).json({ status: 'error', message: error.message || 'Upload failed.' });
      }
      return res.status(400).render('error', { title: 'Upload Failed', message: error.message, user: req.user });
    });
    return;
  } catch (error) {
    if (req.files) {
      req.files.forEach((file) => {
        try {
          if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
        } catch (_) {
          // best effort cleanup
        }
      });
    }

    if (isAjax(req)) {
      return res.status(400).json({ status: 'error', message: error.message });
    }
    return res.status(400).render('error', { title: 'Upload Failed', message: error.message, user: req.user });
  }
};

exports.cleanupOldFiles = (req, res) => {
  res.json({ status: 'success', message: 'Cleanup logic needs update for v2 structure.' });
};
