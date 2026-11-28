const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PKG_ROOT = path.resolve(__dirname, '..');
const ROOT = path.resolve(__dirname, '..', '..', '..');

function readPkg(rel) {
  return fs.readFileSync(path.join(PKG_ROOT, rel), 'utf8');
}

const previewService = require(path.join(PKG_ROOT, 'MVC/services/school/holidayAiObservancePreviewService'));
const batchService = require(path.join(PKG_ROOT, 'MVC/services/school/holidayAiObservanceBatchService'));
const { getAiServiceByKey } = require(path.join(PKG_ROOT, 'MVC/config/schoolAiServiceRegistry'));

test('preview expands inclusive date range to daily rows', () => {
  const out = previewService.buildPreviewFromAiOccasions({
    year: '2026',
    aiOccasions: [{
      name: 'Sample Fest',
      startDate: '2026-03-01',
      endDate: '2026-03-03',
      confidence: 'high',
      notes: 'test'
    }],
    existingHolidays: []
  });
  assert.equal(out.previewItems.length, 3);
  assert.equal(out.previewItems[0].date, '2026-03-01');
  assert.equal(out.previewItems[2].date, '2026-03-03');
  assert.equal(out.previewItems[0].selected, true);
});

test('preview marks duplicate org date+title', () => {
  const out = previewService.buildPreviewFromAiOccasions({
    year: '2026',
    aiOccasions: [{
      name: 'Diwali',
      startDate: '2026-11-10',
      endDate: '2026-11-10',
      confidence: 'medium'
    }],
    existingHolidays: [{ date: '2026-11-10', title: 'Diwali', orgId: 'ORG1' }]
  });
  assert.equal(out.previewItems.length, 1);
  assert.equal(out.previewItems[0].duplicate, true);
  assert.equal(out.previewItems[0].selected, false);
});

test('buildUndoSummary finds latest applied batch', () => {
  const summary = batchService.buildUndoSummary({
    aiBatches: [
      { batchId: 'A', status: 'undone', holidayIds: ['H1'] },
      { batchId: 'B', status: 'applied', holidayIds: ['H2', 'H3'] }
    ]
  });
  assert.equal(summary.canUndo, true);
  assert.equal(summary.batch.batchId, 'B');
  assert.equal(summary.batch.holidayCount, 2);
});

test('registry and routes expose holiday cultural observances service', () => {
  const svc = getAiServiceByKey('school.holiday_cultural_observances');
  assert.ok(svc);
  assert.equal(svc.status, 'implemented');
  const routes = readPkg('MVC/routes/holidayRoutes.js');
  assert.match(routes, /ai-observances\/analyze/);
  assert.match(routes, /ai-observances\/apply/);
  assert.match(routes, /ai-observances\/undo-last/);
  const view = readPkg('MVC/views/school/holiday/holidays.ejs');
  assert.match(view, /holidayAiObservancesModal/);
  assert.match(view, /btnOpenHolidayAiObservances/);
  assert.match(view, /ai-observances\/analyze/);
  assert.match(view, /holidayAiUndoReviewModal/);
  assert.match(view, /btnHolidayAiReviewUndo/);
});

test('sanitizeBatch keeps importedRows snapshot', () => {
  const model = require(path.join(PKG_ROOT, 'MVC/models/school/holidayYearCalendarStateModel'));
  const batch = model.sanitizeBatch({
    batchId: 'HYB-TEST',
    status: 'applied',
    holidayIds: ['H1'],
    importedRows: [{ holidayId: 'H1', date: '2026-05-01', title: 'Sample Day' }]
  });
  assert.equal(batch.importedRows.length, 1);
  assert.equal(batch.importedRows[0].title, 'Sample Day');
});

test('preset file exists for school.holiday_cultural_observances', () => {
  const { getDefinitionPreset } = require(path.join(PKG_ROOT, 'MVC/config/schoolAiServiceDefinitionPresets'));
  const preset = getDefinitionPreset('school.holiday_cultural_observances');
  assert.ok(preset?.output?.jsonSchema?.properties?.occasions);
});