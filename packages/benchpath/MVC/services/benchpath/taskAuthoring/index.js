const { generateTaskDraft } = require('./taskWizardService');
const { validateTaskDraft } = require('./taskValidationService');
const { generateRubricDraft } = require('./rubricGenerationService');
const { classifyPortfolioFit } = require('./portfolioFitService');
const { generateTaskPackage, buildTaskReadiness } = require('./taskPackagingService');
const taskWizardFlow = require('./taskWizardFlowService');

module.exports = {
  generateTaskDraft,
  validateTaskDraft,
  generateRubricDraft,
  classifyPortfolioFit,
  generateTaskPackage,
  buildTaskReadiness,
  ...taskWizardFlow
};
