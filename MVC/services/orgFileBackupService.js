const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { randomUUID } = require('crypto');
const tar = require('tar');
const pathResolver = require('../utils/pathResolver');
const uploadPathUtils = require('../utils/uploadPathUtils');

const BACKUP_FORMAT = 'org-upload-backup-tar-gzip-v1';
const BACKUP_VERSION = 1;
const TEMP_FOLDER_NAME = '.org-file-backups';

function pad(value) {
  return String(value).padStart(2, '0');
}

function buildTimestamp(date = new Date()) {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    '-',
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds())
  ].join('');
}

function normalizeOrgId(value = '') {
  const rawToken = String(value || '').trim();
  const token = rawToken.replace(/^ORG[_-]/i, '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(token)) {
    throw new Error('Invalid backup scope.');
  }
  if (token.toUpperCase() === 'GLOBAL' || token.toUpperCase() === 'SYSTEM') {
    return 'GLOBAL';
  }
  return token;
}

function getOrgScopeFolder(orgId = '') {
  const normalizedOrgId = normalizeOrgId(orgId);
  return normalizedOrgId === 'GLOBAL' ? 'GLOBAL' : `ORG_${normalizedOrgId}`;
}

function getTempRoot() {
  const uploadRoot = uploadPathUtils.getUploadRootAbsolute();
  return path.join(uploadRoot, TEMP_FOLDER_NAME);
}

function getOrgRoot(orgId = '') {
  const normalizedOrgId = normalizeOrgId(orgId);
  return pathResolver.getRootPath(normalizedOrgId === 'GLOBAL' ? 'GLOBAL' : normalizedOrgId);
}

function getBackupFileName(orgId = '', date = new Date()) {
  return `org-upload-backup-${getOrgScopeFolder(orgId)}-${buildTimestamp(date)}.tar.gz`;
}

async function pathExists(targetPath = '') {
  try {
    await fsp.access(targetPath);
    return true;
  } catch (_) {
    return false;
  }
}

async function ensureCleanDir(dirPath = '') {
  await fsp.rm(dirPath, { recursive: true, force: true });
  await fsp.mkdir(dirPath, { recursive: true });
}

async function movePathSafe(sourcePath = '', destinationPath = '') {
  await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
  try {
    await fsp.rename(sourcePath, destinationPath);
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error;
    await fsp.cp(sourcePath, destinationPath, { recursive: true, errorOnExist: true });
    await fsp.rm(sourcePath, { recursive: true, force: true });
  }
}

function assertInsideUploadRoot(targetPath = '') {
  const uploadRoot = uploadPathUtils.getUploadRootAbsolute();
  if (!uploadPathUtils.isInsideUploadRoot(targetPath, uploadRoot)) {
    throw new Error('Security Violation: Backup path is outside uploads root.');
  }
}

async function mirrorTreeWithHardLinks(sourceDir = '', destinationDir = '', stats = {}) {
  await fsp.mkdir(destinationDir, { recursive: true });
  stats.directoryCount = Number(stats.directoryCount || 0) + 1;

  if (!(await pathExists(sourceDir))) return stats;
  const entries = await fsp.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);

    if (entry.isDirectory()) {
      // eslint-disable-next-line no-await-in-loop
      await mirrorTreeWithHardLinks(sourcePath, destinationPath, stats);
      continue;
    }

    if (entry.isFile()) {
      // eslint-disable-next-line no-await-in-loop
      const fileStats = await fsp.stat(sourcePath);
      try {
        // eslint-disable-next-line no-await-in-loop
        await fsp.link(sourcePath, destinationPath);
      } catch (_) {
        // Hard links avoid double disk usage, but copy fallback keeps local dev portable.
        // eslint-disable-next-line no-await-in-loop
        await fsp.copyFile(sourcePath, destinationPath);
      }
      stats.fileCount = Number(stats.fileCount || 0) + 1;
      stats.totalBytes = Number(stats.totalBytes || 0) + Number(fileStats.size || 0);
      continue;
    }

    stats.skippedCount = Number(stats.skippedCount || 0) + 1;
  }

  return stats;
}

async function countTree(sourceDir = '') {
  const stats = { fileCount: 0, directoryCount: 0, totalBytes: 0, skippedCount: 0 };
  if (!(await pathExists(sourceDir))) return stats;
  const entries = await fsp.readdir(sourceDir, { withFileTypes: true });
  stats.directoryCount += 1;
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    if (entry.isDirectory()) {
      // eslint-disable-next-line no-await-in-loop
      const nested = await countTree(sourcePath);
      stats.fileCount += nested.fileCount;
      stats.directoryCount += nested.directoryCount;
      stats.totalBytes += nested.totalBytes;
      stats.skippedCount += nested.skippedCount;
    } else if (entry.isFile()) {
      // eslint-disable-next-line no-await-in-loop
      const fileStats = await fsp.stat(sourcePath);
      stats.fileCount += 1;
      stats.totalBytes += Number(fileStats.size || 0);
    } else {
      stats.skippedCount += 1;
    }
  }
  return stats;
}

async function createOrgBackupArchive(orgId = '') {
  const normalizedOrgId = normalizeOrgId(orgId);
  const scopeFolder = getOrgScopeFolder(normalizedOrgId);
  const orgRoot = getOrgRoot(normalizedOrgId);
  assertInsideUploadRoot(orgRoot);

  const tempRoot = getTempRoot();
  await fsp.mkdir(tempRoot, { recursive: true });
  const workId = randomUUID();
  const stageDir = path.join(tempRoot, `stage-${scopeFolder}-${workId}`);
  const archivePath = path.join(tempRoot, getBackupFileName(normalizedOrgId));

  await ensureCleanDir(stageDir);
  const filesDir = path.join(stageDir, 'files');
  const stats = await mirrorTreeWithHardLinks(orgRoot, filesDir, {
    fileCount: 0,
    directoryCount: 0,
    totalBytes: 0,
    skippedCount: 0
  });

  const manifest = {
    type: 'manifest',
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    generatedAt: new Date().toISOString(),
    orgId: normalizedOrgId,
    scope: scopeFolder,
    source: `/uploads/${scopeFolder}`,
    fileCount: stats.fileCount,
    directoryCount: stats.directoryCount,
    totalBytes: stats.totalBytes,
    skippedCount: stats.skippedCount
  };

  await fsp.writeFile(path.join(stageDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  await tar.c({
    gzip: true,
    file: archivePath,
    cwd: stageDir,
    portable: true,
    strict: true,
    filter: (entryPath) => validateArchiveEntryPath(entryPath)
  }, ['manifest.json', 'files']);

  await fsp.rm(stageDir, { recursive: true, force: true });
  const fileName = path.basename(archivePath);
  return {
    archivePath,
    fileName,
    manifest,
    async cleanup() {
      await fsp.rm(archivePath, { force: true }).catch(() => null);
    }
  };
}

function normalizeArchivePath(entryPath = '') {
  const token = String(entryPath || '').replace(/\\/g, '/').replace(/^\.\/+/, '').trim();
  if (!token) throw new Error('Backup archive contains an empty path.');
  if (path.posix.isAbsolute(token) || /^[A-Za-z]:/.test(token)) {
    throw new Error(`Backup archive contains an absolute path: ${token}`);
  }
  const parts = token.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new Error(`Backup archive contains an unsafe path: ${token}`);
  }
  return parts.join('/');
}

function validateArchiveEntryPath(entryPath = '') {
  const token = normalizeArchivePath(entryPath);
  if (token === 'manifest.json' || token === 'files' || token.startsWith('files/')) return true;
  throw new Error(`Backup archive contains an unsupported path: ${token}`);
}

function validateArchiveEntry(entryPath = '', entry = {}) {
  validateArchiveEntryPath(entryPath);
  const type = String(entry?.type || '');
  const allowedTypes = new Set(['', 'File', 'Directory', 'OldFile', 'ContiguousFile']);
  if (!allowedTypes.has(type)) {
    throw new Error(`Backup archive contains unsupported entry type "${type}".`);
  }
  return true;
}

function validateManifest(manifest = {}, orgId = '') {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Backup manifest is invalid.');
  }
  if (manifest.format !== BACKUP_FORMAT) {
    throw new Error('Unsupported backup format.');
  }
  if (Number(manifest.version || 0) !== BACKUP_VERSION) {
    throw new Error('Unsupported backup version.');
  }
  if (normalizeOrgId(manifest.orgId) !== normalizedOrgId) {
    throw new Error('Backup scope does not match the selected folder.');
  }
  if (String(manifest.scope || '') !== getOrgScopeFolder(normalizedOrgId)) {
    throw new Error('Backup scope does not match the selected folder.');
  }
  return manifest;
}

async function restoreOrgBackupFromBuffer(orgId = '', buffer, options = {}) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error('Backup file is empty.');
  }

  const scopeFolder = getOrgScopeFolder(normalizedOrgId);
  const orgRoot = getOrgRoot(normalizedOrgId);
  assertInsideUploadRoot(orgRoot);

  const tempRoot = getTempRoot();
  await fsp.mkdir(tempRoot, { recursive: true });
  const workId = randomUUID();
  const archivePath = path.join(tempRoot, `restore-${scopeFolder}-${workId}.tar.gz`);
  const extractDir = path.join(tempRoot, `extract-${scopeFolder}-${workId}`);
  const rollbackDir = path.join(tempRoot, `rollback-${scopeFolder}-${workId}`);

  await ensureCleanDir(extractDir);
  await fsp.writeFile(archivePath, buffer);

  try {
    await tar.x({
      file: archivePath,
      cwd: extractDir,
      strict: true,
      preservePaths: false,
      filter: (entryPath, entry) => validateArchiveEntry(entryPath, entry)
    });

    const manifestPath = path.join(extractDir, 'manifest.json');
    const rawManifest = await fsp.readFile(manifestPath, 'utf8').catch(() => '');
    if (!rawManifest) throw new Error('Backup manifest is missing.');
    const manifest = validateManifest(JSON.parse(rawManifest), normalizedOrgId);

    const filesDir = path.join(extractDir, 'files');
    if (!(await pathExists(filesDir))) {
      await fsp.mkdir(filesDir, { recursive: true });
    }

    const before = await countTree(orgRoot);
    const incoming = await countTree(filesDir);
    const hadExistingRoot = await pathExists(orgRoot);

    if (hadExistingRoot) {
      await movePathSafe(orgRoot, rollbackDir);
    }

    try {
      await movePathSafe(filesDir, orgRoot);
      await fsp.rm(rollbackDir, { recursive: true, force: true });
    } catch (error) {
      await fsp.rm(orgRoot, { recursive: true, force: true }).catch(() => null);
      if (await pathExists(rollbackDir)) {
        await movePathSafe(rollbackDir, orgRoot);
      }
      throw error;
    }

    const after = await countTree(orgRoot);
    return {
      status: 'success',
      message: `Organization files restored for ${scopeFolder}.`,
      orgId: normalizedOrgId,
      scope: scopeFolder,
      fileName: String(options.fileName || ''),
      manifest,
      before,
      incoming,
      after
    };
  } finally {
    await fsp.rm(archivePath, { force: true }).catch(() => null);
    await fsp.rm(extractDir, { recursive: true, force: true }).catch(() => null);
  }
}

module.exports = {
  BACKUP_FORMAT,
  normalizeOrgId,
  getOrgScopeFolder,
  getBackupFileName,
  createOrgBackupArchive,
  restoreOrgBackupFromBuffer
};
