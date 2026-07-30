const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const reportScopePolicy = require('../packages/school/MVC/services/school/reportScopePolicy');
const reportTemplateModel = require('../packages/school/MVC/models/school/reportTemplateModel');
const reportIntegrityService = require('../packages/school/MVC/services/school/reportIntegrityService');
const reportController = require('../packages/school/MVC/controllers/school/reportController');
const schoolDataService = require('../packages/school/MVC/services/school/schoolDataService');
const schoolRepositories = require('../packages/school/MVC/repositories/school');

const ROOT_DIR = path.resolve(__dirname, '..');
const reqUser = { id: 'USER-1', personId: 'PERSON-1', activeOrgId: '900000' };

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

function templatePayload(overrides = {}) {
  return {
    orgId: '900000',
    type: 'progress_report_v1',
    version: 1,
    title: 'Progress Report',
    status: 'active',
    description: '',
    schema: { version: 1, fields: [] },
    placeholderMap: {},
    ...overrides
  };
}

test('template report scopes default legacy records to all canonical scopes', () => {
  assert.deepEqual(
    reportScopePolicy.resolveAllowedReportScopes({ id: 'TPL-LEGACY' }),
    ['class', 'each_student', 'selected_students']
  );
  assert.deepEqual(
    reportTemplateModel.sanitizeTemplate(templatePayload()).allowedReportScopes,
    ['class', 'each_student', 'selected_students']
  );
});

test('template report scopes reject empty and unknown values and preserve canonical order', () => {
  assert.deepEqual(
    reportScopePolicy.normalizeAllowedReportScopes([
      'selected_students',
      'class',
      'selected_students'
    ]),
    ['class', 'selected_students']
  );
  assert.throws(
    () => reportScopePolicy.normalizeAllowedReportScopes([]),
    /Select at least one approved report scope/
  );
  assert.throws(
    () => reportScopePolicy.normalizeAllowedReportScopes(['class', 'school']),
    /Invalid template report scope/
  );
});

test('template list API resolves allowedReportScopes for legacy templates', async () => {
  await withPatched(schoolDataService, {
    fetchData: async () => [{
      id: 'TPL-LEGACY',
      orgId: '900000',
      title: 'Legacy',
      type: 'progress_report_v1',
      status: 'active',
      audit: {}
    }]
  }, async () => {
    let responsePayload = null;
    await reportController.listTemplates({
      query: {},
      headers: { 'x-requested-with': 'XMLHttpRequest' },
      user: reqUser
    }, {
      json(payload) {
        responsePayload = payload;
        return payload;
      },
      status() {
        return this;
      },
      render() {
        throw new Error('Expected JSON response.');
      }
    });

    assert.equal(responsePayload.status, 'success');
    assert.deepEqual(
      responsePayload.results[0].allowedReportScopes,
      ['class', 'each_student', 'selected_students']
    );
  });
});

test('assignment validation rejects a scope not approved by its template', async () => {
  await withPatched(schoolDataService, {
    getDataById: async (entityType, id) => (
      entityType === 'classes' && id === 'CLASS-1'
        ? { id: 'CLASS-1', orgId: '900000', title: 'Class 1' }
        : null
    ),
    getClassSessions: async () => []
  }, async () => {
    await withPatched(schoolRepositories.reportTemplates, {
      getById: async () => ({
        id: 'TPL-1',
        orgId: '900000',
        allowedReportScopes: ['each_student']
      })
    }, async () => {
      await assert.rejects(
        reportIntegrityService.validateAssignmentCrossEntityContext({
          classId: 'CLASS-1',
          templateId: 'TPL-1',
          reqUser,
          reportScope: 'class'
        }),
        /Whole Class.*not approved/
      );
    });
  });
});

test('template scope removal is blocked by assignments of every status', async () => {
  await withPatched(schoolRepositories.reportTemplates, {
    getById: async () => ({
      id: 'TPL-1',
      orgId: '900000',
      allowedReportScopes: ['class', 'each_student', 'selected_students']
    })
  }, async () => {
    await withPatched(schoolDataService, {
      fetchData: async () => [
        { id: 'ASN-ACTIVE', templateId: 'TPL-1', reportScope: 'each_student', status: 'active' },
        { id: 'ASN-INACTIVE', templateId: 'TPL-1', reportScope: 'selected_students', status: 'inactive' },
        { id: 'ASN-ARCHIVED', templateId: 'TPL-1', reportScope: 'each_student', status: 'archived' }
      ]
    }, async () => {
      await assert.rejects(
        reportIntegrityService.assertTemplateScopeChangeCompatible({
          templateId: 'TPL-1',
          nextAllowedReportScopes: ['class'],
          reqUser
        }),
        (error) => (
          /3 existing assignments/.test(error.message)
          && /ASN-ACTIVE/.test(error.message)
          && /ASN-INACTIVE/.test(error.message)
          && /ASN-ARCHIVED/.test(error.message)
        )
      );
    });
  });
});

test('template copy and forms carry and enforce approved report scopes', () => {
  const controllerSource = read('packages/school/MVC/controllers/school/reportController.js');
  const templateFormSource = read('packages/school/MVC/views/school/report/templateForm.ejs');
  const assignmentFormSource = read('packages/school/MVC/views/school/report/assignmentForm.ejs');
  const repositorySource = read('packages/school/MVC/repositories/school/index.js');

  assert.match(controllerSource, /allowedReportScopes: reportScopePolicy\.resolveAllowedReportScopes\(sourceTemplate\)/);
  assert.match(templateFormSource, /name="allowedReportScopes"/);
  assert.match(templateFormSource, /Select at least one approved report scope/);
  assert.match(assignmentFormSource, /applyTemplateScopePolicy/);
  assert.match(assignmentFormSource, /option\.disabled = !hasTemplate \|\| !allowedScopes\.includes\(value\)/);
  assert.match(repositorySource, /normalizePayload:[\s\S]*normalizeAllowedReportScopes/);
  assert.match(repositorySource, /transformList:[\s\S]*resolveAllowedReportScopes/);
});

test('template and assignment scope controls render valid client JavaScript', async () => {
  const templateHtml = await ejs.renderFile(
    path.join(ROOT_DIR, 'packages/school/MVC/views/school/report/templateForm.ejs'),
    {
      title: 'New Report Template',
      actionStateId: 'ACTION-1',
      template: null,
      copySourceTemplate: null,
      funderPickerOptions: [],
      templateStatuses: ['draft', 'active', 'inactive', 'archived'],
      fieldTypes: ['text', 'textarea', 'number', 'date', 'select', 'checkbox', 'section', 'subheader', 'row_break'],
      reportScopeDefinitions: reportScopePolicy.REPORT_SCOPE_DEFINITIONS,
      prefillCatalog: {
        common: [], classOnly: [], gradebookPeriodClass: [], gradebookPeriodSkillsClass: [], examPeriodClass: [],
        studentOnly: [], gradebookPeriodStudent: [], gradebookPeriodSkillsStudent: [], examPeriodStudent: []
      }
    },
    { views: [path.join(ROOT_DIR, 'MVC/views')] }
  );

  const assignmentHtml = await ejs.renderFile(
    path.join(ROOT_DIR, 'packages/school/MVC/views/school/report/assignmentForm.ejs'),
    {
      title: 'New Report Assignment',
      actionStateId: 'ACTION-2',
      user: reqUser,
      assignment: null,
      classes: [],
      templates: [],
      sessions: [],
      selectedClassId: '',
      selectedClassTitle: '',
      selectedTemplateId: '',
      selectedTemplateTitle: '',
      selectedTemplateAllowedReportScopes: [],
      selectedSessionIds: [],
      selectedDateTargets: [],
      selectedTaskStartTime: '',
      selectedTaskEndTime: '',
      selectedConflictPermitted: false,
      selectedReportStartDate: '',
      selectedReportDueDate: '',
      selectedTargetRows: [],
      selectedReportScope: 'class',
      selectedTargetStudentIds: [],
      teacherOptions: [],
      studentOptions: [],
      assignmentReportScopes: reportScopePolicy.REPORT_SCOPES,
      reportScopeDefinitions: reportScopePolicy.REPORT_SCOPE_DEFINITIONS,
      assignmentStatuses: ['active', 'inactive', 'archived']
    },
    { views: [path.join(ROOT_DIR, 'MVC/views')] }
  );

  [templateHtml, assignmentHtml].forEach((html) => {
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    assert.ok(scripts.length > 0);
    scripts.forEach((source) => {
      // Parse only; DOM behavior is covered by the source assertions above.
      new Function(source);
    });
  });
});
