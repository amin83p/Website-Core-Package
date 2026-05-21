// MVC/controllers/scopesImportController.js
const createImportController = require('./importControllerFactory');
const dataService = require('../services/dataService'); // ✅ Use Data Service

const scopesImportController = createImportController({
  validateRecord: record => {
    if (!record.name || !record.name.trim()) {
      throw new Error('Name is required');
    }
    // Basic check for level presence
    if (record.level === undefined || record.level === '') {
       throw new Error('Level is required');
    }
  },
  
  processRecord: async (record, context) => {
    const now = new Date().toISOString();
    // Context usually comes from the import factory (req.user)
    const userId = context && context.userId ? context.userId : "1";

    let name = record.name.trim().toUpperCase();
    name = name.replace(/\s+/g, '_'); 

    // ✅ Parse Level
    let level = parseInt(record.level, 10);
    if (isNaN(level) || level < 0) level = 0;

    const scopeItem = {
      name: name,
      level: level,
      description: (record.description || '').trim(),
      active: String(record.active).toLowerCase() === 'true' || record.active === '1',
      audit: {
        createUser: userId,
        createDateTime: now,
        lastUpdateUser: userId,
        lastUpdateDateTime: now
      }
    };

    // ✅ Use dataService to add
    // We pass { id: userId } as the requestingUser object so dataService can log it if needed
    await dataService.addData('scopes', scopeItem, { id: userId });
  },
  
  downloadRouteBase: '/scopes/import/report'
});

module.exports = scopesImportController;