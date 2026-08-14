const test = require('node:test');
const assert = require('node:assert/strict');

const studentAttendanceReportGenerationService = require('../packages/school/MVC/services/school/studentAttendanceReportGenerationService');

test('sortClasses orders by class name then class id', () => {
  const sorted = studentAttendanceReportGenerationService.sortClasses([
    { classId: 'C2', className: 'Beta' },
    { classId: 'C1', className: 'Alpha' }
  ]);
  assert.equal(sorted[0].classId, 'C1');
  assert.equal(sorted[1].classId, 'C2');
});

test('buildSourceRunsForStudent maps sorted classes to overall slots by index', () => {
  const student = {
    personId: 'PERSON-1',
    name: 'Alice',
    classes: [
      { classId: 'C2', className: 'Beta', teacherId: 'TEACH-2' },
      { classId: 'C1', className: 'Alpha', teacherId: 'TEACH-1' }
    ]
  };
  const overallTemplate = {
    sourceSlots: [
      { slotKey: 'T1', order: 1, templateId: 'RPT-1' },
      { slotKey: 'T2', order: 2, templateId: 'RPT-1' }
    ]
  };
  const { sourceRuns, warnings } = studentAttendanceReportGenerationService.buildSourceRunsForStudent({
    student,
    policy: { reportTemplateId: 'RPT-1' },
    overallTemplate,
    startDate: '2026-01-01',
    endDate: '2026-01-31'
  });
  assert.equal(warnings.length, 0);
  assert.equal(sourceRuns.length, 2);
  assert.equal(sourceRuns[0].slotKey, 'T1');
  assert.equal(sourceRuns[0].classId, 'C1');
  assert.equal(sourceRuns[0].teacherId, 'TEACH-1');
  assert.equal(sourceRuns[0].targetStudentIds[0], 'PERSON-1');
  assert.equal(sourceRuns[1].slotKey, 'T2');
  assert.equal(sourceRuns[1].classId, 'C2');
});

test('buildSourceRunsForStudent without overall creates one run per class', () => {
  const student = {
    personId: 'PERSON-1',
    classes: [
      { classId: 'C1', className: 'Alpha', teacherId: 'TEACH-1' },
      { classId: 'C2', className: 'Beta', teacherId: 'TEACH-2' }
    ]
  };
  const { sourceRuns } = studentAttendanceReportGenerationService.buildSourceRunsForStudent({
    student,
    policy: { reportTemplateId: 'RPT-1' },
    overallTemplate: null,
    startDate: '2026-01-01',
    endDate: '2026-01-07'
  });
  assert.equal(sourceRuns.length, 2);
  assert.equal(sourceRuns[0].templateId, 'RPT-1');
  assert.equal(sourceRuns[0].format, 'docx');
  assert.equal(sourceRuns[1].classId, 'C2');
});

test('buildSourceRunsForStudent warns when overall slot lacks a class', () => {
  const student = {
    personId: 'PERSON-1',
    classes: [{ classId: 'C1', className: 'Alpha', teacherId: 'TEACH-1' }]
  };
  const overallTemplate = {
    sourceSlots: [
      { slotKey: 'T1', order: 1, templateId: 'RPT-1' },
      { slotKey: 'T2', order: 2, templateId: 'RPT-1' }
    ]
  };
  const { sourceRuns, warnings } = studentAttendanceReportGenerationService.buildSourceRunsForStudent({
    student,
    policy: { reportTemplateId: 'RPT-1' },
    overallTemplate,
    startDate: '2026-01-01',
    endDate: '2026-01-31'
  });
  assert.equal(sourceRuns.length, 1);
  assert.match(warnings.join(' '), /slot/i);
});

test('buildClassExportRowsForStudent attaches template capability flags', () => {
  const student = {
    personId: 'PERSON-1',
    classes: [
      { classId: 'C1', className: 'Alpha', teacherId: 'TEACH-1' },
      { classId: 'C2', className: 'Beta', teacherId: 'TEACH-2' }
    ]
  };
  const templateMetaMap = new Map([
    ['RPT-1', { templateTitle: 'Attendance Report', hasDocx: true, hasPdf: true }]
  ]);
  const rows = studentAttendanceReportGenerationService.buildClassExportRowsForStudent(
    student,
    { reportTemplateId: 'RPT-1' },
    null,
    templateMetaMap
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].templateTitle, 'Attendance Report');
  assert.equal(rows[0].hasDocx, true);
  assert.equal(rows[0].hasPdf, true);
  assert.equal(rows[0].exportable, true);
});

test('buildClassExportRowsForStudent always uses configured class report template', () => {
  const student = {
    personId: 'PERSON-1',
    classes: [
      { classId: 'C2', className: 'Beta', teacherId: 'TEACH-2' },
      { classId: 'C1', className: 'Alpha', teacherId: 'TEACH-1' }
    ]
  };
  const overallTemplate = {
    sourceSlots: [
      { slotKey: 'T1', order: 1, templateId: 'RPT-A' },
      { slotKey: 'T2', order: 2, templateId: 'RPT-B' }
    ]
  };
  const templateMetaMap = new Map([
    ['RPT-1', { templateTitle: 'Class Template', hasDocx: true, hasPdf: true }],
    ['RPT-A', { templateTitle: 'Template A', hasDocx: true, hasPdf: false }],
    ['RPT-B', { templateTitle: 'Template B', hasDocx: false, hasPdf: true }]
  ]);
  const rows = studentAttendanceReportGenerationService.buildClassExportRowsForStudent(
    student,
    { reportTemplateId: 'RPT-1' },
    overallTemplate,
    templateMetaMap
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].classId, 'C1');
  assert.equal(rows[0].slotKey, '');
  assert.equal(rows[0].templateId, 'RPT-1');
  assert.equal(rows[0].templateTitle, 'Class Template');
  assert.equal(rows[0].hasDocx, true);
  assert.equal(rows[0].hasPdf, true);
  assert.equal(rows[1].classId, 'C2');
  assert.equal(rows[1].templateId, 'RPT-1');
  assert.equal(rows[1].hasPdf, true);
});

test('buildOverallExportBlock marks eligible when all slots are exportable', () => {
  const overallTemplate = {
    title: 'Overall Attendance',
    sourceSlots: [
      { slotKey: 'T1', order: 1 },
      { slotKey: 'T2', order: 2 }
    ]
  };
  const classRows = [
    { slotIndex: 0, templateId: 'RPT-1', exportable: true, warning: '' },
    { slotIndex: 1, templateId: 'RPT-1', exportable: true, warning: '' }
  ];
  const block = studentAttendanceReportGenerationService.buildOverallExportBlock(
    { personId: 'PERSON-1' },
    { reportTemplateId: 'RPT-1', overallReportTemplateId: 'OVR-1' },
    overallTemplate,
    classRows
  );
  assert.equal(block.defined, true);
  assert.equal(block.eligible, true);
  assert.equal(block.missingSlots.length, 0);
});

test('buildOverallExportBlock is not eligible when a slot class is not exportable', () => {
  const overallTemplate = {
    sourceSlots: [
      { slotKey: 'T1', order: 1 },
      { slotKey: 'T2', order: 2 }
    ]
  };
  const classRows = [
    { slotIndex: 0, templateId: 'RPT-1', exportable: true, warning: '' },
    { slotIndex: 1, templateId: 'RPT-1', exportable: false, warning: 'No teacher assigned for Beta.' }
  ];
  const block = studentAttendanceReportGenerationService.buildOverallExportBlock(
    { personId: 'PERSON-1' },
    { reportTemplateId: 'RPT-1', overallReportTemplateId: 'OVR-1' },
    overallTemplate,
    classRows
  );
  assert.equal(block.eligible, false);
  assert.ok(block.missingSlots.length > 0);
});

test('buildOverallExportBlock is eligible when only necessary slots are satisfied', () => {
  const overallTemplate = {
    title: 'Overall Attendance',
    sourceSlots: [
      { slotKey: 'T1', order: 1, requirement: 'necessary' },
      { slotKey: 'T2', order: 2, requirement: 'optional' }
    ]
  };
  const classRows = [
    { slotIndex: 0, templateId: 'RPT-1', exportable: true, warning: '' }
  ];
  const block = studentAttendanceReportGenerationService.buildOverallExportBlock(
    { personId: 'PERSON-1' },
    { reportTemplateId: 'RPT-1', overallReportTemplateId: 'OVR-1' },
    overallTemplate,
    classRows
  );
  assert.equal(block.eligible, true);
  assert.equal(block.necessarySlotCount, 1);
  assert.equal(block.missingSlots.length, 0);
});

test('buildSourceRunsForStudent skips optional slots without classes', () => {
  const student = {
    personId: 'PERSON-1',
    classes: [{ classId: 'C1', className: 'Alpha', teacherId: 'TEACH-1' }]
  };
  const overallTemplate = {
    sourceSlots: [
      { slotKey: 'T1', order: 1, templateId: 'RPT-1', requirement: 'necessary' },
      { slotKey: 'T2', order: 2, templateId: 'RPT-1', requirement: 'optional' }
    ]
  };
  const { sourceRuns, warnings } = studentAttendanceReportGenerationService.buildSourceRunsForStudent({
    student,
    policy: { reportTemplateId: 'RPT-1' },
    overallTemplate,
    startDate: '2026-01-01',
    endDate: '2026-01-31'
  });
  assert.equal(sourceRuns.length, 1);
  assert.equal(warnings.length, 0);
  assert.equal(sourceRuns[0].slotKey, 'T1');
});

test('buildSourceRunsForStudent respects selectedClassIds for overall slots', () => {
  const student = {
    personId: 'PERSON-1',
    classes: [
      { classId: 'C1', className: 'Alpha', teacherId: 'TEACH-1' },
      { classId: 'C2', className: 'Beta', teacherId: 'TEACH-2' }
    ]
  };
  const overallTemplate = {
    sourceSlots: [
      { slotKey: 'T1', order: 1, templateId: 'RPT-1' },
      { slotKey: 'T2', order: 2, templateId: 'RPT-1' }
    ]
  };
  const { sourceRuns, warnings } = studentAttendanceReportGenerationService.buildSourceRunsForStudent({
    student,
    policy: { reportTemplateId: 'RPT-1' },
    overallTemplate,
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    selectedClassIds: ['C1']
  });
  assert.equal(sourceRuns.length, 1);
  assert.equal(sourceRuns[0].classId, 'C1');
  assert.match(warnings.join(' '), /not selected/i);
});

test('buildSourceRunsForStudent rejects necessary overall slots with mismatched class template', () => {
  const student = {
    personId: 'PERSON-1',
    classes: [{ classId: 'C1', className: 'Alpha', teacherId: 'TEACH-1' }]
  };
  const overallTemplate = {
    sourceSlots: [{ slotKey: 'T1', order: 1, templateId: 'RPT-OTHER', requirement: 'necessary' }]
  };
  const { sourceRuns, warnings } = studentAttendanceReportGenerationService.buildSourceRunsForStudent({
    student,
    policy: { reportTemplateId: 'RPT-1' },
    overallTemplate,
    startDate: '2026-01-01',
    endDate: '2026-01-31'
  });
  assert.equal(sourceRuns.length, 0);
  assert.match(warnings.join(' '), /requires RPT-OTHER/);
});

test('buildOverallExportOptions returns eligible templates in settings order', () => {
  const student = { personId: 'PERSON-1' };
  const classRows = [
    { slotIndex: 0, classId: 'C1', templateId: 'RPT-1', exportable: true, warning: '' },
    { slotIndex: 1, classId: 'C2', templateId: 'RPT-1', exportable: true, warning: '' }
  ];
  const templates = [
    {
      id: 'OVR-1',
      title: 'First Overall',
      sourceSlots: [
        { slotKey: 'T1', order: 1, templateId: 'RPT-1' },
        { slotKey: 'T2', order: 2, templateId: 'RPT-1' }
      ]
    },
    {
      id: 'OVR-2',
      title: 'Second Overall',
      sourceSlots: [
        { slotKey: 'T1', order: 1, templateId: 'RPT-1' }
      ]
    }
  ];
  const options = studentAttendanceReportGenerationService.buildOverallExportOptions(
    student,
    { reportTemplateId: 'RPT-1' },
    templates,
    classRows
  );

  assert.deepEqual(options.map((row) => row.templateId), ['OVR-1', 'OVR-2']);
  assert.equal(options.every((row) => row.eligible), true);
  assert.deepEqual(options[0].matchedClassIds, ['C1', 'C2']);
});
