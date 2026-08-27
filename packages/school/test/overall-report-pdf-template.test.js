const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const overallReportTemplateModel = require('../MVC/models/school/overallReportTemplateModel');
const overallReportInstanceModel = require('../MVC/models/school/overallReportInstanceModel');
const overallReportService = require('../MVC/services/school/overallReportService');
const reportFunderPdfService = require('../MVC/services/school/reportFunderPdfService');
const reportViewService = require('../MVC/services/school/reportViewService');

const overallTemplateFormPath = path.join(
  __dirname,
  '../MVC/views/school/report/overallTemplateForm.ejs'
);

test('overallReportTemplateModel.sanitizeTemplate persists pdf template fields', () => {
  const sanitized = overallReportTemplateModel.sanitizeTemplate({
    orgId: 'ORG-1',
    title: 'Overall With PDF',
    status: 'active',
    sourceSlots: [{
      slotKey: 'T1',
      templateId: 'RPT-1',
      templateTitle: 'Source',
      requirement: 'necessary',
      order: 1
    }],
    schema: {
      version: 1,
      fields: [{
        id: 'attendance',
        label: 'Attendance',
        type: 'text',
        overallValueMode: 'manual'
      }]
    },
    pdfTemplate: {
      fileName: 'default.pdf',
      path: '/uploads/school-reports/default.pdf',
      url: '/uploads/school-reports/default.pdf'
    },
    pdfTemplatesByFunder: [{
      funderKey: 'FUN_1',
      label: 'IRCC',
      pdfTemplate: {
        fileName: 'ircc.pdf',
        path: '/uploads/school-reports/ircc.pdf',
        url: '/uploads/school-reports/ircc.pdf'
      }
    }],
    pdfFieldMap: {
      'O.attendance': 'AttendanceField'
    }
  });

  assert.equal(sanitized.pdfTemplate.fileName, 'default.pdf');
  assert.equal(sanitized.pdfTemplatesByFunder.length, 1);
  assert.equal(sanitized.pdfTemplatesByFunder[0].funderKey, 'FUN_1');
  assert.deepEqual(sanitized.pdfFieldMap, { 'O.attendance': 'AttendanceField' });
});

test('reportViewService.buildPdfFieldMapFromPayload parses hidden json field', () => {
  const map = reportViewService.buildPdfFieldMapFromPayload({
    pdfFieldMapJson: JSON.stringify({ 'O.student_name': 'StudentName' })
  });
  assert.deepEqual(map, { 'O.student_name': 'StudentName' });
});

test('overallReportService.resolveSelectedPdfKey resolves funder pdf mapping', () => {
  const template = {
    pdfTemplate: { fileName: 'default.pdf', path: '/uploads/default.pdf' },
    pdfTemplatesByFunder: [{
      funderKey: 'FUN_1',
      label: 'IRCC',
      pdfTemplate: { fileName: 'ircc.pdf', path: '/uploads/ircc.pdf' }
    }]
  };
  const resolved = overallReportService.resolveSelectedPdfKey(template, 'FUN_1', { allowMissingPdf: false });
  assert.equal(resolved.pdfKey, 'FUN_1');
  assert.equal(resolved.pdfTemplate.fileName, 'ircc.pdf');
  assert.equal(
    reportFunderPdfService.buildAvailablePdfOptions(template).length,
    2
  );
});

test('overallReportInstanceModel stores selectedPdfKey and generated pdfKey', () => {
  const instance = overallReportInstanceModel.sanitizeInstance({
    orgId: 'ORG-1',
    overallTemplateId: 'OVRTPL-1',
    title: 'Test',
    status: 'draft',
    selectedDocxKey: 'default',
    selectedPdfKey: 'FUN_1',
    templateSnapshot: {
      id: 'OVRTPL-1',
      schema: { version: 1, fields: [] },
      sourceSlots: [{
        slotKey: 'T1',
        templateId: 'RPT-1',
        templateTitle: 'Source',
        requirement: 'necessary',
        order: 1
      }]
    },
    sourceSelections: [{
      slotKey: 'T1',
      templateId: 'RPT-1',
      instanceId: 'INST-1'
    }],
    generatedDocs: [{
      fileName: 'student.pdf',
      path: '/uploads/student.pdf',
      pdfKey: 'FUN_1'
    }]
  });
  assert.equal(instance.selectedPdfKey, 'FUN_1');
  assert.equal(instance.generatedDocs[0].pdfKey, 'FUN_1');
});

test('overallTemplateForm includes PDF template designer section', () => {
  const view = fs.readFileSync(overallTemplateFormPath, 'utf8');
  assert.match(view, /PDF Templates/);
  assert.match(view, /name="pdfTemplate"/);
  assert.match(view, /funderPdfKeys/);
  assert.match(view, /pdfFieldMapEditor/);
  assert.match(view, /btnInspectPdfFields/);
  assert.match(view, /overall-templates\/.*pdf-fields/);
});
