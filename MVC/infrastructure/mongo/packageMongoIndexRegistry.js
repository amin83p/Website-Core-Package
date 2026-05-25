const fs = require('fs');
const path = require('path');

const registeredDefinitions = new Map();

function cleanText(value = '', max = 500) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function resolveProjectRoot() {
  return path.resolve(__dirname, '../../../');
}

function normalizePackageId(value = '') {
  return cleanText(value, 80).toLowerCase();
}

function normalizeIndexDeclarations(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return [value];
  return [];
}

function assertInsidePackage(packageDir = '', targetPath = '') {
  const packageRoot = path.resolve(packageDir);
  const resolved = path.resolve(targetPath);
  const relative = path.relative(packageRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Package Mongo index module must stay inside the package directory.');
  }
  return resolved;
}

function registerMongoIndexDefinitions(packageId = '', definitions = {}, source = '') {
  const id = normalizePackageId(packageId);
  if (!id) throw new Error('Package id is required for Mongo index definitions.');
  if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions)) {
    throw new Error('Mongo index definitions must be an object keyed by collection name.');
  }

  const key = cleanText(source, 1200) || id;
  registeredDefinitions.set(key, {
    packageId: id,
    source: key,
    definitions
  });
  return key;
}

function getRegisteredMongoIndexDefinitions() {
  return Array.from(registeredDefinitions.values());
}

function resetRegisteredMongoIndexDefinitions() {
  registeredDefinitions.clear();
}

function mergeMongoIndexDefinitions(baseDefinitions = {}, packageRows = getRegisteredMongoIndexDefinitions()) {
  const merged = {};
  Object.entries(baseDefinitions || {}).forEach(([collectionName, specs]) => {
    merged[collectionName] = Array.isArray(specs) ? [...specs] : [];
  });

  (Array.isArray(packageRows) ? packageRows : []).forEach((row) => {
    Object.entries(row?.definitions || {}).forEach(([collectionName, specs]) => {
      if (!Array.isArray(specs) || !specs.length) return;
      const current = Array.isArray(merged[collectionName]) ? merged[collectionName] : [];
      const seenNames = new Set(
        current.map((spec) => cleanText(spec?.options?.name, 240)).filter(Boolean)
      );
      specs.forEach((spec) => {
        const name = cleanText(spec?.options?.name, 240);
        if (name && seenNames.has(name)) return;
        if (name) seenNames.add(name);
        current.push(spec);
      });
      merged[collectionName] = current;
    });
  });

  return Object.freeze(merged);
}

function readJsonFile(filePath = '') {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadMongoIndexDefinitionsFromManifest(manifestPath = '') {
  const manifest = readJsonFile(manifestPath);
  const packageId = normalizePackageId(manifest?.id);
  if (!packageId) return [];
  const packageDir = path.dirname(manifestPath);
  const declarations = normalizeIndexDeclarations(manifest?.mongoIndexes);
  const loaded = [];

  declarations.forEach((declaration) => {
    if (!declaration || typeof declaration !== 'object') return;
    if (declaration.active === false) return;
    const modulePath = cleanText(declaration.path || declaration.module || declaration.file, 1200);
    if (!modulePath) return;
    const resolvedModulePath = assertInsidePackage(packageDir, path.resolve(packageDir, modulePath));
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const definitions = require(resolvedModulePath);
    const source = path.relative(resolveProjectRoot(), resolvedModulePath).replace(/\\/g, '/');
    registerMongoIndexDefinitions(packageId, definitions, source);
    loaded.push({ packageId, source });
  });

  return loaded;
}

function loadMongoIndexDefinitionsFromPackageManifests(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || resolveProjectRoot());
  const packageRootDir = path.resolve(options.packageRootDir || path.join(projectRoot, 'packages'));
  if (!fs.existsSync(packageRootDir)) return [];

  const loaded = [];
  fs.readdirSync(packageRootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .forEach((entry) => {
      const manifestPath = path.join(packageRootDir, entry.name, 'package.manifest.json');
      if (!fs.existsSync(manifestPath)) return;
      loaded.push(...loadMongoIndexDefinitionsFromManifest(manifestPath));
    });
  return loaded;
}

module.exports = {
  registerMongoIndexDefinitions,
  getRegisteredMongoIndexDefinitions,
  resetRegisteredMongoIndexDefinitions,
  mergeMongoIndexDefinitions,
  loadMongoIndexDefinitionsFromManifest,
  loadMongoIndexDefinitionsFromPackageManifests
};
