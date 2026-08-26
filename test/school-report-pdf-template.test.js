const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');

const reportPdfRenderService = require('../packages/school/MVC/services/school/reportPdfRenderService');
const reportTemplateModel = require('../packages/school/MVC/models/school/reportTemplateModel');

async function createSamplePdf(filePath) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([420, 240]);
  const form = pdfDoc.getForm();
  [
    ['YN1', 30, 180],
    ['NOTES1', 80, 180],
    ['Students Surname First Name Initial', 30, 130],
    ['Report Date ddmmyyyy', 30, 80]
  ].forEach(([name, x, y]) => {
    const field = form.createTextField(name);
    field.addToPage(page, { x, y, width: 220, height: 24 });
  });
  fs.writeFileSync(filePath, Buffer.from(await pdfDoc.save()));
}

test('PDF template inspection returns AcroForm field names', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-report-pdf-'));
  const pdfPath = path.join(dir, 'sample.pdf');
  await createSamplePdf(pdfPath);

  const inspected = await reportPdfRenderService.inspectPdfTemplateFields({ path: pdfPath });
  const names = inspected.fields.map((field) => field.name).sort();
  assert.deepEqual(names, ['NOTES1', 'Report Date ddmmyyyy', 'Students Surname First Name Initial', 'YN1']);
});

test('PDF renderer fills mapped report values into form fields', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-report-pdf-'));
  const pdfPath = path.join(dir, 'sample.pdf');
  await createSamplePdf(pdfPath);

  const template = {
    id: 'template-1',
    title: 'PDF Test',
    pdfTemplate: { path: pdfPath, fileName: 'sample.pdf' },
    pdfFieldMap: {
      attendance_presence_01: 'YN1',
      attendance_note_01: 'NOTES1',
      student_full_name: 'Students Surname First Name Initial',
      report_period_due_date: 'Report Date ddmmyyyy'
    }
  };
  const instance = {
    id: 'instance-1',
    answers: {},
    prefillSnapshot: { student_full_name: 'Alice Test' }
  };

  const rendered = await reportPdfRenderService.renderReportInstancePdf({
    template,
    instance,
    placeholders: {
      '{{attendance_presence_01}}': 'Y',
      '{{attendance_note_01}}': 'Late Excused - Left Early Excused',
      '{{student_full_name}}': 'Alice Test',
      '{{report_period_due_date}}': '2026-07-31'
    },
    mergedAnswers: {},
    flatten: false
  });

  const filledDoc = await PDFDocument.load(rendered.buffer);
  const form = filledDoc.getForm();
  assert.equal(form.getTextField('YN1').getText(), 'Y');
  assert.equal(form.getTextField('NOTES1').getText(), 'Late Excused - Left Early Excused');
  assert.equal(form.getTextField('Students Surname First Name Initial').getText(), 'Alice Test');
  assert.equal(form.getTextField('Report Date ddmmyyyy').getText(), '31/07/2026');
  assert.deepEqual(rendered.missingFields, []);
});

test('PDF renderer replaces placeholder text already stored in form fields', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-report-pdf-'));
  const pdfPath = path.join(dir, 'sample.pdf');
  await createSamplePdf(pdfPath);

  const templateDoc = await PDFDocument.load(fs.readFileSync(pdfPath));
  const templateForm = templateDoc.getForm();
  templateForm.getTextField('YN1').setText('{{attendance_presence_01}}');
  templateForm.getTextField('NOTES1').setText('{{attendance_note_01}}');
  fs.writeFileSync(pdfPath, Buffer.from(await templateDoc.save()));

  const rendered = await reportPdfRenderService.renderReportInstancePdf({
    template: {
      id: 'template-1',
      title: 'PDF Placeholder Test',
      pdfTemplate: { path: pdfPath, fileName: 'sample.pdf' },
      pdfFieldMap: {}
    },
    instance: { id: 'instance-1', answers: {}, prefillSnapshot: {} },
    placeholders: {
      '{{attendance_presence_01}}': 'N',
      '{{attendance_note_01}}': 'Absent'
    },
    mergedAnswers: {},
    flatten: false
  });

  const filledDoc = await PDFDocument.load(rendered.buffer);
  const form = filledDoc.getForm();
  assert.equal(form.getTextField('YN1').getText(), 'N');
  assert.equal(form.getTextField('NOTES1').getText(), 'Absent');
});

test('report template sanitizer keeps PDF template metadata and explicit field map', () => {
  const sanitized = reportTemplateModel.sanitizeTemplate({
    id: 'RPTTPL-PDF',
    orgId: '900000',
    type: 'overall_attendance',
    version: 1,
    title: 'Overall Attendance PDF',
    status: 'active',
    schema: {
      version: 1,
      fields: [
        { id: 'student_full_name', label: 'Student Name', type: 'text', prefillKey: 'student_full_name' },
        { id: 'attendance_presence_01', label: 'Presence 1', type: 'text', prefillKey: 'attendance_presence_01' },
        { id: '__section', label: 'Section', type: 'section' }
      ]
    },
    placeholderMap: {},
    pdfTemplate: { fileName: 'wcb.pdf', originalName: 'wcb.pdf', path: '/uploads/school-reports/wcb.pdf', url: '/uploads/school-reports/wcb.pdf' },
    pdfTemplatesByFunder: [
      {
        funderKey: 'self',
        label: 'Self Fund',
        pdfTemplate: { fileName: 'self.pdf', originalName: 'self.pdf', path: '/uploads/school-reports/self.pdf', url: '/uploads/school-reports/self.pdf' }
      }
    ],
    pdfFieldMap: {
      student_full_name: 'Students Surname First Name Initial',
      attendance_presence_01: 'YN1',
      __section: 'Ignored'
    }
  });

  assert.equal(sanitized.pdfTemplate.fileName, 'wcb.pdf');
  assert.equal(sanitized.pdfTemplatesByFunder[0].pdfTemplate.fileName, 'self.pdf');
  assert.deepEqual(sanitized.pdfFieldMap, {
    student_full_name: 'Students Surname First Name Initial',
    attendance_presence_01: 'YN1'
  });
});

test('report template repository replaces map objects on Mongo updates', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../packages/school/MVC/repositories/school/index.js'), 'utf8');
  assert.match(source, /replaceObjectFields:\s*\[\s*'placeholderMap'\s*,\s*'pdfFieldMap'\s*\]/);
  assert.match(source, /for \(const field of replaceObjectFields\)/);
});

test('report template form renders PDF field map JSON without HTML entity encoding', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../packages/school/MVC/views/school/report/templateForm.ejs'), 'utf8');
  assert.match(source, /id="pdfFieldMapEditor"[\s\S]*<%- JSON\.stringify\(initialPdfFieldMap, null, 2\)\.replace\(\/<\//);
  assert.doesNotMatch(source, /id="pdfFieldMapEditor"[\s\S]*<%= JSON\.stringify\(initialPdfFieldMap/);
});

test('formatPdfFieldValue formats ISO dates as dd/mm/yyyy for ddmmyyyy field names', () => {
  assert.equal(reportPdfRenderService.formatPdfFieldValue('Date of Birth ddmmyyyy', '1990-05-15'), '15/05/1990');
  assert.equal(reportPdfRenderService.formatPdfFieldValue('Report Date dd/mm/yyyy', '2026-07-31'), '31/07/2026');
  assert.equal(reportPdfRenderService.formatPdfFieldValue('plain_field', '2026-07-31'), '2026-07-31');
});

test('buildPdfFieldMapFromPayload accepts plain objects only', () => {
  const reportViewService = require('../packages/school/MVC/services/school/reportViewService');
  const map = reportViewService.buildPdfFieldMapFromPayload({
    pdfFieldMapJson: JSON.stringify({ attendance_presence_01: 'YN1' })
  });
  assert.deepEqual(map, { attendance_presence_01: 'YN1' });
  assert.deepEqual(reportViewService.buildPdfFieldMapFromPayload({ pdfFieldMapJson: '[]' }), {});
  assert.deepEqual(reportViewService.buildPdfFieldMapFromPayload({ pdfFieldMapJson: '' }), {});
});

test('parsePdfFieldMapText rejects duplicate top-level keys before silent data loss', () => {
  const reportViewService = require('../packages/school/MVC/services/school/reportViewService');
  const duplicateText = [
    '{',
    '  "student_last_name": "s_surname",',
    '  "student_first_name": "s_firstname",',
    '  "student_last_name": "Area Telephone Number 2"',
    '}'
  ].join('\n');
  assert.deepEqual(reportViewService.findDuplicateTopLevelJsonKeys(duplicateText), ['student_last_name']);
  const parsed = reportViewService.parsePdfFieldMapText(duplicateText);
  assert.equal(parsed.map, null);
  assert.deepEqual(parsed.duplicates, ['student_last_name']);
  assert.deepEqual(JSON.parse(duplicateText).student_last_name, 'Area Telephone Number 2');
  const valid = reportViewService.parsePdfFieldMapText('{"student_last_name":"s_surname","student_first_name":"s_firstname"}');
  assert.deepEqual(valid.map, { student_last_name: 's_surname', student_first_name: 's_firstname' });
  assert.deepEqual(valid.duplicates, []);
});
