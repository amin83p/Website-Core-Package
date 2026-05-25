const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const pathResolver = require('../utils/pathResolver');
const uploadPathUtils = require('../utils/uploadPathUtils');
const uploadFolderSettingsService = require('./uploadFolderSettingsService');
const uploadCategoryResolverService = require('./uploadCategoryResolverService');
const { isRailwayProxyMode } = require('../utils/uploadModeUtils');
const adminAuthorityService = require('./adminAuthorityService');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');
const {
  gatewayUploadFile,
  gatewayDeleteByUploadUrl,
  gatewayDeleteByRelativePath,
  gatewayMoveItem,
  gatewayCopyItem,
  gatewayRenameItem,
  gatewayCreateFolder,
  gatewayListDirectory
} = require('./fileGatewayClientService');

/**
 * Core Files Service Contract (v1)
 * --------------------------------
 * This service is the core façade for file/upload operations.
 * Package/domain modules should consume this contract instead of manipulating
 * upload paths, gateway branching, and disk operations directly.
 *
 * Key capabilities:
 * - upload category/folder resolution
 * - upload URL <-> disk path conversion helpers
 * - request-file mirroring/cleanup helpers
 * - file-manager path validation and drive context resolution
 * - list/copy/move/rename/delete/create-folder/upload operations
 */

const PROXY_LOCAL_REQUIRED_CATEGORIES = new Set([
  'imports',
  'public-pages-staging'
]);

const INVALID_NAME_PATTERN = /[<>:"/\\|?*\x00-\x1F]/;
const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
]);

function clean(value) {
  return String(value || '').trim();
}

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getMaxUploadFileMb() {
  return toPositiveInteger(
    process.env.APP_UPLOAD_MAX_FILE_MB || process.env.FILE_UPLOAD_MAX_MB || process.env.FILE_GATEWAY_MAX_FILE_MB,
    25
  );
}

function isUploadsUrl(value = '') {
  return /^\/uploads\//i.test(clean(value));
}

function isUploadReference(value = '') {
  return Boolean(uploadPathUtils.extractRelativeUploadPath(value));
}

function sanitizeDrivePath(pathValue = '') {
  return String(pathValue || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .trim();
}

function shouldKeepLocalProxyPath(category = '') {
  return PROXY_LOCAL_REQUIRED_CATEGORIES.has(clean(category));
}

function cleanFolderId(value, fallback = '') {
  return uploadFolderSettingsService.sanitizeFolderToken(value, fallback || 'item_unsaved');
}

function resolveUploadCategory(fixedCategory = 'misc', isDynamic = false, req = {}) {
  if (fixedCategory === 'imports') return 'imports';
  if (fixedCategory === 'misc') return uploadFolderSettingsService.resolveUploadFolder('core.fileManager');
  if (fixedCategory === 'public-pages') {
    return path.join(uploadFolderSettingsService.resolveUploadFolder('core.fileManager'), 'public-pages');
  }
  if (fixedCategory === 'public-pages-staging') {
    return path.join(uploadFolderSettingsService.resolveUploadFolder('core.fileManager'), 'public-pages-staging');
  }
  if (fixedCategory === 'symbols') return uploadFolderSettingsService.resolveUploadFolder('core.symbols');
  if (fixedCategory === 'news') return uploadFolderSettingsService.resolveUploadFolder('core.news');
  if (fixedCategory === 'contacts') return uploadFolderSettingsService.resolveUploadFolder('core.contacts');
  if (fixedCategory === 'ielts') return uploadFolderSettingsService.resolveUploadFolder('core.ielts');
  if (fixedCategory === 'reports') return uploadFolderSettingsService.resolveUploadFolder('school.reportTemplates');
  const registeredCategory = uploadCategoryResolverService.resolveUploadCategory(fixedCategory, {
    isDynamic,
    req
  });
  if (registeredCategory) return registeredCategory;
  if (fixedCategory === 'tasks') {
    return uploadFolderSettingsService.resolveUploadFolder('core.tasks', {
      taskId: req.body?.taskId
    });
  }
  if (fixedCategory === 'chat') {
    return uploadFolderSettingsService.resolveUploadFolder('core.chat', {
      conversationId: req.body?.convId || req.params?.convId
    });
  }
  if (fixedCategory === 'students') {
    return uploadFolderSettingsService.resolveUploadFolder('school.students', {
      personId: req.body?.personId || req.params?.personId || req.params?.id
    });
  }
  if (fixedCategory === 'school-exams') {
    return uploadFolderSettingsService.resolveUploadFolder('school.examMedia', {
      templateId: req.body?.templateId || req.params?.templateId || 'template_unsaved',
      questionId: req.body?.questionId || req.params?.questionId || '_unsaved'
    });
  }

  if (isDynamic) {
    if (req.body?.taskId) return path.join(fixedCategory, cleanFolderId(req.body.taskId, 'task_unsaved'));
    if (req.body?.convId) return path.join(fixedCategory, cleanFolderId(req.body.convId, 'conversation_unsaved'));
  }
  return fixedCategory;
}

function resolveUploadDestination({ fixedCategory = 'misc', isDynamic = false, forceGlobal = false, req = {} } = {}) {
  let scopeId = 'GLOBAL';
  if (!forceGlobal && req.user && req.user.activeOrgId && req.user.activeOrgId !== 'SYSTEM') {
    scopeId = req.user.activeOrgId;
  }
  const category = resolveUploadCategory(fixedCategory, isDynamic, req);
  const root = pathResolver.getRootPath(scopeId);
  const fullPath = pathResolver.resolveSafePath(root, category);
  pathResolver.ensureDir(fullPath);
  return { scopeId, category, root, fullPath };
}

function collectRequestFiles(req = {}) {
  const rows = [];
  if (req?.file) rows.push(req.file);
  if (Array.isArray(req?.files)) rows.push(...req.files);
  if (req?.files && typeof req.files === 'object' && !Array.isArray(req.files)) {
    Object.values(req.files).forEach((entry) => {
      if (Array.isArray(entry)) rows.push(...entry);
    });
  }
  return rows;
}

async function mirrorUploadedFilesIfNeeded(req = {}, fixedCategory = '') {
  if (!isRailwayProxyMode()) return;
  if (shouldKeepLocalProxyPath(fixedCategory)) return;
  const requestPath = String(req.originalUrl || req.url || '').toLowerCase();
  if (requestPath.includes('/internal/file-gateway/')) return;
  if (requestPath.includes('/files/upload')) return;

  const uploadRoot = uploadPathUtils.getUploadRootAbsolute();
  const rows = collectRequestFiles(req);

  for (const file of rows) {
    const absolutePath = clean(file?.path);
    if (!absolutePath) continue;
    if (!uploadPathUtils.isInsideUploadRoot(absolutePath, uploadRoot)) continue;

    const relative = path.relative(uploadRoot, absolutePath).split(path.sep).join('/');
    const parts = String(relative || '').split('/').filter(Boolean);
    if (parts.length < 2) continue;

    const scopeToken = String(parts.shift() || '').toUpperCase();
    const scopeKey = scopeToken === 'GLOBAL'
      ? 'GLOBAL'
      : scopeToken.replace(/^ORG_/, '');
    const desiredName = parts.pop() || clean(file.originalname || file.filename);
    const relativeDir = parts.join('/');

    const gatewayResult = await gatewayUploadFile({
      scopeKey,
      relativeDir,
      desiredName,
      localFilePath: absolutePath,
      mimeType: file.mimetype || 'application/octet-stream'
    });

    file.localPath = absolutePath;
    file.uploadUrl = clean(gatewayResult?.url);
    file.storagePath = file.uploadUrl || file.path;
    file.gatewayRelativePath = clean(gatewayResult?.relativePath);
    file.gatewayFileName = clean(gatewayResult?.fileName);
    if (file.gatewayFileName) file.filename = file.gatewayFileName;
    if (file.uploadUrl) file.path = file.uploadUrl;

    await fsp.unlink(absolutePath).catch(() => {});
  }
}

function getUploadedFilePaths(req = {}) {
  const out = [];
  const rows = collectRequestFiles(req);
  rows.forEach((file) => {
    if (file?.path) out.push(file.path);
    if (file?.localPath) out.push(file.localPath);
    if (file?.uploadUrl) out.push(file.uploadUrl);
  });
  return [...new Set(out.filter(Boolean))];
}

async function deleteFilePaths(filePaths = []) {
  const list = Array.isArray(filePaths) ? filePaths : [filePaths];
  await Promise.all(
    list.map(async (rawPath) => {
      const target = clean(rawPath);
      if (!target) return;
      if (isUploadReference(target) && isRailwayProxyMode()) {
        try {
          await gatewayDeleteByUploadUrl(target);
        } catch (_) {
          // best-effort cleanup
        }
        return;
      }
      const diskPath = isUploadReference(target)
        ? uploadPathUtils.fromUploadsUrlToDiskPath(target)
        : target;
      if (!diskPath) return;
      await fsp.unlink(diskPath).catch(() => {});
    })
  );
}

async function deleteUploadedFiles(req = {}) {
  const paths = getUploadedFilePaths(req);
  await deleteFilePaths(paths);
  return paths;
}

function getStoredFilePath(file = {}) {
  return clean(file?.uploadUrl || file?.storagePath || file?.path || '');
}

function getStoredFileUrl(file = {}) {
  return clean(file?.uploadUrl || file?.storagePath || '')
    || uploadPathUtils.fromDiskPathToUploadsUrl(file?.path || '');
}

function getUploadRootAbsolute() {
  return uploadPathUtils.getUploadRootAbsolute();
}

function getDefaultUploadRoot() {
  return uploadPathUtils.DEFAULT_UPLOAD_ROOT;
}

function extractRelativeUploadPath(uploadRef = '') {
  return uploadPathUtils.extractRelativeUploadPath(uploadRef);
}

function fromUploadsUrlToDiskPath(uploadRef = '', rootPath = '') {
  return uploadPathUtils.fromUploadsUrlToDiskPath(uploadRef, rootPath);
}

function fromDiskPathToUploadsUrl(filePath = '', rootPath = '') {
  return uploadPathUtils.fromDiskPathToUploadsUrl(filePath, rootPath);
}

function isInsideUploadRoot(targetPath = '', rootPath = '') {
  return uploadPathUtils.isInsideUploadRoot(targetPath, rootPath);
}

function parseRelativePathsMap(body = {}) {
  const raw = typeof body.relativePathsJson === 'string'
    ? body.relativePathsJson
    : '';
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function assertValidName(name, label = 'name') {
  const token = clean(name);
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
  return parts.map((part) => assertValidName(part, label)).join('/');
}

function buildCurrentPathFromUploadBody(body = {}) {
  const explicitPath = assertValidRelativePath(body.path || '', 'path');
  if (explicitPath) return explicitPath;
  const scopeTokenRaw = clean(body.targetOrgId || 'GLOBAL');
  const scopeToken = scopeTokenRaw.toUpperCase() === 'GLOBAL'
    ? 'GLOBAL'
    : `ORG_${scopeTokenRaw.replace(/^ORG_/i, '')}`;
  const subfolder = assertValidRelativePath(body.category || '', 'path');
  if (!subfolder) return scopeToken;
  return `${scopeToken}/${subfolder}`;
}

function splitFilePath(relativeToken = '', fallbackName = '') {
  const cleanPath = assertValidRelativePath(relativeToken, 'file path');
  if (!cleanPath) return { relativeDir: '', fileName: assertValidName(fallbackName, 'file name') };
  const parts = cleanPath.split('/').filter(Boolean);
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

function getRootPath(scopeId = '') {
  return pathResolver.getRootPath(scopeId);
}

function resolveSafePath(basePath = '', relativePath = '') {
  return pathResolver.resolveSafePath(basePath, relativePath);
}

function ensureDir(dirPath = '') {
  return pathResolver.ensureDir(dirPath);
}

function getWebUrlForUpload(dirPath = '') {
  return pathResolver.getWebUrlForUpload(dirPath);
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
  if (user?.activeOrgId && user.activeOrgId !== 'SYSTEM') {
    const orgToken = clean(user.activeOrgId).replace(/^ORG_/i, '');
    if (orgToken) drives.push({ name: 'Active Org', id: `ORG_${orgToken}`, icon: 'bi-building' });
  }
  return drives;
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

function buildPathBreadcrumbs(pathValue = '') {
  const breadcrumbs = [];
  let accum = '';
  String(pathValue || '').split('/').filter(Boolean).forEach((part, idx) => {
    accum += (idx === 0 ? part : `/${part}`);
    breadcrumbs.push({ name: part, path: accum });
  });
  return breadcrumbs;
}

function parseSourcePathInputs(body = {}) {
  const values = [];
  const pushValue = (value) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach(pushValue);
      return;
    }
    const token = clean(value);
    if (!token) return;
    if (token.startsWith('[') && token.endsWith(']')) {
      try {
        const parsed = JSON.parse(token);
        if (Array.isArray(parsed)) {
          parsed.forEach(pushValue);
          return;
        }
      } catch (_) {
        // treat as literal
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
    const key = clean(token);
    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push(key);
  });
  return deduped;
}

function buildOperationDestinationPath(destinationContext = {}, finalName = '') {
  return [destinationContext.currentPath, finalName].filter(Boolean).join('/').replace(/\\/g, '/');
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

async function listContextDirectory(context = {}) {
  if (isRailwayProxyMode()) {
    const gatewayResult = await gatewayListDirectory({
      scopeKey: context.scopeKey,
      relativeDir: context.relativeSub
    });
    return (Array.isArray(gatewayResult?.files) ? gatewayResult.files : []).map((item) => ({
      name: item.name,
      isDir: Boolean(item.isDir),
      size: item.isDir ? '-' : formatBytes(Number(item.size || 0)),
      modified: item.modified ? new Date(item.modified) : new Date(0),
      path: path.join(context.currentPath, item.name).replace(/\\/g, '/')
    }));
  }

  pathResolver.ensureDir(context.targetPath);
  const items = fs.readdirSync(context.targetPath, { withFileTypes: true });
  return items.map((item) => {
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

async function listDirectoryByScope({ scopeKey = '', relativeDir = '' } = {}) {
  if (isRailwayProxyMode()) {
    const gatewayResult = await gatewayListDirectory({
      scopeKey,
      relativeDir
    });
    return Array.isArray(gatewayResult?.files) ? gatewayResult.files : [];
  }
  const root = pathResolver.getRootPath(scopeKey);
  const target = relativeDir ? pathResolver.resolveSafePath(root, relativeDir) : root;
  const entries = await fsp.readdir(target, { withFileTypes: true }).catch(() => []);
  const rows = [];
  for (const entry of entries) {
    if (!entry) continue;
    const absolutePath = pathResolver.resolveSafePath(target, entry.name);
    // eslint-disable-next-line no-await-in-loop
    const stat = await fsp.stat(absolutePath).catch(() => null);
    if (!stat) continue;
    rows.push({
      name: entry.name,
      isDir: entry.isDirectory(),
      size: entry.isDirectory() ? 0 : Number(stat.size || 0),
      modified: stat.mtime ? stat.mtime.toISOString() : new Date(0).toISOString()
    });
  }
  return rows;
}

async function listFolderRowsForContext(context = {}) {
  const rows = await listContextDirectory(context);
  return rows
    .filter((item) => item && item.isDir)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

async function transferSingleItem({ operation = 'move', sourceContext = {}, destinationContext = {} } = {}) {
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
    finalName = clean(result?.finalName || path.basename(sourceContext.relativeSub));
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
    finalName
  };
}

async function deletePathByContext(context = {}) {
  if (!context.relativeSub) throw new Error('Cannot delete root drives.');
  if (isRailwayProxyMode()) {
    await gatewayDeleteByRelativePath({
      scopeKey: context.scopeKey,
      relativePath: context.relativeSub
    });
    return true;
  }
  const target = context.targetPath;
  if (!fs.existsSync(target)) return false;
  const stat = fs.statSync(target);
  if (stat.isDirectory()) fs.rmSync(target, { recursive: true, force: true });
  else fs.unlinkSync(target);
  return true;
}

async function renamePathByContext(sourceContext = {}, newName = '') {
  if (!sourceContext.relativeSub) throw new Error('Cannot rename root drives.');
  const safeName = assertValidName(newName, 'new name');
  if (path.basename(sourceContext.relativeSub) === safeName) {
    throw new Error('New name must be different from the current name.');
  }
  const parentPath = sourceContext.currentPath.split('/').slice(0, -1).join('/');
  const parentRelative = sourceContext.relativeSub.split('/').slice(0, -1).join('/');
  let targetPath = [parentPath, safeName].filter(Boolean).join('/').replace(/\\/g, '/');
  let finalName = safeName;

  if (isRailwayProxyMode()) {
    const result = await gatewayRenameItem({
      scopeKey: sourceContext.scopeKey,
      relativePath: sourceContext.relativeSub,
      newName: safeName
    });
    finalName = clean(result?.finalName || safeName) || safeName;
    targetPath = [parentPath, finalName].filter(Boolean).join('/').replace(/\\/g, '/');
  } else {
    const sourceTarget = sourceContext.targetPath;
    if (!fs.existsSync(sourceTarget)) throw new Error('Source item not found.');
    const destinationTarget = pathResolver.resolveSafePath(
      sourceContext.baseDir,
      [parentRelative, safeName].filter(Boolean).join('/')
    );
    if (fs.existsSync(destinationTarget)) {
      throw new Error('A file or folder with this name already exists.');
    }
    movePathSafe(sourceTarget, destinationTarget);
  }

  return {
    sourcePath: sourceContext.currentPath,
    destinationPath: targetPath,
    finalName
  };
}

async function createFolderByContext(context = {}, folderName = '') {
  const safeFolderName = assertValidName(folderName, 'folder name');
  if (isRailwayProxyMode()) {
    await gatewayCreateFolder({
      scopeKey: context.scopeKey,
      relativeDir: context.relativeSub,
      folderName: safeFolderName
    });
    return true;
  }
  const folderRelative = context.relativeSub
    ? `${context.relativeSub}/${safeFolderName}`
    : safeFolderName;
  const folderPath = pathResolver.resolveSafePath(context.baseDir, folderRelative);
  if (fs.existsSync(folderPath)) {
    throw new Error('A folder or file with this name already exists.');
  }
  pathResolver.ensureDir(folderPath);
  return true;
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

async function uploadFilesToContext({ context = {}, files = [], relativePaths = [] } = {}) {
  const baseTargetDir = context.targetPath;
  if (!isRailwayProxyMode()) {
    pathResolver.ensureDir(baseTargetDir);
  }

  const finalFiles = [];
  const renamedFiles = [];
  const errors = [];
  let renamedCount = 0;
  let uploadedCount = 0;
  let skippedCount = 0;

  const processFile = async (file, index) => {
    try {
      const relativeFromClient = clean(relativePaths[index] || '');
      const { relativeDir, fileName } = splitFilePath(relativeFromClient, file.originalname);
      const finalSubfolder = [context.relativeSub, relativeDir].filter(Boolean).join('/').replace(/\\/g, '/');

      if (isRailwayProxyMode()) {
        const gatewayResult = await gatewayUploadFile({
          scopeKey: context.scopeKey,
          relativeDir: finalSubfolder,
          desiredName: fileName,
          localFilePath: file.path,
          mimeType: file.mimetype
        });
        const finalName = clean(gatewayResult.fileName || fileName) || fileName;
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
          url: clean(gatewayResult.url || getWebUrl(context.scopeKey, finalSubfolder, finalName)),
          type: String(file.mimetype || '').startsWith('image/') ? 'image' : 'file'
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
        type: String(file.mimetype || '').startsWith('image/') ? 'image' : 'file'
      });
    } catch (error) {
      skippedCount += 1;
      errors.push({
        index,
        fileName: file.originalname,
        message: error.message || String(error)
      });
      try {
        if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      } catch (_) {
        // best effort
      }
    }
  };

  await runWithConcurrency(files, getFileManagerUploadConcurrency(), processFile);

  return {
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
}

module.exports = {
  // Upload middleware compatibility adapter surface
  getMaxUploadFileMb,
  isUploadReference,
  shouldKeepLocalProxyPath,
  resolveUploadCategory,
  resolveUploadDestination,
  mirrorUploadedFilesIfNeeded,
  getUploadedFilePaths,
  deleteFilePaths,
  deleteUploadedFiles,
  getStoredFilePath,
  getStoredFileUrl,
  getUploadRootAbsolute,
  getDefaultUploadRoot,
  extractRelativeUploadPath,
  fromUploadsUrlToDiskPath,
  fromDiskPathToUploadsUrl,
  isInsideUploadRoot,

  // Common conversion + context helpers
  sanitizeDrivePath,
  assertValidName,
  assertValidRelativePath,
  buildCurrentPathFromUploadBody,
  parseRelativePathsMap,
  splitFilePath,
  parseSourcePathInputs,
  buildPathBreadcrumbs,
  resolveContextFromPath,
  getUserDrives,
  formatBytes,
  getRootPath,
  resolveSafePath,
  ensureDir,
  getWebUrlForUpload,

  // File operations
  listContextDirectory,
  listDirectoryByScope,
  listFolderRowsForContext,
  transferSingleItem,
  deletePathByContext,
  renamePathByContext,
  createFolderByContext,
  uploadFilesToContext,
  buildOperationDestinationPath
};
