const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const PizZip = require('pizzip');

const dataService = require('./dataService');
const packageManifestService = require('./packageManifestService');
const packageDataOwnershipService = require('./packageDataOwnershipService');
const { getPackageStorageRootAbsolute } = require('../utils/packageStoragePathUtils');
const uploadPathUtils = require('../utils/uploadPathUtils');

const SYSTEM_CONTEXT = Object.freeze({
  id: 'SYSTEM',
  username: 'SYSTEM',
  activeOrgId: 'SYSTEM',
  primaryOrgId: 'SYSTEM',
  organizations: [{ orgId: 'SYSTEM', role: 'super_admin', roles: ['super_admin'] }]
});

const REMAP_ORG_FIELDS = new Set([
  'orgid',
  'activeorgid',
  'primaryorgid',
  'targetorgid'
]);

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function normalizePackageId(value = '') {
  return cleanText(value, 120).toLowerCase();
}

function sanitizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function sanitizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeVersion(value = '') {
  return packageManifestService.assertValidVersion(cleanText(value, 120));
}

function parseSemver(version = '') {
  const token = cleanText(version, 120);
  const [coreAndPre] = token.split('+');
  const [core, prereleaseRaw = ''] = String(coreAndPre || '').split('-');
  const coreParts = core.split('.').map((item) => Number.parseInt(item, 10));
  const prerelease = prereleaseRaw ? prereleaseRaw.split('.') : [];
  return { coreParts, prerelease };
}

function compareSemver(a = '', b = '') {
  const left = parseSemver(a);
  const right = parseSemver(b);
  for (let index = 0; index < 3; index += 1) {
    const l = Number.isFinite(left.coreParts[index]) ? left.coreParts[index] : 0;
    const r = Number.isFinite(right.coreParts[index]) ? right.coreParts[index] : 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  if (!left.prerelease.length && !right.prerelease.length) return 0;
  if (!left.prerelease.length) return 1;
  if (!right.prerelease.length) return -1;

  const max = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < max; index += 1) {
    const l = left.prerelease[index];
    const r = right.prerelease[index];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const lNumeric = /^\d+$/.test(l);
    const rNumeric = /^\d+$/.test(r);
    if (lNumeric && rNumeric) {
      const lNum = Number.parseInt(l, 10);
      const rNum = Number.parseInt(r, 10);
      if (lNum > rNum) return 1;
      if (lNum < rNum) return -1;
      continue;
    }
    if (lNumeric && !rNumeric) return -1;
    if (!lNumeric && rNumeric) return 1;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}

function formatStamp(now = new Date()) {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

async function pathExists(filePath = '') {
  try {
    await fsp.access(filePath);
    return true;
  } catch (_) {
    return false;
  }
}

function normalizeManualFileRef(raw = '') {
  const token = cleanText(raw, 2000);
  if (!token) return '';
  return token.replace(/\\/g, '/');
}

function parseManualFileRefs(input = []) {
  const rows = [];
  const sourceRows = Array.isArray(input)
    ? input
    : String(input || '').split(/\r?\n/);
  sourceRows.forEach((entry) => {
    const token = normalizeManualFileRef(entry);
    if (token) rows.push(token);
  });
  return Array.from(new Set(rows));
}

function normalizeOrgToken(raw = '') {
  const token = cleanText(raw, 160);
  if (!token) return '';
  if (/^ORG_[A-Za-z0-9_-]+$/i.test(token)) return token.toUpperCase();
  if (/^[A-Za-z0-9_-]+$/.test(token)) return `ORG_${token.toUpperCase()}`;
  return '';
}

function readJsonFile(filePath = '') {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

function walkFiles(rootDir = '') {
  const out = [];
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(absolutePath);
      else if (entry.isFile()) out.push(absolutePath);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function loadSigningPrivateKey(projectRoot = process.cwd()) {
  const privateKeyFile = cleanText(process.env.PACKAGE_SIGNING_ED25519_PRIVATE_KEY_FILE, 1800);
  const privateKeyBase64 = cleanText(process.env.PACKAGE_SIGNING_ED25519_PRIVATE_KEY_BASE64, 100000);
  if (privateKeyFile) {
    const resolved = path.isAbsolute(privateKeyFile)
      ? privateKeyFile
      : path.resolve(projectRoot, privateKeyFile);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Signing private key file was not found at "${resolved}".`);
    }
    const raw = fs.readFileSync(resolved, 'utf8');
    return {
      key: raw.includes('BEGIN PRIVATE KEY')
        ? crypto.createPrivateKey({ key: raw, format: 'pem' })
        : crypto.createPrivateKey({ key: Buffer.from(raw.trim(), 'base64'), format: 'der', type: 'pkcs8' }),
      source: `file:${resolved}`
    };
  }
  if (privateKeyBase64) {
    return {
      key: crypto.createPrivateKey({ key: Buffer.from(privateKeyBase64, 'base64'), format: 'der', type: 'pkcs8' }),
      source: 'env:PACKAGE_SIGNING_ED25519_PRIVATE_KEY_BASE64'
    };
  }
  throw new Error(
    'Package signing private key is not configured. Set PACKAGE_SIGNING_ED25519_PRIVATE_KEY_FILE or PACKAGE_SIGNING_ED25519_PRIVATE_KEY_BASE64.'
  );
}

function extractUploadUrls(node, intoSet) {
  if (typeof node === 'string') {
    const token = cleanText(node, 4000);
    if (/\/uploads\/[^"'` ]+/i.test(token)) {
      const match = token.match(/\/uploads\/[^"'` ]+/ig) || [];
      match.forEach((item) => intoSet.add(item));
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item) => extractUploadUrls(item, intoSet));
    return;
  }
  if (node && typeof node === 'object') {
    Object.values(node).forEach((item) => extractUploadUrls(item, intoSet));
  }
}

function transformForOrgRemap(node, state = {}, keyName = '') {
  if (typeof node === 'string') {
    const current = String(node);
    let next = current;
    if (/\/uploads\/ORG_[^/]+/i.test(next)) {
      next = next.replace(/\/uploads\/ORG_[^/]+/ig, '/uploads/{{ORG_ID}}');
      state.rewrittenUrlCount = Number(state.rewrittenUrlCount || 0) + 1;
    }
    if (REMAP_ORG_FIELDS.has(String(keyName || '').toLowerCase()) && normalizeOrgToken(next)) {
      next = '{{ORG_ID}}';
      state.rewrittenFieldCount = Number(state.rewrittenFieldCount || 0) + 1;
    }
    return next;
  }
  if (Array.isArray(node)) {
    return node.map((item) => transformForOrgRemap(item, state, keyName));
  }
  if (node && typeof node === 'object') {
    const out = {};
    Object.entries(node).forEach(([childKey, childValue]) => {
      out[childKey] = transformForOrgRemap(childValue, state, childKey);
    });
    return out;
  }
  return node;
}

function applyOrgRemap(node, targetOrgId = '') {
  if (typeof node === 'string') {
    return String(node)
      .replace(/\{\{ORG_ID\}\}/g, targetOrgId)
      .replace(/\/uploads\/ORG_[^/]+/ig, `/uploads/${targetOrgId}`);
  }
  if (Array.isArray(node)) {
    return node.map((item) => applyOrgRemap(item, targetOrgId));
  }
  if (node && typeof node === 'object') {
    const out = {};
    Object.entries(node).forEach(([childKey, childValue]) => {
      out[childKey] = applyOrgRemap(childValue, targetOrgId);
    });
    return out;
  }
  return node;
}

async function copyFileSafe(sourcePath = '', destinationPath = '') {
  await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
  await fsp.copyFile(sourcePath, destinationPath);
}

async function copyDirectorySafe(sourceDir = '', destinationDir = '') {
  await fsp.mkdir(destinationDir, { recursive: true });
  const entries = await fsp.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      // eslint-disable-next-line no-await-in-loop
      await copyDirectorySafe(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      // eslint-disable-next-line no-await-in-loop
      await copyFileSafe(sourcePath, destinationPath);
    }
  }
}

function createDependencies(overrides = {}) {
  return {
    fs: overrides.fs || fsp,
    path: overrides.path || path,
    os: overrides.os || os,
    crypto: overrides.crypto || crypto,
    dataService: overrides.dataService || dataService,
    packageManifestService: overrides.packageManifestService || packageManifestService,
    packageDataOwnershipService: overrides.packageDataOwnershipService || packageDataOwnershipService
  };
}

function createService(overrides = {}) {
  const deps = createDependencies(overrides);

  async function discoverLocalPackages(options = {}) {
    const packageRootDir = getPackageStorageRootAbsolute({
      packageRootDir: options.packageRootDir,
      ensureExists: true
    });
    const rows = [];
    const entries = await deps.fs.readdir(packageRootDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry?.isDirectory?.()) continue;
      const packageDir = deps.path.join(packageRootDir, entry.name);
      const manifestPath = deps.path.join(packageDir, 'package.manifest.json');
      if (!(await pathExists(manifestPath))) continue;
      const storedManifestPath = cleanText(deps.path.relative(process.cwd(), manifestPath), 2000).replace(/\\/g, '/');
      try {
        const parsed = readJsonFile(manifestPath);
        const manifest = deps.packageManifestService.validatePackageManifest(parsed);
        rows.push({
          packageId: manifest.id,
          packageName: manifest.name,
          version: manifest.version,
          mountPath: manifest.mountPath,
          manifestPath,
          storedManifestPath,
          packageDir,
          manifest,
          valid: true
        });
      } catch (error) {
        rows.push({
          packageId: normalizePackageId(entry.name),
          packageName: entry.name,
          version: '',
          mountPath: '',
          manifestPath,
          storedManifestPath,
          packageDir,
          manifest: null,
          valid: false,
          error: cleanText(error?.message || String(error), 1200)
        });
      }
    }
    return rows.sort((a, b) => String(a.packageId || '').localeCompare(String(b.packageId || '')));
  }

  async function findPackageById(packageId = '', options = {}) {
    const token = normalizePackageId(packageId);
    if (!token) throw new Error('packageId is required.');
    const rows = await discoverLocalPackages(options);
    const match = rows.find((row) => row.packageId === token && row.valid);
    if (!match) throw new Error(`Package "${token}" was not found in local package storage.`);
    return match;
  }

  async function inferDataEntitiesFromDataDirectory(packageId = '') {
    const rows = [];
    const prefix = normalizePackageId(packageId);
    const dataDir = deps.path.join(process.cwd(), 'data');
    const entries = await deps.fs.readdir(dataDir, { withFileTypes: true }).catch(() => []);
    entries.forEach((entry) => {
      if (!entry?.isFile?.() || !entry.name.endsWith('.json')) return;
      const name = entry.name.replace(/\.json$/i, '');
      if (!name.toLowerCase().startsWith(prefix)) return;
      rows.push({
        id: name,
        entityType: name,
        label: name,
        source: 'data-directory-fallback'
      });
    });
    return rows;
  }

  async function resolveDataEntities(manifest = {}, packageId = '', options = {}) {
    const normalizedRows = [];
    const seen = new Set();
    const pushEntity = (entityTypeRaw = '', source = '', labelRaw = '') => {
      const entityType = cleanText(entityTypeRaw, 200);
      if (!entityType) return;
      const id = entityType.toLowerCase();
      if (seen.has(id)) return;
      seen.add(id);
      normalizedRows.push({
        id: entityType,
        entityType,
        label: cleanText(labelRaw, 200) || entityType,
        source
      });
    };

    const declared = sanitizeArray(manifest?.dataEntities);
    declared.forEach((row) => {
      if (typeof row === 'string') pushEntity(row, 'manifest', row);
      else if (row && typeof row === 'object') pushEntity(
        row.entityType || row.table || row.id || '',
        'manifest',
        row.label || row.name || ''
      );
    });
    if (normalizedRows.length) return normalizedRows;

    if (deps.packageDataOwnershipService && typeof deps.packageDataOwnershipService.listOwnershipByPackage === 'function') {
      const ownershipRows = await deps.packageDataOwnershipService.listOwnershipByPackage(packageId, {
        backendMode: options.backendMode,
        limit: 5000
      }).catch(() => []);
      ownershipRows.forEach((row) => pushEntity(row?.entityType || '', 'ownership-ledger', row?.entityType || ''));
    }
    if (normalizedRows.length) return normalizedRows;

    if (cleanText(options.backendMode, 40).toLowerCase() === 'json') {
      const inferred = await inferDataEntitiesFromDataDirectory(packageId);
      inferred.forEach((row) => pushEntity(row.entityType, row.source, row.label));
    }
    return normalizedRows;
  }

  async function fetchEntityRows(entityType = '', options = {}) {
    const rows = await deps.dataService.fetchData(entityType, {}, SYSTEM_CONTEXT, {
      backendMode: options.backendMode
    });
    return Array.isArray(rows) ? rows : [];
  }

  async function preflightBuild(input = {}, options = {}) {
    const packageId = normalizePackageId(input.packageId);
    if (!packageId) throw new Error('packageId is required.');
    const backendMode = cleanText(options.backendMode, 40).toLowerCase() || 'json';
    const packageRow = await findPackageById(packageId, options);
    const availableDataEntities = await resolveDataEntities(packageRow.manifest, packageId, { backendMode });
    const selectedDataEntityTokens = sanitizeArray(input.selectedDataEntities)
      .map((item) => cleanText(item, 200))
      .filter(Boolean);
    const selectedDataEntities = selectedDataEntityTokens.length
      ? availableDataEntities.filter((row) => selectedDataEntityTokens.includes(row.entityType) || selectedDataEntityTokens.includes(row.id))
      : availableDataEntities;

    const detectedUploadUrls = new Set();
    const warnings = [];
    let selectedRowCount = 0;
    for (const entity of selectedDataEntities) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const rows = await fetchEntityRows(entity.entityType, { backendMode });
        selectedRowCount += rows.length;
        rows.forEach((row) => extractUploadUrls(row, detectedUploadUrls));
      } catch (error) {
        warnings.push(`Failed to inspect data entity "${entity.entityType}": ${cleanText(error?.message || String(error), 400)}`);
      }
    }

    const manualFileRefs = parseManualFileRefs(input.selectedFileRefs || []);
    const combinedFileRefs = Array.from(new Set([...Array.from(detectedUploadUrls), ...manualFileRefs]));
    const normalizedFileRefs = combinedFileRefs.map((item) => {
      const uploadRelative = uploadPathUtils.extractRelativeUploadPath(item);
      return {
        ref: item,
        type: uploadRelative ? 'upload-url' : 'manual',
        uploadRelativePath: uploadRelative || '',
        exists: uploadRelative ? fs.existsSync(uploadPathUtils.fromUploadsUrlToDiskPath(item) || '') : true
      };
    });

    return {
      package: {
        packageId: packageRow.packageId,
        name: packageRow.packageName,
        currentVersion: packageRow.version,
        mountPath: packageRow.mountPath,
        manifestPath: packageRow.storedManifestPath
      },
      backendMode,
      availableDataEntities,
      selectedDataEntities,
      selectedRowCount,
      filePlan: {
        detectedFromData: Array.from(detectedUploadUrls),
        manualRefs: manualFileRefs,
        normalizedRefs: normalizedFileRefs
      },
      warnings
    };
  }

  function resolveReferenceToAbsolutePath(ref = '') {
    const token = normalizeManualFileRef(ref);
    if (!token) return '';
    const uploadRelative = uploadPathUtils.extractRelativeUploadPath(token);
    if (uploadRelative) {
      return uploadPathUtils.fromUploadsUrlToDiskPath(token) || '';
    }
    const uploadRoot = uploadPathUtils.getUploadRootAbsolute();
    if (token.startsWith('/')) {
      const joined = path.resolve(uploadRoot, token.replace(/^\/+/, ''));
      if (uploadPathUtils.isInsideUploadRoot(joined, uploadRoot)) return joined;
      return '';
    }
    if (path.isAbsolute(token)) {
      const resolved = path.resolve(token);
      return uploadPathUtils.isInsideUploadRoot(resolved, uploadRoot) ? resolved : '';
    }
    const candidate = path.resolve(uploadRoot, token);
    return uploadPathUtils.isInsideUploadRoot(candidate, uploadRoot) ? candidate : '';
  }

  async function copySelectedRefs(refRows = [], targetRoot = '') {
    const copied = [];
    const warnings = [];
    const uploadRoot = uploadPathUtils.getUploadRootAbsolute();
    for (const row of sanitizeArray(refRows)) {
      const ref = cleanText(row?.ref || row, 2000);
      const absolutePath = resolveReferenceToAbsolutePath(ref);
      if (!absolutePath) {
        warnings.push(`Skipped file ref "${ref}" because it is outside upload root or invalid.`);
        continue;
      }
      if (!(await pathExists(absolutePath))) {
        warnings.push(`Skipped file ref "${ref}" because source path does not exist.`);
        continue;
      }
      const relativePath = path.relative(uploadRoot, absolutePath).replace(/\\/g, '/');
      const destinationPath = path.join(targetRoot, relativePath);
      const stat = await fsp.stat(absolutePath);
      if (stat.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        await copyDirectorySafe(absolutePath, destinationPath);
      } else {
        // eslint-disable-next-line no-await-in-loop
        await copyFileSafe(absolutePath, destinationPath);
      }
      copied.push({
        ref,
        absolutePath,
        relativePath,
        type: stat.isDirectory() ? 'directory' : 'file'
      });
    }
    return { copied, warnings };
  }

  async function buildPackage(input = {}, options = {}) {
    const packageId = normalizePackageId(input.packageId);
    if (!packageId) throw new Error('packageId is required.');
    const requestedVersion = normalizeVersion(input.version);
    const backendMode = cleanText(options.backendMode, 40).toLowerCase() || 'json';
    const packageRow = await findPackageById(packageId, options);
    if (compareSemver(requestedVersion, packageRow.version) < 0) {
      throw new Error(`Requested version "${requestedVersion}" must be >= package current version "${packageRow.version}".`);
    }
    const preflight = await preflightBuild(input, { ...options, backendMode });
    const selectedEntityRows = sanitizeArray(preflight.selectedDataEntities);
    const dataPayload = {};
    const remapState = { rewrittenUrlCount: 0, rewrittenFieldCount: 0 };

    for (const entity of selectedEntityRows) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await fetchEntityRows(entity.entityType, { backendMode });
      dataPayload[entity.entityType] = rows.map((row) => transformForOrgRemap(row, remapState));
    }

    const fileRefs = sanitizeArray(preflight.filePlan?.normalizedRefs).map((row) => ({
      ref: cleanText(row.ref, 2000),
      type: cleanText(row.type, 40),
      uploadRelativePath: cleanText(row.uploadRelativePath, 2000)
    }));

    const stageRoot = await deps.fs.mkdtemp(deps.path.join(deps.os.tmpdir(), `pkg-build-${packageId}-`));
    const stagedPackageDir = deps.path.join(stageRoot, packageId);
    const payloadDir = deps.path.join(stagedPackageDir, '__builder_payload__');
    const payloadFilesDir = deps.path.join(payloadDir, 'files');
    let copiedFileReport = { copied: [], warnings: [] };
    let artifactPaths = null;

    try {
      await copyDirectorySafe(packageRow.packageDir, stagedPackageDir);
      const stagedManifestPath = deps.path.join(stagedPackageDir, 'package.manifest.json');
      const stagedManifest = readJsonFile(stagedManifestPath);
      stagedManifest.version = requestedVersion;
      await deps.fs.writeFile(stagedManifestPath, JSON.stringify(stagedManifest, null, 2));

      await deps.fs.mkdir(payloadFilesDir, { recursive: true });
      copiedFileReport = await copySelectedRefs(fileRefs, payloadFilesDir);
      const payload = {
        schema: 'core.package-builder.payload.v1',
        buildId: `PKG_BUILD_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        packageId,
        packageName: packageRow.packageName,
        packageVersion: requestedVersion,
        backendMode,
        createdAt: new Date().toISOString(),
        orgRemapRequired: remapState.rewrittenFieldCount > 0 || remapState.rewrittenUrlCount > 0,
        remapSummary: {
          rewrittenOrgFields: remapState.rewrittenFieldCount,
          rewrittenUploadUrls: remapState.rewrittenUrlCount
        },
        selectedDataEntities: selectedEntityRows,
        data: dataPayload,
        fileRefs,
        copiedFiles: copiedFileReport.copied.map((row) => ({
          relativePath: row.relativePath,
          type: row.type
        }))
      };
      await deps.fs.writeFile(deps.path.join(payloadDir, 'payload.json'), JSON.stringify(payload, null, 2));

      const zip = new PizZip();
      const stagedFiles = walkFiles(stagedPackageDir);
      stagedFiles.forEach((filePath) => {
        const rel = deps.path.relative(stageRoot, filePath).replace(/\\/g, '/');
        zip.file(rel, fs.readFileSync(filePath));
      });
      if (!zip.files[`${packageId}/package.manifest.json`]) {
        throw new Error(`Build layout invalid; missing ${packageId}/package.manifest.json.`);
      }
      const zipBuffer = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
      const signing = loadSigningPrivateKey(process.cwd());
      const signatureBuffer = deps.crypto.sign(null, zipBuffer, signing.key);
      const publicPem = deps.crypto.createPublicKey(signing.key).export({ type: 'spki', format: 'pem' });
      const outDir = deps.path.join(process.cwd(), 'install_packages');
      await deps.fs.mkdir(outDir, { recursive: true });
      const baseName = `${packageId}-${requestedVersion}-${formatStamp()}`;
      const zipPath = deps.path.join(outDir, `${baseName}.zip`);
      const sigPath = deps.path.join(outDir, `${baseName}.sig`);
      const publicPath = deps.path.join(outDir, `${baseName}.public.pem`);
      await deps.fs.writeFile(zipPath, zipBuffer);
      await deps.fs.writeFile(sigPath, signatureBuffer);
      await deps.fs.writeFile(publicPath, publicPem);
      artifactPaths = { zipPath, sigPath, publicPath, signingSource: signing.source };

      return {
        status: 'success',
        buildId: payload.buildId,
        packageId,
        version: requestedVersion,
        dataSummary: {
          entityCount: selectedEntityRows.length,
          rowCount: Object.values(dataPayload).reduce((sum, rows) => sum + sanitizeArray(rows).length, 0)
        },
        fileSummary: {
          selectedRefCount: fileRefs.length,
          copiedCount: copiedFileReport.copied.length
        },
        remapSummary: payload.remapSummary,
        orgRemapRequired: payload.orgRemapRequired,
        artifacts: {
          zip: artifactPaths.zipPath,
          signature: artifactPaths.sigPath,
          publicKeyPem: artifactPaths.publicPath
        },
        warnings: copiedFileReport.warnings
      };
    } finally {
      await deps.fs.rm(stageRoot, { recursive: true, force: true }).catch(() => {});
    }
  }

  async function applyBuilderPayloadIfPresent(context = {}, options = {}) {
    const manifestPath = cleanText(context.manifestPath, 2000);
    if (!manifestPath) {
      return {
        applied: false,
        orgRemapRequired: false,
        dataSummary: { entityCount: 0, upserted: 0 },
        fileSummary: { copied: 0 },
        warnings: []
      };
    }
    const packageDir = path.dirname(path.resolve(manifestPath));
    const payloadPath = path.join(packageDir, '__builder_payload__', 'payload.json');
    if (!(await pathExists(payloadPath))) {
      return {
        applied: false,
        orgRemapRequired: false,
        dataSummary: { entityCount: 0, upserted: 0 },
        fileSummary: { copied: 0 },
        warnings: []
      };
    }
    const payload = readJsonFile(payloadPath);
    const orgRemapRequired = payload?.orgRemapRequired === true;
    const targetOrgId = normalizeOrgToken(options.targetOrgId || '');
    if (orgRemapRequired && !targetOrgId) {
      const error = new Error('Target organization is required for this package install because exported data contains org-bound fields/URLs.');
      error.code = 'TARGET_ORG_REQUIRED';
      throw error;
    }
    if (options.dryRun === true) {
      return {
        applied: false,
        orgRemapRequired,
        targetOrgId: targetOrgId || '',
        dataSummary: {
          entityCount: Object.keys(sanitizeObject(payload?.data)).length,
          upserted: 0
        },
        fileSummary: {
          copied: 0
        },
        warnings: []
      };
    }

    const backendMode = cleanText(options.backendMode, 40).toLowerCase() || 'json';
    let upserted = 0;
    const warnings = [];
    const entityNames = Object.keys(sanitizeObject(payload?.data));
    for (const entityType of entityNames) {
      const rows = sanitizeArray(payload.data[entityType]).map((row) => (
        orgRemapRequired ? applyOrgRemap(row, targetOrgId) : row
      ));
      for (const row of rows) {
        const rowId = cleanText(row?.id, 200);
        try {
          if (rowId) {
            // eslint-disable-next-line no-await-in-loop
            const existing = await deps.dataService.getDataById(entityType, rowId, SYSTEM_CONTEXT, { backendMode });
            if (existing) {
              // eslint-disable-next-line no-await-in-loop
              await deps.dataService.updateData(entityType, rowId, row, SYSTEM_CONTEXT, { backendMode });
              upserted += 1;
              continue;
            }
          }
          // eslint-disable-next-line no-await-in-loop
          await deps.dataService.addData(entityType, row, SYSTEM_CONTEXT, { backendMode });
          upserted += 1;
        } catch (error) {
          warnings.push(`Failed to import ${entityType}${rowId ? `#${rowId}` : ''}: ${cleanText(error?.message || String(error), 300)}`);
        }
      }
    }

    const sourceFilesRoot = path.join(packageDir, '__builder_payload__', 'files');
    let copiedFiles = 0;
    if (await pathExists(sourceFilesRoot)) {
      const uploadRoot = uploadPathUtils.getUploadRootAbsolute();
      const files = walkFiles(sourceFilesRoot);
      for (const sourcePath of files) {
        const rel = path.relative(sourceFilesRoot, sourcePath).replace(/\\/g, '/');
        let mappedRel = rel;
        if (orgRemapRequired && targetOrgId) {
          mappedRel = rel.replace(/^ORG_[^/]+/i, targetOrgId);
        }
        const destinationPath = path.resolve(uploadRoot, mappedRel);
        if (!uploadPathUtils.isInsideUploadRoot(destinationPath, uploadRoot)) {
          warnings.push(`Skipped payload file outside upload root boundary: ${rel}`);
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        await copyFileSafe(sourcePath, destinationPath);
        copiedFiles += 1;
      }
    }

    return {
      applied: true,
      orgRemapRequired,
      targetOrgId: targetOrgId || '',
      dataSummary: {
        entityCount: entityNames.length,
        upserted
      },
      fileSummary: {
        copied: copiedFiles
      },
      warnings
    };
  }

  return {
    discoverLocalPackages,
    preflightBuild,
    buildPackage,
    applyBuilderPayloadIfPresent
  };
}

module.exports = {
  ...createService(),
  createService,
  createDependencies
};
