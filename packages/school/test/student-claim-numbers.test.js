const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const studentModel = require('../MVC/models/school/studentModel');

const ROOT = path.resolve(__dirname, '..', '..', '..');
function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('student model sanitizes claimNumbers with required number and primary flag', () => {
  const cleaned = studentModel.cleanClaimNumbers([
    { id: 'claim_1', number: ' WCB-123 ', label: 'Primary WCB', notes: 'note', isPrimary: true },
    { number: 'CLM-2', isPrimary: false }
  ]);
  assert.equal(cleaned.length, 2);
  assert.equal(cleaned[0].number, 'WCB-123');
  assert.equal(cleaned[0].label, 'Primary WCB');
  assert.equal(cleaned[0].isPrimary, true);
  assert.equal(cleaned[1].number, 'CLM-2');
  assert.equal(cleaned[1].isPrimary, false);
});

test('student model rejects claimNumbers without number', () => {
  assert.throws(() => studentModel.cleanClaimNumbers([{ number: '' }]), /requires a number/i);
});

test('student routes expose claim-numbers API endpoints', () => {
  const routes = read('packages/school/MVC/routes/studentRoutes.js');
  assert.match(routes, /router\.get\('\/api\/:id\/claim-numbers'/);
  assert.match(routes, /ctrl\.getStudentClaimNumbersApi/);
  assert.match(routes, /router\.put\('\/api\/:id\/claim-numbers'/);
  assert.match(routes, /ctrl\.putStudentClaimNumbersApi/);
});

test('student controller resolves legacy studentIdAtFunder when claimNumbers empty', () => {
  const controller = read('packages/school/MVC/controllers/school/studentController.js');
  assert.match(controller, /function resolveClaimNumbersForApi\(/);
  assert.match(controller, /studentIdAtFunder/);
  assert.match(controller, /exports\.getStudentClaimNumbersApi/);
  assert.match(controller, /exports\.putStudentClaimNumbersApi/);
});
