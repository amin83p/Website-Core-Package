// MVC/controllers/accessImportController.js
const createImportController = require('./importControllerFactory');
const dataService = require('../services/dataService'); // ✅ Use Data Service

const accessImportController = createImportController({
  validateRecord: record => {
    if (!record.name) throw new Error('Name is required');
  },
  
  processRecord: async (record, context) => {
    const now = new Date().toISOString();
    // Context usually comes from the import factory (req.user)
    const userId = context && context.userId ? context.userId : "1";

    let name = record.name.trim().toUpperCase().replace(/\s+/g, '_');
    
    let sections = [];
    if (record.sections_json) {
        try { sections = JSON.parse(record.sections_json); } catch {}
    }

    const accessItem = {
      name: name,
      description: (record.description || '').trim(),
      active: String(record.active).toLowerCase() === 'true' || record.active === '1',
      validity: { startDate: null, endDate: null }, // Default open validity
      sections,
      audit: {
        createUser: userId,
        createDateTime: now,
        lastUpdateUser: userId,
        lastUpdateDateTime: now
      }
    };

    // ✅ Use dataService to add
    // We pass { id: userId } as the requestingUser object so dataService can log it if needed
    await dataService.addData('accesses', accessItem, { id: userId });
  },
  
  downloadRouteBase: '/accesses/import/report'
});

module.exports = accessImportController;