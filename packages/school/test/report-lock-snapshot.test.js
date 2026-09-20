const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const reportService = require('../MVC/services/school/reportService');
const reportTemplateModel = require('../MVC/models/school/reportTemplateModel');
const overallReportService = require('../MVC/services/school/overallReportService');

const ROOT = path.resolve(__dirname, '../../..');

const baseTemplatePayload = {
  orgId: 'ORG-TEST-1',
  type: 'progress_report_v1',
  version: 1,
  title: 'Snapshot Test Template',
  status: 'draft',
  schema: {
    version: 1,
    fields: [
      {
        id: 'student_name',
        label: 'Student Name',
        type: 'text',
        readOnly: true,
        prefillKey: 'student_full_name',
        valueMode: 'manual'
      },
      {
        id: 'attendance_pct',
        label: 'Attendance',
        type: 'number',
        readOnly: true,
        prefillKey: 'student_attendance_percent',
        valueMode: 'manual'
      }
    ]
  },
  placeholderMap: { student_name: 'student_full_name' },
  snapshotKeys: ['student_full_name', 'student_name', 'attendance_pct', 'student_attendance_percent']
};

test('reportTemplateModel sanitizes snapshotKeys with dedupe and cap', () => {
  const sanitized = reportTemplateModel.sanitizeTemplate({
    ...baseTemplatePayload,
    snapshotKeys: ['student_full_name', ' {{student_name}} ', 'student_full_name']
  });
  assert.deepEqual(sanitized.snapshotKeys, ['student_full_name', 'student_name']);
});

test('validateTemplateSnapshotKeys rejects unknown keys', () => {
  const invalid = reportService.validateTemplateSnapshotKeys({
    ...baseTemplatePayload,
    snapshotKeys: ['student_full_name', 'not_a_real_catalog_key_xyz']
  });
  assert.equal(invalid.length, 1);
  assert.equal(invalid[0].key, 'not_a_real_catalog_key_xyz');
});

test('resolveTemplateFillKeys with snapshotKeys uses explicit keys plus deps for in-scope fields only', () => {
  const keys = reportService.resolveTemplateFillKeys({
    ...baseTemplatePayload,
    schema: {
      version: 1,
      fields: [
        ...baseTemplatePayload.schema.fields,
        {
          id: 'total_score',
          label: 'Total',
          type: 'number',
          valueMode: 'calculated',
          calculationRule: { enabled: true, expression: 'answers.attendance_pct', onError: 'keep_last' },
          calculationDependencies: ['attendance_pct']
        },
        {
          id: 'unused_metric',
          label: 'Unused',
          type: 'number',
          readOnly: true,
          prefillKey: 'class_attendance_present',
          valueMode: 'manual'
        }
      ]
    }
  });
  assert.ok(keys.has('student_full_name'));
  assert.ok(keys.has('student_attendance_percent'));
  assert.ok(keys.has('attendance_pct'));
  assert.ok(keys.has('student_name'));
  assert.ok(!keys.has('class_attendance_present'));
});

test('resolveTemplateFillKeys adds expression deps when calculated field is in snapshotKeys', () => {
  const keys = reportService.resolveTemplateFillKeys({
    ...baseTemplatePayload,
    snapshotKeys: ['student_full_name', 'total_score'],
    schema: {
      version: 1,
      fields: [
        ...baseTemplatePayload.schema.fields,
        {
          id: 'total_score',
          label: 'Total',
          type: 'number',
          valueMode: 'calculated',
          calculationRule: { enabled: true, expression: 'answers.attendance_pct', onError: 'keep_last' },
          calculationDependencies: ['attendance_pct']
        }
      ]
    }
  });
  assert.ok(keys.has('total_score'));
  assert.ok(keys.has('attendance_pct'));
});

test('resolveTemplateFillKeys falls back to all field suggestions when snapshotKeys empty', () => {
  const keys = reportService.resolveTemplateFillKeys({
    ...baseTemplatePayload,
    snapshotKeys: [],
    schema: {
      version: 1,
      fields: [
        ...baseTemplatePayload.schema.fields,
        {
          id: 'total_score',
          label: 'Total',
          type: 'number',
          valueMode: 'calculated',
          calculationRule: { enabled: true, expression: 'answers.attendance_pct', onError: 'keep_last' },
          calculationDependencies: ['attendance_pct']
        }
      ]
    }
  });
  assert.ok(keys.has('student_full_name'));
  assert.ok(keys.has('student_attendance_percent'));
  assert.ok(keys.has('attendance_pct'));
  assert.ok(!keys.has('student_name'));
});

test('resolveTemplateLockKeys returns explicit snapshotKeys only', () => {
  const keys = reportService.resolveTemplateLockKeys(baseTemplatePayload);
  assert.deepEqual(keys, [
    'student_full_name',
    'student_name',
    'attendance_pct',
    'student_attendance_percent'
  ]);
});

test('pickKeySubset keeps only requested keys', () => {
  const subset = reportService.pickKeySubset(
    { a: 1, b: 2, student_full_name: 'Ada' },
    new Set(['student_full_name', 'missing'])
  );
  assert.deepEqual(subset, { student_full_name: 'Ada' });
});

test('buildLockSnapshot stores merged answers and filtered source values', async () => {
  const template = baseTemplatePayload;
  const instance = {
    id: 'RPTINS-TEST-1',
    templateId: 'RPTTPL-TEST-1',
    templateVersion: 1,
    status: 'submitted',
    answers: {},
    prefillSnapshot: {
      student_full_name: 'Ada Lovelace',
      student_attendance_percent: 92
    }
  };
  const snapshot = await reportService.buildLockSnapshot({
    template: { ...template, id: 'RPTTPL-TEST-1' },
    instance,
    assignment: { reportScope: 'each_student', sharedAnswers: {} }
  });
  assert.equal(snapshot.templateVersion, 1);
  assert.equal(snapshot.keys.student_full_name, 'Ada Lovelace');
  assert.ok(Object.prototype.hasOwnProperty.call(snapshot.sourceValues, 'student_full_name')
    || Object.prototype.hasOwnProperty.call(snapshot.keys, 'student_name'));
  assert.ok(snapshot.mergedAnswers && typeof snapshot.mergedAnswers === 'object');
});

test('locked export paths prefer lockSnapshot without rebuilding student payload', () => {
  const overallEngineSource = fs.readFileSync(
    path.join(ROOT, 'packages/school/MVC/services/school/overallReportGenerationEngineService.js'),
    'utf8'
  );
  assert.match(overallEngineSource, /lockSnapshot\?\.sourceValues/);
  assert.match(overallEngineSource, /buildStudentPayload/);

  const overallServiceSource = fs.readFileSync(
    path.join(ROOT, 'packages/school/MVC/services/school/overallReportService.js'),
    'utf8'
  );
  assert.match(overallServiceSource, /instance\.lockSnapshot\.sourceValues/);

  const controllerSource = fs.readFileSync(
    path.join(ROOT, 'packages/school/MVC/controllers/school/reportController.js'),
    'utf8'
  );
  assert.match(controllerSource, /lockSnapshot:\s*null/);
});

test('getSourceTemplateKeyCatalog filters to snapshotKeys when configured', () => {
  const template = {
    ...baseTemplatePayload,
    id: 'RPTTPL-1',
    snapshotKeys: ['student_full_name']
  };
  const catalog = overallReportService.getSourceTemplateKeyCatalog(template);
  assert.ok(catalog.includes('student_full_name'));
  assert.ok(!catalog.includes('teacher_name'));
});

test('getSourceTemplateKeyCatalog includes option docxAlias shortcuts used in overall Key catalog', () => {
  const template = {
    ...baseTemplatePayload,
    id: 'RPTTPL-1',
    snapshotKeys: ['student_full_name']
  };
  const options = overallReportService.getSourceTemplateKeyOptions(template);
  const nameOption = options.find((row) => row.key === 'student_full_name');
  assert.ok(nameOption?.docxAlias, 'expected docxAlias on snapshotted catalog option');
  const catalog = overallReportService.getSourceTemplateKeyCatalog(template);
  assert.ok(catalog.includes(nameOption.docxAlias));
});

test('buildSourceValuesFromPlaceholders materializes catalog docxAlias keys for export', () => {
  const template = {
    ...baseTemplatePayload,
    id: 'RPTTPL-1',
    snapshotKeys: ['student_full_name']
  };
  const options = overallReportService.getSourceTemplateKeyOptions(template);
  const alias = options.find((row) => row.key === 'student_full_name')?.docxAlias;
  assert.ok(alias);
  const values = overallReportService.buildSourceValuesFromPlaceholders(template, {
    student_full_name: 'Ada Lovelace'
  });
  assert.equal(values.student_full_name, 'Ada Lovelace');
  assert.equal(values[alias], 'Ada Lovelace');
});

test('buildTemplateSnapshotKeySuggestions skips visual fields and docx alias duplicates', () => {
  const suggestions = reportService.buildTemplateSnapshotKeySuggestions({
    ...baseTemplatePayload,
    schema: {
      version: 1,
      fields: [
        { id: '__row_break_attendance_01', type: 'row_break', label: 'Attendance row' },
        {
          id: 'student_name',
          label: 'Student Name',
          type: 'text',
          prefillKey: 'student_full_name',
          docxAlias: 'stnm'
        }
      ]
    },
    placeholderMap: { student_name: 'student_full_name' }
  });
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].key, 'student_full_name');
  assert.equal(suggestions[0].label, 'Student Name');
  assert.ok(!suggestions.some((row) => row.key === '__row_break_attendance_01'));
  assert.ok(!suggestions.some((row) => row.key === 'stnm'));
});

test('resolveSnapshotKeyLabel prefers stored snapshotKeyLabels', () => {
  const label = reportService.resolveSnapshotKeyLabel({
    ...baseTemplatePayload,
    snapshotKeyLabels: { student_full_name: 'Learner legal name' }
  }, 'student_full_name');
  assert.equal(label, 'Learner legal name');
});

test('getSourceTemplateKeyOptions uses friendly labels for snapshotted keys', () => {
  const options = overallReportService.getSourceTemplateKeyOptions({
    ...baseTemplatePayload,
    id: 'RPTTPL-1',
    snapshotKeys: ['student_full_name'],
    snapshotKeyLabels: { student_full_name: 'Student full name (locked)' }
  });
  const match = options.find((row) => row.key === 'student_full_name');
  assert.ok(match);
  assert.equal(match.label, 'Student full name (locked)');
});

test('reportTemplateModel sanitizes snapshotKeyLabels against snapshotKeys', () => {
  const sanitized = reportTemplateModel.sanitizeTemplate({
    ...baseTemplatePayload,
    snapshotKeys: ['student_full_name'],
    snapshotKeyLabels: {
      student_full_name: 'Student Name',
      dropped_key: 'Should drop'
    }
  });
  assert.deepEqual(sanitized.snapshotKeyLabels, { student_full_name: 'Student Name' });
});

test('reconcileTemplateSnapshotKeys merges used template keys missing from snapshotKeys', () => {
  const reconciled = reportService.reconcileTemplateSnapshotKeys({
    ...baseTemplatePayload,
    snapshotKeys: ['student_full_name'],
    schema: {
      version: 1,
      fields: [
        ...baseTemplatePayload.schema.fields,
        {
          id: 'total_score',
          label: 'Total',
          type: 'number',
          valueMode: 'calculated',
          calculationRule: { enabled: true, expression: 'answers.attendance_pct', onError: 'keep_last' },
          calculationDependencies: ['attendance_pct']
        }
      ]
    }
  });
  assert.ok(reconciled.addedKeys.includes('attendance_pct'));
  assert.ok(reconciled.addedKeys.includes('student_attendance_percent'));
  assert.ok(reconciled.snapshotKeys.includes('student_full_name'));
});

test('resolvePrefillBundlesForKeys scopes expensive bundles to requested keys', () => {
  const nameOnly = reportService.resolvePrefillBundlesForKeys(new Set(['student_full_name']));
  assert.ok(nameOnly.has('core'));
  assert.ok(nameOnly.has('studentIdentity'));
  assert.ok(!nameOnly.has('gradebookPeriod'));
  assert.ok(!nameOnly.has('examPeriod'));
  assert.ok(!nameOnly.has('overallAttendanceDays'));

  const spanKeys = reportService.resolvePrefillBundlesForKeys(new Set(['student_attendance_span_percent']));
  assert.ok(spanKeys.has('studentAttendanceSpan'));
  assert.ok(spanKeys.has('classAttendanceSpan') || spanKeys.has('classSessionAttendance') || spanKeys.has('core'));
});

test('buildSourceValuesFromPlaceholders mirrors docx aliases from catalog values when snapshotKeys omit alias tokens', () => {
  const sourceTemplate = {
    id: 'RPTTPL-SRC',
    snapshotKeys: ['student_full_name'],
    schema: {
      version: 1,
      fields: [{
        id: 'student_name',
        label: 'Student Name',
        type: 'text',
        prefillKey: 'student_full_name',
        docxAlias: 's124'
      }]
    },
    placeholderMap: { student_name: 'student_full_name' }
  };
  const values = overallReportService.buildSourceValuesFromPlaceholders(sourceTemplate, {
    '{{student_full_name}}': 'Ada Lovelace',
    student_full_name: 'Ada Lovelace'
  });
  assert.equal(values.student_full_name, 'Ada Lovelace');
  assert.equal(values.s124, 'Ada Lovelace');
  const catalog = overallReportService.getSourceTemplateKeyCatalog(sourceTemplate);
  assert.ok(catalog.includes('s124'));
});

test('mergeTemplateData with respectSnapshotKeys omits out-of-scope field answers', () => {
  const template = {
    ...baseTemplatePayload,
    snapshotKeys: ['student_full_name'],
    schema: {
      version: 1,
      fields: [
        ...baseTemplatePayload.schema.fields,
        {
          id: 'unused_metric',
          label: 'Unused',
          type: 'number',
          readOnly: true,
          prefillKey: 'class_attendance_present',
          valueMode: 'manual'
        }
      ]
    }
  };
  const instance = {
    prefillSnapshot: { student_full_name: 'Ada', class_attendance_present: 99 },
    answers: {}
  };
  const scoped = reportService.mergeTemplateData(template, instance, null, { respectSnapshotKeys: true });
  const defaultScoped = reportService.mergeTemplateData(template, instance, null);
  const full = reportService.mergeTemplateData(template, instance, null, { respectSnapshotKeys: false });
  assert.equal(scoped.student_full_name, 'Ada');
  assert.equal(defaultScoped.student_full_name, 'Ada');
  assert.equal(defaultScoped.unused_metric, undefined);
  assert.equal(full.class_attendance_present, 99);
  assert.equal(scoped.unused_metric, undefined);
  assert.equal(scoped.class_attendance_present, undefined);
});

test('buildDocxPlaceholderPayloadDetailed respectSnapshotKeys omits out-of-scope placeholder tokens', () => {
  const template = {
    ...baseTemplatePayload,
    snapshotKeys: ['student_full_name'],
    schema: {
      version: 1,
      fields: [
        ...baseTemplatePayload.schema.fields,
        {
          id: 'unused_metric',
          label: 'Unused',
          type: 'text',
          prefillKey: 'class_attendance_present',
          valueMode: 'manual'
        }
      ]
    },
    placeholderMap: {
      student_name: 'student_full_name',
      unused_metric: 'class_attendance_present'
    }
  };
  const instance = {
    prefillSnapshot: { student_full_name: 'Ada', class_attendance_present: 'x' },
    answers: {}
  };
  const scoped = reportService.buildDocxPlaceholderPayloadDetailed(template, instance, null, { respectSnapshotKeys: true });
  const defaultScoped = reportService.buildDocxPlaceholderPayloadDetailed(template, instance, null);
  assert.ok(scoped.placeholders['{{student_full_name}}'] !== undefined);
  assert.ok(defaultScoped.placeholders['{{student_full_name}}'] !== undefined);
  assert.equal(scoped.placeholders['{{class_attendance_present}}'], undefined);
  assert.equal(defaultScoped.placeholders['{{class_attendance_present}}'], undefined);
});

test('buildSourceValuesFromPlaceholders filters out-of-scope tokens when snapshotKeys configured', () => {
  const template = {
    ...baseTemplatePayload,
    snapshotKeys: ['student_full_name'],
    schema: baseTemplatePayload.schema,
    placeholderMap: baseTemplatePayload.placeholderMap
  };
  const values = overallReportService.buildSourceValuesFromPlaceholders(template, {
    student_full_name: 'Ada',
    class_attendance_present: 'should drop'
  });
  assert.equal(values.student_full_name, 'Ada');
  assert.equal(values.class_attendance_present, undefined);
});

test('resolveAllowedDocxTokens includes snapshot keys and in-scope aliases only', () => {
  const template = {
    ...baseTemplatePayload,
    snapshotKeys: ['student_full_name'],
    schema: {
      version: 1,
      fields: [
        {
          id: 'student_name',
          label: 'Student Name',
          type: 'text',
          prefillKey: 'student_full_name',
          docxAlias: 'name1'
        },
        {
          id: 'other',
          label: 'Other',
          type: 'text',
          prefillKey: 'class_attendance_present',
          docxAlias: 'othr'
        }
      ]
    }
  };
  const allowed = reportService.resolveAllowedDocxTokens(template);
  assert.ok(allowed.has('student_full_name'));
  assert.ok(allowed.has('name1'));
  assert.ok(!allowed.has('othr'));
  assert.ok(!allowed.has('class_attendance_present'));
});

test('resolveAllowedDocxTokens includes snapshotKeyDocxAliases for catalog-only snapshot rows', () => {
  const template = {
    ...baseTemplatePayload,
    snapshotKeys: ['student_full_name', 'class_attendance_present'],
    snapshotKeyDocxAliases: { class_attendance_present: 'att1' },
    schema: baseTemplatePayload.schema
  };
  const allowed = reportService.resolveAllowedDocxTokens(template);
  assert.ok(allowed.has('att1'));
});

test('reportTemplateModel sanitizes snapshotKeyDocxAliases against snapshotKeys', () => {
  const sanitized = reportTemplateModel.sanitizeTemplate({
    ...baseTemplatePayload,
    snapshotKeys: ['student_full_name'],
    snapshotKeyDocxAliases: {
      student_full_name: 'key1',
      class_attendance_present: 'drop1'
    }
  });
  assert.deepEqual(sanitized.snapshotKeyDocxAliases, { student_full_name: 'key1' });
});

test('ensureSnapshotDocxShortcuts assigns alias for catalog-only snapshot key', () => {
  const template = JSON.parse(JSON.stringify({
    ...baseTemplatePayload,
    snapshotKeys: ['class_attendance_present'],
    snapshotKeyDocxAliases: {},
    schema: { version: 1, fields: baseTemplatePayload.schema.fields }
  }));
  reportService.ensureSnapshotDocxShortcuts(template);
  assert.ok(template.snapshotKeyDocxAliases.class_attendance_present);
  assert.match(template.snapshotKeyDocxAliases.class_attendance_present, /^[a-z][a-z0-9]+$/);
});

test('ensureSnapshotDocxShortcuts rejects shortcut that matches another reserved token', () => {
  const template = {
    ...baseTemplatePayload,
    snapshotKeys: ['student_full_name', 'class_attendance_present'],
    snapshotKeyDocxAliases: { class_attendance_present: 'name1' },
    schema: {
      version: 1,
      fields: [
        {
          id: 'student_name',
          label: 'Student Name',
          type: 'text',
          prefillKey: 'student_full_name',
          docxAlias: 'name1'
        },
        ...baseTemplatePayload.schema.fields.filter((f) => f.id !== 'student_name')
      ]
    },
    placeholderMap: baseTemplatePayload.placeholderMap
  };
  assert.throws(() => {
    reportService.ensureSnapshotDocxShortcuts(template);
  }, /conflicts/);
});

test('buildSnapshotAllowedTokenSummary reports not configured when snapshotKeys empty', () => {
  const summary = reportService.buildSnapshotAllowedTokenSummary({
    ...baseTemplatePayload,
    snapshotKeys: []
  });
  assert.equal(summary.configured, false);
  assert.equal(summary.allowedSet, null);
});

test('inspectTemplatePdfSnapshotCompliance flags pdfFieldMap keys outside snapshot allowlist', async () => {
  const template = {
    ...baseTemplatePayload,
    snapshotKeys: ['student_full_name'],
    pdfFieldMap: {
      student_full_name: 'StudentName',
      class_attendance_present: 'YN1'
    }
  };
  const result = await reportService.inspectTemplatePdfSnapshotCompliance(template, {
    label: 'Default PDF',
    pdfTemplate: null
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((row) => row.type === 'pdf_field_map' && row.token === 'class_attendance_present'));
});

test('formatSnapshotComplianceError summarizes docx token failures for save validation', () => {
  const message = reportService.formatSnapshotComplianceError([{
    ok: false,
    label: 'Default DOCX',
    issues: [{ type: 'token', token: 'bad_key' }]
  }]);
  assert.match(message, /bad_key/);
  assert.match(message, /Lock Snapshot Keys/);
});

test('validateTemplateDocxSnapshotTokens allows save when snapshot keys exist but no Word files attached', async () => {
  const result = await reportService.validateTemplateDocxSnapshotTokens({
    ...baseTemplatePayload,
    snapshotKeys: ['teacher_name'],
    docxTemplate: null
  });
  assert.equal(result.ok, true);
});
