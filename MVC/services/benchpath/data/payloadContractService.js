const { toPublicId } = require('../../../utils/idAdapter');

function asString(value) {
  return String(value == null ? '' : value).trim();
}

function asNullableString(value) {
  const normalized = asString(value);
  return normalized === '' ? null : normalized;
}

function asBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = asString(value).toLowerCase();
  if (!normalized) return fallback;
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function asInteger(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asFloat(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asStringArray(value, separator = ',') {
  if (Array.isArray(value)) {
    return value.map((entry) => asString(entry)).filter(Boolean);
  }

  const normalized = asString(value);
  if (!normalized) return [];

  return normalized
    .split(separator)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function asJsonArray(value, fallback = []) {
  if (Array.isArray(value)) return value;
  const normalized = asString(value);
  if (!normalized) return fallback;

  try {
    const parsed = JSON.parse(normalized);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function asJsonObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  const normalized = asString(value);
  if (!normalized) return fallback;

  try {
    const parsed = JSON.parse(normalized);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : fallback;
  } catch (_) {
    return fallback;
  }
}

const CONTRACTS = Object.freeze({
  sources: {
    stringArrayFields: ['authors', 'tags', 'usableFor'],
    booleanFields: ['isActive', 'isSystem'],
    integerFields: ['year', 'fileSizeBytes', 'pageCount', 'version'],
    jsonObjectFields: ['extensions']
  },
  sourceFragments: {
    stringArrayFields: ['sectionPath', 'contextTags', 'usageTags', 'mappedEntityIds', 'tags'],
    separators: { sectionPath: '>' },
    booleanFields: ['isDirectQuote', 'isActive', 'isSystem', 'isLocked'],
    integerFields: ['pageStart', 'pageEnd', 'paragraphStart', 'paragraphEnd', 'lineStart', 'lineEnd', 'version'],
    floatFields: ['quoteConfidence'],
    jsonObjectFields: ['extensions']
  },
  clbFrameworks: {
    stringArrayFields: ['authors', 'purpose', 'notIntendedAs', 'stageIds', 'skillIds', 'frameworkFeatures', 'tags'],
    separators: { globalNotes: '\n' },
    additionalStringArrayFields: ['globalNotes'],
    booleanFields: ['isActive', 'isSystem', 'isLocked'],
    integerFields: ['version'],
    jsonArrayFields: ['sourceRefs'],
    jsonObjectFields: ['supportedBenchmarks', 'extensions']
  },
  clbStages: {
    stringArrayFields: ['tags'],
    booleanFields: ['isActive', 'isSystem', 'isLocked'],
    integerFields: ['displayOrder', 'version'],
    jsonArrayFields: ['sourceRefs'],
    jsonObjectFields: ['benchmarkRange', 'extensions']
  },
  clbSkills: {
    stringArrayFields: ['stageIds', 'benchmarkIds', 'competencyAreaIds', 'tags'],
    booleanFields: ['isActive', 'isSystem', 'isLocked'],
    integerFields: ['displayOrder', 'version'],
    jsonArrayFields: ['sourceRefs'],
    jsonObjectFields: ['supportedBenchmarkRange', 'assessmentCharacteristics', 'teachingCharacteristics', 'extensions']
  },
  clbCompetencyAreas: {
    stringArrayFields: ['relatedIds', 'tags', 'communicativeContexts'],
    booleanFields: ['isActive', 'isSystem', 'isLocked'],
    integerFields: ['version'],
    jsonArrayFields: ['sourceRefs'],
    jsonObjectFields: ['extensions']
  },
  clbBenchmarks: {
    stringArrayFields: ['relatedIds', 'tags', 'competencyIds', 'featureIds', 'sampleTaskLabelIds'],
    booleanFields: ['isActive', 'isSystem', 'isLocked'],
    integerFields: ['version', 'benchmarkNumber'],
    jsonArrayFields: ['sourceRefs'],
    jsonObjectFields: ['extensions']
  },
  clbCompetencies: {
    stringArrayFields: ['relatedIds', 'tags', 'indicatorIds', 'featureIds', 'sampleTaskLabelIds'],
    booleanFields: ['isActive', 'isSystem', 'isLocked'],
    integerFields: ['version'],
    jsonArrayFields: ['sourceRefs'],
    jsonObjectFields: ['extensions']
  },
  clbIndicators: {
    stringArrayFields: ['relatedIds', 'tags'],
    booleanFields: ['isActive', 'isSystem', 'isLocked'],
    integerFields: ['version'],
    jsonArrayFields: ['sourceRefs'],
    jsonObjectFields: ['extensions']
  },
  clbProfileOfAbility: {
    stringArrayFields: ['relatedIds', 'tags', 'descriptorDimensions', 'featureIds'],
    booleanFields: ['isActive', 'isSystem', 'isLocked'],
    integerFields: ['version'],
    jsonArrayFields: ['sourceRefs'],
    jsonObjectFields: ['extensions']
  },
  clbFeaturesOfCommunication: {
    stringArrayFields: ['relatedIds', 'tags'],
    booleanFields: ['isActive', 'isSystem', 'isLocked'],
    integerFields: ['version'],
    jsonArrayFields: ['sourceRefs'],
    jsonObjectFields: ['extensions']
  },
  clbSampleTaskLabels: {
    stringArrayFields: ['relatedIds', 'tags'],
    booleanFields: ['isActive', 'isSystem', 'isLocked', 'officialSample'],
    integerFields: ['version'],
    jsonArrayFields: ['sourceRefs'],
    jsonObjectFields: ['extensions']
  },
  benchpathTasks: {
    stringArrayFields: [
      'competencyAreaIds',
      'competencyIds',
      'profileOfAbilityRefs',
      'indicatorIds',
      'featureOfCommunicationIds',
      'sampleTaskLabelIds',
      'tags'
    ],
    booleanFields: ['isActive'],
    integerFields: ['version'],
    jsonArrayFields: ['criteriaForSuccess'],
    jsonObjectFields: [
      'learnerContext',
      'classContext',
      'taskConditions',
      'evidencePlan',
      'rubricDraft',
      'portfolioFit',
      'validation',
      'wizardTrace',
      'extensions'
    ]
  }
});

function getContract(entityType) {
  return CONTRACTS[String(entityType || '')] || null;
}

function normalizeBenchpathPayload(entityType, payload = {}) {
  const contract = getContract(entityType);
  if (!contract) {
    return { ...(payload || {}) };
  }

  const normalized = { ...(payload || {}) };

  const stringArrayFields = [
    ...(Array.isArray(contract.stringArrayFields) ? contract.stringArrayFields : []),
    ...(Array.isArray(contract.additionalStringArrayFields) ? contract.additionalStringArrayFields : [])
  ];

  stringArrayFields.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(normalized, field)) return;
    const separator = contract.separators && contract.separators[field] ? contract.separators[field] : ',';
    normalized[field] = asStringArray(normalized[field], separator);
  });

  (contract.booleanFields || []).forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(normalized, field)) return;
    normalized[field] = asBoolean(normalized[field], false);
  });

  (contract.integerFields || []).forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(normalized, field)) return;
    normalized[field] = asInteger(normalized[field], null);
  });

  (contract.floatFields || []).forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(normalized, field)) return;
    normalized[field] = asFloat(normalized[field], null);
  });

  (contract.jsonArrayFields || []).forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(normalized, field)) return;
    normalized[field] = asJsonArray(normalized[field], []);
  });

  (contract.jsonObjectFields || []).forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(normalized, field)) return;
    normalized[field] = asJsonObject(normalized[field], {});
  });

  if (Object.prototype.hasOwnProperty.call(normalized, 'orgId')) {
    normalized.orgId = toPublicId(normalized.orgId) || asString(normalized.orgId) || 'SYSTEM';
  }

  return normalized;
}

function validateBenchpathPayloadShape(entityType, payload = {}, phase = 'write') {
  const contract = getContract(entityType);
  if (!contract) return [];

  const errors = [];

  const requireType = (condition, message) => {
    if (!condition) errors.push(`${phase} shape: ${message}`);
  };

  (contract.stringArrayFields || []).forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) return;
    requireType(Array.isArray(payload[field]), `${field} must be an array.`);
  });

  (contract.additionalStringArrayFields || []).forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) return;
    requireType(Array.isArray(payload[field]), `${field} must be an array.`);
  });

  (contract.booleanFields || []).forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) return;
    requireType(typeof payload[field] === 'boolean', `${field} must be a boolean.`);
  });

  (contract.integerFields || []).forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) return;
    const value = payload[field];
    requireType(value === null || Number.isInteger(value), `${field} must be an integer or null.`);
  });

  (contract.floatFields || []).forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) return;
    const value = payload[field];
    requireType(value === null || typeof value === 'number', `${field} must be a number or null.`);
  });

  (contract.jsonArrayFields || []).forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) return;
    requireType(Array.isArray(payload[field]), `${field} must be an array.`);
  });

  (contract.jsonObjectFields || []).forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) return;
    const value = payload[field];
    requireType(value && typeof value === 'object' && !Array.isArray(value), `${field} must be an object.`);
  });

  return errors;
}

function deriveSourceSnapshotFields(sourceRecord = null) {
  if (!sourceRecord || typeof sourceRecord !== 'object') {
    return {
      sourceType: null,
      authorityLevel: null,
      framework: null
    };
  }

  return {
    sourceType: asNullableString(sourceRecord.sourceType),
    authorityLevel: asNullableString(sourceRecord.authorityLevel),
    framework: asNullableString(sourceRecord.framework)
  };
}

module.exports = {
  CONTRACTS,
  getContract,
  normalizeBenchpathPayload,
  validateBenchpathPayloadShape,
  deriveSourceSnapshotFields
};
