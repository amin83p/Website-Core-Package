const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildTimesheetImportMismatchSummary,
  normalizePersonNameKey
} = require('../MVC/services/school/timesheetImportMismatchSummaryService');

const ROOT = path.resolve(__dirname, '../../..');
const MANAGE_VIEW = path.join(ROOT, 'packages/school/MVC/views/school/timesheet/timesheetManage.ejs');
const CONTROLLER_PATH = path.join(ROOT, 'packages/school/MVC/controllers/school/timesheetController.js');

test('normalizePersonNameKey ignores punctuation and case', () => {
  assert.equal(
    normalizePersonNameKey('Amin Paknejad'),
    normalizePersonNameKey('amin-paknejad')
  );
});

test('buildTimesheetImportMismatchSummary flags name and partial period mismatches', () => {
  const detailedMatchNote = [
    'Excel period falls inside this app period but dates do not match exactly.',
    'Excel: 2026-03-16 to 2026-03-28.',
    'App period 2026-MAR-16 (TSP_1): 2026-03-16 to 2026-03-31.',
    'Start dates match.',
    'Excel end date is 3 days before app period end (2026-03-31).'
  ].join(' ');
  const summary = buildTimesheetImportMismatchSummary([
    {
      fileName: 'march.xlsx',
      status: 'ok',
      employeeNameFromFile: 'Other Teacher',
      matchStatus: 'partial',
      matchedPeriod: { id: 'TP_1', matchStatus: 'partial' },
      matchNote: detailedMatchNote
    }
  ], 'Amin Paknejad');

  assert.equal(summary.blocking, false);
  assert.equal(summary.hasIssues, true);
  assert.equal(summary.issues.length, 2);
  assert.ok(summary.issues.some((issue) => issue.type === 'name_mismatch'));
  const periodIssue = summary.issues.find((issue) => issue.type === 'period_partial');
  assert.ok(periodIssue);
  assert.match(periodIssue.message, /2026-03-16 to 2026-03-28/);
  assert.match(periodIssue.message, /3 days before app period end/);
});

test('buildTimesheetImportMismatchSummary blocks unmatched periods', () => {
  const summary = buildTimesheetImportMismatchSummary([
    {
      fileName: 'bad.xlsx',
      status: 'ok',
      employeeNameFromFile: 'Amin Paknejad',
      matchStatus: 'none',
      matchedPeriod: null
    }
  ], 'Amin Paknejad');

  assert.equal(summary.blocking, true);
  assert.ok(summary.issues.some((issue) => issue.type === 'period_unmatched'));
});

test('timesheet manage view uses split bulk and row import entry points', () => {
  const viewSource = fs.readFileSync(MANAGE_VIEW, 'utf8');
  assert.match(viewSource, /id="btnOpenTimesheetBulkImport"/);
  assert.match(viewSource, /openBulkImportSetupModal/);
  assert.match(viewSource, /openRowImportSetupModal/);
  assert.match(viewSource, /buildImportMismatchSummary/);
  assert.match(viewSource, /expectedPeriodId/);
  assert.doesNotMatch(viewSource, /id="btnOpenTimesheetImport"/);
  assert.match(viewSource, /data-import-person/);
  assert.match(viewSource, /timesheetImportExecutionModal/);
  assert.match(viewSource, /openImportExecutionModal/);
  assert.match(viewSource, /importExecutionPersonRoleByPersonId/);
  assert.match(viewSource, /\/manage\/api\/import\/execution\/plan/);
  assert.match(viewSource, /\/manage\/api\/import\/execution\/perform/);
  assert.doesNotMatch(viewSource, /\/manage\/api\/import\/apply/);
});

test('timesheet controller exposes import execution endpoints', () => {
  const controllerSource = fs.readFileSync(CONTROLLER_PATH, 'utf8');
  assert.match(controllerSource, /planTimesheetImportExecution/);
  assert.match(controllerSource, /performTimesheetImportExecution/);
  assert.match(controllerSource, /timesheetLegacyImportExecutionService/);
  assert.match(controllerSource, /expectedPeriodId/);
  assert.match(controllerSource, /Single-period import accepts exactly one Excel file/);
});
