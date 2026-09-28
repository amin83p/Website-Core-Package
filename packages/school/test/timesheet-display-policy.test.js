'use strict';



const test = require('node:test');

const assert = require('node:assert/strict');

const fs = require('node:fs');

const path = require('node:path');



const ROOT = path.resolve(__dirname, '../../..');

const service = require('../MVC/services/school/timesheetDisplayPolicyService');



function read(relativePath) {

  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

}



test('display policy defaults include department on line 1 and session time on line 2', () => {

  const policy = service.resolvePolicy({});

  const classLayout = policy.pulledClassSession;

  assert.ok(classLayout.some((row) => row.field === 'departmentName' && row.line === 1));

  assert.ok(classLayout.some((row) => row.field === 'sessionDateTime' && row.line === 2));

  assert.equal(service.DISPLAY_FIELD_CATALOG.sessionDateTime.label, 'Session Start/End Time');

});



test('compose uses department code on line 1 and start/end time on line 2', () => {

  const composed = service.composeTimesheetRowDisplay({

    sessionId: 'sess-1',

    deliveryDepartmentCode: 'ESL',

    deliveryDepartmentName: 'English',

    className: 'Intermediate',

    date: '2026-03-10',

    startTime: '09:00',

    endTime: '11:00'

  }, service.DEFAULT_POLICY);

  assert.equal(composed.primaryText, 'ESL');

  assert.equal(composed.timeRowText, '09:00 – 11:00');

});

test('compose activity assignee department uses backend department code like class sessions', () => {
  const composed = service.composeTimesheetRowDisplay({
    sessionId: 'act-1',
    isSchoolActivity: true,
    deliveryDepartmentId: 'DEPT-ESL',
    deliveryDepartmentName: 'Wrong cached label',
    startTime: '13:00',
    endTime: '15:00'
  }, service.DEFAULT_POLICY, {
    departmentMap: service.buildDepartmentMapFromRows([
      { id: 'DEPT-ESL', code: 'ESL', name: 'English as a Second Language' }
    ])
  });
  assert.equal(composed.primaryText, 'ESL');
});

test('compose falls back to first org department when id is missing', () => {
  const composed = service.composeTimesheetRowDisplay({
    sessionId: 'man-1',
    isManual: true
  }, service.DEFAULT_POLICY, {
    orgDepartments: [
      { id: 'DEPT-Z', orgId: 'ORG-1', name: 'Zulu Dept' },
      { id: 'DEPT-A', orgId: 'ORG-1', name: 'Academics' }
    ],
    orgId: 'ORG-1'
  });
  assert.equal(composed.primaryText, 'Academics');
});

test('compose resolves department by code when id is missing', () => {
  const composed = service.composeTimesheetRowDisplay({
    sessionId: 'man-1',
    isManual: true,
    deliveryDepartmentCode: 'ADM',
    deliveryDepartmentName: 'Wrong cached label'
  }, service.DEFAULT_POLICY, {
    orgDepartments: [
      { id: 'DEPT-CAEC', orgId: 'ORG-1', code: 'CAEC', name: 'Canadian Adult Education Credential' },
      { id: 'DEPT-ADM', orgId: 'ORG-1', code: 'ADM', name: 'Administration Services' }
    ],
    orgId: 'ORG-1'
  });
  assert.equal(composed.primaryText, 'ADM');
});

test('settings form layouts JSON survives urlencoded POST merge', () => {
  const layouts = {
    pulledClassSession: [
      { kind: 'field', field: 'departmentName', line: 1 },
      { kind: 'separator', text: ' | ', line: 1 },
      { kind: 'field', field: 'className', line: 1 }
    ]
  };
  const parsedBody = { layouts: JSON.stringify(layouts) };
  const merged = { ...parsedBody, ...JSON.parse(parsedBody.layouts) };
  const normalized = service.validatePolicyInput(merged);
  assert.equal(normalized.pulledClassSession.some((row) => row.kind === 'separator' && row.text === ' | '), true);
  assert.equal(normalized.pulledClassSession.some((row) => row.field === 'className'), true);

  const brokenBody = Object.fromEntries(new URLSearchParams({
    pulledClassSession: layouts.pulledClassSession
  }));
  const broken = service.validatePolicyInput(brokenBody);
  assert.equal(broken.pulledClassSession.some((row) => row.kind === 'separator'), false);
});


test('session start/end time never includes session date', () => {

  const composed = service.composeTimesheetRowDisplay({

    sessionId: 'sess-2',

    isSchoolActivity: true,

    className: 'Morning class',

    date: '2026-03-10',

    startTime: '10:00',

    endTime: '11:30'

  }, service.DEFAULT_POLICY);

  assert.equal(composed.timeRowText, '10:00 – 11:30');

  assert.doesNotMatch(composed.timeRowText, /2026/);

  assert.doesNotMatch(composed.timeRowText, /Morning class/);

});



test('validatePolicyInput injects mandatory department name on line 1', () => {

  const normalized = service.validatePolicyInput({

    pulledClassSession: [{ kind: 'field', field: 'className', line: 1 }]

  });

  assert.equal(normalized.pulledClassSession.some((row) => row.field === 'departmentName' && row.line === 1), true);

  assert.equal(normalized.pulledClassSession.some((row) => row.field === 'importedRowContent'), false);

});



test('compose hides line 2 when session time is omitted from layout', () => {

  const policy = service.validatePolicyInput({

    pulledClassSession: [{ kind: 'field', field: 'departmentName', line: 1 }]

  });

  const composed = service.composeTimesheetRowDisplay({

    sessionId: 'sess-3',

    deliveryDepartmentCode: 'ESL',

    startTime: '09:00',

    endTime: '10:00'

  }, policy);

  assert.equal(composed.primaryText, 'ESL');

  assert.equal(composed.showTimeRow, false);

});



test('settings catalog route and editor wire display policy', () => {

  const catalog = read('packages/school/MVC/config/schoolSettingsCatalog.js');

  const routes = read('packages/school/MVC/routes/schoolSettingsRoutes.js');

  const settingsView = read('packages/school/MVC/views/school/settings/index.ejs');

  const editor = read('packages/school/MVC/views/school/timesheet/timesheetEditor.ejs');

  const printService = read('packages/school/MVC/services/school/timesheetPrintService.js');



  assert.match(catalog, /timesheet-display/);

  assert.match(catalog, /Timesheet Display\/Print/);

  assert.match(routes, /\/timesheet-display/);

  assert.match(settingsView, /timesheetDisplaySettingsForm/);

  assert.match(settingsView, /js-ts-display-line/);

  assert.match(settingsView, /Session Start\/End Time/);

  assert.match(settingsView, /timesheetDisplayComposer\.js/);

  assert.match(editor, /TIMESHEET_DISPLAY_POLICY/);

  assert.match(editor, /TimesheetDisplayComposer\.composeTimesheetRowDisplay/);

  assert.match(printService, /timesheetDisplayPolicyService/);

});



test('timesheet display policy model persists through repository backend selector', () => {

  const modelSource = read('packages/school/MVC/models/school/timesheetDisplayPolicyModel.js');

  const migrationSource = read('MVC/services/migration/jsonToMongoMigrationService.js');

  assert.match(modelSource, /runByRepositoryBackend/);

  assert.match(modelSource, /schoolTimesheetDisplayPolicy/);

  assert.match(modelSource, /timesheet-display-policy/);

  assert.match(modelSource, /removePolicyForOrg/);

  assert.match(migrationSource, /school\.timesheetDisplayPolicy/);

  assert.match(migrationSource, /schoolTimesheetDisplayPolicy/);

});



test('timesheet display policy model round-trips org layouts with display lines', async () => {

  const timesheetDisplayPolicyModel = require('../MVC/models/school/timesheetDisplayPolicyModel');

  const orgId = `ORG_DISPLAY_RT_${Date.now()}`;

  const patch = service.validatePolicyInput({

    pulledClassSession: [

      { kind: 'field', field: 'className', line: 1 },

      { kind: 'field', field: 'sessionDateTime', line: 2 }

    ]

  });

  await timesheetDisplayPolicyModel.savePolicyForOrg(orgId, patch, 'TEST_USER');

  const loaded = await timesheetDisplayPolicyModel.getPolicyForOrg(orgId);

  assert.equal(loaded.pulledClassSession.some((row) => row.field === 'className' && row.line === 1), true);

  assert.equal(loaded.pulledClassSession.some((row) => row.field === 'sessionDateTime' && row.line === 2), true);

  assert.equal(loaded.pulledClassSession.some((row) => row.field === 'departmentName' && row.line === 1), true);

});


