const test = require('node:test');
const assert = require('node:assert/strict');

const exportFormatService = require('../MVC/services/school/studentAttendanceReportExportFormatService');
const policyService = require('../MVC/services/school/studentAttendanceReportPolicyService');
const generationService = require('../MVC/services/school/studentAttendanceReportGenerationService');

test('sanitizeTemplateExportFormats prunes entries to selected template ids', () => {
  const normalizedPolicy = {
    reportTemplateId: 'report-a',
    overallReportTemplateIds: ['overall-1', 'overall-2']
  };
  const input = {
    report: {
      'report-a': { docx: false, pdf: true, payload: true },
      'report-orphan': { docx: false, pdf: false, payload: false }
    },
    overall: {
      'overall-1': { docx: true, payload: false },
      'overall-stale': { docx: false, payload: false }
    }
  };

  const sanitized = exportFormatService.sanitizeTemplateExportFormats(input, normalizedPolicy);
  assert.deepEqual(Object.keys(sanitized.report), ['report-a']);
  assert.equal(sanitized.report['report-a'].docx, false);
  assert.equal(sanitized.report['report-a'].pdf, true);
  assert.deepEqual(Object.keys(sanitized.overall).sort(), ['overall-1', 'overall-2']);
  assert.equal(sanitized.overall['overall-1'].payload, false);
  assert.equal(sanitized.overall['overall-2'].docx, true);
  assert.equal(sanitized.overall['overall-2'].payload, true);
});

test('sanitizeExportFormatFlags parses form-like boolean tokens', () => {
  assert.deepEqual(exportFormatService.sanitizeExportFormatFlags({ docx: 'on', pdf: '0', payload: 'false' }), {
    docx: true,
    pdf: false,
    payload: false
  });
  assert.deepEqual(exportFormatService.sanitizeExportFormatFlags({ docx: 'off', payload: 'yes' }, { kind: 'overall' }), {
    docx: false,
    pdf: true,
    payload: true
  });
  assert.deepEqual(exportFormatService.sanitizeExportFormatFlags({ docx: 'off', pdf: '0', payload: 'yes' }, { kind: 'overall' }), {
    docx: false,
    pdf: false,
    payload: true
  });
});

test('resolveEffectiveClassExportFlags combines template capability with policy', () => {
  const policy = {
    templateExportFormats: {
      report: {
        'tpl-1': { docx: true, pdf: false, payload: false }
      },
      overall: {}
    }
  };
  const flags = exportFormatService.resolveEffectiveClassExportFlags(policy, 'tpl-1', {
    hasDocx: true,
    hasPdf: true
  });
  assert.deepEqual(flags, { hasDocx: true, hasPdf: false, hasPayload: false });
});

test('resolveEffectiveOverallExportFlags gates docx by template files', () => {
  const policy = {
    templateExportFormats: {
      report: {},
      overall: {
        'overall-1': { docx: true, payload: true }
      }
    }
  };
  assert.deepEqual(
    exportFormatService.resolveEffectiveOverallExportFlags(policy, 'overall-1', { hasDocx: false, hasPdf: true }),
    { hasDocx: false, hasPdf: true, hasPayload: true }
  );
  assert.deepEqual(
    exportFormatService.resolveEffectiveOverallExportFlags(policy, 'overall-1', { hasDocx: false, hasPdf: false }),
    { hasDocx: false, hasPdf: false, hasPayload: true }
  );
});

test('assertSarExportFormatAllowed rejects disabled formats', () => {
  const policy = {
    templateExportFormats: {
      report: { 'tpl-1': { docx: true, pdf: true, payload: false } },
      overall: {}
    }
  };
  assert.throws(
    () => exportFormatService.assertSarExportFormatAllowed(policy, 'report', 'tpl-1', 'json'),
    (error) => error.statusCode === 400 && /Payload export is disabled/i.test(error.message)
  );
  assert.throws(
    () => exportFormatService.assertSarExportFormatAllowed({
      templateExportFormats: {
        report: {},
        overall: { 'overall-1': { docx: true, pdf: false, payload: true } }
      }
    }, 'overall', 'overall-1', 'pdf'),
    (error) => error.statusCode === 400 && /PDF export is disabled/i.test(error.message)
  );
});

test('normalizePolicyFromForm persists templateExportFormats for selected templates', () => {
  const normalized = policyService.normalizePolicyFromForm({
    reportTemplateId: 'report-a',
    overallReportTemplateIds: JSON.stringify(['overall-1']),
    templateExportFormats: JSON.stringify({
      report: { 'report-a': { docx: false, pdf: true, payload: true } },
      overall: { 'overall-1': { docx: true, payload: false } }
    })
  });
  assert.equal(normalized.reportTemplateId, 'report-a');
  assert.equal(normalized.templateExportFormats.report['report-a'].docx, false);
  assert.equal(normalized.templateExportFormats.overall['overall-1'].payload, false);
});

test('buildClassExportRowsForStudent exposes hasPayload from template meta map', () => {
  const policy = { reportTemplateId: 'tpl-1' };
  const templateMetaMap = new Map([
    ['tpl-1', { templateTitle: 'Class Template', hasDocx: true, hasPdf: false, hasPayload: false }]
  ]);
  const rows = generationService.buildClassExportRowsForStudent(
    { classes: [{ classId: 'c1', className: 'Math', teacherId: 't1' }] },
    policy,
    null,
    templateMetaMap
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hasDocx, true);
  assert.equal(rows[0].hasPdf, false);
  assert.equal(rows[0].hasPayload, false);
});

test('buildOverallExportBlock omits payload when policy disables it', () => {
  const policy = {
    reportTemplateId: 'tpl-1',
    overallReportTemplateId: 'overall-1',
    templateExportFormats: {
      report: {},
      overall: { 'overall-1': { docx: true, payload: false } }
    }
  };
  const overallTemplate = {
    id: 'overall-1',
    title: 'Overall',
    docxTemplate: { path: '/tmp/overall.docx' },
    slots: [{ slotKey: 'A', requirement: 'necessary' }]
  };
  const classRows = [{
    classId: 'c1',
    className: 'Math',
    slotIndex: 0,
    templateId: 'tpl-1',
    exportable: true,
    warning: ''
  }];
  const block = generationService.buildOverallExportBlock(
    { personId: 'p1' },
    policy,
    overallTemplate,
    classRows
  );
  assert.equal(block.hasDocx, true);
  assert.equal(block.hasPdf, false);
  assert.equal(block.hasPayload, false);
});

test('applyOverallTemplateVariantToOption gates variant pdf flags by school settings', () => {
  const policy = {
    templateExportFormats: {
      report: {},
      overall: { 'overall-1': { docx: true, pdf: false, payload: true } }
    }
  };
  const overallTemplate = {
    id: 'overall-1',
    title: 'Overall',
    docxTemplate: { path: '/tmp/overall.docx' },
    pdfTemplate: { path: '/tmp/overall.pdf' }
  };
  const option = generationService.buildOverallExportBlock(
    { personId: 'p1' },
    policy,
    overallTemplate,
    []
  );
  const enriched = generationService.applyOverallTemplateVariantToOption(
    option,
    overallTemplate,
    policy,
    ''
  );
  assert.equal(enriched.hasPdf, false);
  const defaultVariant = (enriched.templateVariantOptions || []).find((row) => row.key === 'default');
  assert.ok(defaultVariant);
  assert.equal(defaultVariant.hasDocx, true);
  assert.equal(defaultVariant.hasPdf, false);
});

test('buildOverallExportBlock exposes pdf when overall template has attached pdf', () => {
  const policy = {
    reportTemplateId: 'tpl-1',
    overallReportTemplateId: 'overall-1',
    templateExportFormats: {
      report: {},
      overall: { 'overall-1': { docx: true, pdf: true, payload: true } }
    }
  };
  const overallTemplate = {
    id: 'overall-1',
    title: 'Overall',
    docxTemplate: { path: '/tmp/overall.docx' },
    pdfTemplate: { path: '/tmp/overall.pdf' },
    sourceSlots: [{ slotKey: 'T1', requirement: 'necessary' }]
  };
  const classRows = [{
    classId: 'c1',
    className: 'Math',
    slotIndex: 0,
    templateId: 'tpl-1',
    exportable: true,
    warning: ''
  }];
  const block = generationService.buildOverallExportBlock(
    { personId: 'p1' },
    policy,
    overallTemplate,
    classRows
  );
  assert.equal(block.hasDocx, true);
  assert.equal(block.hasPdf, true);
  assert.equal(block.hasPayload, true);
});

test('enrichClassExportRowsWithFunderSuggestions sets suggested docx key from enrollment funder', () => {
  const funderId = 'funder-wioa';
  const template = {
    docxTemplate: { path: '/tmp/default.docx' },
    docxTemplatesByFunder: [
      { funderKey: funderId, label: 'WIOA', docxTemplate: { path: '/tmp/wioa.docx' } }
    ]
  };
  const periodRowsByClassId = new Map([
    ['c1', [{
      studentId: 'sr1',
      personId: 'p1',
      funderId,
      funderType: 'funder',
      periodStart: '2025-01-01',
      periodEnd: '2025-12-31'
    }]]
  ]);
  const labelById = new Map([[funderId, 'WIOA Program']]);
  const rows = generationService.enrichClassExportRowsWithFunderSuggestions(
    { personId: 'p1', studentRecordId: 'sr1' },
    [{
      classId: 'c1',
      className: 'Math',
      exportable: true,
      hasDocx: true,
      hasPdf: false,
      hasPayload: true
    }],
    template,
    periodRowsByClassId,
    '2025-06-01',
    '2025-06-30',
    labelById
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].suggestedDocxKey, funderId);
  assert.match(rows[0].funderLabel || '', /WIOA/i);
  assert.ok((rows[0].docxOptions || []).length >= 1);
});

test('enrichClassExportRowsWithFunderSuggestions uses default docx when no overlapping period', () => {
  const template = {
    docxTemplate: { path: '/tmp/default.docx' },
    docxTemplatesByFunder: [
      { funderKey: 'funder-x', label: 'Other', docxTemplate: { path: '/tmp/other.docx' } }
    ]
  };
  const rows = generationService.enrichClassExportRowsWithFunderSuggestions(
    { personId: 'p1' },
    [{ classId: 'c1', exportable: true, hasDocx: true }],
    template,
    new Map([['c1', []]]),
    '2025-06-01',
    '2025-06-30',
    new Map()
  );
  assert.equal(rows[0].suggestedDocxKey, 'default');
  assert.equal(rows[0].funderLabel, '');
});

test('exportClassTarget forwards docxKey to generateReportOutput', async () => {
  const reportGenerationEngineService = require('../MVC/services/school/reportGenerationEngineService');
  const original = reportGenerationEngineService.generateReportOutput;
  let captured = null;
  reportGenerationEngineService.generateReportOutput = async (requestPayload) => {
    captured = requestPayload;
    return { file: { buffer: Buffer.from('docx'), contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } };
  };
  try {
    const ctx = {
      policy: {
        reportTemplateId: 'tpl-1',
        templateExportFormats: {
          report: { 'tpl-1': { docx: true, pdf: true, payload: true } },
          overall: {}
        }
      },
      startDate: '2025-01-01',
      endDate: '2025-01-31'
    };
    await generationService.exportClassTarget(
      {
        personId: 'p1',
        name: 'Student',
        classes: [{ classId: 'c1', className: 'Math', teacherId: 't1' }]
      },
      'c1',
      'docx',
      ctx,
      {},
      null,
      { docxKey: 'funder-wioa', pdfKey: '' }
    );
    assert.ok(captured);
    assert.equal(captured.docxKey, 'funder-wioa');
    assert.deepEqual(captured.selections, [{ studentId: 'p1', docxKey: 'funder-wioa', pdfKey: '' }]);
  } finally {
    reportGenerationEngineService.generateReportOutput = original;
  }
});
