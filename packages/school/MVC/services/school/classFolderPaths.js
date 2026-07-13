const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { requireCoreModule } = require('./schoolCoreContracts');
const { resolveCoreRoot } = require('./schoolCoreModuleResolver');
const fileAssetStorage = requireCoreModule('MVC/services/fileAssetStorageService');
const uploadFolderSettingsService = requireCoreModule('MVC/services/uploadFolderSettingsService');
const { toPublicId } = requireCoreModule('MVC/utils/idAdapter');

const UPLOAD_CLASS_ROOTS = Object.freeze([
  'school/classes',
  'classes',
  'class'
]);

function getClassStorageBasePath() {
  return path.join(resolveCoreRoot(), 'data/school/classes_storage');
}

function isSafeChildPath(basePath, targetPath) {
  const normalizedBase = path.resolve(basePath);
  const normalizedTarget = path.resolve(targetPath);
  return normalizedTarget === normalizedBase || normalizedTarget.startsWith(`${normalizedBase}${path.sep}`);
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (_) {
    return false;
  }
}

function buildUploadTargetsForClass(classData = {}) {
  const classId = toPublicId(classData?.id);
  const orgId = String(classData?.orgId || '').trim();
  if (!classId) return [];

  const storedWorkspace = String(classData?.uploadWorkspace?.relativePath || '').trim();
  const configuredWorkspace = uploadFolderSettingsService.resolveUploadFolder('school.classWorkspace', { classId });
  const defaultWorkspace = uploadFolderSettingsService.resolveDefaultUploadFolder('school.classWorkspace', { classId });
  const workspaceTargets = [storedWorkspace, defaultWorkspace, configuredWorkspace].filter(Boolean);
  const scopeKey = orgId || 'GLOBAL';

  const uploadTargets = [
    ...workspaceTargets.map((relativePath) => ({ scopeKey, relativePath })),
    { scopeKey, relativePath: `classes/${classId}` },
    { scopeKey, relativePath: `class/${classId}` }
  ];

  return uploadTargets.filter((target, index, list) =>
    list.findIndex((item) => item.scopeKey === target.scopeKey && item.relativePath === target.relativePath) === index
  );
}

async function deleteDirectoryIfExists(basePath, relativeSegments = []) {
  const safeSegments = (Array.isArray(relativeSegments) ? relativeSegments : [])
    .map((segment) => String(segment || '').trim())
    .filter(Boolean);
  const targetPath = path.resolve(basePath, ...safeSegments);
  if (!isSafeChildPath(basePath, targetPath)) {
    throw new Error('Security Violation: Refusing to delete path outside allowed base directory.');
  }
  const existed = await pathExists(targetPath);
  if (!existed) {
    return { existed: false, removed: false, path: targetPath };
  }
  await fs.rm(targetPath, { recursive: true, force: true });
  const stillExists = await pathExists(targetPath);
  return {
    existed: true,
    removed: !stillExists,
    path: targetPath
  };
}

async function deleteClassFolderTargets(classData = {}) {
  const classId = toPublicId(classData?.id);
  if (!classId) return { removed: [], failed: [] };

  const removed = [];
  const failed = [];

  const tryDelete = async (basePath, segments = []) => {
    try {
      const result = await deleteDirectoryIfExists(basePath, segments);
      if (result.existed && result.removed) {
        removed.push(result.path);
      }
    } catch (error) {
      failed.push({
        basePath,
        segments: (Array.isArray(segments) ? segments : []).join('/'),
        message: error?.message || String(error)
      });
    }
  };

  const classStorageBase = getClassStorageBasePath();
  await tryDelete(classStorageBase, [classId]);

  for (const target of buildUploadTargetsForClass(classData)) {
    try {
      const removedUpload = await fileAssetStorage.deleteRelativePath(target);
      if (removedUpload) {
        removed.push(`/uploads/${fileAssetStorage.scopeFolder(target.scopeKey)}/${target.relativePath}`);
      }
    } catch (error) {
      failed.push({
        basePath: `/uploads/${fileAssetStorage.scopeFolder(target.scopeKey)}`,
        segments: target.relativePath,
        message: error?.message || String(error)
      });
    }
  }

  return { removed, failed };
}

async function listChildDirectoryNames(basePath) {
  if (!fsSync.existsSync(basePath)) return [];
  const entries = await fs.readdir(basePath, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function listUploadClassIdsForOrg(orgId) {
  const scopeKey = String(orgId || '').trim() || 'GLOBAL';
  const classIds = new Set();

  for (const root of UPLOAD_CLASS_ROOTS) {
    try {
      const entries = await fileAssetStorage.listDirectory({ scopeKey, relativeDir: root });
      for (const entry of entries) {
        if (!entry?.isDir) continue;
        const name = String(entry?.name || '').trim();
        if (name) classIds.add(name);
      }
    } catch (_) {
      // Directory may not exist for this org/root.
    }
  }

  return classIds;
}

async function classWorkspaceExists(classRow = {}) {
  const targets = buildUploadTargetsForClass(classRow);
  for (const target of targets) {
    const entries = await fileAssetStorage.listDirectory({
      scopeKey: target.scopeKey,
      relativeDir: target.relativePath
    });
    if (Array.isArray(entries) && entries.length) return true;
  }
  const classId = toPublicId(classRow?.id);
  if (!classId) return false;
  const legacyPath = path.join(getClassStorageBasePath(), classId);
  return fsSync.existsSync(legacyPath);
}

/**
 * @param {string} orgId
 * @param {Set<string>} liveClassIds - class ids that exist for this org
 * @param {Set<string>} [globalLiveClassIds] - all class ids in system (for legacy storage safety)
 */
async function scanOrphanClassFolders(orgId, liveClassIds, globalLiveClassIds = liveClassIds) {
  const orphanDirs = [];
  const seen = new Set();

  const classStorageBase = getClassStorageBasePath();
  const legacyDirs = await listChildDirectoryNames(classStorageBase);
  for (const classId of legacyDirs) {
    const normalizedId = toPublicId(classId) || classId;
    if (liveClassIds.has(normalizedId)) continue;
    const key = `classes_storage:${normalizedId}`;
    if (!seen.has(key)) {
      seen.add(key);
      orphanDirs.push({
        classId: normalizedId,
        source: 'classes_storage',
        path: path.join(classStorageBase, normalizedId),
        deleteTarget: { type: 'classes_storage', classId: normalizedId },
        blockedByGlobalClass: globalLiveClassIds.has(normalizedId)
      });
    }
  }

  const uploadClassIds = await listUploadClassIdsForOrg(orgId);
  const scopeFolder = fileAssetStorage.scopeFolder(orgId);
  for (const classId of uploadClassIds) {
    const normalizedId = toPublicId(classId) || classId;
    if (liveClassIds.has(normalizedId)) continue;
    for (const root of UPLOAD_CLASS_ROOTS) {
      const key = `upload:${normalizedId}:${root}`;
      if (seen.has(key)) continue;
      seen.add(key);
      orphanDirs.push({
        classId: normalizedId,
        source: 'upload',
        path: `/uploads/${scopeFolder}/${root}/${normalizedId}`,
        deleteTarget: { type: 'upload', scopeKey: orgId, relativePath: `${root}/${normalizedId}` }
      });
    }
  }

  return orphanDirs;
}

async function scanMissingFoldersForLiveClasses(classRows = []) {
  const missing = [];
  for (const row of classRows) {
    const classId = toPublicId(row?.id);
    if (!classId) continue;
    // eslint-disable-next-line no-await-in-loop
    const exists = await classWorkspaceExists(row);
    if (!exists) {
      missing.push({
        classId,
        title: String(row?.title || row?.name || classId).trim()
      });
    }
  }
  return missing;
}

async function deleteOrphanFolderTarget(target, reqUser, globalLiveClassIds) {
  const classId = toPublicId(target?.classId);
  if (!classId) return { removed: false, skipped: true, reason: 'missing classId' };
  if (globalLiveClassIds.has(classId)) {
    return { removed: false, skipped: true, reason: 'class still exists in another org' };
  }

  if (target?.deleteTarget?.type === 'classes_storage') {
    const result = await deleteDirectoryIfExists(getClassStorageBasePath(), [classId]);
    return { removed: Boolean(result.removed), path: result.path };
  }

  if (target?.deleteTarget?.type === 'upload') {
    const removed = await fileAssetStorage.deleteRelativePath({
      scopeKey: target.deleteTarget.scopeKey,
      relativePath: target.deleteTarget.relativePath
    });
    return {
      removed: Boolean(removed),
      path: `/uploads/${fileAssetStorage.scopeFolder(target.deleteTarget.scopeKey)}/${target.deleteTarget.relativePath}`
    };
  }

  return { removed: false, skipped: true, reason: 'unknown target type' };
}

module.exports = {
  UPLOAD_CLASS_ROOTS,
  getClassStorageBasePath,
  buildUploadTargetsForClass,
  deleteClassFolderTargets,
  scanOrphanClassFolders,
  scanMissingFoldersForLiveClasses,
  deleteOrphanFolderTarget,
  isSafeChildPath
};
