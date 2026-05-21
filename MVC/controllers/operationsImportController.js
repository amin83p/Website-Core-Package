// MVC/controllers/operationsImportController.js
const createImportController = require('./importControllerFactory');
const dataService = require('../services/dataService'); // ✅ Use Data Service

const operationsImportController = createImportController({
  validateRecord: record => {
    if (!record.name || !record.name.trim()) {
      throw new Error('Name is required');
    }
  },
  
  processRecord: async (record, context) => {
    const now = new Date().toISOString();
    // Context usually comes from the import factory (req.user)
    const userId = context && context.userId ? context.userId : "1";

    const name = record.name.trim();

    // The model (via dataService) contains strict validation (uppercase/underscores).
    // If the import CSV contains invalid names, dataService.addData will throw,
    // and the Factory will catch it as a row error.

    const operationItem = {
      name: name,
      active: String(record.active).toLowerCase() === 'true' || record.active === '1',
      system: false, // Imported operations are never system-protected by default
      audit: {
        createUser: userId,
        createDateTime: now,
        lastUpdateUser: userId,
        lastUpdateDateTime: now
      }
    };

    // ✅ Use dataService to add
    // We pass { id: userId } as the requestingUser context for audit logging
    await dataService.addData('operations', operationItem, { id: userId });
  },
  
  downloadRouteBase: '/operations/import/report'
});

module.exports = operationsImportController;