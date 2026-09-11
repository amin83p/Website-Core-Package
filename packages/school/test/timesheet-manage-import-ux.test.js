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
    'Excel period partially overlaps this app period.',
    'Excel: 2026-03-10 to 2026-03-20.',
    'App period 2026-MAR-16 (TSP_1): 2026-03-16 to 2026-03-31.',
    'Start dates match.',
    'Shared overlap window: 2026-03-16 to 2026-03-15.'
  ].join(' ');
  const summary = buildTimesheetImportMismatchSummary([
    {
      fileName: 'march.xlsx',
      status: 'ok',
      employeeNameFromFile: 'Other Teacher',
      matchStatus: 'partial',
      matchedPeriod: { id: 'TP_1', matchStatus: 'partial' },
      matchNote: detailedMatchNote,
      matchDetails: { kind: 'overlap' }
    }
  ], 'Amin Paknejad');

  assert.equal(summary.blocking, false);
  assert.equal(summary.hasIssues, true);
  assert.equal(summary.issues.length, 2);
  assert.ok(summary.issues.some((issue) => issue.type === 'name_mismatch'));
  const periodIssue = summary.issues.find((issue) => issue.type === 'period_partial');
  assert.ok(periodIssue);
  assert.match(periodIssue.message, /partially overlaps/);
});

test('buildTimesheetImportMismatchSummary does not warn when excel period is contained in app period', () => {
  const summary = buildTimesheetImportMismatchSummary([
    {
      fileName: 'may.xlsx',
      status: 'ok',
      employeeNameFromFile: 'Amin Paknejad',
      matchStatus: 'exact',
      matchedPeriod: { id: 'TSP_2026_MAY_16', matchStatus: 'exact' },
      matchNote: 'Excel period falls within app timesheet period.'
    }
  ], 'Amin Paknejad');

  assert.equal(summary.blocking, false);
  assert.equal(summary.hasIssues, false);
  assert.ok(!summary.issues.some((issue) => issue.type === 'period_partial'));
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
  assert.match(viewSource, /applyActionStateFromResult\(payload\)/);
  assert.match(viewSource, /buildImportExecutionConfirmMessage/);
  assert.match(viewSource, /renderImportExecutionTimesheetCell/);
  assert.match(viewSource, /data-import-exec-open-draft/);
  assert.match(viewSource, /data-import-exec-status/);
  assert.match(viewSource, /renderImportExecutionStatusCell/);
  assert.match(viewSource, /targetStatus:/);
  assert.match(viewSource, /defaultImportTargetStatus/);
  assert.match(viewSource, /statHolidayPreview/);
  assert.match(viewSource, /Stat holiday/);
  assert.match(viewSource, /summarizeImportExecutionStatHolidayPreview/);
  assert.match(viewSource, /payable .* in period/);
  assert.match(viewSource, /Choose Draft to review and edit them in the timesheet editor/);
  assert.doesNotMatch(viewSource, /Stat holiday manual hours/);
  assert.doesNotMatch(viewSource, /js-import-stat-holiday-hours/);
  assert.doesNotMatch(viewSource, /statHolidayOverrides/);
  assert.doesNotMatch(viewSource, /No files are ready to execute/);
  assert.doesNotMatch(viewSource, /\/manage\/api\/import\/apply/);
});

test('timesheet manage view opens execution modal from plan rows including blocked entries', () => {
  const viewSource = fs.readFileSync(MANAGE_VIEW, 'utf8');
  assert.match(viewSource, /ensureModalOnBody\(importExecutionModalEl\)\?\.show\(\)/);
  assert.match(viewSource, /overallStatus: isBlocked \? 'blocked' : 'pending'/);
  assert.match(viewSource, /String\(row\.eligibility \|\| ''\) === 'blocked'/);
  assert.match(viewSource, /buildImportExecutionConfirmMessage\(payload\)/);
});

test('timesheet controller exposes import execution endpoints', () => {
  const controllerSource = fs.readFileSync(CONTROLLER_PATH, 'utf8');
  assert.match(controllerSource, /planTimesheetImportExecution/);
  assert.match(controllerSource, /performTimesheetImportExecution/);
  assert.match(controllerSource, /timesheetLegacyImportExecutionService/);
  assert.match(controllerSource, /expectedPeriodId/);
  assert.match(controllerSource, /Single-period import accepts exactly one Excel file/);
  assert.match(controllerSource, /targetStatus/);
});
