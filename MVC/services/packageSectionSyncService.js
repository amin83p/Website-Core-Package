const fs = require('fs/promises');
const path = require('path');
const packageRegistryInstallerService = require('./packageRegistryInstallerService');
const packageManifestService = require('./packageManifestService');
const sectionRepository = require('../repositories/sectionRepository');

function cleanText(value = '', max = 4000) {
  const out = String(value ?? '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function normalizePackageId(value = '') {
  return cleanText(value, 120).toLowerCase();
}

function normalizeSectionName(value = '') {
  return cleanText(value, 180).toUpperCase();
}

function normalizeSectionNameList(values = []) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((row) => normalizeSectionName(row))
      .filter(Boolean)
  ));
}

function getOwnershipFromRow(row = {}) {
  return normalizePackageId(
    row?.packageId
    || row?.package?.id
    || row?.package?.packageId
    || row?.metadata?.packageId
    || ''
  );
}

function rowOwnedByPackage(row = {}, packageId = '', manifestEntry = null) {
  const owner = getOwnershipFromRow(row);
  const target = normalizePackageId(packageId);
  if (!target) return false;
  if (!owner) return true;
  if (owner === target) return true;
  const manifestOwner = normalizePackageId(
    manifestEntry?.normalized?.packageId
    || manifestEntry?.declaration?.packageId
    || ''
  );
  return Boolean(manifestOwner) && manifestOwner === target;
}

function sanitizeOperation(row = {}) {
  const id = cleanText(row?.id || row?.operationId, 120);
  if (!id) return null;
  return {
    id,
    sessionAttempts: Number.isInteger(row?.sessionAttempts) ? row.sessionAttempts : 5,
    sessionTime: Number.isInteger(row?.sessionTime) ? row.sessionTime : 15,
    active: row?.active !== false
  };
}

function sanitizeSectionRef(row = {}) {
  const id = cleanText(row?.id || row?.sectionId, 120);
  if (!id) return null;
  return { id };
}

function sanitizeSectionForManifest(row = {}) {
  const name = normalizeSectionName(row?.name);
  if (!name) return null;
  const category = normalizeSectionName(row?.category) || 'GENERAL';
  return {
    id: cleanText(row?.id, 120) || undefined,
    name,
    category,
    description: cleanText(row?.description, 1200) || `${name} section`,
    active: row?.active !== false,
    trackState: row?.trackState !== false,
    minimumAccessRequirement: Number.isInteger(row?.minimumAccessRequirement) ? row.minimumAccessRequirement : 5,
    dashboardDisplay: row?.dashboardDisplay === true,
    mainDashboardDisplay: row?.mainDashboardDisplay === true,
    navigatorSection: row?.navigatorSection === true,
    homeURL: cleanText(row?.homeURL, 600),
    inactiveMessage: cleanText(row?.inactiveMessage, 600),
    message: cleanText(row?.message, 600),
    operations: Array.isArray(row?.operations) ? row.operations.map(sanitizeOperation).filter(Boolean) : [],
    subsections: Array.isArray(row?.subsections) ? row.subsections.map(sanitizeSectionRef).filter(Boolean) : [],
    related: Array.isArray(row?.related) ? row.related : [],
    adoptExisting: true
  };
}

const SECTION_SYNC_BACKUP_FORMAT = 'package-section-sync-backup';
const SECTION_SYNC_BACKUP_VERSION = 1;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeSectionForRuntimeBackup(row = {}) {
  const sanitized = sanitizeSectionForManifest(row);
  if (!sanitized) return null;
  return {
    ...sanitized,
    id: cleanText(row?.id, 120) || sanitized.id,
    packageId: getOwnershipFromRow(row) || undefined,
    packageName: cleanText(row?.packageName || row?.package?.name, 200) || undefined
  };
}

function validateSectionSyncBackup(backup = {}, packageId = '') {
  if (!backup || typeof backup !== 'object') throw new Error('Backup JSON is invalid.');
  if (backup.format !== SECTION_SYNC_BACKUP_FORMAT) {
    throw new Error('Backup file is not a section sync backup.');
  }
  if (Number(backup.version) !== SECTION_SYNC_BACKUP_VERSION) {
    throw new Error('Backup version is not supported.');
  }
  const backupPackageId = normalizePackageId(backup.packageId);
  const target = normalizePackageId(packageId);
  if (!backupPackageId || backupPackageId !== target) {
    throw new Error(`Backup package id "${backupPackageId || 'unknown'}" does not match "${target}".`);
  }
  if (!Array.isArray(backup.manifestSections)) {
    throw new Error('Backup is missing manifestSections array.');
  }
  if (!Array.isArray(backup.runtimeSections)) {
    throw new Error('Backup is missing runtimeSections array.');
  }
  return backup;
}

function buildManifestSectionMap(manifest = {}, packageMeta = {}) {
  const map = new Map();
  (Array.isArray(manifest?.sections) ? manifest.sections : []).forEach((declaration) => {
    try {
      const normalized = packageRegistryInstallerService.normalizeSectionDeclaration(declaration, packageMeta);
      map.set(normalized.name, {
        declaration,
        normalized,
        snapshot: packageRegistryInstallerService.pickSectionCompareSnapshot(normalized)
      });
    } catch (_) {
      // Skip invalid manifest rows in preview.
    }
  });
  return map;
}

function buildRuntimeSectionMap(rows = [], packageId = '') {
  const map = new Map();
  rows.forEach((row) => {
    if (!rowOwnedByPackage(row, packageId)) return;
    const name = normalizeSectionName(row?.name);
    if (!name) return;
    map.set(name, {
      row,
      snapshot: packageRegistryInstallerService.pickSectionCompareSnapshot(row)
    });
  });
  return map;
}

function buildPreviewRow({ name, runtimeEntry = null, manifestEntry = null }) {
  const runtime = runtimeEntry?.snapshot || null;
  const manifest = manifestEntry?.snapshot || null;
  let status = 'match';
  if (runtime && manifest) {
    const driftedFields = packageRegistryInstallerService.describeSectionDrift(
      runtimeEntry?.row || {},
      manifestEntry?.normalized || {}
    );
    status = driftedFields.length ? 'drift' : 'match';
    return {
      name,
      id: cleanText(runtimeEntry?.row?.id || manifestEntry?.normalized?.id, 120),
      status,
      driftedFields,
      runtime,
      manifest
    };
  }
  if (runtime && !manifest) {
    return {
      name,
      id: cleanText(runtimeEntry?.row?.id, 120),
      status: 'runtime-only',
      driftedFields: [],
      runtime,
      manifest: null
    };
  }
  return {
    name,
    id: cleanText(manifestEntry?.normalized?.id, 120),
    status: 'manifest-only',
    driftedFields: packageRegistryInstallerService.SECTION_COMPARE_FIELDS.slice(),
    runtime: null,
    manifest
  };
}

function createDefaultDependencies(overrides = {}) {
  return {
    sectionRepository: overrides.sectionRepository || sectionRepository,
    packageManifestService: overrides.packageManifestService || packageManifestService,
    fs: overrides.fs || fs
  };
}

function createService(overrides = {}) {
  const deps = createDefaultDependencies(overrides);

  async function listRuntimeSections(packageId = '', options = {}) {
    const backendMode = cleanText(options.backendMode, 30) || undefined;
    const rows = await deps.sectionRepository.list({ backendMode });
    return (Array.isArray(rows) ? rows : []).filter((row) => rowOwnedByPackage(row, packageId));
  }

  async function assertWritableManifestPath(manifestPath = '') {
    const token = String(manifestPath || '').trim();
    if (!token) throw new Error('Manifest path is not configured for this package.');
    const absPath = path.resolve(token);
    try {
      await deps.fs.access(absPath);
    } catch (_) {
      throw new Error(`Manifest file was not found at ${absPath}.`);
    }
    try {
      await deps.fs.access(absPath, require('fs').constants.W_OK);
    } catch (_) {
      throw new Error(`Manifest file is not writable at ${absPath}.`);
    }
    return absPath;
  }

  async function buildSectionSyncPreview(context = {}, options = {}) {
    const packageId = normalizePackageId(context?.packageId || context?.manifest?.id);
    if (!packageId) throw new Error('Package id is required.');
    const manifest = context?.manifest;
    if (!manifest || typeof manifest !== 'object') throw new Error('Package manifest is unavailable.');
    const packageMeta = {
      packageId,
      packageName: cleanText(context?.packageName || manifest?.name, 200) || packageId.toUpperCase()
    };
    const manifestMap = buildManifestSectionMap(manifest, packageMeta);
    const runtimeRows = await listRuntimeSections(packageId, options);
    const runtimeMap = buildRuntimeSectionMap(runtimeRows, packageId);
    const names = Array.from(new Set([...manifestMap.keys(), ...runtimeMap.keys()])).sort();
    const allPackageSections = names.map((name) => buildPreviewRow({
      name,
      runtimeEntry: runtimeMap.get(name) || null,
      manifestEntry: manifestMap.get(name) || null
    }));
    const runtimeOnlyHidden = allPackageSections.filter((row) => row.status === 'runtime-only').length;
    const packageSections = allPackageSections.filter((row) => row.status !== 'runtime-only');
    return {
      packageId,
      packageName: packageMeta.packageName,
      manifestPath: cleanText(context?.manifestPath, 1600),
      sections: packageSections,
      packageSections,
      summary: {
        total: packageSections.length,
        match: packageSections.filter((row) => row.status === 'match').length,
        drift: packageSections.filter((row) => row.status === 'drift').length,
        runtimeOnly: runtimeOnlyHidden,
        manifestOnly: packageSections.filter((row) => row.status === 'manifest-only').length,
        packageTotal: packageSections.length,
        packageMatch: packageSections.filter((row) => row.status === 'match').length,
        packageDrift: packageSections.filter((row) => row.status === 'drift').length,
        packageRuntimeOnly: runtimeOnlyHidden,
        packageManifestOnly: packageSections.filter((row) => row.status === 'manifest-only').length,
        runtimeOnlyHidden
      }
    };
  }

  function buildSectionPatch(existing = {}, manifestNormalized = {}, includeTopology = true) {
    const fields = [...packageRegistryInstallerService.SECTION_UPDATE_FIELDS];
    if (includeTopology) {
      fields.push('subsections', 'related');
    }
    return packageRegistryInstallerService.mergeEntityPayload(existing, manifestNormalized, fields);
  }

  async function applySectionsFromManifest(context = {}, sectionNames = [], options = {}) {
    const packageId = normalizePackageId(context?.packageId || context?.manifest?.id);
    if (!packageId) throw new Error('Package id is required.');
    const manifest = context?.manifest;
    if (!manifest || typeof manifest !== 'object') throw new Error('Package manifest is unavailable.');
    const names = normalizeSectionNameList(sectionNames);
    if (!names.length) throw new Error('Select at least one section to apply from the manifest.');
    const includeTopology = options?.includeTopology !== false;
    const backendMode = cleanText(options.backendMode, 30) || undefined;
    const packageMeta = {
      packageId,
      packageName: cleanText(context?.packageName || manifest?.name, 200) || packageId.toUpperCase()
    };
    const manifestMap = buildManifestSectionMap(manifest, packageMeta);
    const results = [];

    for (const name of names) {
      const manifestEntry = manifestMap.get(name);
      if (!manifestEntry) {
        results.push({ name, status: 'failed', message: 'Section was not found in the manifest.' });
        continue;
      }
      const existing = await deps.sectionRepository.getByName
        ? deps.sectionRepository.getByName(name, { backendMode })
        : (await deps.sectionRepository.list({ backendMode, query: { name__eq: name, limit: 1 } }))?.[0];
      if (!existing) {
        try {
          const created = await deps.sectionRepository.create(manifestEntry.normalized, { backendMode });
          results.push({
            name,
            status: 'created',
            id: cleanText(created?.id, 120),
            message: 'Created section from manifest.'
          });
        } catch (error) {
          results.push({ name, status: 'failed', message: error?.message || String(error) });
        }
        continue;
      }
      if (!rowOwnedByPackage(existing, packageId, manifestEntry)) {
        results.push({ name, status: 'failed', message: 'Section is owned by another package.' });
        continue;
      }
      try {
        const existingId = cleanText(existing?.id || existing?._id || manifestEntry?.normalized?.id, 120);
        if (!existingId) throw new Error('Section id is missing in runtime data.');
        const patch = buildSectionPatch(existing, manifestEntry.normalized, includeTopology);
        const updated = await deps.sectionRepository.update(existingId, patch, { backendMode });
        results.push({
          name,
          status: 'updated',
          id: cleanText(updated?.id || existing.id, 120),
          message: 'Updated section from manifest.'
        });
      } catch (error) {
        results.push({ name, status: 'failed', message: error?.message || String(error) });
      }
    }

    return {
      action: 'apply-manifest',
      packageId,
      includeTopology,
      results,
      updated: results.filter((row) => row.status === 'updated' || row.status === 'created').length,
      failed: results.filter((row) => row.status === 'failed').length
    };
  }

  async function applySectionsToManifest(context = {}, sectionNames = [], options = {}) {
    const packageId = normalizePackageId(context?.packageId || context?.manifest?.id);
    if (!packageId) throw new Error('Package id is required.');
    const manifest = context?.manifest;
    if (!manifest || typeof manifest !== 'object') throw new Error('Package manifest is unavailable.');
    const manifestPath = await assertWritableManifestPath(context?.manifestPath);
    const names = normalizeSectionNameList(sectionNames);
    if (!names.length) throw new Error('Select at least one section to apply to the manifest.');
    const includeTopology = options?.includeTopology !== false;
    const backendMode = cleanText(options.backendMode, 30) || undefined;
    const runtimeRows = await listRuntimeSections(packageId, { backendMode });
    const runtimeMap = buildRuntimeSectionMap(runtimeRows, packageId);
    const manifestSections = Array.isArray(manifest.sections) ? [...manifest.sections] : [];
    const manifestIndexByName = new Map();
    manifestSections.forEach((row, index) => {
      const name = normalizeSectionName(row?.name);
      if (name) manifestIndexByName.set(name, index);
    });
    const results = [];

    names.forEach((name) => {
      const runtimeEntry = runtimeMap.get(name);
      if (!runtimeEntry) {
        results.push({ name, status: 'failed', message: 'Section was not found in runtime data.' });
        return;
      }
      const sanitized = sanitizeSectionForManifest(runtimeEntry.row);
      if (!sanitized) {
        results.push({ name, status: 'failed', message: 'Section could not be sanitized for manifest export.' });
        return;
      }
      if (!includeTopology) {
        delete sanitized.subsections;
        delete sanitized.related;
      }
      const index = manifestIndexByName.get(name);
      if (index === undefined) {
        manifestSections.push(sanitized);
        manifestIndexByName.set(name, manifestSections.length - 1);
        results.push({ name, status: 'created', message: 'Added section to manifest.' });
        return;
      }
      manifestSections[index] = {
        ...manifestSections[index],
        ...sanitized,
        id: sanitized.id || manifestSections[index]?.id
      };
      results.push({ name, status: 'updated', message: 'Updated section in manifest.' });
    });

    const nextManifest = {
      ...manifest,
      sections: manifestSections
    };
    deps.packageManifestService.validatePackageManifest(nextManifest, { knownIds: [] });
    await deps.fs.writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');

    return {
      action: 'apply-runtime',
      packageId,
      manifestPath,
      includeTopology,
      results,
      updated: results.filter((row) => row.status === 'updated' || row.status === 'created').length,
      failed: results.filter((row) => row.status === 'failed').length
    };
  }

  async function buildSectionSyncBackup(context = {}, options = {}) {
    const packageId = normalizePackageId(context?.packageId || context?.manifest?.id);
    if (!packageId) throw new Error('Package id is required.');
    const manifest = context?.manifest;
    if (!manifest || typeof manifest !== 'object') throw new Error('Package manifest is unavailable.');
    const packageMeta = {
      packageId,
      packageName: cleanText(context?.packageName || manifest?.name, 200) || packageId.toUpperCase()
    };
    const runtimeRows = await listRuntimeSections(packageId, options);
    const runtimeSections = runtimeRows
      .map((row) => sanitizeSectionForRuntimeBackup(row))
      .filter(Boolean)
      .sort((left, right) => left.name.localeCompare(right.name));
    const manifestSections = cloneJson(Array.isArray(manifest?.sections) ? manifest.sections : []);
    return {
      format: SECTION_SYNC_BACKUP_FORMAT,
      version: SECTION_SYNC_BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      packageId,
      packageName: packageMeta.packageName,
      manifestPath: cleanText(context?.manifestPath, 1600),
      manifestSections,
      runtimeSections,
      counts: {
        manifestSections: manifestSections.length,
        runtimeSections: runtimeSections.length
      }
    };
  }

  async function restoreSectionSyncBackup(context = {}, backupInput = {}, options = {}) {
    const packageId = normalizePackageId(context?.packageId || context?.manifest?.id);
    if (!packageId) throw new Error('Package id is required.');
    const manifest = context?.manifest;
    if (!manifest || typeof manifest !== 'object') throw new Error('Package manifest is unavailable.');
    const backup = validateSectionSyncBackup(backupInput, packageId);
    const restoreRuntime = options?.restoreRuntime !== false;
    const restoreManifest = options?.restoreManifest !== false;
    const includeTopology = options?.includeTopology !== false;
    const backendMode = cleanText(options.backendMode, 30) || undefined;
    const packageMeta = {
      packageId,
      packageName: cleanText(context?.packageName || manifest?.name, 200) || packageId.toUpperCase()
    };
    const runtimeResults = [];

    if (restoreRuntime) {
      for (const rawRow of backup.runtimeSections) {
        const name = normalizeSectionName(rawRow?.name);
        if (!name) {
          runtimeResults.push({ name: '', status: 'failed', message: 'Section name is missing in backup.' });
          continue;
        }
        try {
          const normalized = packageRegistryInstallerService.normalizeSectionDeclaration(rawRow, packageMeta);
          const existing = deps.sectionRepository.getByName
            ? await deps.sectionRepository.getByName(name, { backendMode })
            : (await deps.sectionRepository.list({ backendMode, query: { name__eq: name, limit: 1 } }))?.[0];
          if (!existing) {
            const created = await deps.sectionRepository.create(normalized, { backendMode });
            runtimeResults.push({
              name,
              status: 'created',
              id: cleanText(created?.id, 120),
              message: 'Restored section in runtime from backup.'
            });
            continue;
          }
          if (!rowOwnedByPackage(existing, packageId)) {
            runtimeResults.push({ name, status: 'failed', message: 'Section is owned by another package.' });
            continue;
          }
          const existingId = cleanText(existing?.id || existing?._id || normalized?.id, 120);
          if (!existingId) throw new Error('Section id is missing in runtime data.');
          const patch = buildSectionPatch(existing, normalized, includeTopology);
          const updated = await deps.sectionRepository.update(existingId, patch, { backendMode });
          runtimeResults.push({
            name,
            status: 'updated',
            id: cleanText(updated?.id || existingId, 120),
            message: 'Restored section in runtime from backup.'
          });
        } catch (error) {
          runtimeResults.push({ name, status: 'failed', message: error?.message || String(error) });
        }
      }
    }

    let manifestResult = null;
    if (restoreManifest) {
      const manifestPath = await assertWritableManifestPath(context?.manifestPath);
      const manifestSections = cloneJson(backup.manifestSections);
      const nextManifest = {
        ...manifest,
        sections: manifestSections
      };
      deps.packageManifestService.validatePackageManifest(nextManifest, { knownIds: [] });
      await deps.fs.writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');
      manifestResult = {
        status: 'updated',
        sectionCount: manifestSections.length,
        manifestPath,
        message: 'Restored manifest sections from backup.'
      };
    }

    return {
      action: 'restore-backup',
      packageId,
      restoreRuntime,
      restoreManifest,
      includeTopology,
      runtimeResults,
      manifestResult,
      runtimeUpdated: runtimeResults.filter((row) => row.status === 'updated' || row.status === 'created').length,
      runtimeFailed: runtimeResults.filter((row) => row.status === 'failed').length
    };
  }

  return {
    buildSectionSyncPreview,
    applySectionsFromManifest,
    applySectionsToManifest,
    buildSectionSyncBackup,
    restoreSectionSyncBackup,
    sanitizeSectionForManifest
  };
}

const defaultService = createService();

module.exports = {
  ...defaultService,
  createService,
  createDefaultDependencies,
  sanitizeSectionForManifest,
  sanitizeSectionForRuntimeBackup,
  validateSectionSyncBackup,
  SECTION_SYNC_BACKUP_FORMAT,
  SECTION_SYNC_BACKUP_VERSION
};
