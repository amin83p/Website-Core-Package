const test = require('node:test');
const assert = require('node:assert/strict');

const reportTemplateModel = require('../MVC/models/school/reportTemplateModel');
const reportFunderDocxService = require('../MVC/services/school/reportFunderDocxService');
const reportDocxRenderService = require('../MVC/services/school/reportDocxRenderService');

test('sanitizeDocxTemplatesByFunder keeps unique funder mappings and files', () => {
  const rows = reportTemplateModel.sanitizeDocxTemplatesByFunder([
    {
      funderKey: 'self',
      label: 'Self Fund',
      docxTemplate: { fileName: 'self.docx', path: '/uploads/self.docx', url: '/uploads/self.docx' }
    },
    {
      funderKey: 'FUN_1',
      label: 'IRCC',
      docxTemplate: { fileName: 'ircc.docx', path: '/uploads/ircc.docx', url: '/uploads/ircc.docx' }
    },
    {
      funderKey: 'FUN_1',
      label: 'Duplicate',
      docxTemplate: { fileName: 'dup.docx', path: '/uploads/dup.docx', url: '/uploads/dup.docx' }
    }
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].funderKey, 'self');
  assert.equal(rows[1].funderKey, 'FUN_1');
  assert.equal(rows[1].label, 'IRCC');
});

test('resolveDocxTemplateForFunder falls back to default template', () => {
  const template = {
    docxTemplate: { fileName: 'default.docx', path: '/uploads/default.docx' },
    docxTemplatesByFunder: [
      {
        funderKey: 'FUN_1',
        label: 'IRCC',
        docxTemplate: { fileName: 'ircc.docx', path: '/uploads/ircc.docx' }
      }
    ]
  };
  assert.equal(
    reportFunderDocxService.resolveDocxTemplateForFunder({ template, funderKey: 'FUN_1' }).docxTemplate.fileName,
    'ircc.docx'
  );
  assert.equal(
    reportFunderDocxService.resolveDocxTemplateForFunder({ template, funderKey: 'self' }).docxKey,
    'default'
  );
  assert.equal(
    reportFunderDocxService.suggestDocxKeyForFunder({ template, funderKey: 'FUN_1' }),
    'FUN_1'
  );
  assert.equal(
    reportFunderDocxService.suggestDocxKeyForFunder({ template, funderKey: 'missing' }),
    'default'
  );
});

test('resolveEnrollmentClaimNumberForReportPeriod resolves claimNumberId from student profile', () => {
  const periods = [{
    studentId: 'stu1',
    startDate: '2026-10-01',
    endDate: '2026-12-31',
    claimNumberId: 'CLM-WCB',
    claimNumber: ''
  }];
  const studentRecord = {
    id: 'stu1',
    claimNumbers: [{ id: 'CLM-WCB', number: 'WCB-998877', label: 'WCB' }]
  };
  const resolved = reportFunderDocxService.resolveEnrollmentClaimNumberForReportPeriod({
    periodRows: periods,
    studentId: 'stu1',
    windowStart: '2026-10-15',
    windowEnd: '2026-10-29',
    studentRecord
  });
  assert.equal(resolved, 'WCB-998877');
});

test('resolveStudentFunderForReportPeriod picks latest overlapping enrollment funder', () => {
  const periods = [
    {
      studentId: 'stu1',
      startDate: '2026-01-01',
      endDate: '2026-03-31',
      funderType: 'self',
      funderId: 'self'
    },
    {
      studentId: 'stu1',
      startDate: '2026-04-01',
      endDate: '2026-12-31',
      funderType: 'funder',
      funderId: 'FUN_9'
    }
  ];
  const resolved = reportFunderDocxService.resolveStudentFunderForReportPeriod({
    periodRows: periods,
    studentId: 'stu1',
    windowStart: '2026-05-01',
    windowEnd: '2026-05-31'
  });
  assert.equal(resolved.funderKey, 'FUN_9');
  assert.equal(resolved.funderType, 'funder');
});

test('zipReportInstanceDocxFiles packs named buffers', async () => {
  const zipBuffer = await reportDocxRenderService.zipReportInstanceDocxFiles([
    { fileName: 'Ada_report.docx', buffer: Buffer.from('one') },
    { fileName: 'Bob_report.docx', buffer: Buffer.from('two') }
  ]);
  assert.ok(Buffer.isBuffer(zipBuffer));
  assert.ok(zipBuffer.length > 20);
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(zipBuffer);
  assert.ok(zip.file('Ada_report.docx'));
  assert.ok(zip.file('Bob_report.docx'));
});
