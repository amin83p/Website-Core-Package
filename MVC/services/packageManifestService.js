const DECLARATION_ARRAY_KEYS = Object.freeze([
  'routes',
  'queryExecutors',
  'operations',
  'roles',
  'sections',
  'symbols',
  'accesses',
  'uploadFolders',
  'quotaDefinitions',
  'mongoIndexes',
  'settings',
  'menuEntries',
  'dashboardEntries',
  'seeders',
  'migrations',
  'dependencies'
]);

const DECLARATION_OBJECT_KEYS = Object.freeze([
  'views',
  'assets'
]);

const PACKAGE_ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const MOUNT_SEGMENT_PATTERN = /^[a-zA-Z0-9._-]+$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SAFE_RELATIVE_PATH_PATTERN = /^[a-zA-Z0-9._/-]+$/;
const ALLOWED_BACKEND_MODES = new Set(['json', 'mongo']);
const ALLOWED_SEEDER_MODES = new Set(['upsert', 'append', 'replace']);

function cleanText(value, max = 500) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function normalizePackageId(rawId = '') {
  return cleanText(rawId, 80).toLowerCase();
}

function assertValidPackageId(rawId = '', label = 'Package id') {
  const id = normalizePackageId(rawId);
  if (!id) throw new Error(`${label} is required.`);
  if (!PACKAGE_ID_PATTERN.test(id)) {
    throw new Error(
      `${label} is invalid. Use lowercase letters, digits, and dashes; must start with a letter.`
    );
  }
  return id;
}

function normalizeMountPath(rawPath = '') {
  const token = cleanText(rawPath, 320);
  if (!token) return '';
  return token.replace(/\\/g, '/');
}

function assertValidMountPath(rawPath = '') {
  const mountPath = normalizeMountPath(rawPath);
  if (!mountPath) throw new Error('mountPath is required.');
  if (mountPath === '/') throw new Error('mountPath cannot be root "/".');
  if (!mountPath.startsWith('/')) throw new Error('mountPath must start with "/".');
  if (mountPath.endsWith('/')) throw new Error('mountPath must not end with "/".');
  if (mountPath.includes('//')) throw new Error('mountPath must not include empty path segments.');
  if (/\s/.test(mountPath)) throw new Error('mountPath must not include whitespace.');

  const segments = mountPath.split('/').filter(Boolean);
  if (!segments.length) throw new Error('mountPath must include at least one segment.');
  segments.forEach((segment) => {
    if (!MOUNT_SEGMENT_PATTERN.test(segment)) {
      throw new Error(`mountPath segment "${segment}" is invalid.`);
    }
  });
  return `/${segments.join('/')}`;
}

function assertValidVersion(rawVersion = '') {
  const version = cleanText(rawVersion, 120);
  if (!version) throw new Error('version is required.');
  if (!VERSION_PATTERN.test(version)) {
    throw new Error('version must follow semver format, for example "1.0.0".');
  }
  return version;
}

function normalizeArrayDeclaration(value, key) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array when provided.`);
  }
  return value;
}

function normalizeObjectDeclaration(value, key) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${key} must be an object when provided.`);
  }
  return value;
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

function assertValidRelativeScriptPath(rawPath = '', label = 'Script path') {
  const scriptPath = cleanText(rawPath, 1600).replace(/\\/g, '/');
  if (!scriptPath) throw new Error(`${label} is required.`);
  if (scriptPath.startsWith('/') || /^[A-Za-z]:\//.test(scriptPath)) {
    throw new Error(`${label} must be relative to package folder.`);
  }
  if (!SAFE_RELATIVE_PATH_PATTERN.test(scriptPath)) {
    throw new Error(`${label} contains unsupported characters.`);
  }
  const parts = scriptPath.split('/').filter(Boolean);
  if (!parts.length) throw new Error(`${label} is invalid.`);
  if (parts.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`${label} must stay inside package folder.`);
  }
  return parts.join('/');
}

function normalizeBackendModes(rawModes = [], label = 'backendModes') {
  const rows = normalizeArrayDeclaration(rawModes, label)
    .map((mode) => cleanText(mode, 40).toLowerCase())
    .filter(Boolean);
  const deduped = Array.from(new Set(rows));
  if (!deduped.length) return ['json', 'mongo'];
  deduped.forEach((mode) => {
    if (!ALLOWED_BACKEND_MODES.has(mode)) {
      throw new Error(`${label} contains unsupported backend mode "${mode}".`);
    }
  });
  return deduped;
}

function validateMigrationDeclarations(rawMigrations = []) {
  const seenIds = new Set();
  const out = normalizeArrayDeclaration(rawMigrations, 'migrations').map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`migrations[${index}] must be an object.`);
    }
    const id = cleanText(row.id, 200);
    if (!id) throw new Error(`migrations[${index}].id is required.`);
    if (seenIds.has(id)) throw new Error(`Duplicate migration id "${id}" is not allowed.`);
    seenIds.add(id);
    const version = assertValidVersion(row.version);
    const description = cleanText(row.description, 500) || id;
    const up = assertValidRelativeScriptPath(row.up, `migrations[${index}].up`);
    const down = assertValidRelativeScriptPath(row.down, `migrations[${index}].down`);
    const dependsOn = normalizeArrayDeclaration(row.dependsOn, `migrations[${index}].dependsOn`)
      .map((token) => cleanText(token, 200))
      .filter(Boolean);
    const backendModes = normalizeBackendModes(row.backendModes, `migrations[${index}].backendModes`);
    return {
      id,
      version,
      description,
      up,
      down,
      dependsOn,
      backendModes,
      safeToRollback: row.safeToRollback !== false
    };
  });

  const validIds = new Set(out.map((row) => row.id));
  out.forEach((row, index) => {
    row.dependsOn.forEach((dependencyId) => {
      if (!validIds.has(dependencyId)) {
        throw new Error(`migrations[${index}].dependsOn references unknown id "${dependencyId}".`);
      }
    });
  });

  for (let index = 1; index < out.length; index += 1) {
    const prev = out[index - 1];
    const curr = out[index];
    if (compareSemver(curr.version, prev.version) < 0) {
      throw new Error('migrations must be ordered by non-decreasing semantic version.');
    }
  }
  return out;
}

function validateSeederDeclarations(rawSeeders = []) {
  const seenIds = new Set();
  const out = normalizeArrayDeclaration(rawSeeders, 'seeders').map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`seeders[${index}] must be an object.`);
    }
    const id = cleanText(row.id, 200);
    if (!id) throw new Error(`seeders[${index}].id is required.`);
    if (seenIds.has(id)) throw new Error(`Duplicate seeder id "${id}" is not allowed.`);
    seenIds.add(id);
    const version = assertValidVersion(row.version);
    const description = cleanText(row.description, 500) || id;
    const run = assertValidRelativeScriptPath(row.run, `seeders[${index}].run`);
    const revert = assertValidRelativeScriptPath(row.revert, `seeders[${index}].revert`);
    const backendModes = normalizeBackendModes(row.backendModes, `seeders[${index}].backendModes`);
    const mode = cleanText(row.mode, 40).toLowerCase() || 'upsert';
    if (!ALLOWED_SEEDER_MODES.has(mode)) {
      throw new Error(`seeders[${index}].mode is invalid. Use upsert, append, or replace.`);
    }
    const idempotencyKey = cleanText(row.idempotencyKey, 240);
    if (!idempotencyKey) {
      throw new Error(`seeders[${index}].idempotencyKey is required.`);
    }
    return {
      id,
      version,
      description,
      run,
      revert,
      mode,
      backendModes,
      idempotencyKey
    };
  });

  for (let index = 1; index < out.length; index += 1) {
    const prev = out[index - 1];
    const curr = out[index];
    if (compareSemver(curr.version, prev.version) < 0) {
      throw new Error('seeders must be ordered by non-decreasing semantic version.');
    }
  }
  return out;
}

function assertNoUnknownKeys(manifest = {}, allowedKeys = []) {
  const unknownKeys = Object.keys(manifest || {}).filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length) {
    throw new Error(`Manifest contains unsupported keys: ${unknownKeys.join(', ')}`);
  }
}

function normalizeDependencies(rawDependencies = [], ownerId = '') {
  const dependencies = normalizeArrayDeclaration(rawDependencies, 'dependencies')
    .map((entry) => assertValidPackageId(entry, 'Dependency id'));
  const deduped = Array.from(new Set(dependencies));
  if (ownerId && deduped.includes(ownerId)) {
    throw new Error('Package cannot depend on itself.');
  }
  return deduped;
}

function validatePackageManifest(rawManifest = {}, options = {}) {
  const source = rawManifest && typeof rawManifest === 'object' && !Array.isArray(rawManifest)
    ? rawManifest
    : null;
  if (!source) throw new Error('Manifest must be an object.');

  const allowUnknownKeys = options.allowUnknownKeys === true;
  const knownIds = Array.isArray(options.knownIds) ? options.knownIds : [];
  const normalizedKnownIds = new Set(knownIds.map((row) => normalizePackageId(row)).filter(Boolean));

  const allowedKeys = [
    'id',
    'name',
    'version',
    'mountPath',
    'enabledByDefault',
    ...DECLARATION_ARRAY_KEYS,
    ...DECLARATION_OBJECT_KEYS
  ];

  if (!allowUnknownKeys) {
    assertNoUnknownKeys(source, allowedKeys);
  }

  const id = assertValidPackageId(source.id, 'id');
  if (normalizedKnownIds.has(id)) {
    throw new Error(`Duplicate package id "${id}" is not allowed.`);
  }

  const name = cleanText(source.name, 200);
  if (!name) throw new Error('name is required.');

  const manifest = {
    id,
    name,
    version: assertValidVersion(source.version),
    mountPath: assertValidMountPath(source.mountPath),
    enabledByDefault: source.enabledByDefault === true
  };

  DECLARATION_ARRAY_KEYS.forEach((key) => {
    if (key === 'dependencies') return;
    manifest[key] = normalizeArrayDeclaration(source[key], key);
  });
  DECLARATION_OBJECT_KEYS.forEach((key) => {
    manifest[key] = normalizeObjectDeclaration(source[key], key);
  });
  manifest.migrations = validateMigrationDeclarations(source.migrations);
  manifest.seeders = validateSeederDeclarations(source.seeders);
  const lifecycleIds = new Set();
  [...manifest.migrations, ...manifest.seeders].forEach((row) => {
    const id = cleanText(row.id, 200);
    if (lifecycleIds.has(id)) {
      throw new Error(`Lifecycle step id "${id}" must be unique across migrations and seeders.`);
    }
    lifecycleIds.add(id);
  });
  manifest.dependencies = normalizeDependencies(source.dependencies, id);

  return manifest;
}

function validatePackageManifestCollection(rawManifests = [], options = {}) {
  if (!Array.isArray(rawManifests)) {
    throw new Error('Manifest collection must be an array.');
  }

  const out = [];
  const seenIds = new Set((options?.knownIds || []).map((row) => normalizePackageId(row)).filter(Boolean));
  rawManifests.forEach((manifest, index) => {
    const validated = validatePackageManifest(manifest, {
      ...options,
      knownIds: [...seenIds]
    });
    if (seenIds.has(validated.id)) {
      throw new Error(`Duplicate package id "${validated.id}" at index ${index}.`);
    }
    seenIds.add(validated.id);
    out.push(validated);
  });
  return out;
}

function getPackageManifestContract() {
  return {
    required: ['id', 'name', 'version', 'mountPath'],
    optional: ['enabledByDefault', ...DECLARATION_ARRAY_KEYS, ...DECLARATION_OBJECT_KEYS],
    idPattern: PACKAGE_ID_PATTERN.source,
    mountPathPattern: '/segment[/segment...]',
    versionPattern: VERSION_PATTERN.source
  };
}

module.exports = {
  DECLARATION_ARRAY_KEYS,
  DECLARATION_OBJECT_KEYS,
  PACKAGE_ID_PATTERN,
  VERSION_PATTERN,
  assertValidPackageId,
  assertValidMountPath,
  assertValidVersion,
  normalizePackageId,
  validatePackageManifest,
  validatePackageManifestCollection,
  getPackageManifestContract
};
