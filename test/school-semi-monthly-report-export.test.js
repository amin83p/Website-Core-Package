const test = require('node:test');
const assert = require('node:assert/strict');

const exportFormatService = require('../packages/school/MVC/services/school/studentAttendanceReportExportFormatService');
const semiMonthlyPolicyService = require('../packages/school/MVC/services/school/semiMonthlyReportPolicyService');
const smmrExportService = require('../packages/school/MVC/services/school/schoolSemiMonthlyReportExportService');
const smmrReportService = require('../packages/school/MVC/services/school/schoolSemiMonthlyReportService');

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

test('applyPreviewInstanceExportKeys adds default funder template keys without full enrichment', () => {
  const policy = { reportTemplateIds: ['tpl-1'], templateExportFormats: { report: {}, overall: {} } };
  const template = {
    id: 'tpl-1',
    docxTemplate: { path: '/uploads/default.docx' },
    docxTemplatesByFunder: []
  };
  const templateMetaMap = new Map([['tpl-1', {
    templateTitle: 'Class Report',
    hasDocx: true,
    hasPdf: false,
    hasPayload: true,
    docxOptions: [{ key: 'default', label: 'Default' }],
    pdfOptions: [],
    template
  }]]);
  const student = {
    personId: 'P-1',
    studentRecordId: 'STU-1',
    name: 'Student',
    classes: [{ classId: 'CLS-1', instances: [{ id: 'INS-1', templateId: 'tpl-1', exportable: true }] }]
  };
  const instanceRows = smmrExportService.flattenInstanceRows(
    {
      personId: 'P-1',
      classes: [{
        classId: 'CLS-1',
        className: 'Math',
        instances: [{
          id: 'INS-1',
          templateId: 'tpl-1',
          sessionDate: '2026-01-10',
          status: 'submitted',
          assignmentId: 'ASG-1'
        }]
      }]
    },
    templateMetaMap,
    policy
  );
  const periodRowsByClassId = new Map();
  const previewRows = smmrExportService.applyPreviewInstanceExportKeys(
    instanceRows,
    student,
    templateMetaMap,
    periodRowsByClassId,
    '2026-01-01',
    '2026-01-31'
  );
  assert.equal(previewRows.length, 1);
  assert.equal(previewRows[0].exportable, true);
  assert.equal(previewRows[0].suggestedDocxKey, 'default');
  assert.ok(Array.isArray(previewRows[0].docxOptions));
});

test('buildSmmrOverallExportBlock offers only overall templates whose slots match instance types', () => {
  const policy = {
    reportTemplateIds: ['tpl-wr', 'tpl-monthly'],
    templateExportFormats: { report: {}, overall: {} }
  };
  const overallWr = {
    id: 'overall-wr',
    title: 'W/R Overall',
    sourceSlots: [{ slotKey: 'T1', templateId: 'tpl-wr', requirement: 'necessary', order: 1 }]
  };
  const overallMonthly = {
    id: 'overall-monthly',
    title: 'Monthly Overall',
    sourceSlots: [{ slotKey: 'T1', templateId: 'tpl-monthly', requirement: 'necessary', order: 1 }]
  };
  const student = {
    personId: 'P-1',
    classes: [{
      classId: 'CLS-1',
      className: 'Reading',
      instances: [{
        id: 'INS-WR',
        templateId: 'tpl-wr',
        sessionDate: '2026-01-15',
        templateLabel: 'W/R Progress'
      }]
    }]
  };
  const wrBlock = smmrExportService.buildSmmrOverallExportBlock(student, policy, overallWr);
  const monthlyBlock = smmrExportService.buildSmmrOverallExportBlock(student, policy, overallMonthly);
  assert.equal(wrBlock.eligible, true);
  assert.equal(monthlyBlock.eligible, false);
  const eligibleCount = [wrBlock, monthlyBlock].filter((row) => row.eligible).length;
  assert.equal(eligibleCount, 1);
});

test('buildSmmrOverallExportBlock is not eligible when a necessary slot has no source template id', () => {
  const policy = { reportTemplateIds: ['tpl-wr'], templateExportFormats: { report: {}, overall: {} } };
  const overallTemplate = {
    id: 'overall-bad',
    sourceSlots: [{ slotKey: 'T1', templateId: '', requirement: 'necessary', order: 1 }]
  };
  const student = {
    personId: 'P-1',
    classes: [{
      classId: 'CLS-1',
      instances: [{ id: 'INS-1', templateId: 'tpl-wr', sessionDate: '2026-01-15' }]
    }]
  };
  const block = smmrExportService.buildSmmrOverallExportBlock(student, policy, overallTemplate);
  assert.equal(block.eligible, false);
  assert.ok(block.warnings.some((msg) => /without a source report template/i.test(msg)));
});

test('buildSmmrOverallExportBlock does not treat empty optional slot as wildcard for policy templates', () => {
  const policy = { reportTemplateIds: ['tpl-other'], templateExportFormats: { report: {}, overall: {} } };
  const overallTemplate = {
    id: 'overall-1',
    sourceSlots: [
      { slotKey: 'A', templateId: 'tpl-class', requirement: 'necessary', order: 1 },
      { slotKey: 'B', templateId: '', requirement: 'optional', order: 2 }
    ]
  };
  const student = {
    personId: 'P-1',
    classes: [{
      classId: 'CLS-1',
      instances: [{ id: 'INS-1', templateId: 'tpl-other', sessionDate: '2026-01-15' }]
    }]
  };
  const block = smmrExportService.buildSmmrOverallExportBlock(student, policy, overallTemplate);
  assert.equal(block.eligible, false);
});

test('sortInstancesByPolicyTemplateOrder sorts by school settings list then session date desc', () => {
  const ordered = smmrReportService.sortInstancesByPolicyTemplateOrder(
    [
      { id: 'INS-old-b', templateId: 'tpl-b', sessionDate: '2026-01-01' },
      { id: 'INS-new-a', templateId: 'tpl-a', sessionDate: '2026-01-20' },
      { id: 'INS-old-a', templateId: 'tpl-a', sessionDate: '2026-01-05' }
    ],
    ['tpl-a', 'tpl-b']
  );
  assert.deepEqual(ordered.map((row) => row.id), ['INS-new-a', 'INS-old-a', 'INS-old-b']);
});

test('flattenInstanceRows orders instances by policy template list', () => {
  const policy = { reportTemplateIds: ['tpl-a', 'tpl-b'], templateExportFormats: { report: {}, overall: {} } };
  const templateMetaMap = new Map();
  const rows = smmrExportService.flattenInstanceRows({
    personId: 'P-1',
    classes: [{
      classId: 'CLS-1',
      className: 'Class',
      instances: [
        { id: 'INS-b', templateId: 'tpl-b', sessionDate: '2026-01-10', status: 'submitted' },
        { id: 'INS-a', templateId: 'tpl-a', sessionDate: '2026-01-08', status: 'submitted' }
      ]
    }]
  }, templateMetaMap, policy);
  assert.deepEqual(rows.map((row) => row.instanceId), ['INS-a', 'INS-b']);
});
