const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { flattenInstanceRows } = require('../MVC/services/school/schoolSemiMonthlyReportExportService');

const pkgRoot = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(pkgRoot, relPath), 'utf8');
}

test('flattenInstanceRows carries assignmentId and per-template file options', () => {
  const policy = { reportTemplateIds: ['tpl-1'], templateExportFormats: {} };
  const templateMetaMap = new Map([[
    'tpl-1',
    {
      templateTitle: 'Attendance',
      hasDocx: true,
      hasPdf: true,
      hasPayload: true,
      docxOptions: [{ key: 'default', label: 'Default', fileName: 'base.docx' }],
      pdfOptions: [{ key: 'default', label: 'Default', fileName: 'base.pdf' }]
    }
  ]]);
  const rows = flattenInstanceRows({
    personId: 'person-1',
    classes: [{
      classId: 'class-1',
      className: 'Morning',
      instances: [{
        id: 'inst-1',
        templateId: 'tpl-1',
        assignmentId: 'asgn-1',
        sessionDate: '2026-01-10',
        status: 'draft'
      }]
    }]
  }, templateMetaMap, policy);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].instanceId, 'inst-1');
  assert.equal(rows[0].assignmentId, 'asgn-1');
  assert.equal(rows[0].docxOptions[0].key, 'default');
  assert.equal(rows[0].pdfOptions[0].fileName, 'base.pdf');
  assert.equal(rows[0].exportable, true);
});

test('semi-monthly export service passes docxKey and pdfKey into stored instance export', () => {
  const service = read('MVC/services/school/schoolSemiMonthlyReportExportService.js');
  assert.match(service, /enrichInstanceRowsForExport/);
  assert.match(service, /suggestedDocxKey/);
  assert.match(service, /suggestedPdfKey/);
  assert.match(service, /options\.docxKey/);
  assert.match(service, /options\.pdfKey/);
  assert.match(service, /target\?\.docxKey/);
});
