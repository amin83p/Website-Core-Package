const test = require('node:test');
const assert = require('node:assert/strict');

const { validateSarRawSnapshot, SAR_RAW_SNAPSHOT_VERSION } = require('../MVC/services/school/sarRawSnapshotSchema');
const { validateRenderBundle } = require('../MVC/services/school/sarLocalRenderBundleSchema');

test('validateSarRawSnapshot accepts minimal shape', () => {
  const snapshot = {
    schemaVersion: SAR_RAW_SNAPSHOT_VERSION,
    manifest: {
      orgId: 'org-1',
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      studentCount: 1
    },
    matrix: { students: [{ personId: 's1', name: 'Student', classes: [] }] },
    exportPlan: { students: [{ personId: 's1', name: 'Student', classes: [] }] },
    reportTemplatesById: { 'tpl-1': { id: 'tpl-1', title: 'Class tpl' } },
    classMatrixPayloadsByClassId: {},
    policy: { reportTemplateId: 'tpl-1' }
  };
  assert.equal(validateSarRawSnapshot(snapshot), true);
});

test('validateRenderBundle accepts virtual bundle from snapshot prepare shape', () => {
  const bundle = {
    schemaVersion: 1,
    renderCoreVersion: 1,
    manifest: {
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      targetCount: 1,
      mergePolicy: { mode: 'single', outputStem: 'test' }
    },
    templates: {
      'tpl-1|default': {
        templateId: 'tpl-1',
        variantKey: 'default',
        dataBase64: Buffer.from('dGVzdA==', 'base64').toString('base64')
      }
    },
    targets: [{
      templateRefKey: 'tpl-1|default',
      fileName: 'a.docx',
      placeholders: { student_name: 'A' },
      collections: {}
    }]
  };
  assert.equal(validateRenderBundle(bundle), true);
});
