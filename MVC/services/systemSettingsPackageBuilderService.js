const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const PizZip = require('pizzip');

const dataService = require('./dataService');
const packageRegistryService = require('./packageRegistryService');
const packageManifestService = require('./packageManifestService');
const packageDataOwnershipService = require('./packageDataOwnershipService');
const coreFilesService = require('./coreFilesService');
const { getMongoCollection, getMongoDbOrNull } = require('../infrastructure/mongo/mongoConnection');
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
const ORG_TOKEN_EXACT_REGEX = /^ORG_[A-Za-z0-9_-]+$/i;
const ORG_UPLOAD_SEGMENT_REGEX = /\/uploads\/(ORG_[^/]+)/ig;
const UPLOAD_URL_MATCH_REGEX = /\/uploads\/[^"'` ]+/ig;
const FILE_FIELD_HINT_REGEX = /(file|url|path|image|audio|video|document|attachment|logo|avatar|icon|pdf|media|thumbnail|banner|cover)/i;

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

function normalizeFieldPathToken(value = '') {
  const token = cleanText(value, 500);
  if (!token) return '';
  return token
    .replace(/\[\d+\]/g, '[]')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .replace(/^\[\]\.?/, '[]');
}

function formatFieldPath(parts = []) {
  let pathToken = '';
  sanitizeArray(parts).forEach((partRaw) => {
    const part = cleanText(partRaw, 200);
    if (!part) return;
    if (part === '[]') {
      pathToken += '[]';
      return;
    }
    pathToken = pathToken ? `${pathToken}.${part}` : part;
  });
  return normalizeFieldPathToken(pathToken);
}

function listUploadRefsInText(value = '') {
  const token = cleanText(value, 4000);
  if (!token) return [];
  const matches = token.match(UPLOAD_URL_MATCH_REGEX) || [];
  return Array.from(new Set(matches.map((row) => cleanText(row, 2000)).filter(Boolean)));
}

function extractOrgTokensFromUploadRef(uploadRef = '') {
  const ref = cleanText(uploadRef, 2000);
  if (!ref) return [];
  const rows = [];
  const regex = /\/uploads\/(ORG_[^/]+)/ig;
  let match = regex.exec(ref);
  while (match) {
    const normalized = normalizeOrgToken(match[1]);
    if (normalized) rows.push(normalized);
    match = regex.exec(ref);
  }
  return Array.from(new Set(rows));
}

function collectStringLeafRows(node, pathParts = [], out = []) {
  if (typeof node === 'string') {
    const value = cleanText(node, 4000);
    if (!value) return out;
    out.push({
      fieldPath: formatFieldPath(pathParts),
      value
    });
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((item) => collectStringLeafRows(item, [...pathParts, '[]'], out));
    return out;
  }
  if (node && typeof node === 'object') {
    Object.entries(node).forEach(([key, value]) => {
      collectStringLeafRows(value, [...pathParts, cleanText(key, 160)], out);
    });
  }
  return out;
}

function collectFileFieldCandidates(rows = []) {
  const fromHint = new Set();
  const fromUpload = new Set();
  sanitizeArray(rows).forEach((row) => {
    const leafRows = collectStringLeafRows(row, [], []);
    leafRows.forEach((leaf) => {
      const fieldPath = normalizeFieldPathToken(leaf?.fieldPath || '');
      if (!fieldPath) return;
      if (FILE_FIELD_HINT_REGEX.test(fieldPath)) fromHint.add(fieldPath);
      if (listUploadRefsInText(leaf.value).length) fromUpload.add(fieldPath);
    });
  });
  return Array.from(new Set([
    ...Array.from(fromUpload),
    ...Array.from(fromHint)
  ]));
}

function normalizeFileFieldSelection(input = {}) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  Object.entries(input).forEach(([entityTypeRaw, value]) => {
    const entityType = cleanText(entityTypeRaw, 200);
    if (!entityType) return;
    const source = Array.isArray(value)
      ? value
      : String(value || '').split(/\r?\n|,/);
    const fields = Array.from(new Set(
      source
        .map((row) => normalizeFieldPathToken(row))
        .filter(Boolean)
    ));
    out[entityType] = fields;
  });
  return out;
}

function resolveSelectedFileFields(entityType = '', requestedSelection = {}, candidates = []) {
  const entity = cleanText(entityType, 200);
  if (!entity) return [];
  const requested = sanitizeArray(requestedSelection[entity]).map((row) => normalizeFieldPathToken(row)).filter(Boolean);
  const uniqueCandidates = Array.from(new Set(sanitizeArray(candidates).map((row) => normalizeFieldPathToken(row)).filter(Boolean)));
  if (requested.length) {
    return Array.from(new Set(requested));
  }
  return uniqueCandidates;
}

function deriveRowId(row = {}, index = 0) {
  const id = cleanText(row?.id || row?._id || '', 200);
  if (id) return id;
  return `ROW_${index + 1}`;
}

function collectUploadRefProvenanceFromRow(row = {}, options = {}) {
  const entityType = cleanText(options.entityType, 200);
  const rowIndex = Number.isFinite(Number(options.rowIndex)) ? Number(options.rowIndex) : 0;
  const rowId = cleanText(options.rowId, 200) || deriveRowId(row, rowIndex);
  const selectedFields = new Set(
    sanitizeArray(options.selectedFields)
      .map((item) => normalizeFieldPathToken(item))
      .filter(Boolean)
  );
  const leafRows = collectStringLeafRows(row, [], []);
  const rows = [];
  leafRows.forEach((leaf) => {
    const fieldPath = normalizeFieldPathToken(leaf?.fieldPath || '');
    if (!fieldPath) return;
    if (selectedFields.size && !selectedFields.has(fieldPath)) return;
    const refs = listUploadRefsInText(leaf.value);
    refs.forEach((ref) => {
      rows.push({
        entityType,
        rowId,
        rowIndex,
        fieldPath,
        ref,
        detectedOrgTokens: extractOrgTokensFromUploadRef(ref)
      });
    });
  });
  return rows;
}

function normalizeOrgToken(raw = '') {
  const token = cleanText(raw, 160);
  if (!token) return '';
  if (/^ORG_[A-Za-z0-9_-]+$/i.test(token)) return token.toUpperCase();
  if (/^[A-Za-z0-9_-]+$/.test(token)) return `ORG_${token.toUpperCase()}`;
  return '';
}

function isUnknownEntityTypeError(error = null) {
  const message = cleanText(error?.message || String(error || ''), 600).toLowerCase();
  if (!message) return false;
  return message.includes('unknown entity type');
}

function collectOrgTokensFromNode(node, collector = null, keyName = '') {
  const state = collector && typeof collector === 'object'
    ? collector
    : { field: new Set(), token: new Set(), upload: new Set() };

  if (typeof node === 'string') {
    const token = cleanText(node, 4000);
    const fieldKey = cleanText(keyName, 200).toLowerCase();
    if (REMAP_ORG_FIELDS.has(fieldKey)) {
      const normalized = normalizeOrgToken(token);
      if (normalized) state.field.add(normalized);
    }

    let match = ORG_UPLOAD_SEGMENT_REGEX.exec(token);
    while (match) {
      const normalized = normalizeOrgToken(match[1]);
      if (normalized) state.upload.add(normalized);
      match = ORG_UPLOAD_SEGMENT_REGEX.exec(token);
    }
    ORG_UPLOAD_SEGMENT_REGEX.lastIndex = 0;

    if (ORG_TOKEN_EXACT_REGEX.test(token)) {
      const normalized = normalizeOrgToken(token);
      if (normalized) state.token.add(normalized);
    }
    return state;
  }
  if (Array.isArray(node)) {
    node.forEach((item) => collectOrgTokensFromNode(item, state, keyName));
    return state;
  }
  if (node && typeof node === 'object') {
    Object.entries(node).forEach(([childKey, childValue]) => collectOrgTokensFromNode(childValue, state, childKey));
  }
  return state;
}

function evaluateRowOriginScope(row = {}, originOrgId = '') {
  const normalizedOriginOrgId = normalizeOrgToken(originOrgId);
  const collected = collectOrgTokensFromNode(row, { field: new Set(), token: new Set(), upload: new Set() });
  const businessTokens = new Set([...Array.from(collected.field), ...Array.from(collected.token)]);
  const businessTokenList = Array.from(businessTokens);
  const uploadTokens = Array.from(collected.upload);
  const orgTokens = Array.from(new Set([...businessTokenList, ...uploadTokens]));
  const hasScopedMarkers = orgTokens.length > 0;
  const includesUnscoped = !hasScopedMarkers;
  const hasOrigin = normalizedOriginOrgId ? orgTokens.includes(normalizedOriginOrgId) : false;
  const hasOther = normalizedOriginOrgId
    ? orgTokens.some((token) => token !== normalizedOriginOrgId)
    : false;

  const include = includesUnscoped || (hasOrigin && !hasOther);
  return {
    include,
    includesUnscoped,
    hasOrigin,
    hasOther,
    orgTokens,
    businessTokens: businessTokenList,
    uploadTokens
  };
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
    listUploadRefsInText(node).forEach((item) => intoSet.add(item));
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
      if (Array.isArray(state.pathHits)) state.pathHits.push({ type: 'upload_url', key: String(keyName || '') });
    }
    if (REMAP_ORG_FIELDS.has(String(keyName || '').toLowerCase()) && normalizeOrgToken(next)) {
      next = '{{ORG_ID}}';
      state.rewrittenFieldCount = Number(state.rewrittenFieldCount || 0) + 1;
      if (Array.isArray(state.pathHits)) state.pathHits.push({ type: 'org_field', key: String(keyName || '') });
    }
    if (ORG_TOKEN_EXACT_REGEX.test(next)) {
      next = '{{ORG_ID}}';
      state.rewrittenExactTokenCount = Number(state.rewrittenExactTokenCount || 0) + 1;
      if (Array.isArray(state.pathHits)) state.pathHits.push({ type: 'org_token', key: String(keyName || '') });
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

function extractSymbolUploadRefs(manifest = {}) {
  const refs = new Set();
  const symbols = sanitizeArray(manifest?.symbols);
  symbols.forEach((row) => {
    if (!row || typeof row !== 'object') return;
    const value = row.value;
    if (typeof value === 'string' || Array.isArray(value) || (value && typeof value === 'object')) {
      extractUploadUrls(value, refs);
    }
  });
  return Array.from(refs);
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
    packageRegistryService: overrides.packageRegistryService || packageRegistryService,
    packageManifestService: overrides.packageManifestService || packageManifestService,
    packageDataOwnershipService: overrides.packageDataOwnershipService || packageDataOwnershipService,
    coreFilesService: overrides.coreFilesService || coreFilesService,
    getMongoCollection: overrides.getMongoCollection || getMongoCollection,
    getMongoDbOrNull: overrides.getMongoDbOrNull || getMongoDbOrNull
  };
}

function createService(overrides = {}) {
  const deps = createDependencies(overrides);

  function toStoredManifestPath(absPath = '') {
    const token = cleanText(absPath, 2000);
    if (!token) return '';
    const relative = deps.path.relative(process.cwd(), token).replace(/\\/g, '/');
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative;
    return token.replace(/\\/g, '/');
  }

  function sourcePriority(source = '') {
    const token = cleanText(source, 80).toLowerCase();
    if (token === 'configured_root') return 3;
    if (token === 'default_root') return 2;
    if (token === 'registry') return 1;
    return 0;
  }

  function selectBetterCandidate(current = null, next = null) {
    if (!current) return next;
    if (!next) return current;
    const currentResolved = current?.manifestResolved === true;
    const nextResolved = next?.manifestResolved === true;
    if (currentResolved !== nextResolved) return nextResolved ? next : current;
    const currentValid = current?.valid === true;
    const nextValid = next?.valid === true;
    if (currentValid !== nextValid) return nextValid ? next : current;
    const currentPriority = sourcePriority(current?.source);
    const nextPriority = sourcePriority(next?.source);
    if (currentPriority !== nextPriority) return nextPriority > currentPriority ? next : current;
    const currentPath = cleanText(current?.manifestPath, 2000);
    const nextPath = cleanText(next?.manifestPath, 2000);
    if (!currentPath && nextPath) return next;
    return current;
  }

  async function readManifestCandidate(manifestPath = '', baseRow = {}) {
    const candidatePath = cleanText(manifestPath, 2000);
    if (!candidatePath) return null;
    if (!(await pathExists(candidatePath))) return null;
    const row = {
      ...baseRow,
      manifestPath: candidatePath,
      storedManifestPath: toStoredManifestPath(candidatePath),
      manifestResolved: true,
      availability: 'available',
      warning: ''
    };
    try {
      const parsed = readJsonFile(candidatePath);
      const manifest = deps.packageManifestService.validatePackageManifest(parsed);
      row.packageId = manifest.id;
      row.packageName = manifest.name;
      row.version = manifest.version;
      row.mountPath = manifest.mountPath;
      row.packageDir = deps.path.dirname(candidatePath);
      row.manifest = manifest;
      row.valid = true;
      return row;
    } catch (error) {
      row.manifest = null;
      row.valid = false;
      row.availability = 'missing_manifest';
      row.warning = cleanText(error?.message || String(error), 1200) || 'Manifest is invalid.';
      row.error = row.warning;
      return row;
    }
  }

  async function discoverPackagesFromRoot(rootDir = '', source = '') {
    const root = cleanText(rootDir, 2000);
    if (!root) return [];
    const rows = [];
    const entries = await deps.fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry?.isDirectory?.()) continue;
      const packageDir = deps.path.join(root, entry.name);
      const manifestPath = deps.path.join(packageDir, 'package.manifest.json');
      const candidate = await readManifestCandidate(manifestPath, {
        source,
        packageId: normalizePackageId(entry.name),
        packageName: entry.name,
        version: '',
        mountPath: '',
        packageDir
      });
      if (candidate) rows.push(candidate);
    }
    return rows;
  }

  async function discoverRegistryPackages(options = {}) {
    const rows = [];
    if (!deps.packageRegistryService || typeof deps.packageRegistryService.listPackageRegistry !== 'function') return rows;
    const registryRows = await deps.packageRegistryService.listPackageRegistry({
      backendMode: options.backendMode
    }).catch(() => []);
    const list = sanitizeArray(registryRows);
    const configuredRoot = getPackageStorageRootAbsolute({
      packageRootDir: options.packageRootDir,
      ensureExists: false
    });
    const defaultRoot = deps.path.resolve(process.cwd(), 'packages');

    for (const row of list) {
      const packageId = normalizePackageId(row?.packageId || row?.id || '');
      if (!packageId) continue;
      const packageName = cleanText(row?.metadata?.packageName || row?.packageName || packageId, 200) || packageId;
      const explicitMetaPath = cleanText(row?.metadata?.manifestPath || row?.manifestPath || '', 2000);
      const explicitCandidate = explicitMetaPath
        ? (deps.path.isAbsolute(explicitMetaPath)
          ? explicitMetaPath
          : deps.path.resolve(process.cwd(), explicitMetaPath))
        : '';
      const fallbackCandidates = [
        explicitCandidate,
        deps.path.join(configuredRoot, packageId, 'package.manifest.json'),
        deps.path.join(defaultRoot, packageId, 'package.manifest.json')
      ]
        .map((item) => cleanText(item, 2000))
        .filter(Boolean)
        .filter((item, index, arr) => arr.findIndex((x) => x.toLowerCase() === item.toLowerCase()) === index);

      let resolved = null;
      for (const candidatePath of fallbackCandidates) {
        // eslint-disable-next-line no-await-in-loop
        resolved = await readManifestCandidate(candidatePath, {
          source: 'registry',
          packageId,
          packageName,
          version: cleanText(row?.version, 120),
          mountPath: cleanText(row?.metadata?.mountPath || '', 200),
          packageDir: deps.path.dirname(candidatePath)
        });
        if (resolved && resolved.valid === true) break;
      }

      if (resolved) {
        rows.push(resolved);
        continue;
      }

      rows.push({
        source: 'registry',
        packageId,
        packageName,
        version: cleanText(row?.version, 120),
        mountPath: cleanText(row?.metadata?.mountPath || '', 200),
        manifestPath: explicitCandidate || '',
        storedManifestPath: toStoredManifestPath(explicitCandidate || ''),
        packageDir: '',
        manifest: null,
        valid: false,
        manifestResolved: false,
        availability: 'missing_manifest',
        warning: 'Manifest file was not found for this installed package in configured/default package roots.',
        error: 'Manifest file was not found for this installed package in configured/default package roots.'
      });
    }
    return rows;
  }

  async function discoverLocalPackages(options = {}) {
    const configuredRoot = getPackageStorageRootAbsolute({
      packageRootDir: options.packageRootDir,
      ensureExists: false
    });
    const defaultRoot = deps.path.resolve(process.cwd(), 'packages');
    const candidates = [];
    const configuredRows = await discoverPackagesFromRoot(configuredRoot, 'configured_root');
    candidates.push(...configuredRows);
    if (configuredRoot.toLowerCase() !== defaultRoot.toLowerCase()) {
      const defaultRows = await discoverPackagesFromRoot(defaultRoot, 'default_root');
      candidates.push(...defaultRows);
    }
    const registryRows = await discoverRegistryPackages(options);
    candidates.push(...registryRows);

    const byPackageId = new Map();
    candidates.forEach((row) => {
      const key = normalizePackageId(row?.packageId || '');
      if (!key) return;
      const current = byPackageId.get(key) || null;
      byPackageId.set(key, selectBetterCandidate(current, row));
    });

    return Array.from(byPackageId.values())
      .map((row) => ({
        ...row,
        source: cleanText(row?.source, 80).toLowerCase() || 'configured_root',
        manifestResolved: row?.manifestResolved === true,
        availability: row?.manifestResolved === true && row?.valid === true ? 'available' : 'missing_manifest',
        warning: cleanText(row?.warning || row?.error || '', 1200)
      }))
      .sort((a, b) => String(a.packageId || '').localeCompare(String(b.packageId || '')));
  }

  async function findPackageById(packageId = '', options = {}) {
    const token = normalizePackageId(packageId);
    if (!token) throw new Error('packageId is required.');
    const rows = await discoverLocalPackages(options);
    const match = rows.find((row) => row.packageId === token);
    if (!match) throw new Error(`Package "${token}" was not found in local package storage.`);
    if (match.manifestResolved !== true || match.valid !== true) {
      const reason = cleanText(match.warning || match.error || '', 800)
        || 'Manifest file is missing or unreadable for this package.';
      throw new Error(`Package "${token}" is unavailable for build: ${reason}`);
    }
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

    const inferred = await inferDataEntitiesFromDataDirectory(packageId);
    inferred.forEach((row) => pushEntity(row.entityType, row.source, row.label));
    return normalizedRows;
  }

  async function fetchEntityRows(entityType = '', options = {}) {
    try {
      const rows = await deps.dataService.fetchData(entityType, {}, SYSTEM_CONTEXT, {
        backendMode: options.backendMode
      });
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      if (!isUnknownEntityTypeError(error)) throw error;

      const backendMode = cleanText(options.backendMode, 40).toLowerCase() || 'json';
      if (backendMode === 'json') {
        const filePath = deps.path.join(process.cwd(), 'data', `${entityType}.json`);
        if (!(await pathExists(filePath))) return [];
        const payload = readJsonFile(filePath);
        return Array.isArray(payload) ? payload : [];
      }

      if (backendMode === 'mongo') {
        if (typeof deps.getMongoDbOrNull === 'function' && !deps.getMongoDbOrNull()) {
          throw new Error(`Mongo is not connected for fallback entity read: ${entityType}`);
        }
        if (typeof deps.getMongoCollection !== 'function') {
          throw new Error(`Mongo collection resolver is unavailable for fallback entity read: ${entityType}`);
        }
        const collection = deps.getMongoCollection(entityType);
        const docs = await collection.find({}).toArray();
        return Array.isArray(docs) ? docs.map((row) => {
          if (!row || typeof row !== 'object') return row;
          if (row._id !== undefined && row.id === undefined) {
            return { ...row, id: String(row._id) };
          }
          return row;
        }) : [];
      }

      throw error;
    }
  }

  async function resolveOriginOrgId(inputOriginOrgId = '', options = {}) {
    const inputText = cleanText(inputOriginOrgId, 160);
    const originOrgId = normalizeOrgToken(inputText);
    if (!inputText) {
      throw new Error('Origin organization is required. Select an origin org before preflight/build.');
    }

    const candidateTokens = new Set([
      inputText,
      originOrgId,
      originOrgId.replace(/^ORG_/i, '')
    ].filter(Boolean));

    let organizations = [];
    const actorContext = options.actor || SYSTEM_CONTEXT;
    if (deps.dataService && typeof deps.dataService.fetchData === 'function') {
      organizations = await deps.dataService.fetchData('organizations', {}, actorContext, {
        backendMode: options.backendMode
      }).catch(() => []);
    }

    if (!Array.isArray(organizations) || !organizations.length) {
      // Fallback path for environments where organization listing is unavailable.
      if (deps.dataService && typeof deps.dataService.getDataById === 'function') {
        let resolved = null;
        for (const candidate of Array.from(candidateTokens)) {
          // eslint-disable-next-line no-await-in-loop
          resolved = await deps.dataService.getDataById('organizations', candidate, actorContext, {
            backendMode: options.backendMode
          }).catch(() => null);
          if (resolved) break;
        }
        if (!resolved) {
          throw new Error(`Origin organization "${originOrgId || inputText}" was not found.`);
        }
      } else {
        throw new Error(`Origin organization "${originOrgId || inputText}" was not found.`);
      }
      return originOrgId || inputText;
    }

    const match = organizations.find((row) => {
      const rowId = cleanText(row?.id, 160);
      const rowOrgId = cleanText(row?.orgId, 160);
      const rowTokens = new Set([
        rowId,
        rowOrgId,
        normalizeOrgToken(rowId),
        normalizeOrgToken(rowOrgId)
      ].filter(Boolean));
      return Array.from(candidateTokens).some((token) => rowTokens.has(token));
    });
    if (!match) {
      throw new Error(`Origin organization "${originOrgId || inputText}" was not found.`);
    }

    const normalizedMatch = normalizeOrgToken(cleanText(match?.orgId, 160))
      || normalizeOrgToken(cleanText(match?.id, 160))
      || originOrgId
      || inputText;
    return normalizedMatch;
  }

  function filterRowsByOriginScope(rows = [], originOrgId = '') {
    const includedRows = [];
    const rejectedRows = [];
    const evaluatedRows = [];
    const summary = {
      inspectedRows: 0,
      includedRows: 0,
      excludedOtherOrgRows: 0,
      includedUnscopedRows: 0
    };
    sanitizeArray(rows).forEach((row, index) => {
      summary.inspectedRows += 1;
      const scope = evaluateRowOriginScope(row, originOrgId);
      const rowId = deriveRowId(row, index);
      const reason = scope.include
        ? (scope.includesUnscoped ? 'included_unscoped' : 'included_origin_scope')
        : 'excluded_cross_org_scope';
      const evaluated = {
        row,
        rowId,
        rowIndex: index,
        scope,
        reason
      };
      evaluatedRows.push(evaluated);
      if (scope.include) {
        includedRows.push(row);
        summary.includedRows += 1;
        if (scope.includesUnscoped) summary.includedUnscopedRows += 1;
      } else {
        summary.excludedOtherOrgRows += 1;
        rejectedRows.push({
          rowId,
          rowIndex: index,
          reason,
          orgTokens: scope.orgTokens,
          businessTokens: scope.businessTokens,
          uploadTokens: scope.uploadTokens
        });
      }
    });
    return {
      rows: includedRows,
      summary,
      rejectedRows,
      evaluatedRows
    };
  }

  async function preflightBuild(input = {}, options = {}) {
    const packageId = normalizePackageId(input.packageId);
    if (!packageId) throw new Error('packageId is required.');
    const backendMode = cleanText(options.backendMode, 40).toLowerCase() || 'json';
    const originOrgId = await resolveOriginOrgId(input.originOrgId, {
      backendMode,
      actor: options.actor || null
    });
    const packageRow = await findPackageById(packageId, options);
    const availableDataEntities = await resolveDataEntities(packageRow.manifest, packageId, { backendMode });
    const selectedDataEntityTokens = new Set(
      sanitizeArray(input.selectedDataEntities)
        .map((item) => cleanText(item, 200))
        .filter(Boolean)
    );
    const requestedFileFieldSelection = normalizeFileFieldSelection(input.fileFieldSelection || {});
    const detectedUploadUrls = new Set();
    const detectedSymbolUploadUrls = new Set(extractSymbolUploadRefs(packageRow.manifest));
    const fileProvenance = [];
    const entityCatalog = [];
    const warnings = [];
    let selectedRowCount = 0;
    const scopeViolations = {
      blocking: false,
      rows: [],
      files: [],
      manualRefs: []
    };
    const originScopeSummary = {
      inspectedRows: 0,
      includedRows: 0,
      excludedOtherOrgRows: 0,
      includedUnscopedRows: 0
    };
    const remapImpactPreview = {
      rewrittenOrgFields: 0,
      rewrittenUploadUrls: 0,
      rewrittenExactOrgTokens: 0
    };

    for (const entity of availableDataEntities) {
      const isSelected = selectedDataEntityTokens.size === 0
        ? true
        : (selectedDataEntityTokens.has(entity.entityType) || selectedDataEntityTokens.has(entity.id));
      try {
        // eslint-disable-next-line no-await-in-loop
        const rowsRaw = await fetchEntityRows(entity.entityType, { backendMode });
        const scoped = filterRowsByOriginScope(rowsRaw, originOrgId);
        const rows = scoped.rows;
        const fileFieldCandidates = collectFileFieldCandidates(rowsRaw);
        const selectedFields = resolveSelectedFileFields(
          entity.entityType,
          requestedFileFieldSelection,
          fileFieldCandidates
        );
        const selectedFieldSet = new Set(selectedFields);
        originScopeSummary.inspectedRows += scoped.summary.inspectedRows;
        originScopeSummary.includedRows += scoped.summary.includedRows;
        originScopeSummary.excludedOtherOrgRows += scoped.summary.excludedOtherOrgRows;
        originScopeSummary.includedUnscopedRows += scoped.summary.includedUnscopedRows;
        const entityUploads = new Set();
        const entityFileProvenance = [];
        const remapEntityState = { rewrittenFieldCount: 0, rewrittenUrlCount: 0, rewrittenExactTokenCount: 0, pathHits: [] };
        rows.forEach((row) => {
          extractUploadUrls(row, entityUploads);
          transformForOrgRemap(row, remapEntityState);
        });
        if (isSelected) {
          selectedRowCount += rows.length;
          sanitizeArray(scoped.evaluatedRows).forEach((rowMeta) => {
            const rowRefs = collectUploadRefProvenanceFromRow(rowMeta?.row, {
              entityType: entity.entityType,
              rowId: rowMeta?.rowId,
              rowIndex: rowMeta?.rowIndex,
              selectedFields: Array.from(selectedFieldSet)
            });
            rowRefs.forEach((rowRef) => {
              const detectedTokens = sanitizeArray(rowRef.detectedOrgTokens)
                .map((token) => normalizeOrgToken(token))
                .filter(Boolean);
              const hasOtherDetectedOrg = detectedTokens.some((token) => token !== originOrgId);
              const hasOriginBusinessToken = sanitizeArray(rowMeta?.scope?.businessTokens).includes(originOrgId);
              const mixedOriginFileRef = hasOriginBusinessToken && hasOtherDetectedOrg;

              if (mixedOriginFileRef) {
                scopeViolations.files.push({
                  entityType: entity.entityType,
                  rowId: rowMeta?.rowId,
                  rowIndex: Number(rowMeta?.rowIndex || 0),
                  fieldPath: rowRef.fieldPath,
                  ref: rowRef.ref,
                  detectedOrgTokens: detectedTokens,
                  reason: 'Cross-org upload reference detected in origin-scoped row.'
                });
              }

              if (rowMeta?.scope?.include) {
                const provenanceRow = {
                  entityType: entity.entityType,
                  rowId: rowMeta?.rowId,
                  rowIndex: Number(rowMeta?.rowIndex || 0),
                  fieldPath: rowRef.fieldPath,
                  ref: rowRef.ref,
                  detectedOrgTokens: detectedTokens,
                  rowOrgTokens: sanitizeArray(rowMeta?.scope?.orgTokens),
                  include: true
                };
                entityFileProvenance.push(provenanceRow);
                fileProvenance.push(provenanceRow);
                if (!mixedOriginFileRef) {
                  detectedUploadUrls.add(rowRef.ref);
                }
              }
            });
          });

          sanitizeArray(scoped.rejectedRows).forEach((row) => {
            scopeViolations.rows.push({
              entityType: entity.entityType,
              rowId: row.rowId,
              rowIndex: Number(row.rowIndex || 0),
              reason: row.reason,
              orgTokens: sanitizeArray(row.orgTokens),
              businessTokens: sanitizeArray(row.businessTokens),
              uploadTokens: sanitizeArray(row.uploadTokens)
            });
          });

          remapImpactPreview.rewrittenOrgFields += remapEntityState.rewrittenFieldCount;
          remapImpactPreview.rewrittenUploadUrls += remapEntityState.rewrittenUrlCount;
          remapImpactPreview.rewrittenExactOrgTokens += remapEntityState.rewrittenExactTokenCount;
        }
        entityCatalog.push({
          ...entity,
          rowCount: rows.length,
          detectedUploadRefCount: entityUploads.size,
          remapCandidates: {
            orgFieldCount: remapEntityState.rewrittenFieldCount,
            uploadUrlCount: remapEntityState.rewrittenUrlCount,
            exactOrgTokenCount: remapEntityState.rewrittenExactTokenCount
          },
          fileFieldCandidates,
          fileFieldSelected: selectedFields,
          rejectedRows: sanitizeArray(scoped.rejectedRows),
          fileProvenanceCount: entityFileProvenance.length,
          originScope: scoped.summary,
          selected: isSelected
        });
      } catch (error) {
        warnings.push(`Failed to inspect data entity "${entity.entityType}": ${cleanText(error?.message || String(error), 400)}`);
        entityCatalog.push({
          ...entity,
          rowCount: 0,
          detectedUploadRefCount: 0,
          remapCandidates: {
            orgFieldCount: 0,
            uploadUrlCount: 0,
            exactOrgTokenCount: 0
          },
          fileFieldCandidates: [],
          fileFieldSelected: [],
          rejectedRows: [],
          fileProvenanceCount: 0,
          originScope: {
            inspectedRows: 0,
            includedRows: 0,
            excludedOtherOrgRows: 0,
            includedUnscopedRows: 0
          },
          inspectionError: true,
          selected: isSelected
        });
      }
    }

    const selectedDataEntities = entityCatalog.filter((row) => row.selected);

    const manualFileRefs = parseManualFileRefs(input.selectedFileRefs || []);
    manualFileRefs.forEach((ref) => {
      const detectedOrgTokens = extractOrgTokensFromUploadRef(ref);
      if (detectedOrgTokens.length && detectedOrgTokens.some((token) => token !== originOrgId)) {
        scopeViolations.manualRefs.push({
          ref,
          detectedOrgTokens,
          reason: 'Manual file reference points to a different organization scope.'
        });
      }
    });

    const fileFieldSelection = {};
    selectedDataEntities.forEach((row) => {
      const entityType = cleanText(row?.entityType, 200);
      if (!entityType) return;
      fileFieldSelection[entityType] = sanitizeArray(row.fileFieldSelected);
    });

    scopeViolations.blocking = scopeViolations.files.length > 0 || scopeViolations.manualRefs.length > 0;
    if (scopeViolations.blocking) {
      warnings.push('Blocking origin-scope violations were detected. Resolve scope violations before running build.');
    }

    const combinedFileRefs = Array.from(new Set([
      ...Array.from(detectedUploadUrls),
      ...Array.from(detectedSymbolUploadUrls),
      ...manualFileRefs
    ]));
    const normalizedFileRefs = combinedFileRefs.map((item) => {
      const uploadRelative = uploadPathUtils.extractRelativeUploadPath(item);
      return {
        ref: item,
        type: uploadRelative
          ? (detectedSymbolUploadUrls.has(item) ? 'symbol-upload-url' : 'upload-url')
          : 'manual',
        uploadRelativePath: uploadRelative || '',
        exists: uploadRelative ? fs.existsSync(uploadPathUtils.fromUploadsUrlToDiskPath(item) || '') : true,
        detectedOrgTokens: extractOrgTokensFromUploadRef(item)
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
      originOrgId,
      originScopeSummary,
      availableDataEntities,
      entityCatalog,
      selectedDataEntities,
      selectedRowCount,
      remapImpactPreview,
      scopeValidation: scopeViolations,
      fileFieldSelection,
      filePlan: {
        detectedFromData: Array.from(detectedUploadUrls),
        detectedFromSymbols: Array.from(detectedSymbolUploadUrls),
        provenance: fileProvenance,
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

  async function hashFileSha256(filePath = '') {
    const buffer = await deps.fs.readFile(filePath);
    return deps.crypto.createHash('sha256').update(buffer).digest('hex');
  }

  async function publishBuildArtifacts(options = {}) {
    const packageId = normalizePackageId(options.packageId);
    const buildId = cleanText(options.buildId, 200);
    if (!packageId || !buildId) return null;
    const globalRoot = deps.coreFilesService.getRootPath('GLOBAL');
    const packagesRoot = deps.coreFilesService.resolveSafePath(globalRoot, 'packages');
    deps.coreFilesService.ensureDir(packagesRoot);
    const packageRoot = deps.coreFilesService.resolveSafePath(packagesRoot, packageId);
    deps.coreFilesService.ensureDir(packageRoot);
    const buildRoot = deps.coreFilesService.resolveSafePath(packageRoot, buildId);
    deps.coreFilesService.ensureDir(buildRoot);

    const publishRows = [];
    const publishFile = async (sourcePath = '', targetName = '') => {
      const source = cleanText(sourcePath, 2000);
      const fileName = cleanText(targetName, 260);
      if (!source || !fileName) return;
      const destinationPath = deps.path.join(buildRoot, fileName);
      await copyFileSafe(source, destinationPath);
      const stat = await deps.fs.stat(destinationPath);
      publishRows.push({
        fileName,
        absolutePath: destinationPath,
        uploadsUrl: deps.coreFilesService.fromDiskPathToUploadsUrl(destinationPath) || '',
        size: Number(stat?.size || 0),
        sha256: await hashFileSha256(destinationPath)
      });
    };

    await publishFile(options?.zipPath, 'package.zip');
    await publishFile(options?.sigPath, 'package.sig');
    if (cleanText(options?.publicPath, 2000)) {
      await publishFile(options.publicPath, 'package.public.pem');
    }

    const details = {
      buildId,
      packageId,
      packageName: cleanText(options.packageName, 200),
      version: cleanText(options.version, 120),
      originOrgId: cleanText(options.originOrgId, 160),
      createdAt: new Date().toISOString(),
      summary: sanitizeObject(options.summary),
      files: publishRows.map((row) => ({
        fileName: row.fileName,
        uploadsUrl: row.uploadsUrl,
        size: row.size,
        sha256: row.sha256
      })),
      fileFieldSelection: sanitizeObject(options.fileFieldSelection)
    };
    const detailPath = deps.path.join(buildRoot, 'build-detail.json');
    await deps.fs.writeFile(detailPath, JSON.stringify(details, null, 2));
    const detailStat = await deps.fs.stat(detailPath);
    publishRows.push({
      fileName: 'build-detail.json',
      absolutePath: detailPath,
      uploadsUrl: deps.coreFilesService.fromDiskPathToUploadsUrl(detailPath) || '',
      size: Number(detailStat?.size || 0),
      sha256: await hashFileSha256(detailPath)
    });

    return {
      rootAbsolutePath: buildRoot,
      rootUploadsUrl: deps.coreFilesService.fromDiskPathToUploadsUrl(buildRoot) || '',
      files: publishRows
    };
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
    if (preflight?.scopeValidation?.blocking) {
      const error = new Error('Blocking origin-scope violations were detected in selected rows/files. Resolve violations and rerun build.');
      error.code = 'ORIGIN_SCOPE_VIOLATION';
      error.details = sanitizeObject(preflight.scopeValidation);
      throw error;
    }
    const selectedEntityRows = sanitizeArray(preflight.selectedDataEntities);
    const originOrgId = cleanText(preflight.originOrgId, 160);
    const fileFieldSelection = sanitizeObject(preflight.fileFieldSelection);
    const tablePayload = {};
    const remapState = { rewrittenUrlCount: 0, rewrittenFieldCount: 0, rewrittenExactTokenCount: 0 };
    const originScopeSummary = {
      inspectedRows: 0,
      includedRows: 0,
      excludedOtherOrgRows: 0,
      includedUnscopedRows: 0
    };

    for (const entity of selectedEntityRows) {
      // eslint-disable-next-line no-await-in-loop
      const rowsRaw = await fetchEntityRows(entity.entityType, { backendMode });
      const scoped = filterRowsByOriginScope(rowsRaw, originOrgId);
      const rows = scoped.rows;
      originScopeSummary.inspectedRows += scoped.summary.inspectedRows;
      originScopeSummary.includedRows += scoped.summary.includedRows;
      originScopeSummary.excludedOtherOrgRows += scoped.summary.excludedOtherOrgRows;
      originScopeSummary.includedUnscopedRows += scoped.summary.includedUnscopedRows;
      tablePayload[entity.entityType] = rows.map((row) => transformForOrgRemap(row, remapState));
    }

    const fileRefs = sanitizeArray(preflight.filePlan?.normalizedRefs).map((row) => ({
      ref: cleanText(row.ref, 2000),
      type: cleanText(row.type, 40),
      uploadRelativePath: cleanText(row.uploadRelativePath, 2000)
    }));

    const stageRoot = await deps.fs.mkdtemp(deps.path.join(deps.os.tmpdir(), `pkg-build-${packageId}-`));
    const stagedPackageDir = deps.path.join(stageRoot, packageId);
    const payloadDir = deps.path.join(stagedPackageDir, '__builder_payload__');
    const payloadFilesDir = deps.path.join(payloadDir, 'artifacts');
    const payloadTablesDir = deps.path.join(payloadDir, 'tables');
    let copiedFileReport = { copied: [], warnings: [] };
    let artifactPaths = null;
    let publishedArtifacts = null;

    try {
      await copyDirectorySafe(packageRow.packageDir, stagedPackageDir);
      const stagedManifestPath = deps.path.join(stagedPackageDir, 'package.manifest.json');
      const stagedManifest = readJsonFile(stagedManifestPath);
      stagedManifest.version = requestedVersion;
      await deps.fs.writeFile(stagedManifestPath, JSON.stringify(stagedManifest, null, 2));

      await deps.fs.mkdir(payloadFilesDir, { recursive: true });
      await deps.fs.mkdir(payloadTablesDir, { recursive: true });
      copiedFileReport = await copySelectedRefs(fileRefs, payloadFilesDir);
      const tableIndex = [];
      for (const entity of selectedEntityRows) {
        const entityType = cleanText(entity?.entityType, 200);
        if (!entityType) continue;
        const rows = sanitizeArray(tablePayload[entityType]);
        const fileName = `${entityType}.json`;
        // eslint-disable-next-line no-await-in-loop
        await deps.fs.writeFile(deps.path.join(payloadTablesDir, fileName), JSON.stringify(rows, null, 2));
        tableIndex.push({
          entityType,
          file: `tables/${fileName}`,
          rowCount: rows.length
        });
      }

      const payload = {
        schema: 'core.package-builder.payload.v2',
        buildId: `PKG_BUILD_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        packageId,
        packageName: packageRow.packageName,
        packageVersion: requestedVersion,
        backendMode,
        originOrgId,
        createdAt: new Date().toISOString(),
        orgRemapRequired: remapState.rewrittenFieldCount > 0 || remapState.rewrittenUrlCount > 0,
        remapSummary: {
          rewrittenOrgFields: remapState.rewrittenFieldCount,
          rewrittenUploadUrls: remapState.rewrittenUrlCount,
          rewrittenExactOrgTokens: remapState.rewrittenExactTokenCount
        },
        selectedDataEntities: selectedEntityRows.map((row) => ({
          id: row?.id,
          entityType: row?.entityType,
          label: row?.label,
          rowCount: Number(row?.rowCount || 0)
        })),
        fileFieldSelection,
        tables: tableIndex,
        artifactsRoot: 'artifacts',
        fileRefs,
        copiedFiles: copiedFileReport.copied.map((row) => ({
          relativePath: row.relativePath,
          type: row.type
        }))
      };
      await deps.fs.writeFile(deps.path.join(payloadDir, 'manifest.json'), JSON.stringify(payload, null, 2));

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
      publishedArtifacts = await publishBuildArtifacts({
        packageId,
        packageName: packageRow.packageName,
        version: requestedVersion,
        buildId: payload.buildId,
        originOrgId,
        zipPath,
        sigPath,
        publicPath,
        fileFieldSelection,
        summary: {
          backendMode,
          originScopeSummary,
          selectedDataEntities: payload.selectedDataEntities,
          tableCount: tableIndex.length,
          rowCount: Object.values(tablePayload).reduce((sum, rows) => sum + sanitizeArray(rows).length, 0),
          copiedFileCount: copiedFileReport.copied.length
        }
      });

      return {
        status: 'success',
        buildId: payload.buildId,
        packageId,
        version: requestedVersion,
        originOrgId,
        originScopeSummary,
        dataSummary: {
          entityCount: selectedEntityRows.length,
          rowCount: Object.values(tablePayload).reduce((sum, rows) => sum + sanitizeArray(rows).length, 0)
        },
        fileSummary: {
          selectedRefCount: fileRefs.length,
          copiedCount: copiedFileReport.copied.length
        },
        fileFieldSelection,
        remapSummary: payload.remapSummary,
        orgRemapRequired: payload.orgRemapRequired,
        artifacts: {
          zip: artifactPaths.zipPath,
          signature: artifactPaths.sigPath,
          publicKeyPem: artifactPaths.publicPath
        },
        publishedArtifacts,
        downloadLinks: sanitizeArray(publishedArtifacts?.files)
          .map((row) => row.uploadsUrl)
          .filter(Boolean),
        warnings: copiedFileReport.warnings
      };
    } finally {
      await deps.fs.rm(stageRoot, { recursive: true, force: true }).catch(() => {});
    }
  }

  async function loadBuilderPayload(packageDir = '') {
    const payloadRoot = path.join(packageDir, '__builder_payload__');
    const manifestPath = path.join(payloadRoot, 'manifest.json');
    if (await pathExists(manifestPath)) {
      const manifest = readJsonFile(manifestPath);
      const tables = sanitizeArray(manifest?.tables);
      const data = {};
      for (const row of tables) {
        const entityType = cleanText(row?.entityType, 200);
        const relativeFile = cleanText(row?.file, 1000);
        if (!entityType || !relativeFile) continue;
        const absoluteFile = path.resolve(payloadRoot, relativeFile);
        if (!(await pathExists(absoluteFile))) {
          throw new Error(`Builder payload table file is missing: ${relativeFile}`);
        }
        // eslint-disable-next-line no-await-in-loop
        data[entityType] = sanitizeArray(readJsonFile(absoluteFile));
      }
      return {
        format: 'v2',
        manifest,
        data,
        orgRemapRequired: manifest?.orgRemapRequired === true,
        artifactsRoot: cleanText(manifest?.artifactsRoot, 200) || 'artifacts'
      };
    }

    const legacyPayloadPath = path.join(payloadRoot, 'payload.json');
    if (!(await pathExists(legacyPayloadPath))) return null;
    const payload = readJsonFile(legacyPayloadPath);
    return {
      format: 'v1',
      manifest: payload,
      data: sanitizeObject(payload?.data),
      orgRemapRequired: payload?.orgRemapRequired === true,
      artifactsRoot: 'files'
    };
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
    const loadedPayload = await loadBuilderPayload(packageDir);
    if (!loadedPayload) {
      return {
        applied: false,
        orgRemapRequired: false,
        dataSummary: { entityCount: 0, upserted: 0 },
        fileSummary: { copied: 0 },
        warnings: []
      };
    }
    const payload = loadedPayload.manifest;
    const payloadData = sanitizeObject(loadedPayload.data);
    const orgRemapRequired = loadedPayload.orgRemapRequired === true;
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
          entityCount: Object.keys(payloadData).length,
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
    const entityNames = Object.keys(payloadData);
    for (const entityType of entityNames) {
      const rows = sanitizeArray(payloadData[entityType]).map((row) => (
        orgRemapRequired ? applyOrgRemap(row, targetOrgId) : row
      ));
      for (const row of rows) {
        const rowId = cleanText(row?.id, 200);
        let operation = 'insert';
        try {
          if (rowId) {
            // eslint-disable-next-line no-await-in-loop
            const existing = await deps.dataService.getDataById(entityType, rowId, SYSTEM_CONTEXT, { backendMode });
            if (existing) {
              operation = 'update';
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
          const message = cleanText(error?.message || String(error), 500) || 'Unknown payload import error.';
          const importError = new Error(`Builder payload import failed for ${entityType}${rowId ? `#${rowId}` : ''}: ${message}`);
          importError.code = 'BUILDER_PAYLOAD_IMPORT_FAILED';
          importError.details = {
            entityType,
            rowId: rowId || '',
            operation,
            targetOrgId: targetOrgId || '',
            backendMode,
            message
          };
          throw importError;
        }
      }
    }

    const sourceFilesRoot = path.join(packageDir, '__builder_payload__', loadedPayload.artifactsRoot || 'files');
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
