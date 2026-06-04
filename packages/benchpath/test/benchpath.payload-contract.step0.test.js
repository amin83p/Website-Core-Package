const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeBenchpathPayload,
  validateBenchpathPayloadShape,
  deriveSourceSnapshotFields
} = require('../MVC/services/benchpath/data/payloadContractService');

test('sources fixture normalizes write shape', () => {
  const payload = {
    id: 'source:clb:2012',
    authors: 'Centre A, Centre B',
    tags: ['official', 'clb'],
    usableFor: 'reference_extraction,citation',
    isActive: 'true',
    isSystem: '0',
    year: '2012',
    fileSizeBytes: '100',
    pageCount: '',
    version: '3',
    extensions: '{"checksumVerified":true}'
  };

  const normalized = normalizeBenchpathPayload('sources', payload);
  const errors = validateBenchpathPayloadShape('sources', normalized, 'write');

  assert.deepEqual(normalized.authors, ['Centre A', 'Centre B']);
  assert.deepEqual(normalized.usableFor, ['reference_extraction', 'citation']);
  assert.equal(normalized.isActive, true);
  assert.equal(normalized.isSystem, false);
  assert.equal(normalized.year, 2012);
  assert.equal(normalized.fileSizeBytes, 100);
  assert.equal(normalized.pageCount, null);
  assert.equal(normalized.version, 3);
  assert.equal(typeof normalized.extensions, 'object');
  assert.equal(Array.isArray(normalized.extensions), false);
  assert.equal(errors.length, 0);
});

test('sourceFragments fixture normalizes JSON-string and list inputs', () => {
  const payload = {
    sourceId: 'source:clb:2012',
    sectionPath: 'Introduction > General Description',
    contextTags: 'framework_definition,official_reference',
    usageTags: ['reference_extraction', 'citation'],
    mappedEntityIds: 'framework:clb,benchmark:listening:1',
    isDirectQuote: 'false',
    isActive: '1',
    isSystem: '',
    isLocked: '0',
    pageStart: '5',
    pageEnd: '6',
    quoteConfidence: '0.85',
    extensions: '{"uiColor":"#fff"}'
  };

  const normalized = normalizeBenchpathPayload('sourceFragments', payload);
  const errors = validateBenchpathPayloadShape('sourceFragments', normalized, 'write');

  assert.deepEqual(normalized.sectionPath, ['Introduction', 'General Description']);
  assert.deepEqual(normalized.contextTags, ['framework_definition', 'official_reference']);
  assert.deepEqual(normalized.mappedEntityIds, ['framework:clb', 'benchmark:listening:1']);
  assert.equal(normalized.isDirectQuote, false);
  assert.equal(normalized.isActive, true);
  assert.equal(normalized.isSystem, false);
  assert.equal(normalized.isLocked, false);
  assert.equal(normalized.pageStart, 5);
  assert.equal(normalized.pageEnd, 6);
  assert.equal(normalized.quoteConfidence, 0.85);
  assert.equal(typeof normalized.extensions, 'object');
  assert.equal(errors.length, 0);
});

test('clbSkills fixture normalizes structured JSON strings', () => {
  const payload = {
    stageIds: 'stage:1,stage:2,stage:3',
    benchmarkIds: 'benchmark:listening:1,benchmark:listening:2',
    competencyAreaIds: 'ca:listening:interacting_with_others',
    tags: 'official,skill,listening',
    supportedBenchmarkRange: '{"minimum":1,"maximum":12,"totalCount":12}',
    assessmentCharacteristics: '{"primaryEvidenceModes":["audio"],"defaultAssessmentApproach":"criterion_referenced"}',
    teachingCharacteristics: '{"taskBased":true}',
    sourceRefs: '[{"sourceId":"source:clb:2012"}]',
    isActive: 'true',
    isSystem: 'false',
    isLocked: '0',
    displayOrder: '1',
    version: '2'
  };

  const normalized = normalizeBenchpathPayload('clbSkills', payload);
  const errors = validateBenchpathPayloadShape('clbSkills', normalized, 'write');

  assert.deepEqual(normalized.stageIds, ['stage:1', 'stage:2', 'stage:3']);
  assert.deepEqual(normalized.benchmarkIds, ['benchmark:listening:1', 'benchmark:listening:2']);
  assert.equal(Array.isArray(normalized.sourceRefs), true);
  assert.equal(typeof normalized.supportedBenchmarkRange, 'object');
  assert.equal(typeof normalized.assessmentCharacteristics, 'object');
  assert.equal(typeof normalized.teachingCharacteristics, 'object');
  assert.equal(normalized.isActive, true);
  assert.equal(normalized.displayOrder, 1);
  assert.equal(normalized.version, 2);
  assert.equal(errors.length, 0);
});

test('shape gate rejects non-canonical array/boolean types', () => {
  const invalid = {
    usableFor: 'reference_extraction',
    isActive: 'true'
  };

  const errors = validateBenchpathPayloadShape('sources', invalid, 'write');
  assert.equal(errors.length >= 2, true);
});

test('deriveSourceSnapshotFields returns canonical nullable snapshot', () => {
  const snapshot = deriveSourceSnapshotFields({
    sourceType: 'official_standard',
    authorityLevel: 'official',
    framework: 'CLB'
  });

  assert.deepEqual(snapshot, {
    sourceType: 'official_standard',
    authorityLevel: 'official',
    framework: 'CLB'
  });

  const empty = deriveSourceSnapshotFields(null);
  assert.deepEqual(empty, {
    sourceType: null,
    authorityLevel: null,
    framework: null
  });
});
