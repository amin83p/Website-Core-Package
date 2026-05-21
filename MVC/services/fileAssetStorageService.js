const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const uploadPathUtils = require('../utils/uploadPathUtils');
const pathResolver = require('../utils/pathResolver');
const { isRailwayProxyMode } = require('../utils/uploadModeUtils');
const {
  gatewayUploadBlob,
  downloadRemoteUploadFile,
  gatewayDeleteByUploadUrl,
  gatewayDeleteByRelativePath,
  gatewayMoveItem,
  gatewayCopyItem,
  gatewayRenameItem,
  gatewayCreateFolder,
  gatewayListDirectory
} = require('./fileGatewayClientService');

function clean(value) {
  return String(value || '').trim();
}

function normalizeScopeKey(scopeKey = '') {
  const token = clean(scopeKey).toUpperCase();
  if (!token || token === 'GLOBAL' || token === 'SYSTEM') return 'GLOBAL';
  return token.replace(/^ORG_/, '');
}

function cleanRelativePath(value = '') {
  return clean(value)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
}

function cleanFileName(value = '', fallback = 'file') {
  const base = path.basename(clean(value) || fallback);
  const cleaned = base.replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_').replace(/^\.*/, '');
  return cleaned || fallback;
}

function scopeFolder(scopeKey = '') {
  const scope = normalizeScopeKey(scopeKey);
  return scope === 'GLOBAL' ? 'GLOBAL' : `ORG_${scope}`;
}

function localScopeRoot(scopeKey = '') {
  return pathResolver.getRootPath(normalizeScopeKey(scopeKey));
}

function localDirectory(scopeKey = '', relativeDir = '') {
  return pathResolver.resolveSafePath(localScopeRoot(scopeKey), cleanRelativePath(relativeDir));
}

function uploadsUrlForParts(scopeKey = '', relativeDir = '', fileName = '') {
  const parts = [
    scopeFolder(scopeKey),
    cleanRelativePath(relativeDir)
  ].filter(Boolean);
  const safeName = clean(fileName) ? cleanFileName(fileName) : '';
  if (safeName) parts.push(safeName);
  return `/uploads/${parts.join('/')}`;
}

function parseUploadReference(ref = '') {
  const relative = uploadPathUtils.extractRelativeUploadPath(ref);
  if (!relative) return null;
  const parts = relative.split('/').filter(Boolean);
  const first = String(parts.shift() || '').trim();
  const scope = first.toUpperCase() === 'GLOBAL' ? 'GLOBAL' : first.replace(/^ORG_/i, '');
  return {
    scopeKey: normalizeScopeKey(scope),
    relativePath: cleanRelativePath(parts.join('/')),
    fileName: parts.length ? parts[parts.length - 1] : '',
    relativeDir: cleanRelativePath(parts.slice(0, -1).join('/')),
    uploadUrl: `/uploads/${[first, ...parts].join('/')}`
  };
}

function resolveAvailableFilePath(directory, desiredName) {
  const fileName = cleanFileName(desiredName);
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let candidate = path.join(directory, fileName);
  let index = 1;

  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${base}_${index}${ext}`);
    index += 1;
  }

  return candidate;
}

function serializeLocalFile(filePath = '', originalName = '', mimeType = '') {
  const url = uploadPathUtils.fromDiskPathToUploadsUrl(filePath);
  return {
    path: String(filePath || '').replace(/\\/g, '/'),
    url,
    relativePath: uploadPathUtils.extractRelativeUploadPath(url),
    fileName: path.basename(filePath),
    originalName: clean(originalName) || path.basename(filePath),
    mimeType: clean(mimeType),
    size: fs.existsSync(filePath) ? fs.statSync(filePath).size : 0
  };
}

function serializeGatewayResult(result = {}, originalName = '', mimeType = '') {
  const url = clean(result.url || result.uploadUrl);
  const fileName = clean(result.fileName) || cleanFileName(originalName);
  return {
    path: url,
    url,
    relativePath: clean(result.relativePath) || uploadPathUtils.extractRelativeUploadPath(url),
    fileName,
    originalName: clean(originalName) || fileName,
    mimeType: clean(mimeType),
    size: Number(result.size || 0) || 0
  };
}

async function ensureDirectory(scopeKey = '', relativeDir = '') {
  const safeDir = cleanRelativePath(relativeDir);
  if (isRailwayProxyMode()) {
    const parts = safeDir.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await gatewayCreateFolder({
          scopeKey: normalizeScopeKey(scopeKey),
          relativeDir: current,
          folderName: part
        });
      } catch (error) {
        if (!/already exists/i.test(String(error?.message || ''))) throw error;
      }
      current = [current, part].filter(Boolean).join('/');
    }
    return {
      path: uploadsUrlForParts(scopeKey, safeDir, ''),
      url: uploadsUrlForParts(scopeKey, safeDir, '').replace(/\/$/, '')
    };
  }

  const dir = localDirectory(scopeKey, safeDir);
  await fsp.mkdir(dir, { recursive: true });
  return {
    path: dir.replace(/\\/g, '/'),
    url: uploadPathUtils.fromDiskPathToUploadsUrl(dir)
  };
}

async function saveBuffer({ scopeKey = 'GLOBAL', relativeDir = '', fileName = '', originalName = '', mimeType = 'application/octet-stream', buffer, overwrite = false }) {
  const safeName = cleanFileName(fileName || originalName || 'file');
  const safeDir = cleanRelativePath(relativeDir);
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');

  if (isRailwayProxyMode()) {
    if (overwrite) {
      await gatewayDeleteByUploadUrl(uploadsUrlForParts(scopeKey, safeDir, safeName)).catch(() => {});
    }
    const blob = new Blob([source], { type: clean(mimeType) || 'application/octet-stream' });
    const result = await gatewayUploadBlob({
      scopeKey: normalizeScopeKey(scopeKey),
      relativeDir: safeDir,
      desiredName: safeName,
      blob,
      mimeType
    });
    return {
      ...serializeGatewayResult(result, originalName || safeName, mimeType),
      size: source.length
    };
  }

  const dir = localDirectory(scopeKey, safeDir);
  await fsp.mkdir(dir, { recursive: true });
  const finalPath = overwrite ? path.join(dir, safeName) : resolveAvailableFilePath(dir, safeName);
  await fsp.writeFile(finalPath, source);
  return serializeLocalFile(finalPath, originalName || safeName, mimeType);
}

async function saveJson({ scopeKey = 'GLOBAL', relativeDir = '', fileName = 'data.json', data }) {
  return saveBuffer({
    scopeKey,
    relativeDir,
    fileName,
    originalName: fileName,
    mimeType: 'application/json',
    buffer: Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf8'),
    overwrite: true
  });
}

async function readBuffer(ref = '') {
  const token = clean(ref);
  if (!token) throw new Error('File reference is required.');
  if (/^\/uploads\//i.test(token) || /^https?:\/\/[^/]+\/uploads\//i.test(token)) {
    if (isRailwayProxyMode()) {
      const parsed = parseUploadReference(token);
      if (!parsed) throw new Error('Invalid upload URL.');
      const remote = await downloadRemoteUploadFile(parsed.scopeKey, parsed.relativePath);
      const arrayBuffer = await remote.blob.arrayBuffer();
      return {
        buffer: Buffer.from(arrayBuffer),
        mimeType: remote.mimeType || 'application/octet-stream',
        size: remote.size || 0,
        url: token
      };
    }

    const diskPath = uploadPathUtils.fromUploadsUrlToDiskPath(token);
    if (!diskPath) throw new Error('Unable to resolve upload URL.');
    return {
      buffer: await fsp.readFile(diskPath),
      mimeType: '',
      size: fs.existsSync(diskPath) ? fs.statSync(diskPath).size : 0,
      path: diskPath
    };
  }

  const diskPath = path.isAbsolute(token) ? token : path.resolve(process.cwd(), token);
  return {
    buffer: await fsp.readFile(diskPath),
    mimeType: '',
    size: fs.existsSync(diskPath) ? fs.statSync(diskPath).size : 0,
    path: diskPath
  };
}

async function listDirectory({ scopeKey = 'GLOBAL', relativeDir = '' } = {}) {
  const safeDir = cleanRelativePath(relativeDir);
  if (isRailwayProxyMode()) {
    const result = await gatewayListDirectory({
      scopeKey: normalizeScopeKey(scopeKey),
      relativeDir: safeDir
    });
    return (Array.isArray(result?.files) ? result.files : []).map((item) => {
      const name = clean(item?.name);
      return {
        name,
        isDir: Boolean(item?.isDir),
        size: item?.isDir ? 0 : Number(item?.size || 0),
        modified: item?.modified || '',
        url: item?.isDir ? '' : uploadsUrlForParts(scopeKey, safeDir, name)
      };
    });
  }

  const dir = localDirectory(scopeKey, safeDir);
  if (!fs.existsSync(dir)) return [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  return entries.map((entry) => {
    const filePath = path.join(dir, entry.name);
    const stat = fs.statSync(filePath);
    return {
      name: entry.name,
      isDir: entry.isDirectory(),
      size: entry.isDirectory() ? 0 : stat.size,
      modified: stat.mtime.toISOString(),
      url: entry.isDirectory() ? '' : uploadPathUtils.fromDiskPathToUploadsUrl(filePath)
    };
  });
}

async function deleteByUploadUrl(uploadUrl = '') {
  const token = clean(uploadUrl);
  if (!token) return false;
  if (isRailwayProxyMode() && /^\/uploads\//i.test(token)) {
    await gatewayDeleteByUploadUrl(token);
    return true;
  }
  const diskPath = uploadPathUtils.fromUploadsUrlToDiskPath(token) || (path.isAbsolute(token) ? token : '');
  if (!diskPath || !fs.existsSync(diskPath)) return false;
  await fsp.rm(diskPath, { recursive: true, force: true });
  return true;
}

async function deleteRelativePath({ scopeKey = 'GLOBAL', relativePath = '' } = {}) {
  const safePath = cleanRelativePath(relativePath);
  if (!safePath) return false;
  if (isRailwayProxyMode()) {
    await gatewayDeleteByRelativePath({ scopeKey: normalizeScopeKey(scopeKey), relativePath: safePath });
    return true;
  }
  const target = pathResolver.resolveSafePath(localScopeRoot(scopeKey), safePath);
  if (!fs.existsSync(target)) return false;
  await fsp.rm(target, { recursive: true, force: true });
  return true;
}

async function moveUploadReference({ sourceRef = '', destinationScopeKey = '', destinationDir = '' } = {}) {
  const parsed = parseUploadReference(sourceRef);
  if (!parsed || !parsed.relativePath || !parsed.fileName) {
    throw new Error('Invalid upload reference.');
  }
  const destScope = normalizeScopeKey(destinationScopeKey || parsed.scopeKey);
  const destDir = cleanRelativePath(destinationDir);

  if (isRailwayProxyMode()) {
    const result = await gatewayMoveItem({
      sourceScopeKey: parsed.scopeKey,
      sourceRelativePath: parsed.relativePath,
      destinationScopeKey: destScope,
      destinationRelativeDir: destDir
    });
    const finalName = clean(result?.finalName) || parsed.fileName;
    const url = uploadsUrlForParts(destScope, destDir, finalName);
    return {
      path: url,
      url,
      relativePath: uploadPathUtils.extractRelativeUploadPath(url),
      fileName: finalName
    };
  }

  const sourcePath = uploadPathUtils.fromUploadsUrlToDiskPath(parsed.uploadUrl);
  const targetDir = localDirectory(destScope, destDir);
  await fsp.mkdir(targetDir, { recursive: true });
  const targetPath = resolveAvailableFilePath(targetDir, parsed.fileName);
  try {
    await fsp.rename(sourcePath, targetPath);
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error;
    await fsp.copyFile(sourcePath, targetPath);
    await fsp.unlink(sourcePath);
  }
  return serializeLocalFile(targetPath, parsed.fileName);
}

async function copyRelativePath({ sourceScopeKey = '', sourceRelativePath = '', destinationScopeKey = '', destinationDir = '', destinationName = '' } = {}) {
  const sourcePath = cleanRelativePath(sourceRelativePath);
  const destScope = normalizeScopeKey(destinationScopeKey || sourceScopeKey);
  const destDir = cleanRelativePath(destinationDir);
  const safeDestinationName = clean(destinationName) ? cleanFileName(destinationName) : '';
  if (!sourcePath) return null;

  if (isRailwayProxyMode()) {
    const copied = await gatewayCopyItem({
      sourceScopeKey: normalizeScopeKey(sourceScopeKey),
      sourceRelativePath: sourcePath,
      destinationScopeKey: destScope,
      destinationRelativeDir: destDir
    });
    const finalName = clean(copied?.finalName);
    if (safeDestinationName && finalName && finalName !== safeDestinationName) {
      await gatewayRenameItem({
        scopeKey: destScope,
        relativePath: [destDir, finalName].filter(Boolean).join('/'),
        newName: safeDestinationName
      });
      return { ...copied, finalName: safeDestinationName };
    }
    return copied;
  }

  const sourceAbs = pathResolver.resolveSafePath(localScopeRoot(sourceScopeKey), sourcePath);
  if (!fs.existsSync(sourceAbs)) return null;
  const targetDir = localDirectory(destScope, destDir);
  await fsp.mkdir(targetDir, { recursive: true });
  const targetAbs = path.join(targetDir, safeDestinationName || path.basename(sourceAbs));
  await fsp.cp(sourceAbs, targetAbs, { recursive: true, force: false });
  return { path: targetAbs.replace(/\\/g, '/') };
}

async function sendDownload(res, ref = '', downloadName = '') {
  const token = clean(ref);
  if (!token) throw new Error('File reference is required.');
  if (!isRailwayProxyMode() && (/^\/uploads\//i.test(token) || path.isAbsolute(token))) {
    const diskPath = /^\/uploads\//i.test(token) ? uploadPathUtils.fromUploadsUrlToDiskPath(token) : token;
    if (!diskPath) throw new Error('Unable to resolve file path.');
    if (!uploadPathUtils.isInsideUploadRoot(diskPath)) {
      throw new Error('File is outside the upload storage root.');
    }
    return res.download(path.resolve(diskPath), downloadName || path.basename(diskPath));
  }

  const loaded = await readBuffer(token);
  const fileName = clean(downloadName) || path.basename(token.split('?')[0]) || 'download';
  res.setHeader('Content-Type', loaded.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/"/g, '')}"`);
  return res.send(loaded.buffer);
}

module.exports = {
  normalizeScopeKey,
  cleanRelativePath,
  cleanFileName,
  scopeFolder,
  parseUploadReference,
  uploadsUrlForParts,
  localDirectory,
  ensureDirectory,
  saveBuffer,
  saveJson,
  readBuffer,
  listDirectory,
  deleteByUploadUrl,
  deleteRelativePath,
  moveUploadReference,
  copyRelativePath,
  sendDownload
};
