const packageRegistryRepository = require('../repositories/packageRegistryRepository');

function cleanText(value, max = 4000) {
  const out = String(value || '').replace(/\0/g, '').trim();
  if (!out) return '';
  return out.length > max ? out.slice(0, max) : out;
}

function normalizePackageId(value = '') {
  return cleanText(value, 80).toLowerCase();
}

function normalizeStatus(value = '', fallback = 'installed') {
  const token = cleanText(value, 120).toLowerCase();
  if (!token) return fallback;
  return token;
}

function normalizeVersion(value = '') {
  return cleanText(value, 120);
}

function buildRegistryPatch(input = {}, options = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const statusFallback = options?.fallbackStatus || 'installed';
  const patch = {
    packageId: normalizePackageId(source.packageId || source.id || '')
  };
  if (Object.prototype.hasOwnProperty.call(source, 'version')) {
    patch.version = normalizeVersion(source.version);
  }
  if (Object.prototype.hasOwnProperty.call(source, 'enabled')) {
    patch.enabled = Boolean(source.enabled);
  }
  if (Object.prototype.hasOwnProperty.call(source, 'installStatus')) {
    patch.installStatus = normalizeStatus(source.installStatus, statusFallback);
  }
  if (Object.prototype.hasOwnProperty.call(source, 'lastError')) {
    patch.lastError = cleanText(source.lastError, 4000);
  }
  if (Object.prototype.hasOwnProperty.call(source, 'lastWarning')) {
    patch.lastWarning = cleanText(source.lastWarning, 2000);
  }
  if (Object.prototype.hasOwnProperty.call(source, 'metadata')) {
    patch.metadata = source.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata)
      ? { ...source.metadata }
      : {};
  }
  return patch;
}

async function listPackageRegistry(options = {}) {
  const query = options?.query || {};
  const rows = await packageRegistryRepository.list({
    query,
    backendMode: options?.backendMode
  });
  return Array.isArray(rows) ? rows : [];
}

async function getPackageRegistryById(packageId = '', options = {}) {
  const token = normalizePackageId(packageId);
  if (!token) return null;
  return packageRegistryRepository.getByPackageId(token, {
    backendMode: options?.backendMode
  });
}

async function upsertPackageRegistry(input = {}, options = {}) {
  const patch = buildRegistryPatch(input, options);
  if (!patch.packageId) throw new Error('packageId is required.');

  const payload = {
    ...patch
  };
  if (payload.enabled === undefined) {
    delete payload.enabled;
  }
  return packageRegistryRepository.upsertByPackageId(patch.packageId, payload, {
    backendMode: options?.backendMode,
    actor: options?.actor || null
  });
}

async function setPackageEnabled(packageId = '', enabled = false, options = {}) {
  const token = normalizePackageId(packageId);
  if (!token) throw new Error('packageId is required.');
  return packageRegistryRepository.upsertByPackageId(token, {
    enabled: Boolean(enabled),
    installStatus: enabled ? 'enabled' : 'disabled'
  }, {
    backendMode: options?.backendMode,
    actor: options?.actor || null
  });
}

async function markPackageInstallFailure(packageId = '', errorMessage = '', options = {}) {
  const token = normalizePackageId(packageId);
  if (!token) throw new Error('packageId is required.');
  return packageRegistryRepository.upsertByPackageId(token, {
    enabled: false,
    installStatus: 'failed',
    lastError: cleanText(errorMessage, 4000)
  }, {
    backendMode: options?.backendMode,
    actor: options?.actor || null
  });
}

async function removePackageRegistry(packageId = '', options = {}) {
  return packageRegistryRepository.removeByPackageId(packageId, {
    backendMode: options?.backendMode
  });
}

module.exports = {
  normalizePackageId,
  listPackageRegistry,
  getPackageRegistryById,
  upsertPackageRegistry,
  setPackageEnabled,
  markPackageInstallFailure,
  removePackageRegistry
};
