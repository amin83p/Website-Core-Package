const createImportController = require('./importControllerFactory');
const dataService = require('../services/dataService');

function parseAliases(raw) {
  if (Array.isArray(raw)) return raw;
  return String(raw || '')
    .split(/[\n,]/)
    .map((token) => token.trim())
    .filter(Boolean);
}

const rolesImportController = createImportController({
  validateRecord: (record) => {
    if (!record.key || !String(record.key).trim()) {
      throw new Error('Role key is required.');
    }
    if (!record.label || !String(record.label).trim()) {
      throw new Error('Role label is required.');
    }
    if (!record.packageName || !String(record.packageName).trim()) {
      throw new Error('Package name is required.');
    }
  },
  processRecord: async (record, context) => {
    const now = new Date().toISOString();
    const userId = context?.userId || 'SYSTEM';

    const role = {
      key: String(record.key || '').trim().toLowerCase(),
      label: String(record.label || '').trim(),
      description: String(record.description || '').trim(),
      domain: String(record.domain || '').trim().toLowerCase() || 'core',
      packageName: String(record.packageName || '').trim().toUpperCase(),
      aliases: parseAliases(record.aliases),
      active: String(record.active || '').toLowerCase().trim() !== 'false',
      system: String(record.system || '').toLowerCase().trim() === 'true',
      audit: {
        createUser: userId,
        createDateTime: now,
        lastUpdateUser: userId,
        lastUpdateDateTime: now
      }
    };

    await dataService.addData('roles', role, { id: userId });
  },
  downloadRouteBase: '/roles/import/report'
});

module.exports = rolesImportController;
