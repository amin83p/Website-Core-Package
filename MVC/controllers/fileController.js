const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { isRailwayProxyMode } = require('../utils/uploadModeUtils');
const organizationRepository = require('../repositories/organizationRepository');
const orgFileBackupService = require('../services/orgFileBackupService');
const adminAuthorityService = require('../services/adminAuthorityService');
const coreFilesService = require('../services/coreFilesService');
const { SECTIONS, OPERATIONS } = require('../../config/accessConstants');
const {
  gatewayDownloadOrgBackup,
  gatewayRestoreOrgBackup
} = require('../services/fileGatewayClientService');

function isAjax(req) {
  return Boolean(req.headers['x-ajax-request']);
}

function canManageOrgBackups(user) {
  return adminAuthorityService.isAdminForRequest(user, SECTIONS.UPLOADED_FILES, OPERATIONS.DOWNLOAD_FILE, {
    section: { id: SECTIONS.UPLOADED_FILES }
  });
}

function getOrganizationLabel(org = {}) {
  return String(
    org?.identity?.displayName
      || org?.identity?.legalName
      || org?.name
      || org?.displayName
      || org?.id
      || ''
  ).trim();
}

function resolveOrgBackupRestoreMaxUploadMb() {
  const raw = Number.parseInt(String(process.env.ORG_BACKUP_RESTORE_MAX_UPLOAD_MB || ''), 10);
  if (!Number.isFinite(raw) || Number.isNaN(raw) || raw <= 0) return 500;
  return Math.min(raw, 10240);
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

async function handleFileTransfer(req, res, operation = 'move') {
  try {
    const destinationPathInput = coreFilesService.assertValidRelativePath(req.body?.destinationPath || '', 'destination path');
    if (!destinationPathInput) throw new Error('Destination folder is required.');

    const requestedSourcePaths = coreFilesService.parseSourcePathInputs(req.body || {});
    if (!requestedSourcePaths.length) throw new Error('Source path is required.');

    const sourcePaths = [];
    const seenSources = new Set();
    requestedSourcePaths.forEach((token) => {
      const key = String(token || '').trim();
      if (!key || seenSources.has(key)) return;
      seenSources.add(key);
      sourcePaths.push(key);
    });

    const destinationContext = coreFilesService.resolveContextFromPath(req.user, destinationPathInput);

    if (sourcePaths.length === 1) {
      const normalizedSourcePath = coreFilesService.assertValidRelativePath(sourcePaths[0], 'source path');
      if (!normalizedSourcePath) throw new Error('Source path is required.');
      const sourceContext = coreFilesService.resolveContextFromPath(req.user, normalizedSourcePath);
      const transfer = await coreFilesService.transferSingleItem({
        operation,
        sourceContext,
        destinationContext
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
      return res.redirect(`/files?path=${encodeURIComponent(destinationContext.currentPath)}`);
    }

    const verb = operation === 'copy' ? 'copied' : 'moved';
    const results = [];
    let succeeded = 0;
    let failed = 0;
    let lastDestinationPath = destinationContext.currentPath;

    for (const rawSourcePath of sourcePaths) {
      try {
        const normalizedSourcePath = coreFilesService.assertValidRelativePath(rawSourcePath, 'source path');
        if (!normalizedSourcePath) throw new Error('Source path is required.');
        const sourceContext = coreFilesService.resolveContextFromPath(req.user, normalizedSourcePath);
        const transfer = await coreFilesService.transferSingleItem({
          operation,
          sourceContext,
          destinationContext
        });
        succeeded += 1;
        lastDestinationPath = destinationContext.currentPath;
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

    return res.redirect(`/files?path=${encodeURIComponent(lastDestinationPath)}`);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', {
      title: operation === 'copy' ? 'Copy Failed' : 'Move Failed',
      message: error.message,
      user: req.user
    });
  }
}

exports.listFiles = async (req, res) => {
  try {
    const user = req.user;
    const currentPathStr = coreFilesService.sanitizeDrivePath(req.query.path || '');
    const context = coreFilesService.resolveContextFromPath(user, currentPathStr, { allowRoot: true });
    const orgBackupOrganizations = await getOrgBackupOrganizations(user).catch(() => []);
    const orgBackupEnabled = canManageOrgBackups(user);
    const orgBackupRestoreMaxUploadMb = resolveOrgBackupRestoreMaxUploadMb();

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
        orgBackupRestoreMaxUploadMb,
        actionStateId: req.actionStateId
      });
    }

    const contents = await coreFilesService.listContextDirectory(context);
    contents.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return b.modified - a.modified;
    });

    const breadcrumbs = coreFilesService.buildPathBreadcrumbs(context.currentPath);
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
      orgBackupRestoreMaxUploadMb,
      actionStateId: req.actionStateId
    });
  } catch (error) {
    return res.status(500).render('error', { title: 'Error', message: error.message, user: req.user });
  }
};

exports.listFolderLibrary = async (req, res) => {
  try {
    const user = req.user;
    const requestedPath = coreFilesService.sanitizeDrivePath(req.query?.path || '');
    const context = coreFilesService.resolveContextFromPath(user, requestedPath, { allowRoot: true });
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

    const folders = await coreFilesService.listFolderRowsForContext(context);
    return res.json({
      status: 'success',
      message: 'Folder library loaded.',
      currentPath: context.currentPath,
      parentPath: context.currentPath.split('/').slice(0, -1).join('/'),
      breadcrumbs: coreFilesService.buildPathBreadcrumbs(context.currentPath),
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
    const requestedPath = coreFilesService.sanitizeDrivePath(req.query.path || '');
    if (isRailwayProxyMode()) {
      if (!requestedPath) return res.status(400).send('Invalid path');
      return res.redirect(`/uploads/${encodeURI(requestedPath)}`);
    }
    const context = coreFilesService.resolveContextFromPath(req.user, requestedPath);
    const targetFile = context.targetPath;
    if (!fs.existsSync(targetFile)) return res.status(404).send('File not found');
    const stat = fs.statSync(targetFile);
    if (stat.isDirectory()) return res.status(400).send('Cannot download a folder.');
    return res.download(targetFile);
  } catch (error) {
    return res.status(400).send(error.message);
  }
};

exports.deleteFile = async (req, res) => {
  try {
    let requestedPath = coreFilesService.sanitizeDrivePath(req.query.path || '');
    if (!requestedPath && req.params.filename && req.params.filename !== 'dummy') {
      requestedPath = coreFilesService.sanitizeDrivePath(req.params.filename);
    }
    if (!requestedPath) throw new Error('No path provided.');

    const context = coreFilesService.resolveContextFromPath(req.user, requestedPath);
    const deleted = await coreFilesService.deletePathByContext(context);

    if (isAjax(req)) {
      if (!deleted) return res.status(404).json({ status: 'error', message: 'Item not found' });
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
    const sourcePathInput = coreFilesService.assertValidRelativePath(req.body?.sourcePath || '', 'source path');
    const newName = coreFilesService.assertValidName(req.body?.newName || '', 'new name');
    if (!sourcePathInput) throw new Error('Source path is required.');

    const sourceContext = coreFilesService.resolveContextFromPath(req.user, sourcePathInput);
    const result = await coreFilesService.renamePathByContext(sourceContext, newName);
    const parentPath = sourceContext.currentPath.split('/').slice(0, -1).join('/');

    const payload = {
      status: 'success',
      message: `Item renamed to "${result.finalName || newName}".`,
      sourcePath: result.sourcePath,
      destinationPath: result.destinationPath,
      finalName: result.finalName
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

exports.createFolder = async (req, res) => {
  try {
    const currentPath = coreFilesService.assertValidRelativePath(req.body.path || '', 'path');
    const folderName = coreFilesService.assertValidName(req.body.folderName, 'folder name');
    const context = coreFilesService.resolveContextFromPath(req.user, currentPath);
    await coreFilesService.createFolderByContext(context, folderName);

    if (isAjax(req)) {
      return res.json({ status: 'success', message: `Folder "${folderName}" created.` });
    }
    return res.redirect(`/files?path=${encodeURIComponent(context.currentPath)}`);
  } catch (error) {
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Create Folder Failed', message: error.message, user: req.user });
  }
};

exports.uploadFile = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      throw new Error('No files were uploaded.');
    }

    const currentPath = coreFilesService.buildCurrentPathFromUploadBody(req.body || {});
    const context = coreFilesService.resolveContextFromPath(req.user, currentPath);
    const relativePaths = coreFilesService.parseRelativePathsMap(req.body || {});
    const payload = await coreFilesService.uploadFilesToContext({
      context,
      files: req.files,
      relativePaths
    });

    if (isAjax(req)) return res.json(payload);
    return res.redirect(`/files?path=${encodeURIComponent(context.currentPath)}`);
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
    if (isAjax(req)) return res.status(400).json({ status: 'error', message: error.message });
    return res.status(400).render('error', { title: 'Upload Failed', message: error.message, user: req.user });
  }
};

exports.cleanupOldFiles = (req, res) => {
  res.json({ status: 'success', message: 'Cleanup logic needs update for v2 structure.' });
};
