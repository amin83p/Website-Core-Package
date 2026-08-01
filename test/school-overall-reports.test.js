const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ejs = require('ejs');
const PizZip = require('pizzip');

const ruleEngine = require('../packages/school/MVC/services/school/reportRuleEngineService');
const docxService = require('../packages/school/MVC/services/school/reportDocxRenderService');
const overallTemplateModel = require('../packages/school/MVC/models/school/overallReportTemplateModel');
const overallInstanceModel = require('../packages/school/MVC/models/school/overallReportInstanceModel');
const overallReportService = require('../packages/school/MVC/services/school/overallReportService');
const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');

const ROOT_DIR = path.resolve(__dirname, '..');
const reqUser = { id: 'USER-1', personId: 'PERSON-1', activeOrgId: 'ORG-1' };

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function withPatched(target, replacements, callback) {
  const originals = {};
  Object.entries(replacements).forEach(([key, value]) => {
    originals[key] = target[key];
    target[key] = value;
  });
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      Object.entries(originals).forEach(([key, value]) => {
        target[key] = value;
      });
    });
}

function sourceTemplate(id, title = id) {
  return {
    id,
    orgId: 'ORG-1',
    title,
    type: `source_${id.toLowerCase()}`,
    version: 1,
    status: 'active',
    schema: {
      version: 1,
      fields: [
        {
          id: 'score',
          label: 'Score',
          type: 'number',
          valueMode: 'manual',
          docxAlias: 'score_alias',
          validationRules: [],
          conversionRule: { enabled: false, expression: '', onError: 'use_raw' }
        },
        {
          id: 'comments',
          label: 'Comments',
          type: 'text',
          valueMode: 'manual',
          validationRules: [],
          conversionRule: { enabled: false, expression: '', onError: 'use_raw' }
        }
      ]
    },
    placeholderMap: {
      score: '{{score}}',
      comments: '{{comments}}'
    },
    docxTemplatesByFunder: []
  };
}

function overallTemplate(overrides = {}) {
  return overallTemplateModel.sanitizeTemplate({
    orgId: 'ORG-1',
    title: 'Consolidated Progress',
    version: 1,
    status: 'active',
    description: '',
    nextSlotNumber: 3,
    sourceSlots: [
      { slotKey: 'T1', order: 1, templateId: 'SRC-1', templateVersionAtSelection: 1 },
      { slotKey: 'T2', order: 2, templateId: 'SRC-2', templateVersionAtSelection: 1 }
    ],
    schema: {
      version: 1,
      fields: [
        {
          id: 'summary',
          label: 'Summary',
          type: 'text',
          overallValueMode: 'manual',
          defaultValue: 'Initial',
          required: true,
          validationRules: [],
          conversionRule: { enabled: false, expression: '', onError: 'use_raw' }
        },
        {
          id: 'average_score',
          label: 'Average score',
          type: 'number',
          overallValueMode: 'derived_locked',
          calculationRule: {
            enabled: true,
            expression: 'round(avg(source("T1", "score"), source("T2", "score")), 2)',
            onError: 'keep_last'
          },
          validationRules: [],
          conversionRule: { enabled: false, expression: '', onError: 'use_raw' }
        },
        {
          id: 'combined_comments',
          label: 'Combined comments',
          type: 'text',
          overallValueMode: 'derived_editable',
          calculationRule: {
            enabled: true,
            expression: 'concat(source("T1", "comments"), " ", source("T2", "comments"))',
            onError: 'keep_last'
          },
          validationRules: [],
          conversionRule: { enabled: false, expression: '', onError: 'use_raw' }
        },
        {
          id: 'score_label',
          label: 'Score label',
          type: 'text',
          overallValueMode: 'derived_locked',
          calculationRule: {
            enabled: true,
            expression: 'concat("Average: ", str(answers.average_score))',
            onError: 'keep_last'
          },
          validationRules: [],
          conversionRule: { enabled: false, expression: '', onError: 'use_raw' }
        }
      ]
    },
    placeholderMap: {},
    docxTemplate: {
      fileName: 'overall.docx',
      originalName: 'overall.docx',
      path: 'C:/tmp/overall.docx',
      url: '/uploads/overall.docx'
    },
    docxTemplatesByFunder: [],
    ...overrides
  });
}

function singleSourceOverallTemplate(overrides = {}) {
  return overallTemplate({
    title: 'Extracted Progress',
    nextSlotNumber: 2,
    sourceSlots: [
      { slotKey: 'T1', order: 1, templateId: 'SRC-1', templateVersionAtSelection: 1 }
    ],
    schema: {
      version: 1,
      fields: [
        {
          id: 'summary',
          label: 'Summary',
          type: 'text',
          overallValueMode: 'manual',
          defaultValue: 'Initial',
          required: true,
          validationRules: [],
          conversionRule: { enabled: false, expression: '', onError: 'use_raw' }
        },
        {
          id: 'extracted_score',
          label: 'Extracted score',
          type: 'number',
          overallValueMode: 'derived_locked',
          calculationRule: {
            enabled: true,
            expression: 'source("T1", "score")',
            onError: 'keep_last'
          },
          validationRules: [],
          conversionRule: { enabled: false, expression: '', onError: 'use_raw' }
        }
      ]
    },
    ...overrides
  });
}

function sourceValues(score1 = 80, score2 = 90) {
  return {
    T1: { score: score1, comments: 'Good' },
    T2: { score: score2, comments: 'Work' }
  };
}

function createDocxWithTokens(tokens) {
  const zip = new PizZip();
  const paragraphs = tokens.map((token) => {
    const midpoint = Math.max(1, Math.floor(token.length / 2));
    return `<w:p><w:r><w:t>{{${token.slice(0, midpoint)}</w:t></w:r><w:r><w:t>${token.slice(midpoint)}}}</w:t></w:r></w:p>`;
  }).join('');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="urn:test"><w:body>${paragraphs}</w:body></w:document>`);
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overall-report-test-'));
  const filePath = path.join(dir, 'template.docx');
  fs.writeFileSync(filePath, zip.generate({ type: 'nodebuffer' }));
  return { dir, filePath };
}

test('safe formulas support namespaced source values, avg, concat, and overall dependencies', () => {
  const template = overallTemplate();
  const calculated = overallReportService.calculateAnswers({
    template,
    sourceValues: sourceValues(),
    currentAnswers: {},
    derivedOverrides: {},
    initialize: true
  });
  assert.deepEqual(calculated.diagnostics, []);
  assert.equal(calculated.answers.summary, 'Initial');
  assert.equal(calculated.answers.average_score, 85);
  assert.equal(calculated.answers.combined_comments, 'Good Work');
  assert.equal(calculated.answers.score_label, 'Average: 85');
  assert.equal(ruleEngine.evaluateSafeExpression('avg(10, 20, "")'), 15);
  assert.equal(ruleEngine.evaluateSafeExpression('concat("A", " ", "B")'), 'A B');
  assert.throws(() => ruleEngine.evaluateSafeExpression('process.exit(1)'), /Only direct helper calls|Unknown helper|Unknown identifier/);
});

test('overall template normalization enforces stable slots, source keys, and calculation cycles', () => {
  const template = overallTemplate();
  const singleSource = singleSourceOverallTemplate();
  assert.deepEqual(template.sourceSlots.map((row) => row.slotKey), ['T1', 'T2']);
  assert.equal(template.nextSlotNumber, 3);
  assert.deepEqual(singleSource.sourceSlots.map((row) => row.slotKey), ['T1']);
  assert.equal(singleSource.nextSlotNumber, 2);
  assert.deepEqual(
    singleSource.schema.fields.find((field) => field.id === 'extracted_score').sourceReferences,
    [{ slotKey: 'T1', key: 'score' }]
  );
  assert.equal(template.placeholderMap.average_score, '{{O.average_score}}');
  assert.deepEqual(
    template.schema.fields.find((field) => field.id === 'average_score').sourceReferences,
    [{ slotKey: 'T1', key: 'score' }, { slotKey: 'T2', key: 'score' }]
  );
  assert.throws(
    () => overallTemplate({
      sourceSlots: [],
      schema: { version: 1, fields: [] }
    }),
    /at least one source template slot/
  );
  assert.throws(
    () => overallTemplate({
      schema: {
        version: 1,
        fields: [
          { id: 'a', label: 'A', type: 'number', overallValueMode: 'derived_locked', calculationRule: { expression: 'answers.b' } },
          { id: 'b', label: 'B', type: 'number', overallValueMode: 'derived_locked', calculationRule: { expression: 'answers.a' } }
        ]
      }
    }),
    /cycle detected/
  );
  assert.throws(
    () => overallTemplate({
      schema: {
        version: 1,
        fields: [
          { id: 'bad', label: 'Bad', type: 'number', overallValueMode: 'derived_locked', calculationRule: { expression: 'source("T9", "score")' } }
        ]
      }
    }),
    /unknown source slot/
  );
  assert.throws(
    () => overallTemplate({
      schema: {
        version: 1,
        fields: [
          { id: 'bad', label: 'Bad', type: 'number', overallValueMode: 'derived_locked', calculationRule: { expression: 'true || unsafeHelper(1)' } }
        ]
      }
    }),
    /Unknown helper "unsafeHelper"/
  );
});

test('source key options are structured, deduplicated, and retain legacy key compatibility', () => {
  const template = sourceTemplate('SRC-1', 'Progress Report');
  const options = overallReportService.getSourceTemplateKeyOptions(template);
  const keys = overallReportService.getSourceTemplateKeyCatalog(template);

  assert.deepEqual(keys, options.map((option) => option.key).sort((left, right) => left.localeCompare(right)));
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(options.some((option) => option.key === 'teacher_name' && option.origin === 'predefined'));
  assert.deepEqual(
    options.find((option) => option.key === 'score'),
    {
      key: 'score',
      label: 'Score',
      description: 'Saved or calculated value from the template field Score.',
      origin: 'template_field',
      group: 'Template fields',
      fieldId: 'score',
      fieldType: 'number',
      templateId: 'SRC-1',
      templateTitle: 'Progress Report',
      templateType: 'source_src-1',
      templateVersion: 1,
      docxAlias: 'scor'
    }
  );
  assert.ok(options.some((option) => option.origin === 'docx_alias' && option.fieldId === 'comments'));
});

test('ensureSourceTemplateDocxAliases generates missing DOCX shortcuts and reports changes', () => {
  const template = sourceTemplate('SRC-3', 'Alias Test');
  template.schema.fields.forEach((field) => {
    field.docxAlias = '';
  });
  const { template: ensured, changed } = overallReportService.ensureSourceTemplateDocxAliases(template);
  assert.equal(changed, true);
  ensured.schema.fields.forEach((field) => {
    if (field.type === 'section' || field.type === 'subheader' || field.type === 'row_break') return;
    assert.match(String(field.docxAlias || ''), /^[a-z][a-z0-9]{3}$/);
  });
  const options = overallReportService.getSourceTemplateKeyOptions(ensured);
  assert.ok(options.some((option) => option.origin === 'docx_alias' && option.fieldId === 'comments'));
  assert.ok(options.some((option) => option.origin === 'docx_alias' && option.fieldId === 'score'));
});

test('getSourceTemplateKeyOptions previews DOCX shortcuts before source template aliases are persisted', () => {
  const template = sourceTemplate('SRC-4', 'Preview Aliases');
  template.schema.fields.forEach((field) => {
    field.docxAlias = '';
  });
  const options = overallReportService.getSourceTemplateKeyOptions(template);
  assert.ok(options.filter((option) => option.origin === 'docx_alias').length >= 2);
  options.filter((option) => option.origin !== 'docx_alias').forEach((option) => {
    assert.match(String(option.docxAlias || ''), /^[a-z][a-z0-9]{3}$/, `missing alias for ${option.key}`);
  });
});

test('getSourceTemplateKeyOptions assigns docxAlias to predefined catalog keys', () => {
  const options = overallReportService.getSourceTemplateKeyOptions(sourceTemplate('SRC-5', 'Alias All'));
  const predefined = options.filter((option) => option.origin === 'predefined');
  assert.ok(predefined.length > 0);
  predefined.forEach((option) => {
    assert.match(String(option.docxAlias || ''), /^[a-z][a-z0-9]{3}$/, `missing alias for predefined key ${option.key}`);
  });
});

test('overall template routes expose ensure-source-docx endpoint', () => {
  const routes = read('packages/school/MVC/routes/reportRoutes.js');
  const controller = read('packages/school/MVC/controllers/school/overallReportController.js');
  assert.match(routes, /overall-templates\/ensure-source-docx\/:templateId/);
  assert.match(controller, /async function ensureSourceTemplateDocx/);
  assert.match(controller, /docxAliasesEnsured/);
});

test('overall fields retain relevant layout, guidance, styling, typed defaults, and modes', () => {
  const template = overallTemplate({
    schema: {
      version: 1,
      fields: [
        { id: '__section_1', label: 'Summary', type: 'section', helpText: 'Section help' },
        { id: '__row_break_1', label: 'New Row', type: 'row_break' },
        {
          id: 'confirmed',
          label: 'Confirmed',
          type: 'checkbox',
          overallValueMode: 'manual',
          defaultValue: true,
          required: true,
          fullPageWidth: true,
          hasBorder: true,
          backgroundColor: '#abcdef',
          placeholder: 'Input hint',
          helpText: 'Field help'
        },
        {
          id: 'locked_note',
          label: 'Locked Note',
          type: 'text',
          overallValueMode: 'manual',
          readOnly: true,
          defaultValue: 'Fixed note'
        },
        {
          id: 'source_score',
          label: 'Source Score',
          type: 'number',
          overallValueMode: 'derived_editable',
          calculationRule: { expression: 'source("T1", "score")', onError: 'empty' }
        }
      ]
    }
  });
  const confirmed = template.schema.fields.find((field) => field.id === 'confirmed');
  const lockedNote = template.schema.fields.find((field) => field.id === 'locked_note');
  const derived = template.schema.fields.find((field) => field.id === 'source_score');

  assert.equal(confirmed.defaultValue, true);
  assert.equal(confirmed.fullPageWidth, true);
  assert.equal(confirmed.hasBorder, true);
  assert.equal(confirmed.backgroundColor, '#abcdef');
  assert.equal(confirmed.placeholder, 'Input hint');
  assert.equal(confirmed.helpText, 'Field help');
  assert.equal(confirmed.readOnly, false);
  assert.equal(lockedNote.readOnly, true);
  assert.equal(overallReportService.isOverallFieldEditable(lockedNote), false);
  assert.equal(overallReportService.isOverallFieldEditable(confirmed), true);
  assert.equal(derived.overallValueMode, 'derived_editable');
  assert.equal(derived.calculationRule.onError, 'empty');
  assert.deepEqual(derived.sourceReferences, [{ slotKey: 'T1', key: 'score' }]);
});

test('overall instance sanitizer requires snapshot-aligned source selections', () => {
  const template = overallTemplate();
  const singleTemplate = singleSourceOverallTemplate();
  const singleInstance = overallInstanceModel.sanitizeInstance({
    orgId: 'ORG-1',
    overallTemplateId: 'OVERALL-SINGLE',
    overallTemplateVersion: 1,
    title: 'Single-source snapshot',
    status: 'draft',
    templateSnapshot: singleTemplate,
    sourceSelections: [
      { slotKey: 'T1', templateId: 'SRC-1', instanceId: 'REPORT-1', instanceStatus: 'submitted' }
    ],
    sourceValues: { T1: { score: '80', comments: 'Good' } },
    answers: { summary: 'Initial', extracted_score: 80 },
    derivedOverrides: {}
  });
  assert.deepEqual(singleInstance.sourceSelections.map((row) => row.slotKey), ['T1']);
  const instance = overallInstanceModel.sanitizeInstance({
    orgId: 'ORG-1',
    overallTemplateId: 'OVERALL-1',
    overallTemplateVersion: 1,
    title: 'Snapshot',
    status: 'draft',
    templateSnapshot: template,
    sourceSelections: [
      { slotKey: 'T1', templateId: 'SRC-1', instanceId: 'REPORT-1', instanceStatus: 'submitted' },
      { slotKey: 'T2', templateId: 'SRC-2', instanceId: 'REPORT-2', instanceStatus: 'locked' }
    ],
    sourceValues: sourceValues(),
    answers: { summary: 'Initial', average_score: 85 },
    derivedOverrides: { combined_comments: 'true' }
  });
  assert.equal(instance.derivedOverrides.combined_comments, true);
  assert.throws(
    () => overallInstanceModel.sanitizeInstance({
      ...singleInstance,
      sourceSelections: []
    }),
    /at least one source report instance/
  );
  assert.throws(
    () => overallInstanceModel.sanitizeInstance({
      ...singleInstance,
      templateSnapshot: { ...singleTemplate, sourceSlots: [] }
    }),
    /snapshot is missing source slots/
  );
  assert.throws(
    () => overallInstanceModel.sanitizeInstance({
      ...instance,
      sourceSelections: [
        { slotKey: 'T1', templateId: 'SRC-2', instanceId: 'REPORT-1' },
        { slotKey: 'T2', templateId: 'SRC-2', instanceId: 'REPORT-2' }
      ]
    }),
    /does not match snapshot slot T1/
  );
});

test('creation accepts only matching submitted or locked reports and persists a complete snapshot', async () => {
  const template = { ...overallTemplate(), id: 'OVERALL-1' };
  const templates = {
    'SRC-1': sourceTemplate('SRC-1'),
    'SRC-2': sourceTemplate('SRC-2')
  };
  const instances = {
    'REPORT-1': { id: 'REPORT-1', orgId: 'ORG-1', templateId: 'SRC-1', templateVersion: 3, status: 'submitted', answers: { score: 80, comments: 'Good' }, prefillSnapshot: {} },
    'REPORT-2': { id: 'REPORT-2', orgId: 'ORG-1', templateId: 'SRC-2', templateVersion: 4, status: 'locked', answers: { score: 90, comments: 'Work' }, prefillSnapshot: {} }
  };
  let persisted = null;
  await withPatched(schoolDataService, {
    getDataById: async (entityType, id) => {
      if (entityType === 'reportTemplates') return templates[id] || null;
      if (entityType === 'reportInstances') return instances[id] || null;
      return null;
    },
    addData: async (_entityType, row) => {
      persisted = { ...row, id: 'OVERALL-INSTANCE-1' };
      return persisted;
    }
  }, async () => {
    const created = await overallReportService.createOverallInstance({
      template,
      sourceSelections: [
        { slotKey: 'T1', instanceId: 'REPORT-1' },
        { slotKey: 'T2', instanceId: 'REPORT-2' }
      ],
      selectedDocxKey: 'default',
      title: 'Created Snapshot',
      reqUser
    });
    assert.equal(created.id, 'OVERALL-INSTANCE-1');
    assert.equal(persisted.answers.average_score, 85);
    assert.equal(persisted.sourceValues.T1.score, '80');
    assert.equal(persisted.templateSnapshot.id, 'OVERALL-1');
    assert.equal(persisted.sourceSelections[0].templateVersion, 3);

    instances['REPORT-1'].status = 'draft';
    await assert.rejects(
      overallReportService.createOverallInstance({
        template,
        sourceSelections: [
          { slotKey: 'T1', instanceId: 'REPORT-1' },
          { slotKey: 'T2', instanceId: 'REPORT-2' }
        ],
        selectedDocxKey: 'default',
        reqUser
      }),
      /must be submitted or locked/
    );
  });
});

test('single-source reports create, refresh, submit, lock, and export from the stored T1 snapshot', async () => {
  const fixture = createDocxWithTokens(['T1.score', 'O.extracted_score']);
  try {
    const template = {
      ...singleSourceOverallTemplate({
        docxTemplate: {
          fileName: 'single-source.docx',
          originalName: 'single-source.docx',
          path: fixture.filePath,
          url: ''
        }
      }),
      id: 'OVERALL-SINGLE'
    };
    const reportTemplate = sourceTemplate('SRC-1');
    const sourceInstance = {
      id: 'REPORT-1',
      orgId: 'ORG-1',
      templateId: 'SRC-1',
      templateVersion: 4,
      status: 'submitted',
      answers: { score: 72, comments: 'Initial source' },
      prefillSnapshot: {}
    };
    let persisted = null;

    await withPatched(schoolDataService, {
      getDataById: async (entityType, id) => {
        if (entityType === 'reportTemplates' && id === 'SRC-1') return reportTemplate;
        if (entityType === 'reportInstances' && id === 'REPORT-1') return sourceInstance;
        if (entityType === 'reportAssignments') return null;
        return null;
      },
      addData: async (_entityType, row) => {
        persisted = { ...row, id: 'OVERALL-INSTANCE-SINGLE' };
        return persisted;
      },
      updateData: async (_entityType, _id, updates) => {
        persisted = { ...persisted, ...updates };
        return persisted;
      }
    }, async () => {
      persisted = await overallReportService.createOverallInstance({
        template,
        sourceSelections: [{ slotKey: 'T1', instanceId: 'REPORT-1' }],
        selectedDocxKey: 'default',
        title: 'Single-source extraction',
        reqUser
      });
      assert.equal(persisted.sourceSelections.length, 1);
      assert.equal(persisted.sourceValues.T1.score, '72');
      assert.equal(persisted.answers.extracted_score, '72');

      sourceInstance.answers.score = 88;
      const updatePreview = await overallReportService.buildSourceUpdatePreview(persisted, reqUser);
      assert.ok(updatePreview.changes.some((row) => row.selectionKey === 'T1:score'));
      await overallReportService.applySourceUpdates({
        instance: persisted,
        selectedKeys: ['T1:score'],
        replaceOverrideFieldIds: [],
        reqUser
      });
      assert.equal(persisted.sourceValues.T1.score, '88');
      assert.equal(persisted.answers.extracted_score, '88');

      persisted = await overallReportService.transitionStatus({ instance: persisted, action: 'submit', reqUser });
      persisted = await overallReportService.transitionStatus({ instance: persisted, action: 'lock', reqUser });
      assert.equal(persisted.status, 'locked');

      await withPatched(schoolDataService, {
        getDataById: async () => {
          throw new Error('Export preview must not reread the live single source.');
        }
      }, async () => {
        const exportPreview = await overallReportService.buildExportPreview(persisted);
        assert.equal(exportPreview.ready, true);
        assert.equal(exportPreview.placeholders['T1.score'], '88');
        assert.equal(exportPreview.placeholders['O.extracted_score'], '88');
      });
    });
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('derived overrides are preserved until explicitly replaced', () => {
  const template = overallTemplate();
  const preserved = overallReportService.calculateAnswers({
    template,
    sourceValues: sourceValues(100, 100),
    currentAnswers: {
      summary: 'Manual',
      average_score: 85,
      combined_comments: 'Custom override',
      score_label: 'Average: 85'
    },
    derivedOverrides: { combined_comments: true },
    initialize: false
  });
  assert.equal(preserved.answers.average_score, 100);
  assert.equal(preserved.answers.combined_comments, 'Custom override');
  assert.equal(preserved.answers.score_label, 'Average: 100');

  const replaced = overallReportService.calculateAnswers({
    template,
    sourceValues: sourceValues(100, 100),
    currentAnswers: preserved.answers,
    derivedOverrides: preserved.derivedOverrides,
    replaceOverrideFieldIds: ['combined_comments'],
    initialize: false
  });
  assert.equal(replaced.answers.combined_comments, 'Good Work');
  assert.equal(replaced.derivedOverrides.combined_comments, false);
});

test('source refresh preview and apply are selective and preserve overrides unless replaced', async () => {
  const template = { ...overallTemplate(), id: 'OVERALL-1' };
  const templates = {
    'SRC-1': sourceTemplate('SRC-1'),
    'SRC-2': sourceTemplate('SRC-2')
  };
  const latestInstances = {
    'REPORT-1': {
      id: 'REPORT-1',
      orgId: 'ORG-1',
      templateId: 'SRC-1',
      status: 'submitted',
      answers: { score: 100, comments: 'Excellent' },
      prefillSnapshot: {}
    },
    'REPORT-2': {
      id: 'REPORT-2',
      orgId: 'ORG-1',
      templateId: 'SRC-2',
      status: 'locked',
      answers: { score: 90, comments: 'Work' },
      prefillSnapshot: {}
    }
  };
  const storedSources = {
    T1: { score: '80', comments: 'Good' },
    T2: { score: '90', comments: 'Work' }
  };
  const initialCalculation = overallReportService.calculateAnswers({
    template,
    sourceValues: storedSources,
    currentAnswers: {},
    derivedOverrides: {},
    initialize: true
  });
  let persisted = {
    id: 'OVERALL-INSTANCE-1',
    orgId: 'ORG-1',
    status: 'draft',
    revision: 1,
    audit: {},
    templateSnapshot: template,
    sourceSelections: [
      { slotKey: 'T1', templateId: 'SRC-1', instanceId: 'REPORT-1', instanceTitle: 'First', templateTitle: 'Source 1' },
      { slotKey: 'T2', templateId: 'SRC-2', instanceId: 'REPORT-2', instanceTitle: 'Second', templateTitle: 'Source 2' }
    ],
    sourceValues: storedSources,
    answers: { ...initialCalculation.answers, combined_comments: 'Custom override' },
    derivedOverrides: { combined_comments: true }
  };

  await withPatched(schoolDataService, {
    getDataById: async (entityType, id) => {
      if (entityType === 'reportInstances') return latestInstances[id] || null;
      if (entityType === 'reportTemplates') return templates[id] || null;
      if (entityType === 'reportAssignments') return null;
      return null;
    },
    updateData: async (_entityType, _id, updates) => {
      persisted = { ...persisted, ...updates };
      return persisted;
    }
  }, async () => {
    const preview = await overallReportService.buildSourceUpdatePreview(persisted, reqUser);
    assert.deepEqual(
      preview.changes.map((row) => row.selectionKey).sort(),
      ['T1:comments', 'T1:score']
    );

    const scoreResult = await overallReportService.applySourceUpdates({
      instance: persisted,
      selectedKeys: ['T1:score'],
      replaceOverrideFieldIds: [],
      reqUser
    });
    assert.equal(scoreResult.appliedCount, 1);
    assert.equal(persisted.sourceValues.T1.score, '100');
    assert.equal(persisted.sourceValues.T1.comments, 'Good');
    assert.equal(persisted.answers.average_score, 95);
    assert.equal(persisted.answers.combined_comments, 'Custom override');
    assert.equal(persisted.derivedOverrides.combined_comments, true);

    await overallReportService.applySourceUpdates({
      instance: persisted,
      selectedKeys: ['T1:comments'],
      replaceOverrideFieldIds: ['combined_comments'],
      reqUser
    });
    assert.equal(persisted.sourceValues.T1.comments, 'Excellent');
    assert.equal(persisted.answers.combined_comments, 'Excellent Work');
    assert.equal(persisted.derivedOverrides.combined_comments, false);
  });
});

test('overall report lifecycle follows draft, submitted, locked, unlock, and reopen transitions', async () => {
  const template = overallTemplate();
  const storedSources = {
    T1: { score: '80', comments: 'Good' },
    T2: { score: '90', comments: 'Work' }
  };
  const calculated = overallReportService.calculateAnswers({
    template,
    sourceValues: storedSources,
    currentAnswers: {},
    derivedOverrides: {},
    initialize: true
  });
  let persisted = {
    id: 'OVERALL-INSTANCE-1',
    orgId: 'ORG-1',
    status: 'draft',
    revision: 1,
    audit: {},
    templateSnapshot: template,
    sourceValues: storedSources,
    answers: calculated.answers,
    derivedOverrides: {}
  };
  await withPatched(schoolDataService, {
    updateData: async (_entityType, _id, updates) => {
      persisted = { ...persisted, ...updates };
      return persisted;
    }
  }, async () => {
    persisted = await overallReportService.transitionStatus({ instance: persisted, action: 'submit', reqUser });
    assert.equal(persisted.status, 'submitted');
    persisted = await overallReportService.transitionStatus({ instance: persisted, action: 'lock', reqUser });
    assert.equal(persisted.status, 'locked');
    persisted = await overallReportService.transitionStatus({ instance: persisted, action: 'unlock', reqUser });
    assert.equal(persisted.status, 'submitted');
    persisted = await overallReportService.transitionStatus({ instance: persisted, action: 'reopen', reqUser });
    assert.equal(persisted.status, 'draft');
  });
});

test('DOCX inspection recognizes split namespaced tokens and export preview uses only stored snapshots', async () => {
  const fixture = createDocxWithTokens(['T1.score', 'T2.score', 'O.average_score']);
  try {
    const inspection = await docxService.inspectDocxTemplateTokens({
      fileName: 'template.docx',
      originalName: 'template.docx',
      path: fixture.filePath
    });
    assert.deepEqual(inspection.tokens.sort(), ['O.average_score', 'T1.score', 'T2.score']);

    const template = overallTemplate({
      docxTemplate: {
        fileName: 'template.docx',
        originalName: 'template.docx',
        path: fixture.filePath,
        url: ''
      }
    });
    const calculated = overallReportService.calculateAnswers({
      template,
      sourceValues: sourceValues(),
      currentAnswers: {},
      derivedOverrides: {},
      initialize: true
    });
    const instance = {
      id: 'OVERALL-INSTANCE-1',
      orgId: 'ORG-1',
      status: 'submitted',
      selectedDocxKey: 'default',
      templateSnapshot: template,
      sourceValues: sourceValues(),
      answers: calculated.answers,
      derivedOverrides: {},
      revision: 1
    };
    await withPatched(schoolDataService, {
      getDataById: async () => {
        throw new Error('Live source data must not be read during export preview.');
      }
    }, async () => {
      const preview = await overallReportService.buildExportPreview(instance);
      assert.equal(preview.ready, true);
      assert.deepEqual(preview.missingTokens, []);
      assert.equal(preview.placeholders['O.average_score'], 85);
    });
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('registry, maintenance, access, seeding, and Mongo index integrations are declared', () => {
  const controller = read('packages/school/MVC/controllers/school/overallReportController.js');
  const routes = read('packages/school/MVC/routes/reportRoutes.js');
  const repository = read('packages/school/MVC/repositories/school/index.js');
  const deletionRegistry = read('packages/school/MVC/services/school/schoolDeletionRuleRegistry.js');
  const maintenance = read('packages/school/MVC/config/schoolDataMaintenanceCatalog.js');
  const seed = read('scripts/seed-school-overall-report-sections.js');
  const manifest = JSON.parse(read('packages/school/package.manifest.json'));
  const sections = JSON.parse(read('data/sections.json'));
  const symbols = JSON.parse(read('data/symbols.json'));

  assert.match(controller, /nextSlotNumber:\s*2/);
  assert.match(controller, /sourceSlots:\s*\[\s*\{\s*slotKey:\s*'T1'/);
  assert.match(routes, /overallTemplateMutationActionState/);
  assert.match(controller, /includeModal:\s*true/);
  assert.match(controller, /includeModal_Table:\s*true/);
  assert.match(repository, /schoolOverallReportTemplates/);
  assert.match(repository, /schoolOverallReportInstances/);
  assert.match(deletionRegistry, /sourceSlots\.templateId/);
  assert.match(deletionRegistry, /sourceSelections\.instanceId/);
  assert.match(maintenance, /overallReportTemplates/);
  assert.match(maintenance, /overallReportInstances/);
  assert.match(seed, /deleteMany/);
  assert.ok(manifest.mongoIndexes.some((row) => row.path === 'config/mongoIndexes.js'));
  assert.ok(sections.some((row) => row.id === '446104' && row.name === 'SCHOOL_REPORTS_OVERALL_TEMPLATE'));
  assert.ok(sections.some((row) => row.id === '446105' && row.name === 'SCHOOL_REPORTS_OVERALL_INSTANCES'));
  assert.ok(symbols.some((row) => row.id === 'SYM_SYSTEM_129'));
  assert.ok(symbols.some((row) => row.id === 'SYM_SYSTEM_130'));
});

test('overall template, creation, and instance views render searchable pickers and parseable client scripts', async () => {
  const template = { ...overallTemplate(), id: 'OVERALL-1' };
  const templateListSource = read('packages/school/MVC/views/school/report/overallTemplateList.ejs');
  const reportListSource = read('packages/school/MVC/views/school/report/overallReportList.ejs');
  template.schema.fields = [
    { id: '__section_1', label: 'Summary Section', type: 'section', helpText: 'Section guidance', fullPageWidth: true },
    { ...template.schema.fields[0], helpText: 'Summary guidance', placeholder: 'Enter a summary', fullPageWidth: true, hasBorder: true, backgroundColor: '#f0f8ff' },
    { id: '__row_break_1', label: 'New Row', type: 'row_break', fullPageWidth: true },
    { id: 'confirmed', label: 'Confirmed', type: 'checkbox', overallValueMode: 'manual', defaultValue: true, docxAlias: 'c0nf', validationRules: [], conversionRule: { enabled: false, expression: '', onError: 'use_raw' } },
    ...template.schema.fields.slice(1)
  ];
  const sourceRows = [sourceTemplate('SRC-1'), sourceTemplate('SRC-2')].map((row) => {
    const keyOptions = overallReportService.getSourceTemplateKeyOptions(row);
    return { ...row, keyOptions, keyCatalog: keyOptions.map((option) => option.key) };
  });
  const renderOptions = { views: [path.join(ROOT_DIR, 'MVC/views')] };
  const templateHtml = await ejs.renderFile(
    path.join(ROOT_DIR, 'packages/school/MVC/views/school/report/overallTemplateForm.ejs'),
    {
      title: 'Edit Overall Report Template',
      actionStateId: 'ACTION-1',
      template,
      sourceTemplates: sourceRows,
      funderPickerOptions: [{ id: 'FUNDER-1', label: 'Funder One' }],
      valueModes: ['manual', 'derived_editable', 'derived_locked'],
      statuses: ['draft', 'active', 'inactive', 'archived'],
      user: reqUser
    },
    renderOptions
  );
  const calculated = overallReportService.calculateAnswers({
    template,
    sourceValues: sourceValues(),
    currentAnswers: {},
    derivedOverrides: {},
    initialize: true
  });
  const editorHtml = await ejs.renderFile(
    path.join(ROOT_DIR, 'packages/school/MVC/views/school/report/overallReportEditor.ejs'),
    {
      title: 'Overall Report',
      actionStateId: 'ACTION-2',
      instance: {
        id: 'OVERALL-INSTANCE-1',
        title: 'Overall Report',
        status: 'draft',
        revision: 1,
        answers: calculated.answers,
        derivedOverrides: {},
        sourceSelections: [],
        sourceValues: sourceValues(),
        generatedDocs: []
      },
      template,
      validation: { errors: [{ fieldId: 'summary', severity: 'error', message: 'Summary is required.' }], warnings: [], hasBlockingErrors: true },
      exportPreview: { placeholders: {}, missingTokens: [], validation: { hasBlockingErrors: true } }
    },
    renderOptions
  );
  const createHtml = await ejs.renderFile(
    path.join(ROOT_DIR, 'packages/school/MVC/views/school/report/overallReportCreate.ejs'),
    {
      title: 'Create Overall Report',
      actionStateId: 'ACTION-3',
      template,
      sourceSlots: template.sourceSlots.map((slot) => ({
        ...slot,
        templateTitle: `Template ${slot.slotKey}`,
        templateType: 'progress_report',
        templateVersion: 1
      })),
      docxOptions: [{ key: 'default', label: 'Default', fileName: 'overall.docx' }],
      hasOverallFields: true,
      instance: null,
      readOnly: false,
      user: reqUser
    },
    renderOptions
  );
  const listPagination = {
    currentPage: 1,
    totalPages: 1,
    totalItems: 1,
    startItem: 1,
    endItem: 1,
    limit: 10
  };
  const templateListHtml = await ejs.renderFile(
    path.join(ROOT_DIR, 'packages/school/MVC/views/school/report/overallTemplateList.ejs'),
    {
      title: 'Overall Report Templates',
      tableName: 'overallReportTemplates',
      data: [template],
      pagination: listPagination,
      filters: {},
      newUrl: 'school/reports/overall-templates',
      newLabel: 'New Overall Template',
      print: false,
      user: reqUser
    },
    renderOptions
  );
  const reportListHtml = await ejs.renderFile(
    path.join(ROOT_DIR, 'packages/school/MVC/views/school/report/overallReportList.ejs'),
    {
      title: 'Overall Reports',
      tableName: 'overallReportInstances',
      data: [{
        id: 'OVERALL-INSTANCE-1',
        title: 'Overall Report',
        overallTemplateId: template.id,
        overallTemplateVersion: 1,
        sourceSelections: [{ slotKey: 'T1', instanceId: 'REPORT-1' }],
        status: 'submitted',
        revision: 1,
        generatedDocs: [{ fileName: 'overall.docx' }]
      }],
      pagination: listPagination,
      filters: {},
      newUrl: null,
      newLabel: null,
      print: false,
      user: reqUser
    },
    renderOptions
  );

  assert.match(templateHtml, /id="fieldAccess"/);
  assert.match(templateHtml, /Field access/);
  assert.match(templateHtml, /fieldIsReadOnly/);
  assert.match(templateHtml, /Use Source \/ Predefined Value/);
  assert.match(templateHtml, /sourceMode:\s*'local'/);
  assert.match(templateHtml, /searchFields:\s*'key,label,description,templateTitle,slotKey,origin,group,fieldId,fieldType'/);
  assert.match(templateHtml, /ensure-source-docx/);
  assert.match(templateHtml, /ensureSourceTemplateDocxAliases/);
  assert.match(templateHtml, /<th>DOCX Shortcut<\/th>/);
  assert.match(templateHtml, /docxShortcut/);
  assert.doesNotMatch(templateHtml, /sourceDocxAliasByFieldId/);
  assert.match(templateHtml, /group: 'O'/);
  assert.doesNotMatch(templateHtml, /group:'Overall alias'/);
  assert.match(templateHtml, /btnAddSection/);
  assert.match(templateHtml, /overall-field-row/);
  assert.match(templateHtml, /Template Has Different Keys/);
  assert.match(templateHtml, /Source Slot Is In Use/);
  assert.match(templateHtml, /slots\.length <= 1/);
  assert.match(templateHtml, /slots\.length < 1/);
  assert.match(templateHtml, /Select at least one source template\./);
  assert.match(templateHtml, /Field Is In Use/);
  assert.match(templateHtml, /title:\s*'Select Funder'/);
  assert.doesNotMatch(templateHtml, /id="funderPicker"/);
  assert.doesNotMatch(templateHtml, /id="formulaSourceKey"/);
  assert.doesNotMatch(templateHtml, /js-slot-template/);
  assert.match(createHtml, /btnLoadCandidates/);
  assert.match(createHtml, /overall-reports\/api\/load-candidates/);
  assert.match(createHtml, /js-date-range/);
  assert.match(createHtml, /workspaceStudentsTable/);
  assert.match(createHtml, /btnSaveWorkspace/);
  assert.match(createHtml, /btnExportZip/);
  assert.match(createHtml, /ReportMessaging/);
  assert.doesNotMatch(createHtml, /name="sourceInstance_T1"/);
  assert.doesNotMatch(createHtml, /js-pick-source-report/);
  assert.match(editorHtml, /Summary guidance/);
  assert.match(editorHtml, /background-color:#f0f8ff/);
  assert.match(editorHtml, /type="checkbox"[^>]+data-field-id="confirmed"/);
  assert.match(editorHtml, /Summary is required\./);
  assert.match(editorHtml, /async function showReportMessage/);
  assert.match(editorHtml, /await showReportMessage/);
  assert.match(editorHtml, /await confirmReportAction/);
  assert.match(createHtml, /window\.ReportMessaging/);
  assert.match(templateHtml, /window\.ReportMessaging/);
  assert.match(templateHtml, /fetch\(form\.action/);
  assert.match(templateHtml, /X-Requested-With/);
  assert.match(templateHtml, /window\.location\.href = '\/school\/reports\/overall-templates'/);
  assert.match(templateListSource, /btn-row-actions-toggle/);
  assert.match(templateListSource, /bi-three-dots-vertical/);
  assert.match(templateListSource, /js-delete-overall-template/);
  assert.match(templateListSource, /Delete Overall Report Template\?/);
  assert.match(reportListSource, /js-remove-overall-report/);
  assert.match(reportListSource, /Archive <strong>/);
  assert.match(templateListHtml, /data-template-title="Consolidated Progress"/);
  assert.match(reportListHtml, /data-action="Archive"/);

  [templateHtml, editorHtml, createHtml, templateListSource, reportListSource].forEach((source) => {
    assert.doesNotMatch(source, /(^|[^.\w])(?:alert|confirm)\s*\(/m);
  });

  [templateHtml, editorHtml, createHtml].forEach((html) => {
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    assert.ok(scripts.length > 0);
    scripts.forEach((source) => new Function(source));
  });
  [templateListSource, reportListSource].forEach((source) => {
    const scripts = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    assert.equal(scripts.length, 1);
    scripts.forEach((clientScript) => new Function(clientScript));
  });
});

test('loadOverallCreateCandidates groups by student and respects sessionDate, status, and student filters', async () => {
  const template = { ...overallTemplate(), id: 'OVERALL-1' };
  const templates = {
    'SRC-1': sourceTemplate('SRC-1'),
    'SRC-2': sourceTemplate('SRC-2')
  };
  const instances = [
    {
      id: 'R1', orgId: 'ORG-1', templateId: 'SRC-1', status: 'submitted', studentId: 'STU-1',
      sessionDate: '2026-07-10', prefillSnapshot: { student_full_name: 'Ada', class_name: 'A', teacher_name: 'T' }
    },
    {
      id: 'R2', orgId: 'ORG-1', templateId: 'SRC-2', status: 'locked', studentId: 'STU-1',
      sessionDate: '2026-07-11', prefillSnapshot: { student_full_name: 'Ada', class_name: 'A', teacher_name: 'T' }
    },
    {
      id: 'R3', orgId: 'ORG-1', templateId: 'SRC-1', status: 'submitted', studentId: 'STU-2',
      sessionDate: '2026-07-12', prefillSnapshot: { student_full_name: 'Bob', class_name: 'B', teacher_name: 'T' }
    },
    {
      id: 'R4', orgId: 'ORG-1', templateId: 'SRC-1', status: 'draft', studentId: 'STU-1',
      sessionDate: '2026-07-10', prefillSnapshot: { student_full_name: 'Ada' }
    },
    {
      id: 'R5', orgId: 'ORG-1', templateId: 'SRC-1', status: 'submitted', studentId: 'STU-1',
      sessionDate: '2026-06-01', prefillSnapshot: { student_full_name: 'Ada' }
    }
  ];
  await withPatched(schoolDataService, {
    getDataById: async (entityType, id) => {
      if (entityType === 'reportTemplates') return templates[id] || null;
      return null;
    },
    fetchData: async (entityType) => {
      if (entityType === 'reportInstances') return instances;
      if (entityType === 'reportTemplates') return Object.values(templates);
      return [];
    }
  }, async () => {
    const result = await overallReportService.loadOverallCreateCandidates({
      template,
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      statuses: ['submitted', 'locked'],
      reqUser
    });
    assert.equal(result.students.length, 2);
    const ada = result.students.find((row) => row.studentId === 'STU-1');
    assert.ok(ada);
    assert.equal(ada.slots.T1.length, 1);
    assert.equal(ada.slots.T1[0].id, 'R1');
    assert.equal(ada.slots.T2.length, 1);

    const filtered = await overallReportService.loadOverallCreateCandidates({
      template,
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      studentIds: ['STU-2'],
      statuses: ['submitted', 'locked'],
      reqUser
    });
    assert.equal(filtered.students.length, 1);
    assert.equal(filtered.students[0].studentId, 'STU-2');

    const withDraft = await overallReportService.loadOverallCreateCandidates({
      template,
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      studentIds: ['STU-1'],
      statuses: ['draft', 'submitted'],
      reqUser
    });
    assert.equal(withDraft.students[0].slots.T1.length, 2);
  });
});

test('createOverallWorkspace and saveOverallWorkspace persist multi-student entries and support remove-on-save', async () => {
  const template = { ...overallTemplate(), id: 'OVERALL-1' };
  const templates = {
    'SRC-1': sourceTemplate('SRC-1'),
    'SRC-2': sourceTemplate('SRC-2')
  };
  const instances = {
    'R1': {
      id: 'R1', orgId: 'ORG-1', templateId: 'SRC-1', templateVersion: 1, status: 'submitted',
      studentId: 'STU-1', answers: { score: 70, comments: 'A' }, prefillSnapshot: {}
    },
    'R2': {
      id: 'R2', orgId: 'ORG-1', templateId: 'SRC-2', templateVersion: 1, status: 'locked',
      studentId: 'STU-1', answers: { score: 80, comments: 'B' }, prefillSnapshot: {}
    },
    'R3': {
      id: 'R3', orgId: 'ORG-1', templateId: 'SRC-1', templateVersion: 1, status: 'submitted',
      studentId: 'STU-2', answers: { score: 60, comments: 'C' }, prefillSnapshot: {}
    },
    'R4': {
      id: 'R4', orgId: 'ORG-1', templateId: 'SRC-2', templateVersion: 1, status: 'submitted',
      studentId: 'STU-2', answers: { score: 90, comments: 'D' }, prefillSnapshot: {}
    }
  };
  let stored = null;
  await withPatched(schoolDataService, {
    getDataById: async (entityType, id) => {
      if (entityType === 'reportTemplates') return templates[id] || null;
      if (entityType === 'reportInstances') return instances[id] || null;
      if (entityType === 'overallReportInstances') return stored && stored.id === id ? stored : null;
      return null;
    },
    addData: async (_entityType, row) => {
      stored = overallInstanceModel.sanitizeInstance({ ...row, id: 'OVR-WS-1' });
      return stored;
    },
    updateData: async (_entityType, id, updates) => {
      stored = overallInstanceModel.sanitizeInstance({ ...stored, ...updates, id }, { existing: stored, isUpdate: true });
      return stored;
    }
  }, async () => {
    const created = await overallReportService.createOverallWorkspace({
      template,
      filters: { startDate: '2026-07-01', endDate: '2026-07-31', statuses: ['submitted', 'locked'] },
      selectedDocxKey: 'default',
      title: 'Workspace Report',
      studentEntries: [
        {
          studentId: 'STU-1',
          studentName: 'Ada',
          sourceSelections: [
            { slotKey: 'T1', instanceId: 'R1' },
            { slotKey: 'T2', instanceId: 'R2' }
          ]
        },
        {
          studentId: 'STU-2',
          studentName: 'Bob',
          sourceSelections: [
            { slotKey: 'T1', instanceId: 'R3' },
            { slotKey: 'T2', instanceId: 'R4' }
          ]
        }
      ],
      reqUser
    });
    assert.equal(created.studentEntries.length, 2);
    assert.equal(created.studentEntries[0].answers.average_score, 75);

    const preview = overallReportService.previewStudentEntry({
      instance: created,
      studentId: 'STU-1'
    });
    assert.equal(preview.hasOverallFields, true);
    assert.ok(preview.fields.some((field) => field.id === 'summary' && field.editable));

    const savedAnswers = await overallReportService.saveStudentAnswers({
      instance: created,
      studentId: 'STU-1',
      submittedAnswers: { summary: 'Updated summary' },
      reqUser
    });
    assert.equal(savedAnswers.preview.answers.summary, 'Updated summary');

    const saved = await overallReportService.saveOverallWorkspace({
      instance: savedAnswers.instance,
      title: 'Workspace Report',
      selectedDocxKey: 'default',
      studentEntries: [
        {
          studentId: 'STU-2',
          studentName: 'Bob',
          sourceSelections: [
            { slotKey: 'T1', instanceId: 'R3' },
            { slotKey: 'T2', instanceId: 'R4' }
          ],
          answers: savedAnswers.instance.studentEntries.find((row) => row.studentId === 'STU-2')?.answers || {}
        }
      ],
      reqUser
    });
    assert.equal(saved.studentEntries.length, 1);
    assert.equal(saved.studentEntries[0].studentId, 'STU-2');

    const wrapped = overallReportService.ensureWorkspaceShape({
      ...created,
      studentEntries: [],
      sourceSelections: created.sourceSelections,
      sourceValues: created.sourceValues,
      answers: created.answers
    });
    assert.equal(wrapped.studentEntries.length, 1);
    assert.equal(wrapped.studentEntries[0].studentId, 'LEGACY');
  });
});
