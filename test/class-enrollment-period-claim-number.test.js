const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const reportFunderDocxService = require('../packages/school/MVC/services/school/reportFunderDocxService');

const ROOT = path.resolve(__dirname, '..');
function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('class enrollment period model sanitizes claimNumber with trim and max length', () => {
  const model = read('packages/school/MVC/models/school/classEnrollmentPeriodModel.js');
  assert.match(model, /claimNumber: cleanString\(input\.claimNumber, \{ max: 120, allowEmpty: true \}\)/);
});

test('rolling enrollment controller create and edit pass claimNumber without clearing authorizationRef on edit', () => {
  const controller = read('packages/school/MVC/controllers/school/classRollingEnrollmentController.js');
  assert.match(controller, /buildClassEnrollmentCreatePayloadFromRequest[\s\S]*claimNumber: String\(req\.body\?\.claimNumber/);
  const editBlock = controller.match(/async function editClassEnrollmentPeriod[\s\S]*?^async function /m)?.[0] || '';
  assert.match(editBlock, /claimNumber:/);
  assert.doesNotMatch(editBlock, /authorizationRef: ''/);
});

test('rolling enrollment engine passes claimNumber through enrollment payload', () => {
  const engine = read('packages/school/MVC/services/school/rollingEnrollmentEngineService.js');
  assert.match(engine, /claimNumber: String\(input\.claimNumber/);
  assert.match(engine, /claimNumber: normalized\.claimNumber/);
  assert.doesNotMatch(engine, /authorizationRef: ''/);
});

test('resolveEnrollmentClaimNumberForReportPeriod returns overlapping enrollment claim number', () => {
  const claim = reportFunderDocxService.resolveEnrollmentClaimNumberForReportPeriod({
    periodRows: [{
      studentId: 'STU-1',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      claimNumber: 'WCB-CLAIM-99'
    }],
    studentId: 'STU-1',
    windowStart: '2026-06-01',
    windowEnd: '2026-06-30'
  });
  assert.equal(claim, 'WCB-CLAIM-99');
});

test('resolveEnrollmentClaimNumberForReportPeriod returns empty when no matching period', () => {
  const claim = reportFunderDocxService.resolveEnrollmentClaimNumberForReportPeriod({
    periodRows: [{
      studentId: 'STU-OTHER',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      claimNumber: 'WCB-CLAIM-99'
    }],
    studentId: 'STU-1',
    windowStart: '2026-06-01',
    windowEnd: '2026-06-30'
  });
  assert.equal(claim, '');
});
