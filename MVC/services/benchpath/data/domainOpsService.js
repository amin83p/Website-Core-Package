const sourceModel = require('../../../models/benchpath/sourceModel');
const sourceFragmentModel = require('../../../models/benchpath/sourceFragmentModel');
const clbFrameworkModel = require('../../../models/benchpath/clbFrameworkModel');
const clbStageModel = require('../../../models/benchpath/clbStageModel');
const clbSkillModel = require('../../../models/benchpath/clbSkillModel');
const referenceCatalogModel = require('../../../models/benchpath/referenceCatalogModel');
const {
  runBenchpathMigrationDryRunReport,
  applyBenchpathNormalizationMigration,
  writeBenchpathMigrationDryRunReport
} = require('./migrationDryRunService');

const domainOpsService = {
  getSourceFormMeta() {
    return {
      requiredFields: sourceModel.REQUIRED_CREATE_FIELDS,
      sourceTypeOptions: sourceModel.SOURCE_TYPES,
      authorityLevelOptions: sourceModel.AUTHORITY_LEVELS,
      languageOptions: sourceModel.LANGUAGES,
      usageRightsOptions: sourceModel.USAGE_RIGHTS,
      usableForOptions: sourceModel.USABLE_FOR,
      statusOptions: sourceModel.STATUSES,
      reviewStatusOptions: sourceModel.REVIEW_STATUSES,
      extractionStatusOptions: sourceModel.EXTRACTION_STATUSES,
      fileExtensionOptions: sourceModel.FILE_EXTENSIONS
    };
  },

  getSourceFragmentFormMeta() {
    return {
      fragmentTypeOptions: sourceFragmentModel.FRAGMENT_TYPES,
      languageOptions: sourceFragmentModel.LANGUAGES,
      usageTagOptions: sourceFragmentModel.USAGE_TAGS,
      reviewStatusOptions: sourceFragmentModel.REVIEW_STATUSES,
      statusOptions: sourceFragmentModel.STATUSES,
      semanticRoleOptions: sourceFragmentModel.SEMANTIC_ROLES,
      extractionMethodOptions: sourceFragmentModel.EXTRACTION_METHODS,
      mappedEntityTypeOptions: sourceFragmentModel.MAPPED_ENTITY_TYPES
    };
  },

  getFrameworkFormMeta() {
    return {
      frameworkTypeOptions: clbFrameworkModel.FRAMEWORK_TYPES,
      languageOptions: clbFrameworkModel.LANGUAGES,
      purposeOptions: clbFrameworkModel.PURPOSE_OPTIONS,
      notIntendedOptions: clbFrameworkModel.NOT_INTENDED_OPTIONS,
      frameworkFeatureOptions: clbFrameworkModel.FRAMEWORK_FEATURES,
      statusOptions: clbFrameworkModel.RECORD_STATUSES,
      reviewStatusOptions: clbFrameworkModel.REVIEW_STATUSES
    };
  },

  getStageFormMeta() {
    return {
      statusOptions: clbStageModel.RECORD_STATUSES,
      reviewStatusOptions: clbStageModel.REVIEW_STATUSES,
      descriptorOptions: clbStageModel.DESCRIPTORS
    };
  },

  getSkillFormMeta() {
    return {
      modalityOptions: clbSkillModel.MODALITY_OPTIONS,
      statusOptions: clbSkillModel.RECORD_STATUSES,
      reviewStatusOptions: clbSkillModel.REVIEW_STATUSES,
      evidenceModeOptions: clbSkillModel.EVIDENCE_MODES,
      assessmentApproachOptions: clbSkillModel.ASSESSMENT_APPROACHES
    };
  },

  getReferenceEntityDef(entityKey) {
    return referenceCatalogModel.getDef(entityKey);
  },

  getReferenceFormMeta() {
    return {
      statusOptions: referenceCatalogModel.STATUSES,
      reviewStatusOptions: referenceCatalogModel.REVIEW_STATUSES
    };
  },

  runMigrationDryRunReport(options = {}) {
    return runBenchpathMigrationDryRunReport(options);
  },

  applyNormalizationMigration(options = {}) {
    return applyBenchpathNormalizationMigration(options);
  },

  writeMigrationDryRunReport(report, outputPath) {
    return writeBenchpathMigrationDryRunReport(report, outputPath);
  }
};

module.exports = domainOpsService;
