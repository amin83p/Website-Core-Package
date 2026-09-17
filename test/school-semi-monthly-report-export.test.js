const test = require('node:test');
const assert = require('node:assert/strict');

const exportFormatService = require('../packages/school/MVC/services/school/studentAttendanceReportExportFormatService');
const semiMonthlyPolicyService = require('../packages/school/MVC/services/school/semiMonthlyReportPolicyService');
const smmrExportService = require('../packages/school/MVC/services/school/schoolSemiMonthlyReportExportService');

test('sanitizeSmmrTemplateExportFormats keeps one row per configured report template id', () => {
  const normalizedPolicy = {
    reportTemplateIds: ['report-a', 'report-b'],
    overallReportTemplateIds: ['overall-1']
  };
  const input = {
    report: {
      'report-a': { docx: false, pdf: true, payload: true },
      'report-stale': { docx: false, pdf: false, payload: false }
    },
    overall: {
      'overall-1': { docx: true, payload: false }
    }
  };
  const sanitized = exportFormatService.sanitizeSmmrTemplateExportFormats(input, normalizedPolicy);
  assert.deepEqual(Object.keys(sanitized.report).sort(), ['report-a', 'report-b']);
  assert.equal(sanitized.report['report-a'].docx, false);
  assert.equal(sanitized.report['report-b'].docx, true);
  assert.deepEqual(Object.keys(sanitized.overall), ['overall-1']);
  assert.equal(sanitized.overall['overall-1'].payload, false);
});

test('semiMonthlyReportPolicyService normalizes overall template list and export formats', () => {
  const normalized = semiMonthlyPolicyService.normalizePolicyFromStored({
    reportTemplateIds: ['tpl-1'],
    overallReportTemplateIds: ['overall-1', 'overall-1'],
    templateExportFormats: {
      report: { 'tpl-1': { docx: false, pdf: true, payload: true } },
      overall: { 'overall-1': { docx: true, pdf: true, payload: false } }
    }
  });
  assert.deepEqual(normalized.reportTemplateIds, ['tpl-1']);
  assert.deepEqual(normalized.overallReportTemplateIds, ['overall-1']);
  assert.equal(normalized.overallReportTemplateId, 'overall-1');
  assert.equal(normalized.templateExportFormats.report['tpl-1'].docx, false);
  assert.equal(normalized.templateExportFormats.overall['overall-1'].payload, false);
});

test('buildSmmrOverallExportBlock marks eligible when necessary slots have matching instances', () => {
  const policy = {
    reportTemplateIds: ['tpl-class'],
    templateExportFormats: { report: {}, overall: {} }
  };
  const overallTemplate = {
    id: 'overall-1',
    title: 'Overall',
    sourceSlots: [
      { slotKey: 'A', templateId: 'tpl-class', requirement: 'necessary', order: 1 },
      { slotKey: 'B', templateId: '', requirement: 'optional', order: 2 }
    ]
  };
  const student = {
    personId: 'P-1',
    name: 'Student',
    classes: [{
      classId: 'CLS-1',
      className: 'Math',
      instances: [{
        id: 'INS-1',
        templateId: 'tpl-class',
        sessionDate: '2026-01-15',
        templateLabel: 'Class report'
      }]
    }]
  };
  const block = smmrExportService.buildSmmrOverallExportBlock(student, policy, overallTemplate);
  assert.equal(block.eligible, true);
  assert.deepEqual(block.matchedInstanceIds, ['INS-1']);
});

test('buildSmmrOverallExportBlock is not eligible when a necessary slot lacks an instance', () => {
  const policy = { reportTemplateIds: ['tpl-class'], templateExportFormats: { report: {}, overall: {} } };
  const overallTemplate = {
    id: 'overall-1',
    sourceSlots: [{ slotKey: 'A', templateId: 'tpl-class', requirement: 'necessary', order: 1 }]
  };
  const student = {
    personId: 'P-1',
    classes: [{
      classId: 'CLS-1',
      className: 'Math',
      instances: []
    }]
  };
  const block = smmrExportService.buildSmmrOverallExportBlock(student, policy, overallTemplate);
  assert.equal(block.eligible, false);
  assert.ok(block.missingSlots.length >= 1);
});

test('resolveOverallSlotAssignments matches slots by template across classes regardless of class order', () => {
  const policy = {
    reportTemplateIds: ['tpl-A', 'tpl-B'],
    templateExportFormats: { report: {}, overall: {} }
  };
  const overallTemplate = {
    id: 'overall-1',
    sourceSlots: [
      { slotKey: 'T1', templateId: 'tpl-A', requirement: 'necessary', order: 1 },
      { slotKey: 'T2', templateId: 'tpl-B', requirement: 'necessary', order: 2 }
    ]
  };
  const student = {
    personId: 'P-1',
    classes: [
      {
        classId: 'CLS-SCI',
        className: 'Science',
        instances: [{ id: 'INS-B', templateId: 'tpl-B', sessionDate: '2026-01-20' }]
      },
      {
        classId: 'CLS-MATH',
        className: 'Math',
        instances: [{ id: 'INS-A', templateId: 'tpl-A', sessionDate: '2026-01-15' }]
      }
    ]
  };
  const block = smmrExportService.buildSmmrOverallExportBlock(student, policy, overallTemplate);
  assert.equal(block.eligible, true);
  assert.deepEqual(block.matchedInstanceIds.sort(), ['INS-A', 'INS-B']);
  assert.ok(!block.warnings.some((msg) => /requires a different report template/i.test(msg)));
  assert.equal(block.slotAssignments[0].selectedInstanceId, 'INS-A');
  assert.equal(block.slotAssignments[1].selectedInstanceId, 'INS-B');
});

test('resolveOverallSlotAssignments is not eligible when two slots need the same template but only one instance exists', () => {
  const policy = {
    reportTemplateIds: ['tpl-A'],
    templateExportFormats: { report: {}, overall: {} }
  };
  const overallTemplate = {
    id: 'overall-1',
    sourceSlots: [
      { slotKey: 'T1', templateId: 'tpl-A', requirement: 'necessary', order: 1 },
      { slotKey: 'T2', templateId: 'tpl-A', requirement: 'necessary', order: 2 }
    ]
  };
  const student = {
    personId: 'P-1',
    classes: [
      {
        classId: 'CLS-1',
        className: 'Math',
        instances: [{ id: 'INS-1', templateId: 'tpl-A', sessionDate: '2026-01-15' }]
      },
      {
        classId: 'CLS-2',
        className: 'Science',
        instances: []
      }
    ]
  };
  const block = smmrExportService.buildSmmrOverallExportBlock(student, policy, overallTemplate);
  assert.equal(block.eligible, false);
  assert.equal(block.matchedInstanceIds.length, 1);
});
