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
