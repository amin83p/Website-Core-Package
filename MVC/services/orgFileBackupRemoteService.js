'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { randomUUID } = require('crypto');
const tar = require('tar');
const uploadRemoteDriver = require('./uploadRemoteDriverService');
const uploadStorage = require('./uploadStorageService');
const orgFileBackupService = require('./orgFileBackupService');
const uploadPathUtils = require('../utils/uploadPathUtils');

const normalizeOrgId = orgFileBackupService.normalizeOrgId;

function getOrgScopeFolder(orgId = '') {
  const normalizedOrgId = normalizeOrgId(orgId);
  return normalizedOrgId === 'GLOBAL' ? 'GLOBAL' : `ORG_${normalizedOrgId}`;
}

function getTempRoot() {
  const uploadRoot = uploadPathUtils.getUploadRootAbsolute();
  return path.join(uploadRoot, '.org-file-backups');
}

async function listFilesRecursive(scopeKey = '', relativeDir = '') {
  const rows = [];
  const listing = await uploadRemoteDriver.listDirectory({ scopeKey, relativeDir });
  const entries = Array.isArray(listing?.files) ? listing.files : [];
  for (const entry of entries) {
    const name = String(entry?.name || '').trim();
    if (!name || name === '.keep') continue;
    const childDir = [relativeDir, name].filter(Boolean).join('/');
    if (entry.isDir) {
      // eslint-disable-next-line no-await-in-loop
      const nested = await listFilesRecursive(scopeKey, childDir);
      rows.push(...nested);
    } else {
      rows.push({
        relativeDir,
        fileName: name,
        size: Number(entry.size || 0)
      });
    }
  }
  return rows;
}

async function createOrgBackupArchive(orgId = '') {
  const normalizedOrgId = normalizeOrgId(orgId);
  const scopeFolder = getOrgScopeFolder(normalizedOrgId);
  const scopeKey = normalizedOrgId === 'GLOBAL' ? 'GLOBAL' : normalizedOrgId;
  const tempRoot = getTempRoot();
  await fsp.mkdir(tempRoot, { recursive: true });
  const workId = randomUUID();
  const stageDir = path.join(tempRoot, `stage-remote-${scopeFolder}-${workId}`);
  const filesDir = path.join(stageDir, 'files', scopeFolder);
  await fsp.mkdir(filesDir, { recursive: true });

  const remoteFiles = await listFilesRecursive(scopeKey, '');
  let totalBytes = 0;
  for (const row of remoteFiles) {
    const relativePath = [row.relativeDir, row.fileName].filter(Boolean).join('/');
    const url = uploadStorage.uploadsUrlForParts(scopeKey, row.relativeDir, row.fileName);
    // eslint-disable-next-line no-await-in-loop
    const loaded = await uploadStorage.readBuffer(url);
    const dest = path.join(filesDir, relativePath.split('/').join(path.sep));
    // eslint-disable-next-line no-await-in-loop
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    // eslint-disable-next-line no-await-in-loop
    await fsp.writeFile(dest, loaded.buffer);
    totalBytes += Number(loaded.size || loaded.buffer.length || 0);
  }

  const manifest = {
    type: 'manifest',
    format: 'org-upload-backup-tar-gzip-v1',
    version: 1,
    generatedAt: new Date().toISOString(),
    orgId: normalizedOrgId,
    scope: scopeFolder,
    source: `/uploads/${scopeFolder}`,
    fileCount: remoteFiles.length,
    directoryCount: 0,
    totalBytes,
    skippedCount: 0,
    storageBackend: 'remote'
  };
  await fsp.writeFile(path.join(stageDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  const archivePath = path.join(tempRoot, orgFileBackupService.getBackupFileName(orgId));
  await fsp.rm(archivePath, { force: true }).catch(() => null);
  await tar.c({
    gzip: true,
    file: archivePath,
    cwd: stageDir,
    portable: true,
    strict: true
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

async function restoreOrgBackupFromBuffer(orgId = '', buffer, options = {}) {
  const normalizedOrgId = normalizeOrgId(orgId);
  const scopeKey = normalizedOrgId === 'GLOBAL' ? 'GLOBAL' : normalizedOrgId;
  const tempRoot = getTempRoot();
  await fsp.mkdir(tempRoot, { recursive: true });
  const workId = randomUUID();
  const archivePath = path.join(tempRoot, `restore-remote-${workId}.tar.gz`);
  const extractDir = path.join(tempRoot, `extract-remote-${workId}`);
  await fsp.writeFile(archivePath, buffer);
  await fsp.mkdir(extractDir, { recursive: true });
  await tar.x({ file: archivePath, cwd: extractDir, strict: true });

  const filesRoot = path.join(extractDir, 'files', getOrgScopeFolder(normalizedOrgId));
  async function walkAndUpload(relativeDir = '') {
    const absoluteDir = relativeDir ? path.join(filesRoot, relativeDir) : filesRoot;
    if (!(await fsp.stat(absoluteDir).catch(() => null))) return;
    const entries = await fsp.readdir(absoluteDir, { withFileTypes: true });
    for (const entry of entries) {
      const childRelative = [relativeDir, entry.name].filter(Boolean).join('/');
      const abs = path.join(filesRoot, childRelative);
      if (entry.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        await uploadRemoteDriver.createFolder({
          scopeKey,
          relativeDir,
          folderName: entry.name
        }).catch(() => null);
        // eslint-disable-next-line no-await-in-loop
        await walkAndUpload(childRelative);
      } else if (entry.isFile()) {
        // eslint-disable-next-line no-await-in-loop
        await uploadRemoteDriver.uploadFile({
          scopeKey,
          relativeDir,
          desiredName: entry.name,
          localFilePath: abs,
          mimeType: 'application/octet-stream'
        });
      }
    }
  }
  await walkAndUpload('');

  await fsp.rm(archivePath, { force: true }).catch(() => null);
  await fsp.rm(extractDir, { recursive: true, force: true }).catch(() => null);
  return {
    status: 'success',
    message: 'Organization files restored.',
    report: {
      orgId: normalizedOrgId,
      fileCount: 0,
      message: 'Organization files restored from remote upload storage.'
    }
  };
}

module.exports = {
  createOrgBackupArchive,
  restoreOrgBackupFromBuffer
};