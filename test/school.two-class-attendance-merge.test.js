const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');

const mergeService = require('../packages/school/MVC/services/school/twoClassAttendanceMergeService');
const overallTemplateModel = require('../packages/school/MVC/models/school/overallReportTemplateModel');
const overallReportService = require('../packages/school/MVC/services/school/overallReportService');
const reportPdfRenderService = require('../packages/school/MVC/services/school/reportPdfRenderService');

async function createTwoClassSamplePdf(filePath) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([420, 240]);
  const form = pdfDoc.getForm();
  [['YN1', 30, 180], ['NOTES1', 80, 180]].forEach(([name, x, y]) => {
    const field = form.createTextField(name);
    field.addToPage(page, { x, y, width: 220, height: 24 });
  });
  fs.writeFileSync(filePath, Buffer.from(await pdfDoc.save()));
}

test('mergeTwoClassPresence returns X when both slots have no class', () => {
  assert.equal(mergeService.mergeTwoClassPresence('X', 'X'), 'X');
  assert.equal(mergeService.mergeTwoClassPresence('', ''), 'X');
});

test('mergeTwoClassPresence combines active slots with slash', () => {
  assert.equal(mergeService.mergeTwoClassPresence('Y', 'Y'), 'Y/Y');
  assert.equal(mergeService.mergeTwoClassPresence('Y', 'X'), 'Y/X');
  assert.equal(mergeService.mergeTwoClassPresence('X', 'N'), 'X/N');
  assert.equal(mergeService.mergeTwoClassPresence('*', 'Y'), '*/Y');
});

test('mergeTwoClassNote returns empty note when both slots have no class', () => {
  assert.equal(mergeService.mergeTwoClassNote('X', 'No Class', 'X', 'No Class'), '');
});

test('mergeTwoClassNote formats documented presence and note pairs', () => {
  assert.equal(
    mergeService.mergeTwoClassNote('Y', 'Present', 'Y', 'Present'),
    'Present AM/Present PM'
  );
  assert.equal(
    mergeService.mergeTwoClassNote('Y', 'Present', 'X', 'No Class'),
    'Present AM/No Class PM'
  );
  assert.equal(
    mergeService.mergeTwoClassNote('X', 'No Class', 'N', 'Absent'),
    'No Class AM/Absent PM'
  );
});

test('mergeTwoClassNote suffixes late and left-early compound notes with AM and PM', () => {
  assert.equal(
    mergeService.mergeTwoClassNote(
      'Y',
      'Late Excused - Left Early Excused',
      'Y',
      'Late - Left Early'
    ),
    'Late Excused AM - Left Early Excused AM/Late PM - Left Early PM'
  );
});

test('mergeTwoClassNote formats not-marked slots with AM and PM labels', () => {
  assert.equal(
    mergeService.mergeTwoClassNote('*', 'Not Marked', 'Y', 'Present'),
    'Not Marked AM/Present PM'
  );
  assert.equal(
    mergeService.mergeTwoClassNote('Y', 'Present', '*', 'Not Marked'),
    'Present AM/Not Marked PM'
  );
});

test('overall calculateAnswers evaluates twoClass helpers for day01 fields', () => {
  const template = overallTemplateModel.sanitizeTemplate({
    orgId: 'ORG-1',
    title: 'Two Class Attendance',
    status: 'active',
    sourceSlots: [
      { slotKey: 'T1', order: 1, templateId: 'SRC-1', templateVersionAtSelection: 1, requirement: 'necessary' },
      { slotKey: 'T2', order: 2, templateId: 'SRC-2', templateVersionAtSelection: 1, requirement: 'necessary' }
    ],
    schema: {
      version: 1,
      fields: [
        {
          id: 'day01_yn',
          label: 'Day 01 YN',
          type: 'text',
          overallValueMode: 'derived_locked',
          calculationRule: {
            enabled: true,
            expression: 'twoClassPresence(source("T1", "attendance_presence_01"), source("T2", "attendance_presence_01"))',
            onError: 'keep_last'
          },
          validationRules: [],
          conversionRule: { enabled: false, expression: '', onError: 'use_raw' }
        },
        {
          id: 'day01_note',
          label: 'Day 01 Note',
          type: 'text',
          overallValueMode: 'derived_locked',
          calculationRule: {
            enabled: true,
            expression: 'twoClassNote(source("T1", "attendance_presence_01"), source("T1", "attendance_note_01"), source("T2", "attendance_presence_01"), source("T2", "attendance_note_01"))',
            onError: 'keep_last'
          },
          validationRules: [],
          conversionRule: { enabled: false, expression: '', onError: 'use_raw' }
        }
      ]
    }
  });

  const calculated = overallReportService.calculateAnswers({
    template,
    sourceValues: {
      T1: {
        attendance_presence_01: 'Y',
        attendance_note_01: 'Present'
      },
      T2: {
        attendance_presence_01: 'X',
        attendance_note_01: 'No Class'
      }
    },
    currentAnswers: {},
    derivedOverrides: {},
    initialize: true
  });

  assert.deepEqual(calculated.diagnostics, []);
  assert.equal(calculated.answers.day01_yn, 'Y/X');
  assert.equal(calculated.answers.day01_note, 'Present AM/No Class PM');
});

test('overall PDF export fills merged two-class day values through O-prefixed field map', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-two-class-pdf-'));
  const pdfPath = path.join(dir, 'sample.pdf');
  await createTwoClassSamplePdf(pdfPath);

  const template = overallTemplateModel.sanitizeTemplate({
    orgId: 'ORG-1',
    title: 'Two Class Attendance',
    status: 'active',
    sourceSlots: [
      { slotKey: 'T1', order: 1, templateId: 'SRC-1', templateVersionAtSelection: 1, requirement: 'necessary' },
      { slotKey: 'T2', order: 2, templateId: 'SRC-2', templateVersionAtSelection: 1, requirement: 'necessary' }
    ],
    schema: {
      version: 1,
      fields: [
        {
          id: 'day01_yn',
          label: 'Day 01 YN',
          type: 'text',
          overallValueMode: 'derived_locked',
          calculationRule: {
            enabled: true,
            expression: 'twoClassPresence(source("T1", "attendance_presence_01"), source("T2", "attendance_presence_01"))',
            onError: 'keep_last'
          },
          validationRules: [],
          conversionRule: { enabled: false, expression: '', onError: 'use_raw' }
        },
        {
          id: 'day01_note',
          label: 'Day 01 Note',
          type: 'text',
          overallValueMode: 'derived_locked',
          calculationRule: {
            enabled: true,
            expression: 'twoClassNote(source("T1", "attendance_presence_01"), source("T1", "attendance_note_01"), source("T2", "attendance_presence_01"), source("T2", "attendance_note_01"))',
            onError: 'keep_last'
          },
          validationRules: [],
          conversionRule: { enabled: false, expression: '', onError: 'use_raw' }
        }
      ]
    },
    pdfTemplate: { path: pdfPath, fileName: 'sample.pdf' },
    pdfFieldMap: {
      'O.day01_yn': 'YN1',
      'O.day01_note': 'NOTES1'
    }
  });

  const sourceValues = {
    T1: { attendance_presence_01: 'X', attendance_note_01: 'No Class' },
    T2: { attendance_presence_01: 'N', attendance_note_01: 'Absent' }
  };
  const calculated = overallReportService.calculateAnswers({
    template,
    sourceValues,
    currentAnswers: {},
    derivedOverrides: {},
    initialize: true
  });
  const virtualInstance = {
    id: 'overall-test-1',
    answers: calculated.answers,
    sourceValues,
    templateSnapshot: template
  };
  const payload = overallReportService.buildDocxPayloadDetailed(virtualInstance);

  const rendered = await reportPdfRenderService.renderReportInstancePdf({
    template,
    instance: virtualInstance,
    placeholders: payload.placeholders,
    mergedAnswers: virtualInstance.answers,
    flatten: false
  });

  const filledDoc = await PDFDocument.load(rendered.buffer);
  const form = filledDoc.getForm();
  assert.equal(form.getTextField('YN1').getText(), 'X/N');
  assert.equal(form.getTextField('NOTES1').getText(), 'No Class AM/Absent PM');
});
