const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const overallTemplateModel = require('../packages/school/MVC/models/school/overallReportTemplateModel');
const overallReportService = require('../packages/school/MVC/services/school/overallReportService');
const overallReportManagementService = require('../packages/school/MVC/services/school/overallReportManagementService');
const overallReportManagementSessionModel = require('../packages/school/MVC/models/school/overallReportManagementSessionModel');
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
          validationRules: [],
          conversionRule: { enabled: false, expression: '', onError: 'use_raw' }
        }
      ]
    },
    placeholderMap: { score: '{{score}}' },
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
        }
      ]
    },
    placeholderMap: {},
    docxTemplate: null,
    docxTemplatesByFunder: [],
    ...overrides
  });
}

function candidateFixtures() {
  const templates = {
    'OVERALL-A': { ...overallTemplate({ title: 'Template A' }), id: 'OVERALL-A' },
    'OVERALL-B': {
      ...overallTemplate({
        title: 'Template B',
        sourceSlots: [{ slotKey: 'T1', order: 1, templateId: 'SRC-1', templateVersionAtSelection: 1 }]
      }),
      id: 'OVERALL-B'
    },
    'SRC-1': sourceTemplate('SRC-1'),
    'SRC-2': sourceTemplate('SRC-2')
  };
  const instances = [
    {
      id: 'R1', orgId: 'ORG-1', templateId: 'SRC-1', status: 'submitted', studentId: 'STU-1',
      sessionDate: '2026-07-10', title: 'Report 1', prefillSnapshot: { student_full_name: 'Ada' }
    },
    {
      id: 'R2', orgId: 'ORG-1', templateId: 'SRC-2', status: 'locked', studentId: 'STU-1',
      sessionDate: '2026-07-11', title: 'Report 2', prefillSnapshot: { student_full_name: 'Ada' }
    },
    {
      id: 'R3', orgId: 'ORG-1', templateId: 'SRC-1', status: 'submitted', studentId: 'STU-2',
      sessionDate: '2026-07-12', title: 'Report 3', prefillSnapshot: { student_full_name: 'Bob' }
    }
  ];
  return { templates, instances };
}

test('loadManagementMatrix merges students across templates and detects matching templates', async () => {
  const { templates, instances } = candidateFixtures();
  await withPatched(schoolDataService, {
    getDataById: async (entityType, id) => {
      if (entityType === 'overallReportTemplates') return templates[id] || null;
      if (entityType === 'reportTemplates') return templates[id] || null;
      return null;
    },
    fetchData: async (entityType) => {
      if (entityType === 'reportInstances') return instances;
      if (entityType === 'reportTemplates') return Object.values(templates).filter((row) => row.id.startsWith('SRC-'));
      return [];
    }
  }, async () => {
    const matrix = await overallReportManagementService.loadManagementMatrix({
      templateIds: ['OVERALL-A', 'OVERALL-B'],
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      reqUser
    });
    assert.equal(matrix.students.length, 2);
    const ada = matrix.students.find((row) => row.studentId === 'STU-1');
    assert.ok(ada);
    assert.equal(ada.matchingTemplates.length, 2);
    assert.equal(ada.selectedOverallTemplateId, null);
    const bob = matrix.students.find((row) => row.studentId === 'STU-2');
    assert.equal(bob.matchingTemplates.length, 1);
    assert.equal(bob.matchingTemplates[0].templateId, 'OVERALL-B');
    assert.equal(bob.selectedOverallTemplateId, 'OVERALL-B');
  });
});

test('saveManagementSession locks dates after first save and blocks template removal when referenced', async () => {
  let stored = null;
  await withPatched(schoolDataService, {
    addData: async (_type, row) => {
      stored = { ...row, id: 'OVRMSG-TEST-1' };
      return stored;
    },
    updateData: async (_type, id, updates) => {
      stored = { ...stored, ...updates, id };
      return stored;
    },
    getDataById: async (_type, id) => (id === 'OVRMSG-TEST-1' ? stored : null)
  }, async () => {
    const saved = await overallReportManagementService.saveManagementSession({
      title: 'Batch July',
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      selectedTemplateIds: ['OVERALL-A'],
      rows: [{
        studentId: 'STU-1',
        studentName: 'Ada',
        instances: [],
        sourceSelections: [{ slotKey: 'T1', instanceId: 'R1' }, { slotKey: 'T2', instanceId: 'R2' }],
        selectedOverallTemplateId: 'OVERALL-A',
        excludedOverallTemplateIds: [],
        overallInstanceId: null,
        selectedDocxKey: 'default'
      }],
      reqUser
    });
    assert.equal(saved.id, 'OVRMSG-TEST-1');
    await assert.rejects(
      () => overallReportManagementService.saveManagementSession({
        id: saved.id,
        title: 'Batch July',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        selectedTemplateIds: ['OVERALL-A'],
        rows: saved.rows,
        reqUser
      }),
      /Date range cannot be changed/
    );
    await assert.rejects(
      () => overallReportManagementService.saveManagementSession({
        id: saved.id,
        title: 'Batch July',
        startDate: '2026-07-01',
        endDate: '2026-07-31',
        selectedTemplateIds: [],
        rows: saved.rows,
        reqUser
      }),
      /cannot be removed/
    );
  });
});

test('addStudentsToSession appends only new students within locked dates', async () => {
  const { templates, instances } = candidateFixtures();
  const session = overallReportManagementSessionModel.sanitizeSession({
    orgId: 'ORG-1',
    title: 'Batch',
    status: 'draft',
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    selectedTemplateIds: ['OVERALL-A', 'OVERALL-B'],
    addFilters: { studentIds: [], statuses: ['submitted', 'locked'] },
    rows: [{
      studentId: 'STU-1',
      studentName: 'Ada',
      instances: [],
      sourceSelections: [],
      selectedOverallTemplateId: null,
      excludedOverallTemplateIds: [],
      overallInstanceId: null,
      selectedDocxKey: 'default'
    }],
    audit: {
      createUser: 'USER-1',
      createDateTime: '2026-07-31T00:00:00.000Z',
      lastUpdateUser: 'USER-1',
      lastUpdateDateTime: '2026-07-31T00:00:00.000Z'
    }
  });
  let updated = null;
  await withPatched(schoolDataService, {
    getDataById: async (entityType, id) => {
      if (entityType === 'overallReportTemplates') return templates[id] || null;
      if (entityType === 'reportTemplates') return templates[id] || null;
      return null;
    },
    fetchData: async (entityType) => {
      if (entityType === 'reportInstances') return instances;
      if (entityType === 'reportTemplates') return Object.values(templates).filter((row) => row.id.startsWith('SRC-'));
      return [];
    },
    updateData: async (_type, _id, patch) => {
      updated = { ...session, ...patch };
      return updated;
    }
  }, async () => {
    const result = await overallReportManagementService.addStudentsToSession({
      session,
      addFilters: { studentIds: [], statuses: ['submitted', 'locked'] },
      reqUser
    });
    assert.equal(result.added.length, 1);
    assert.equal(result.added[0].studentId, 'STU-2');
    assert.equal(result.session.rows.length, 2);
  });
});

test('createRowOverallInstance creates a per-student OVRINS without requiring docx', async () => {
  const template = { ...overallTemplate({ docxTemplate: null }), id: 'OVERALL-A' };
  const reportTemplates = {
    'SRC-1': sourceTemplate('SRC-1'),
    'SRC-2': sourceTemplate('SRC-2')
  };
  const instances = {
    'R1': {
      id: 'R1', orgId: 'ORG-1', templateId: 'SRC-1', studentId: 'STU-1', status: 'submitted',
      answers: { score: 80 }, prefillSnapshot: {}
    },
    'R2': {
      id: 'R2', orgId: 'ORG-1', templateId: 'SRC-2', studentId: 'STU-1', status: 'locked',
      answers: { score: 90 }, prefillSnapshot: {}
    }
  };
  const session = overallReportManagementSessionModel.sanitizeSession({
    orgId: 'ORG-1',
    title: 'Batch',
    status: 'draft',
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    selectedTemplateIds: ['OVERALL-A'],
    addFilters: { studentIds: [], statuses: ['submitted', 'locked'] },
    rows: [{
      studentId: 'STU-1',
      studentName: 'Ada',
      instances: [],
      sourceSelections: [{ slotKey: 'T1', instanceId: 'R1' }, { slotKey: 'T2', instanceId: 'R2' }],
      selectedOverallTemplateId: 'OVERALL-A',
      excludedOverallTemplateIds: [],
      overallInstanceId: null,
      selectedDocxKey: 'default'
    }],
    audit: {
      createUser: 'USER-1',
      createDateTime: '2026-07-31T00:00:00.000Z',
      lastUpdateUser: 'USER-1',
      lastUpdateDateTime: '2026-07-31T00:00:00.000Z'
    }
  });
  let createdInstance = null;
  let updatedSession = null;
  await withPatched(schoolDataService, {
    getDataById: async (entityType, id) => {
      if (entityType === 'overallReportTemplates') return template;
      if (entityType === 'reportTemplates') return reportTemplates[id] || null;
      if (entityType === 'reportInstances') return instances[id] || null;
      return null;
    },
    addData: async (entityType, row) => {
      if (entityType === 'overallReportInstances') {
        createdInstance = { ...row, id: 'OVRINS-ROW-1' };
        return createdInstance;
      }
      return row;
    },
    updateData: async (_type, _id, patch) => {
      updatedSession = { ...session, ...patch };
      return updatedSession;
    }
  }, async () => {
    const result = await overallReportManagementService.createRowOverallInstance({
      session,
      studentId: 'STU-1',
      reqUser
    });
    assert.equal(result.instance.id, 'OVRINS-ROW-1');
    assert.equal(result.instance.studentEntries.length, 1);
    assert.equal(result.instance.studentEntries[0].studentId, 'STU-1');
    assert.equal(updatedSession.rows[0].overallInstanceId, 'OVRINS-ROW-1');
  });
});

test('buildOverallExportPayload returns answers and validation summary', () => {
  const payload = overallReportService.buildOverallExportPayload({
    id: 'OVRINS-1',
    title: 'Test',
    status: 'draft',
    overallTemplateId: 'OVERALL-A',
    overallTemplateVersion: 1,
    selectedDocxKey: 'default',
    templateSnapshot: overallTemplate(),
    studentEntries: [{
      studentId: 'STU-1',
      studentName: 'Ada',
      sourceSelections: [],
      sourceValues: { T1: { score: 80 } },
      answers: { summary: 'Done' },
      derivedOverrides: {},
      generatedDocs: [],
      included: true
    }]
  });
  assert.equal(payload.id, 'OVRINS-1');
  assert.equal(payload.answers.summary, 'Done');
  assert.ok(payload.validation);
  assert.ok(payload.exportedAt);
});

test('overall management section, routes, and views are registered', () => {
  const sections = JSON.parse(read('data/sections.json'));
  const routes = read('packages/school/MVC/routes/reportRoutes.js');
  const listView = read('packages/school/MVC/views/school/report/overallManagementList.ejs');
  const workspaceView = read('packages/school/MVC/views/school/report/overallManagementWorkspace.ejs');
  const clientScript = read('public/scripts/overallReportManagement.js');
  const repository = read('packages/school/MVC/repositories/school/index.js');

  assert.ok(sections.some((row) => row.id === '446107' && row.name === 'SCHOOL_REPORTS_OVERALL_MANAGEMENT'));
  assert.match(routes, /overall-management/);
  assert.match(routes, /overallReportManagementController/);
  assert.match(repository, /overallReportManagementSessions/);
  assert.match(listView, /overall-management\/edit/);
  assert.match(workspaceView, /Matching templates/);
  assert.match(clientScript, /Export Payload/);
  assert.match(clientScript, /js-create-row/);
  assert.match(clientScript, /hasAttachedDocx/);
});
