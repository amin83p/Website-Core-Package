const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../..');
const PACKAGES_DIR = path.join(ROOT_DIR, 'packages');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeDeep(base = {}, incoming = {}) {
  const out = { ...(isPlainObject(base) ? base : {}) };
  Object.entries(isPlainObject(incoming) ? incoming : {}).forEach(([key, value]) => {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = mergeDeep(out[key], value);
      return;
    }
    out[key] = value;
  });
  return out;
}

function listPackageDefaultModules() {
  if (!fs.existsSync(PACKAGES_DIR)) return [];
  return fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(PACKAGES_DIR, entry.name, 'config', 'settingsDefaults.js'))
    .filter((candidate) => fs.existsSync(candidate));
}

function normalizeDefaultsExport(mod = {}) {
  if (isPlainObject(mod.settingsDefaults)) return mod.settingsDefaults;
  if (isPlainObject(mod.DEFAULTS)) return mod.DEFAULTS;
  if (isPlainObject(mod)) return mod;
  return {};
}

function getPackageSettingsDefaults() {
  return listPackageDefaultModules().reduce((merged, modulePath) => {
    try {
      const defaults = normalizeDefaultsExport(require(modulePath));
      return mergeDeep(merged, defaults);
    } catch (error) {
      console.warn(`[PACKAGE_DEFAULTS] Skipping ${modulePath}: ${error.message}`);
      return merged;
    }
  }, {});
}

module.exports = {
  getPackageSettingsDefaults,
  mergeDeep
};
