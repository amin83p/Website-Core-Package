// MVC/controllers/sectionImportController.js
const createImportController = require('./importControllerFactory');
const dataService = require('../services/dataService'); // ✅ Use Data Service
const { validateName } = require('./sectionController');

// Build a consistent section object from a CSV row
async function processSectionRecord(record, context) {
  const { userId } = context || {};
  const now = new Date().toISOString();

  const name = (record.name || '').trim();
  const description = (record.description || '').trim();
  const active =
    String(record.active || '')
      .toLowerCase()
      .trim() === 'true' || record.active === '1';

  const minimumAccessRequirement = parseInt(record.minimumAccessRequirement, 10) || 1;

  // Expecting JSON array in CSV column "operations"
  // Example: [{"id":"OP1001", "active":true, "sessionAttempts":3, "sessionTime":60}]
  let operations = [];
  if (record.operations) {
    try {
      operations = JSON.parse(record.operations);
    } catch (e) {
      console.warn('Failed to parse operations JSON for section:', name);
      operations = [];
    }
  }

  // Validate Name Format (Uppercase/Underscores)
  // Note: Model also validates this, but good to check early
  await validateName(name);

  const section = {
    name,
    description,
    active,
    minimumAccessRequirement,
    operations,
    
    audit: {
      createUser: userId || null,
      createDateTime: now,
      lastUpdateUser: userId || null,
      lastUpdateDateTime: now,
    }
  };

  // Explicitly call the model to save
  //await sectionModel.addSection(section);
  await dataService.addData('sections', section, { id: userId });

  return section;
}

// Build job-level context (e.g. current user)
function buildContext(req) {
  return {
    userId: req.user ? req.user.id : "1",
  };
}

const sectionsImportController = createImportController({
  downloadRouteBase: '/sections/import/report',
  processRecord: processSectionRecord,
  buildContext,
});

module.exports = sectionsImportController;