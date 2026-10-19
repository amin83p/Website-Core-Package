const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');

const ROOT_DIR = path.resolve(__dirname, '..');
const overallReportService = require('../MVC/services/school/overallReportService');
const reportPdfRenderService = require('../MVC/services/school/reportPdfRenderService');
const studentAttendanceReportGenerationService = require('../MVC/services/school/studentAttendanceReportGenerationService');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function sampleOverallTemplateWithFunders() {
  return {
    id: 'overall-1',
    title: 'Overall Template',
    docxTemplate: { path: '/tmp/default.docx', originalName: 'default.docx' },
    pdfTemplate: { path: '/tmp/default.pdf', originalName: 'default.pdf' },
    docxTemplatesByFunder: [{
      funderKey: 'funder-a',
      label: 'Funder A',
      docxTemplate: { path: '/tmp/funder-a.docx', originalName: 'funder-a.docx' }
    }],
    pdfTemplatesByFunder: [{
      funderKey: 'funder-a',
      label: 'Funder A',
      pdfTemplate: { path: '/tmp/funder-a.pdf', originalName: 'funder-a.pdf' }
    }]
  };
}

test('buildOverallTemplateVariantOptions unions default and funder keys', () => {
  const template = sampleOverallTemplateWithFunders();
  const options = overallReportService.buildOverallTemplateVariantOptions(template);
  assert.equal(options.length, 2);
  const keys = options.map((row) => row.key).sort();
  assert.deepEqual(keys, ['default', 'funder-a']);
  const funderRow = options.find((row) => row.key === 'funder-a');
  assert.equal(funderRow.label, 'Funder A');
  assert.equal(funderRow.hasDocx, true);
  assert.equal(funderRow.hasPdf, true);
});

test('suggestOverallTemplateVariantKeys prefers mapped funder template', () => {
  const template = sampleOverallTemplateWithFunders();
  const suggested = overallReportService.suggestOverallTemplateVariantKeys(template, 'funder-a');
  assert.equal(suggested.suggestedDocxKey, 'funder-a');
  assert.equal(suggested.suggestedPdfKey, 'funder-a');
  assert.equal(suggested.suggestedTemplateVariantKey, 'funder-a');
});

test('resolveOverallTemplateVariantKey validates against available options', () => {
  const template = sampleOverallTemplateWithFunders();
  assert.equal(
    overallReportService.resolveOverallTemplateVariantKey(template, 'funder-a', 'default'),
    'funder-a'
  );
  assert.equal(
    overallReportService.resolveOverallTemplateVariantKey(template, 'missing-key', 'default'),
    'default'
  );
});

test('mergeReportInstancePdfBuffers combines multiple PDFs', async () => {
  async function onePagePdf() {
    const doc = await PDFDocument.create();
    doc.addPage();
    return Buffer.from(await doc.save());
  }
  const first = await onePagePdf();
  const second = await onePagePdf();
  const merged = await reportPdfRenderService.mergeReportInstancePdfBuffers([first, second]);
  assert.ok(Buffer.isBuffer(merged));
  const parsed = await PDFDocument.load(merged);
  assert.equal(parsed.getPageCount(), 2);
});

test('bundleExportFiles merges overall PDFs when mergeDocuments is set', async () => {
  async function onePagePdf() {
    const doc = await PDFDocument.create();
    doc.addPage();
    return Buffer.from(await doc.save());
  }
  const buffer = await onePagePdf();
  const files = [
    { buffer, fileName: 'a.pdf', contentType: 'application/pdf' },
    { buffer, fileName: 'b.pdf', contentType: 'application/pdf' }
  ];
  const result = await studentAttendanceReportGenerationService.bundleExportFiles(
    files,
    'pdf',
    '2026-01-01',
    '2026-01-31',
    { mergeDocuments: true }
  );
  assert.equal(result.contentType, 'application/pdf');
  assert.match(result.fileName, /student_attendance_overall_reports_/);
  const parsed = await PDFDocument.load(result.buffer);
  assert.equal(parsed.getPageCount(), 2);
});

test('export viewers include overall variant select and bundleMode wiring', () => {
  const sarViewer = read('MVC/views/school/attendance/studentAttendanceReportViewer.ejs');
  const smmrViewer = read('MVC/views/school/report/semiMonthlyReportViewer.ejs');
  assert.match(sarViewer, /js-sar-overall-variant-select/);
  assert.match(sarViewer, /templateVariantKey/);
  assert.match(sarViewer, /bundleMode/);
  assert.match(smmrViewer, /js-smmr-overall-variant-select/);
  assert.match(smmrViewer, /templateVariantKey/);
  assert.match(smmrViewer, /bundleMode/);
});

test('export services pass templateVariantKey and bundleMode merge', () => {
  const sarService = read('MVC/services/school/studentAttendanceReportGenerationService.js');
  const smmrService = read('MVC/services/school/schoolSemiMonthlyReportExportService.js');
  assert.match(sarService, /templateVariantKey/);
  assert.match(sarService, /mergeDocuments/);
  assert.match(sarService, /selectedDocxKey: variantKey/);
  assert.match(smmrService, /templateVariantKey/);
  assert.match(smmrService, /mergeDocuments/);
});
