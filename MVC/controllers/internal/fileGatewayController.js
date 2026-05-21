const fs = require('fs');
const path = require('path');
const pathResolver = require('../../utils/pathResolver');
const uploadPathUtils = require('../../utils/uploadPathUtils');
const orgFileBackupService = require('../../services/orgFileBackupService');

const INVALID_NAME_PATTERN = /[<>:"/\\|?*\x00-\x1F]/;
const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
]);

function clean(value) {
  return String(value || '').trim();
}

function assertValidName(name, label = 'name') {
  const token = clean(name);
  if (!token || token === '.' || token === '..') throw new Error(`Invalid ${label}.`);
  if (INVALID_NAME_PATTERN.test(token)) throw new Error(`Invalid ${label}.`);
  if (WINDOWS_RESERVED_NAMES.has(token.toUpperCase())) throw new Error(`Invalid ${label}.`);
  return token;
}

function assertValidRelativePath(rawPath = '', label = 'path') {
  const normalized = clean(rawPath).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalized) return '';
  if (path.isAbsolute(normalized)) throw new Error(`Invalid ${label}.`);
  const parts = normalized.split('/').filter(Boolean).map((part) => assertValidName(part, label));
  return parts.join('/');
}

function normalizeScopeKey(scopeKey = '') {
  const token = clean(scopeKey).toUpperCase();
  if (!token || token === 'GLOBAL') return 'GLOBAL';
  return token.replace(/^ORG_/, '');
}

function resolveDir(scopeKey = '', relativeDir = '') {
  const scope = normalizeScopeKey(scopeKey);
  const baseDir = pathResolver.getRootPath(scope);
  const safeRelative = assertValidRelativePath(relativeDir, 'relative path');
  const targetDir = pathResolver.resolveSafePath(baseDir, safeRelative);
  pathResolver.ensureDir(targetDir);
  return { scope, safeRelative, targetDir };
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

function isSameOrInsidePath(basePath = '', targetPath = '') {
  const base = path.resolve(String(basePath || ''));
  const target = path.resolve(String(targetPath || ''));
  if (!base || !target) return false;
  if (base === target) return true;
  const relative = path.relative(base, target);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function resolveFileOperationPaths(body = {}) {
  const sourceScopeKey = clean(body.sourceScopeKey || body.scopeKey || 'GLOBAL');
  const sourceRelativePath = assertValidRelativePath(body.sourceRelativePath || body.relativePath || '', 'source path');
  if (!sourceRelativePath) throw new Error('Invalid source path.');

  const destinationScopeKey = clean(body.destinationScopeKey || sourceScopeKey || 'GLOBAL');
  const destinationRelativeDir = assertValidRelativePath(
    body.destinationRelativeDir || body.destinationPath || '',
    'destination path'
  );

  const { targetDir: sourceRoot } = resolveDir(sourceScopeKey, '');
  const sourcePath = pathResolver.resolveSafePath(sourceRoot, sourceRelativePath);
  if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error('Source item not found.');

  const { targetDir: destinationDir } = resolveDir(destinationScopeKey, destinationRelativeDir);
  if (!fs.existsSync(destinationDir) || !fs.statSync(destinationDir).isDirectory()) {
    throw new Error('Destination folder not found.');
  }

  const sourceName = path.basename(sourcePath);
  const destinationPath = resolveAvailableFilePath(destinationDir, sourceName);
  const sourceStat = fs.statSync(sourcePath);
  if (sourceStat.isDirectory() && isSameOrInsidePath(sourcePath, destinationDir)) {
    throw new Error('A folder cannot be moved or copied into itself.');
  }

  return {
    sourceScopeKey,
    sourceRelativePath,
    destinationScopeKey,
    destinationRelativeDir,
    sourcePath,
    destinationDir,
    destinationPath,
    finalName: path.basename(destinationPath),
    sourceStat
  };
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

function serializeUploadResult({ filePath = '', originalName = '', mimeType = '' } = {}) {
  const finalName = path.basename(filePath);
  const url = uploadPathUtils.fromDiskPathToUploadsUrl(filePath);
  const relativePath = uploadPathUtils.extractRelativeUploadPath(url);
  return {
    url,
    relativePath,
    fileName: finalName,
    originalName: clean(originalName) || finalName,
    type: clean(mimeType).startsWith('image/') ? 'image' : 'file'
  };
}

function respondError(res, error, statusCode = 400) {
  return res.status(statusCode).json({ status: 'error', message: error?.message || String(error) });
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
    if (!res.headersSent) respondError(res, error, 500);
    else res.destroy(error);
  });
  res.on('close', cleanup);
  stream.pipe(res);
}

function logGateway(op = '', payload = {}) {
  try {
    console.info('[FILE_GATEWAY]', op, JSON.stringify(payload));
  } catch (_) {
    // ignore logging failures
  }
}

exports.upload = async (req, res) => {
  try {
    if (!req.file) throw new Error('No file uploaded.');
    const scopeKey = clean(req.body.scopeKey || 'GLOBAL');
    const relativeDir = clean(req.body.relativeDir || '');
    const desiredName = assertValidName(req.body.desiredName || req.file.originalname || req.file.filename, 'file name');
    const { targetDir } = resolveDir(scopeKey, relativeDir);

    const availablePath = resolveAvailableFilePath(targetDir, desiredName);
    const renamed = path.basename(availablePath) !== desiredName;
    await fs.promises.writeFile(availablePath, req.file.buffer);

    const payload = serializeUploadResult({
      filePath: availablePath,
      originalName: desiredName,
      mimeType: req.file.mimetype
    });
    logGateway('upload', {
      scopeKey,
      relativeDir,
      fileName: payload.fileName,
      renamed
    });

    return res.json({
      status: 'success',
      message: 'File uploaded via gateway.',
      renamed,
      ...payload
    });
  } catch (error) {
    return respondError(res, error);
  }
};

exports.mkdir = (req, res) => {
  try {
    const scopeKey = clean(req.body.scopeKey || 'GLOBAL');
    const relativeDir = clean(req.body.relativeDir || '');
    const folderName = assertValidName(req.body.folderName, 'folder name');
    const { targetDir } = resolveDir(scopeKey, relativeDir);
    const folderPath = pathResolver.resolveSafePath(targetDir, folderName);
    if (fs.existsSync(folderPath)) {
      throw new Error('A folder or file with this name already exists.');
    }
    pathResolver.ensureDir(folderPath);
    const folderUrl = uploadPathUtils.fromDiskPathToUploadsUrl(folderPath);
    logGateway('mkdir', { scopeKey, relativeDir, folderName });
    return res.json({
      status: 'success',
      message: 'Folder created via gateway.',
      folderUrl,
      relativePath: uploadPathUtils.extractRelativeUploadPath(folderUrl)
    });
  } catch (error) {
    return respondError(res, error);
  }
};

exports.delete = (req, res) => {
  try {
    const uploadUrl = clean(req.body.uploadUrl || '');
    let targetPath = '';

    if (uploadUrl) {
      targetPath = uploadPathUtils.fromUploadsUrlToDiskPath(uploadUrl);
    } else {
      const scopeKey = clean(req.body.scopeKey || 'GLOBAL');
      const relativePath = assertValidRelativePath(req.body.relativePath || '', 'relative path');
      if (!relativePath) throw new Error('Invalid delete path.');
      const { targetDir } = resolveDir(scopeKey, '');
      targetPath = pathResolver.resolveSafePath(targetDir, relativePath);
    }

    if (!targetPath || !fs.existsSync(targetPath)) {
      return res.status(404).json({ status: 'error', message: 'Target not found.' });
    }

    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(targetPath);
    }
    logGateway('delete', { uploadUrl: uploadUrl || '', targetPath });

    return res.json({ status: 'success', message: 'Deleted via gateway.' });
  } catch (error) {
    return respondError(res, error);
  }
};

exports.move = (req, res) => {
  try {
    const paths = resolveFileOperationPaths(req.body || {});
    movePathSafe(paths.sourcePath, paths.destinationPath);
    const uploadUrl = uploadPathUtils.fromDiskPathToUploadsUrl(paths.destinationPath);
    logGateway('move', {
      sourceScopeKey: paths.sourceScopeKey,
      sourceRelativePath: paths.sourceRelativePath,
      destinationScopeKey: paths.destinationScopeKey,
      destinationRelativeDir: paths.destinationRelativeDir,
      finalName: paths.finalName
    });
    return res.json({
      status: 'success',
      message: 'Moved via gateway.',
      uploadUrl,
      relativePath: uploadPathUtils.extractRelativeUploadPath(uploadUrl),
      finalName: paths.finalName
    });
  } catch (error) {
    return respondError(res, error);
  }
};

exports.copy = (req, res) => {
  try {
    const paths = resolveFileOperationPaths(req.body || {});
    copyPathRecursive(paths.sourcePath, paths.destinationPath);
    const uploadUrl = uploadPathUtils.fromDiskPathToUploadsUrl(paths.destinationPath);
    logGateway('copy', {
      sourceScopeKey: paths.sourceScopeKey,
      sourceRelativePath: paths.sourceRelativePath,
      destinationScopeKey: paths.destinationScopeKey,
      destinationRelativeDir: paths.destinationRelativeDir,
      finalName: paths.finalName
    });
    return res.json({
      status: 'success',
      message: 'Copied via gateway.',
      uploadUrl,
      relativePath: uploadPathUtils.extractRelativeUploadPath(uploadUrl),
      finalName: paths.finalName
    });
  } catch (error) {
    return respondError(res, error);
  }
};

exports.rename = (req, res) => {
  try {
    const scopeKey = clean(req.body.scopeKey || 'GLOBAL');
    const relativePath = assertValidRelativePath(req.body.relativePath || '', 'relative path');
    const newName = assertValidName(req.body.newName || '', 'new name');
    if (!relativePath) throw new Error('Invalid source path.');

    const { targetDir: scopeRoot } = resolveDir(scopeKey, '');
    const sourcePath = pathResolver.resolveSafePath(scopeRoot, relativePath);
    if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error('Source item not found.');
    if (path.basename(sourcePath) === newName) {
      throw new Error('New name must be different from the current name.');
    }

    const parentRelative = path.dirname(relativePath).replace(/\\/g, '/');
    const safeParentRelative = parentRelative === '.' ? '' : assertValidRelativePath(parentRelative, 'parent path');
    const targetPath = pathResolver.resolveSafePath(scopeRoot, path.posix.join(safeParentRelative, newName));
    if (fs.existsSync(targetPath)) {
      throw new Error('A file or folder with this name already exists.');
    }

    movePathSafe(sourcePath, targetPath);
    const uploadUrl = uploadPathUtils.fromDiskPathToUploadsUrl(targetPath);
    logGateway('rename', {
      scopeKey,
      relativePath,
      newName
    });

    return res.json({
      status: 'success',
      message: 'Renamed via gateway.',
      uploadUrl,
      relativePath: uploadPathUtils.extractRelativeUploadPath(uploadUrl),
      finalName: newName
    });
  } catch (error) {
    return respondError(res, error);
  }
};

exports.list = (req, res) => {
  try {
    const scopeKey = clean(req.body.scopeKey || 'GLOBAL');
    const relativeDir = clean(req.body.relativeDir || '');
    const { targetDir } = resolveDir(scopeKey, relativeDir);
    const items = fs.readdirSync(targetDir, { withFileTypes: true });

    const files = items.map((item) => {
      const absolutePath = path.join(targetDir, item.name);
      const stats = fs.statSync(absolutePath);
      return {
        name: item.name,
        isDir: item.isDirectory(),
        size: item.isDirectory() ? '-' : stats.size,
        modified: stats.mtime.toISOString()
      };
    });

    files.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return new Date(b.modified).getTime() - new Date(a.modified).getTime();
    });

    logGateway('list', { scopeKey, relativeDir, count: files.length });
    return res.json({ status: 'success', files });
  } catch (error) {
    return respondError(res, error);
  }
};

exports.resolve = (req, res) => {
  try {
    const uploadUrl = clean(req.body.uploadUrl || req.query.uploadUrl || '');
    const targetPath = uploadPathUtils.fromUploadsUrlToDiskPath(uploadUrl);
    if (!targetPath) throw new Error('Unable to resolve upload URL.');
    return res.json({
      status: 'success',
      uploadUrl,
      relativePath: uploadPathUtils.extractRelativeUploadPath(uploadUrl),
      exists: fs.existsSync(targetPath)
    });
  } catch (error) {
    return respondError(res, error);
  }
};

exports.downloadOrgBackup = async (req, res) => {
  try {
    const orgId = orgFileBackupService.normalizeOrgId(req.body?.orgId || req.query?.orgId || '');
    const archive = await orgFileBackupService.createOrgBackupArchive(orgId);
    logGateway('org-backup-download', {
      orgId,
      fileName: archive.fileName,
      fileCount: archive.manifest?.fileCount || 0
    });
    return sendArchiveResponse(res, archive);
  } catch (error) {
    return respondError(res, error);
  }
};

exports.restoreOrgBackup = async (req, res) => {
  try {
    const orgId = orgFileBackupService.normalizeOrgId(req.body?.orgId || '');
    if (!req.file || !req.file.buffer) throw new Error('Select an organization backup file to restore.');

    const report = await orgFileBackupService.restoreOrgBackupFromBuffer(orgId, req.file.buffer, {
      fileName: req.file.originalname || 'org-upload-backup.tar.gz'
    });
    logGateway('org-backup-restore', {
      orgId,
      fileName: req.file.originalname || '',
      restoredFiles: report.after?.fileCount || 0
    });
    return res.json({
      status: 'success',
      message: report.message || 'Organization files restored.',
      report
    });
  } catch (error) {
    return respondError(res, error);
  }
};
